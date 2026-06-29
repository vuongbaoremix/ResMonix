import { useCallback, useMemo, useRef, useEffect } from "react";
import { useDiskStore } from "@/store/useDiskStore";
import { formatSize, formatDate, formatNumber, getRiskClass } from "@/lib/format";
import type { FileNodeSummary } from "@/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  Link,
  Lock,
  Loader2,
} from "lucide-react";

interface FlatNode {
  node: FileNodeSummary;
  depth: number;
  parentSize: number;
}

function TreeNode({
  flatNode,
  style,
}: {
  flatNode: FlatNode;
  style: React.CSSProperties;
}) {
  const { node, depth, parentSize } = flatNode;
  
  const toggleNode = useDiskStore((state) => state.toggleNode);
  const selectNode = useDiskStore((state) => state.selectNode);
  const isExpanded = useDiskStore((state) => state.expandedNodes.has(node.id));
  const isSelected = useDiskStore((state) => state.selectedNode?.id === node.id);

  const isDir = node.node_type === "directory";
  const percent = parentSize > 0 ? (node.size / parentSize) * 100 : 0;

  const handleClick = useCallback(() => {
    selectNode(node);
  }, [node, selectNode]);

  const isScanningThisNode = useDiskStore((state) => {
    if (!state.isScanning || !isDir || !state.scanProgress?.active_dirs) return false;
    
    const activeDirs = state.scanProgress.active_dirs;
    
    for (const currentDir of activeDirs) {
      if (currentDir === node.path) return true;
      
      const normalizedPath = node.path.endsWith("\\") || node.path.endsWith("/") 
        ? node.path 
        : node.path + "\\";
        
      const normalizedPathForward = node.path.endsWith("\\") || node.path.endsWith("/")
        ? node.path
        : node.path + "/";

      const currentLower = currentDir.toLowerCase();
      if (currentLower.startsWith(normalizedPath.toLowerCase()) || 
          currentLower.startsWith(normalizedPathForward.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  });

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isDir && node.has_children) {
        toggleNode(node.id);
      }
    },
    [isDir, node.has_children, node.id, toggleNode]
  );

  const nodeIcon = useMemo(() => {
    if (node.access_denied) return <Lock className="h-3.5 w-3.5 text-destructive" />;
    if (node.node_type === "symlink" || node.node_type === "junction")
      return <Link className="h-3.5 w-3.5 text-muted-foreground" />;
    if (isDir) {
      return isExpanded ? (
        <FolderOpen className="h-3.5 w-3.5 text-yellow-500" />
      ) : (
        <Folder className="h-3.5 w-3.5 text-yellow-500" />
      );
    }
    return <File className="h-3.5 w-3.5 text-muted-foreground" />;
  }, [node.access_denied, node.node_type, isDir, isExpanded]);

  return (
    <div style={style}>
      {/* Node row */}
      <div
        className={`flex items-center gap-2 py-0.5 px-1 rounded-sm cursor-pointer group text-[13px] leading-5 h-full
          ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}
        `}
        onClick={handleClick}
        onDoubleClick={handleToggle}
      >
        <div className="flex-1 min-w-0 flex items-center gap-1" style={{ paddingLeft: `${depth * 16}px` }}>
          {/* Expand/collapse toggle */}
          <span
            className="flex items-center justify-center w-4 h-4 shrink-0"
            onClick={handleToggle}
          >
            {isDir && node.has_children ? (
              isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )
            ) : null}
          </span>

          {/* Icon */}
          <span className="shrink-0">{nodeIcon}</span>

          {/* Name & Loading Indicator */}
          <span className="truncate flex items-center gap-2">
            {node.name}
            {isScanningThisNode && (
              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            )}
          </span>

          {/* Risk indicator */}
          {node.risk_level !== "unknown" && (
            <span className={`text-[10px] ml-1 ${getRiskClass(node.risk_level)}`}>
              {node.risk_level === "dangerous"
                ? "🔴"
                : node.risk_level === "caution"
                  ? "🟡"
                  : "🟢"}
            </span>
          )}
        </div>

        {/* Size bar & Percent */}
        <div className="w-[100px] shrink-0 flex items-center gap-1 justify-end text-[11px] tabular-nums text-muted-foreground">
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(percent, 1)}%`,
                backgroundColor: "oklch(0.65 0.19 250 / 60%)",
              }}
            />
          </div>
          <span className="w-10 text-right">{percent.toFixed(1)}%</span>
        </div>

        {/* Logical Size */}
        <span className="text-muted-foreground text-[11px] w-20 text-right shrink-0 tabular-nums">
          {formatSize(node.size)}
        </span>

        {/* Physical Size (Estimated) */}
        <span className="text-muted-foreground text-[11px] w-20 text-right shrink-0 tabular-nums hidden lg:block">
          {formatSize(Math.ceil(node.size / 4096) * 4096)}
        </span>

        {/* Items */}
        <span className="text-muted-foreground text-[11px] w-16 text-right shrink-0 tabular-nums">
          {formatNumber(node.file_count + node.dir_count)}
        </span>

        {/* Modified */}
        <span className="text-muted-foreground text-[11px] w-28 text-right shrink-0 tabular-nums hidden md:block">
          {formatDate(node.last_modified)}
        </span>
      </div>
    </div>
  );
}

export function VirtualTree() {
  const rootNode = useDiskStore((state) => state.rootNode);
  const isScanning = useDiskStore((state) => state.isScanning);
  const refreshVisibleNodes = useDiskStore((state) => state.refreshVisibleNodes);
  const expandedNodes = useDiskStore((state) => state.expandedNodes);
  const childrenCache = useDiskStore((state) => state.childrenCache);

  useEffect(() => {
    if (!isScanning) return;
    
    // Refresh visible nodes every 500ms during scan
    const interval = setInterval(() => {
      refreshVisibleNodes();
    }, 500);
    
    return () => clearInterval(interval);
  }, [isScanning, refreshVisibleNodes]);

  // Flatten the tree for virtualization
  const flattenedData = useMemo(() => {
    if (!rootNode) return [];
    
    const result: FlatNode[] = [];
    
    const flatten = (node: FileNodeSummary, depth: number, parentSize: number) => {
      result.push({ node, depth, parentSize });
      if (expandedNodes.has(node.id)) {
        const children = childrenCache.get(node.id) || [];
        for (const child of children) {
          flatten(child, depth + 1, node.size);
        }
      }
    };
    
    flatten(rootNode, 0, rootNode.size);
    return result;
  }, [rootNode, expandedNodes, childrenCache]);

  const scrollRef = useRef<HTMLDivElement>(null);
  
  const rowVirtualizer = useVirtualizer({
    count: flattenedData.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28, // Height of our row (approx 28px)
    overscan: 10,
  });

  if (!rootNode) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-4">
          <div className="relative mx-auto w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-muted" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p>Đang chuẩn bị quét...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header Row */}
      <div className="flex items-center gap-2 py-1.5 px-2 border-b text-xs font-semibold text-muted-foreground bg-muted/30 sticky top-0 z-10 shrink-0 pr-4">
        <div className="flex-1 min-w-0 pl-6">Name</div>
        <div className="w-[100px] shrink-0 text-right">Percent</div>
        <div className="w-20 shrink-0 text-right">Size</div>
        <div className="w-20 shrink-0 text-right hidden lg:block">Physical Size</div>
        <div className="w-16 shrink-0 text-right">Items</div>
        <div className="w-28 shrink-0 text-right hidden md:block">Modified</div>
      </div>
      
      {/* Virtualized Tree Content */}
      <div 
        ref={scrollRef} 
        className="flex-1 overflow-auto"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => (
            <TreeNode
              key={flattenedData[virtualItem.index].node.id}
              flatNode={flattenedData[virtualItem.index]}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
