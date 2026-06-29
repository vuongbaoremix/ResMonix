import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DriveInfo,
  FileNodeSummary,
  ScanProgress,
  ScanComplete,
  TreemapNode,
  Suggestion,
  FileDescription,
  ActiveModule,
  DiskSubView,
  DiskSortField,
  SortOrder,
} from "@/types";

interface DiskStore {
  // === State ===
  drives: DriveInfo[];
  selectedDrive: string | null;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  scanComplete: ScanComplete | null;
  rootNode: FileNodeSummary | null;
  selectedNode: FileNodeSummary | null;
  expandedNodes: Set<number>;
  childrenCache: Map<number, FileNodeSummary[]>;
  activeModule: ActiveModule;
  diskSubView: DiskSubView;
  treemapData: TreemapNode | null;
  treemapRootId: number;
  fileDescription: FileDescription | null;
  suggestions: Suggestion[];
  isDarkMode: boolean;
  sortBy: DiskSortField;
  sortOrder: SortOrder;

  // === Actions ===
  fetchDrives: () => Promise<void>;
  selectDrive: (mountPoint: string) => void;
  startScan: (path: string) => Promise<void>;
  cancelScan: () => Promise<void>;
  selectNode: (node: FileNodeSummary | null) => void;
  toggleNode: (nodeId: number) => Promise<void>;
  refreshVisibleNodes: () => Promise<void>;
  loadChildren: (nodeId: number) => Promise<FileNodeSummary[]>;
  setActiveModule: (module: ActiveModule) => void;
  setDiskSubView: (subView: DiskSubView) => void;
  loadTreemapData: (nodeId: number) => Promise<void>;
  loadSuggestions: () => Promise<void>;
  describeFile: (path: string) => Promise<void>;
  deleteItem: (path: string, permanent: boolean) => Promise<number>;
  openInExplorer: (path: string) => Promise<void>;
  getLargestFiles: (count: number) => Promise<FileNodeSummary[]>;
  toggleDarkMode: () => void;
  setSort: (field: DiskSortField) => void;
  initEventListeners: () => Promise<void>;
}

