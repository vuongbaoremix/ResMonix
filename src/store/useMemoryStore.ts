import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { ProcessTreeNode, MemorySummary, ProcessAnalysis, OnlineProcessInfo, MemorySubView, MemoryHistoryPoint } from "@/types";

export type SortField = "name" | "pid" | "working_set" | "private_bytes" | "subtree";
export type SortOrder = "asc" | "desc";

interface MemoryStore {
  // State
  processTree: ProcessTreeNode[];
  memorySummary: MemorySummary | null;
  isLoading: boolean;
  expandedPids: Set<number>;
  selectedPid: number | null;

  processAnalysis: ProcessAnalysis | null;
  onlineInfo: OnlineProcessInfo | null;
  isAnalyzing: boolean;
  memorySubView: MemorySubView;
  sortBy: SortField;
  sortOrder: SortOrder;
  searchQuery: string;
  autoRefresh: boolean;
  history: MemoryHistoryPoint[];

  // Actions
  fetchProcessTree: () => Promise<void>;
  toggleNode: (pid: number) => void;
  selectProcess: (pid: number | null) => void;

  analyzeProcess: (pid: number) => Promise<void>;
  killProcess: (pid: number) => Promise<void>;
  setMemorySubView: (subView: MemorySubView) => void;
  setSort: (field: SortField) => void;
  setSearch: (query: string) => void;
  toggleAutoRefresh: () => void;
  expandAll: () => void;
  collapseAll: () => void;
  optimizeMemory: (mode: number) => Promise<number>;
}

function collectAllPids(nodes: ProcessTreeNode[]): number[] {
  const pids: number[] = [];
  for (const node of nodes) {
    if (node.children.length > 0) {
      pids.push(node.process.pid);
      pids.push(...collectAllPids(node.children));
    }
  }
  return pids;
}

function sortTree(nodes: ProcessTreeNode[], sortBy: SortField, sortOrder: SortOrder): ProcessTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "name":
        cmp = a.process.name.localeCompare(b.process.name);
        break;
      case "pid":
        cmp = a.process.pid - b.process.pid;
        break;
      case "working_set":
        cmp = a.process.working_set - b.process.working_set;
        break;
      case "private_bytes":
        cmp = a.process.private_bytes - b.process.private_bytes;
        break;
      case "subtree":
        cmp = a.subtree_working_set - b.subtree_working_set;
        break;
    }
    return sortOrder === "desc" ? -cmp : cmp;
  });
  return sorted.map((node) => ({
    ...node,
    children: sortTree(node.children, sortBy, sortOrder),
  }));
}

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  processTree: [],
  memorySummary: null,
  isLoading: false,
  expandedPids: new Set(),
  selectedPid: null,

  processAnalysis: null,
  onlineInfo: null,
  isAnalyzing: false,
  memorySubView: "tree",
  sortBy: "working_set",
  sortOrder: "desc",
  searchQuery: "",
  autoRefresh: true,
  history: [],

  fetchProcessTree: async () => {
    const { isLoading } = get();
    if (isLoading) return;

    set({ isLoading: true });
    try {
      const [summary, tree] = await invoke<[MemorySummary, ProcessTreeNode[]]>("get_process_tree");
      
      const now = Date.now();
      const processUsage: Record<number, number> = {};
      
      const traverseForHistory = (nodes: ProcessTreeNode[]) => {
        for (const n of nodes) {
          processUsage[n.process.pid] = n.process.working_set;
          traverseForHistory(n.children);
        }
      };
      traverseForHistory(tree);

      const historyPoint: MemoryHistoryPoint = {
        timestamp: now,
        totalUsed: summary.used_physical,
        processUsage,
      };

      set((state) => {
        const newHistory = [...state.history, historyPoint].slice(-60); // Keep last 60 points
        return {
          processTree: sortTree(tree, state.sortBy, state.sortOrder),
          memorySummary: summary,
          isLoading: false,
          history: newHistory,
        };
      });
    } catch (error) {
      console.error("Failed to fetch process tree:", error);
      set({ isLoading: false });
    }
  },

  toggleNode: (pid: number) => {
    const { expandedPids } = get();
    const newExpanded = new Set(expandedPids);
    if (newExpanded.has(pid)) {
      newExpanded.delete(pid);
    } else {
      newExpanded.add(pid);
    }
    set({ expandedPids: newExpanded });
  },

  selectProcess: (pid: number | null) => {
    set({ selectedPid: pid, processAnalysis: null, onlineInfo: null });
    if (pid !== null) {
      // Find the process name and describe it
      const { processTree } = get();
      const findProcess = (nodes: ProcessTreeNode[]): string | null => {
        for (const node of nodes) {
          if (node.process.pid === pid) return node.process.name;
          const found = findProcess(node.children);
          if (found) return found;
        }
        return null;
      };
      const name = findProcess(processTree);

      // Auto-analyze
      get().analyzeProcess(pid);
      // Auto-lookup online
      if (name) {
        invoke<OnlineProcessInfo>("lookup_process_online", { name })
          .then((info) => set({ onlineInfo: info }))
          .catch(() => set({ onlineInfo: null }));
      }
    }
  },



  analyzeProcess: async (pid: number) => {
    set({ isAnalyzing: true, processAnalysis: null });
    try {
      const analysis = await invoke<ProcessAnalysis>("analyze_process", { pid });
      set({ processAnalysis: analysis, isAnalyzing: false });
    } catch (error) {
      console.error("Failed to analyze process:", error);
      set({ isAnalyzing: false });
    }
  },

  killProcess: async (pid: number) => {
    try {
      await invoke("kill_process", { pid });
      // Refresh the process tree after killing
      await get().fetchProcessTree();
      // Clear selection if the killed process was selected
      const { selectedPid } = get();
      if (selectedPid === pid) {
        set({ selectedPid: null });
      }
    } catch (error) {
      console.error("Failed to kill process:", error);
      throw error;
    }
  },

  setMemorySubView: (subView: MemorySubView) => {
    set({ memorySubView: subView });
  },

  setSort: (field: SortField) => {
    const { sortBy, sortOrder, processTree } = get();
    const newOrder = sortBy === field && sortOrder === "desc" ? "asc" : "desc";
    set({
      sortBy: field,
      sortOrder: newOrder,
      processTree: sortTree(processTree, field, newOrder),
    });
  },

  setSearch: (query: string) => {
    set({ searchQuery: query });
  },

  toggleAutoRefresh: () => {
    const { autoRefresh } = get();
    set({ autoRefresh: !autoRefresh });
  },

  expandAll: () => {
    const { processTree } = get();
    const allPids = collectAllPids(processTree);
    set({ expandedPids: new Set(allPids) });
  },

  collapseAll: () => {
    set({ expandedPids: new Set() });
  },

  optimizeMemory: async (mode: number) => {
    try {
      const freed = await invoke<number>("optimize_memory", { mode });
      // Fetch fresh data immediately
      await get().fetchProcessTree();
      return freed;
    } catch (error) {
      console.error("Failed to optimize memory:", error);
      throw error;
    }
  },
}));