export const useDiskStore = create<DiskStore>((set, get) => ({
  // Initial state
  drives: [],
  selectedDrive: null,
  isScanning: false,
  scanProgress: null,
  scanComplete: null,
  rootNode: null,
  selectedNode: null,
  expandedNodes: new Set(),
  childrenCache: new Map(),
  activeModule: "dashboard",
  diskSubView: "tree",
  treemapData: null,
  treemapRootId: 0,
  fileDescription: null,
  suggestions: [],
  isDarkMode: true,
  sortBy: "size",
  sortOrder: "desc",

  fetchDrives: async () => {
    try {
      const drives = await invoke<DriveInfo[]>("get_drives");
      set({ drives });
    } catch (error) {
      console.error("Failed to fetch drives:", error);
    }
  },

  selectDrive: (mountPoint: string) => {
    set({
      selectedDrive: mountPoint,
      rootNode: null,
      selectedNode: null,
      expandedNodes: new Set(),
      childrenCache: new Map(),
      treemapData: null,
      scanComplete: null,
      suggestions: [],
    });
  },

  startScan: async (path: string) => {
    set({
      isScanning: true,
      scanProgress: null,
      scanComplete: null,
      rootNode: null,
      selectedNode: null,
      expandedNodes: new Set(),
      childrenCache: new Map(),
      treemapData: null,
      suggestions: [],
    });

    try {
      await invoke("scan_directory", { path });
    } catch (error) {
      console.error("Scan failed:", error);
      set({ isScanning: false });
    }
  },

  cancelScan: async () => {
    try {
      await invoke("cancel_scan");
      set({ isScanning: false });
    } catch (error) {
      console.error("Failed to cancel scan:", error);
    }
  },

  selectNode: (node: FileNodeSummary | null) => {
    set({ selectedNode: node, fileDescription: null });
    if (node) {
      get().describeFile(node.path);
    }
  },

  toggleNode: async (nodeId: number) => {
    const isExpanding = !get().expandedNodes.has(nodeId);
    
    // Update expanded state synchronously to avoid race conditions and provide immediate UI feedback
    set((state) => {
      const newExpanded = new Set(state.expandedNodes);
      if (newExpanded.has(nodeId)) {
        newExpanded.delete(nodeId);
      } else {
        newExpanded.add(nodeId);
      }
      return { expandedNodes: newExpanded };
    });

    // Load children if we just expanded it and it's not cached
    if (isExpanding && !get().childrenCache.has(nodeId)) {
      await get().loadChildren(nodeId);
    }
  },

  refreshVisibleNodes: async () => {
    const { rootNode, expandedNodes } = get();
    if (!rootNode) return;

    try {
      // 1. Refresh root node to get latest total sizes
      const updatedRoot = await invoke<FileNodeSummary>("get_root_node");
      set({ rootNode: updatedRoot });

      // 2. Fetch the latest children for all expanded nodes
      const { sortBy, sortOrder } = get();
      const fetchPromises = Array.from(expandedNodes).map(async (parentId) => {
        try {
          const children = await invoke<FileNodeSummary[]>("get_node_children_sorted", {
            nodeId: parentId,
            sortBy,
            sortOrder,
          });
          return { parentId, children };
        } catch (e) {
          return null;
        }
      });

      const results = await Promise.all(fetchPromises);

      // 3. Update cache functionally to prevent overwriting parallel changes
      set((state) => {
        const newCache = new Map(state.childrenCache);
        let changed = false;
        for (const res of results) {
          if (res) {
            newCache.set(res.parentId, res.children);
            changed = true;
          }
        }
        return changed ? { childrenCache: newCache } : {};
      });
    } catch (e) {
      console.error("Failed to refresh visible nodes", e);
    }
  },

  loadChildren: async (nodeId: number) => {
    try {
      const { sortBy, sortOrder } = get();
      const children = await invoke<FileNodeSummary[]>("get_node_children_sorted", {
        nodeId,
        sortBy,
        sortOrder,
      });
      set((state) => {
        const newCache = new Map(state.childrenCache);
        newCache.set(nodeId, children);
        return { childrenCache: newCache };
      });
      return children;
    } catch (error) {
      console.error("Failed to load children:", error);
      return [];
    }
  },

  setActiveModule: (module: ActiveModule) => {
    set({ activeModule: module });
    if (module === "disk") {
      const { diskSubView } = get();
      if (diskSubView === "treemap") {
        const { treemapRootId } = get();
        get().loadTreemapData(treemapRootId);
      }
    } else if (module === "suggestions") {
      get().loadSuggestions();
    }
  },

  setDiskSubView: (subView: DiskSubView) => {
    set({ diskSubView: subView });
    if (subView === "treemap") {
      const { treemapRootId } = get();
      get().loadTreemapData(treemapRootId);
    }
  },

  loadTreemapData: async (nodeId: number) => {
    try {
      const data = await invoke<TreemapNode | null>("get_treemap_data", {
        nodeId,
        maxDepth: 5,
      });
      set({ treemapData: data, treemapRootId: nodeId });
    } catch (error) {
      console.error("Failed to load treemap data:", error);
    }
  },

  loadSuggestions: async () => {
    try {
      const suggestions = await invoke<Suggestion[]>("get_suggestions");
      set({ suggestions });
    } catch (error) {
      console.error("Failed to load suggestions:", error);
    }
  },

  describeFile: async (path: string) => {
    try {
      const description = await invoke<FileDescription | null>(
        "describe_path",
        { path }
      );
      set({ fileDescription: description });
    } catch (error) {
      console.error("Failed to describe file:", error);
    }
  },

  deleteItem: async (path: string, permanent: boolean) => {
    try {
      const freedBytes = await invoke<number>("delete_item", {
        path,
        permanent,
      });
      // Refresh the parent's children
      const { selectedNode } = get();
      if (selectedNode?.parent_id != null) {
        await get().loadChildren(selectedNode.parent_id);
      }
      return freedBytes;
    } catch (error) {
      console.error("Failed to delete:", error);
      throw error;
    }
  },

  openInExplorer: async (path: string) => {
    try {
      await invoke("open_in_explorer", { path });
    } catch (error) {
      console.error("Failed to open in explorer:", error);
    }
  },

  getLargestFiles: async (count: number) => {
    try {
      return await invoke<FileNodeSummary[]>("get_largest_files", { count });
    } catch (error) {
      console.error("Failed to get largest files:", error);
      return [];
    }
  },

  toggleDarkMode: () => {
    const { isDarkMode } = get();
    const newMode = !isDarkMode;
    set({ isDarkMode: newMode });
    document.documentElement.classList.toggle("dark", newMode);
  },

  setSort: (field: DiskSortField) => {
    const { sortBy, sortOrder, childrenCache, expandedNodes } = get();
    const newOrder = sortBy === field && sortOrder === "desc" ? "asc" : "desc";
    set({ sortBy: field, sortOrder: newOrder, childrenCache: new Map() });

    // Reload all expanded nodes with new sort
    const reloadAll = async () => {
      const newCache = new Map<number, FileNodeSummary[]>();
      for (const parentId of expandedNodes) {
        try {
          const children = await invoke<FileNodeSummary[]>("get_node_children_sorted", {
            nodeId: parentId,
            sortBy: field,
            sortOrder: newOrder,
          });
          newCache.set(parentId, children);
        } catch {
          // Skip failed nodes
        }
      }
      set({ childrenCache: newCache });
    };
    reloadAll();
  },

  initEventListeners: async () => {
    // Listen for scan progress
    await listen<ScanProgress>("scan:progress", async (event) => {
      const state = get();
      set({ scanProgress: event.payload });

      // Attempt to load root node if not loaded yet
      if (state.isScanning && !state.rootNode) {
        try {
          const rootNode = await invoke<FileNodeSummary>("get_root_node");
          set({ rootNode, treemapRootId: rootNode.id });
          
          // Auto-expand root
          const expandedNodes = new Set<number>();
          expandedNodes.add(rootNode.id);
          set({ expandedNodes });
          
          await get().loadChildren(rootNode.id);
        } catch (e) {
          // Ignore, might not be ready
        }
      }
    });

    // Listen for scan completion
    await listen<ScanComplete>("scan:complete", async (event) => {
      set({
        isScanning: false,
        scanComplete: event.payload,
      });

      // Load root node
      try {
        const rootNode = await invoke<FileNodeSummary>("get_root_node");
        set({ rootNode, treemapRootId: rootNode.id });

        // Auto-expand root and load its children
        const { sortBy, sortOrder } = get();
        const children = await invoke<FileNodeSummary[]>(
          "get_node_children_sorted",
          { nodeId: rootNode.id, sortBy, sortOrder }
        );
        const childrenCache = new Map<number, FileNodeSummary[]>();
        childrenCache.set(rootNode.id, children);
        const expandedNodes = new Set<number>();
        expandedNodes.add(rootNode.id);

        set({ childrenCache, expandedNodes });
      } catch (error) {
        console.error("Failed to load root node:", error);
      }
    });

    // Listen for scan errors
    await listen<string>("scan:error", (event) => {
      console.error("Scan error:", event.payload);
      set({ isScanning: false });
    });

    // Initialize dark mode
    document.documentElement.classList.add("dark");
  },
}));
