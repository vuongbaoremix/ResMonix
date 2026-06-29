import { useMemo, useState, useRef, useEffect } from "react";
import { useDiskStore } from "@/store/useDiskStore";
import { formatSize, formatNumber } from "@/lib/format";
import type { TreemapNode, NodeType, RiskLevel } from "@/types";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

// ===== Color Scheme by node type + risk =====

const NODE_TYPE_COLORS: Record<NodeType, { base: string; hover: string }> = {
  directory: { base: "oklch(0.32 0.12 250)", hover: "oklch(0.38 0.14 250)" },
  file:      { base: "oklch(0.35 0.10 200)", hover: "oklch(0.40 0.12 200)" },
  symlink:   { base: "oklch(0.33 0.08 290)", hover: "oklch(0.38 0.10 290)" },
  junction:  { base: "oklch(0.33 0.08 290)", hover: "oklch(0.38 0.10 290)" },
  unknown:   { base: "oklch(0.30 0.02 250)", hover: "oklch(0.35 0.03 250)" },
};

const RISK_COLORS: Record<RiskLevel, { base: string; hover: string }> = {
  safe:      { base: "oklch(0.33 0.14 145)", hover: "oklch(0.38 0.16 145)" },
  caution:   { base: "oklch(0.38 0.14 75)",  hover: "oklch(0.43 0.16 75)" },
  dangerous: { base: "oklch(0.35 0.18 25)",  hover: "oklch(0.40 0.20 25)" },
  unknown:   { base: "oklch(0.32 0.12 250)", hover: "oklch(0.38 0.14 250)" },
};

function getNodeColor(node: TreemapNode): { base: string; hover: string } {
  if (node.risk_level !== "unknown") {
    return RISK_COLORS[node.risk_level];
  }
  return NODE_TYPE_COLORS[node.node_type] || NODE_TYPE_COLORS.unknown;
}

// ===== Squarified Treemap Layout =====

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(sizes: number[], x: number, y: number, w: number, h: number): Rect[] {
  if (sizes.length === 0 || w <= 0 || h <= 0) return [];

  const totalSize = sizes.reduce((sum, s) => sum + s, 0);
  if (totalSize === 0) return sizes.map(() => ({ x, y, w: 0, h: 0 }));

  const rects: Rect[] = new Array(sizes.length);
  const indices = sizes.map((s, i) => ({ size: s, idx: i }));
  indices.sort((a, b) => b.size - a.size);

  let cx = x, cy = y, rw = w, rh = h;
  let i = 0;

  while (i < indices.length) {
    const isHoriz = rw >= rh;
    const totalRemaining = indices.slice(i).reduce((s, v) => s + v.size, 0);

    let rowSize = 0;
    let rowEnd = i;
    let bestAspect = Infinity;

    for (let j = i; j < indices.length; j++) {
      rowSize += indices[j].size;
      const ratio = rowSize / totalRemaining;
      const sliceSize = isHoriz ? rw * ratio : rh * ratio;

      let worstAspect = 0;
      const span = isHoriz ? rh : rw;

      for (let k = i; k <= j; k++) {
        const nodeRatio = indices[k].size / rowSize;
        const nodeSize = span * nodeRatio;
        if (nodeSize > 0 && sliceSize > 0) {
          const aspect = Math.max(sliceSize / nodeSize, nodeSize / sliceSize);
          worstAspect = Math.max(worstAspect, aspect);
        }
      }

      if (worstAspect <= bestAspect) {
        bestAspect = worstAspect;
        rowEnd = j;
      } else {
        break;
      }
    }

    const rowTotal = indices.slice(i, rowEnd + 1).reduce((s, v) => s + v.size, 0);
    const rowRatio = rowTotal / totalRemaining;
    const sliceSize = isHoriz ? rw * rowRatio : rh * rowRatio;

    let offset = 0;
    const span = isHoriz ? rh : rw;

    for (let k = i; k <= rowEnd; k++) {
      const nodeRatio = indices[k].size / rowTotal;
      const nodeSize = span * nodeRatio;

      if (isHoriz) {
        rects[indices[k].idx] = { x: cx, y: cy + offset, w: sliceSize, h: nodeSize };
      } else {
        rects[indices[k].idx] = { x: cx + offset, y: cy, w: nodeSize, h: sliceSize };
      }
      offset += nodeSize;
    }

    if (isHoriz) {
      cx += sliceSize;
      rw -= sliceSize;
    } else {
      cy += sliceSize;
      rh -= sliceSize;
    }

    i = rowEnd + 1;
  }

  return rects;
}

// ===== Hook: container pixel measurement =====

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ w: width, h: height });
      }
    });
    observer.observe(ref.current);
    const { width, height } = ref.current.getBoundingClientRect();
    setSize({ w: width, h: height });
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

// ===== Inner File/Dir Cell =====

function TreemapCell({
  node,
  rect,
  totalSize,
  onDrillDown,
  onSelect,
  isSelected,
  containerPx,
}: {
  node: TreemapNode;
  rect: Rect;
  totalSize: number;
  onDrillDown: (node: TreemapNode) => void;
  onSelect: (node: TreemapNode) => void;
  isSelected: boolean;
  containerPx: { w: number; h: number };
}) {
  const [hovered, setHovered] = useState(false);
  const colors = getNodeColor(node);
  const pct = totalSize > 0 ? (node.size / totalSize) * 100 : 0;

  const pxW = (rect.w / 100) * containerPx.w;
  const pxH = (rect.h / 100) * containerPx.h;

  if (pxW < 3 || pxH < 3) return null;

  const showName = pxW > 35 && pxH > 16;
  const showSize = pxW > 50 && pxH > 28;
  const showPct = pxW > 50 && pxH > 40;
  const showItems = pxW > 70 && pxH > 52;

  const fontSize = pxW > 90 ? 11 : pxW > 60 ? 10 : 8;
  const fontSizeSub = pxW > 90 ? 10 : pxW > 60 ? 9 : 7;

  const hasChildren = node.children && node.children.length > 0;
  const itemCount = node.file_count + node.dir_count;

  return (
    <div
      className="absolute overflow-hidden cursor-pointer transition-colors duration-100"
      style={{
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        backgroundColor: hovered ? colors.hover : colors.base,
        outline: isSelected
          ? "2px solid oklch(0.9 0 0)"
          : "1px solid oklch(0.2 0 0 / 40%)",
        outlineOffset: isSelected ? "-2px" : "-0.5px",
        zIndex: isSelected ? 10 : hovered ? 5 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (hasChildren) {
          onDrillDown(node);
        } else {
          onSelect(node);
        }
      }}
      title={`${node.name}\n${formatSize(node.size)} (${pct.toFixed(2)}%)\n${itemCount > 0 ? `${formatNumber(itemCount)} items` : ""}`}
    >
      {showName && (
        <div className="p-[2px] flex flex-col items-center justify-center h-full text-center">
          <div
            className="text-white font-bold truncate w-full leading-tight"
            style={{ fontSize: `${fontSize}px` }}
          >
            {node.name}
          </div>
          {showSize && (
            <div
              className="text-white/70 tabular-nums truncate w-full leading-tight"
              style={{ fontSize: `${fontSizeSub}px` }}
            >
              {formatSize(node.size)}
            </div>
          )}
          {showPct && (
            <div
              className="tabular-nums truncate w-full leading-tight font-semibold"
              style={{
                fontSize: `${fontSize}px`,
                color:
                  pct > 10
                    ? "oklch(0.85 0.18 25)"
                    : pct > 3
                      ? "oklch(0.85 0.14 75)"
                      : "oklch(0.8 0 0 / 60%)",
              }}
            >
              {pct.toFixed(1)}%
            </div>
          )}
          {showItems && itemCount > 0 && (
            <div
              className="text-white/40 tabular-nums truncate w-full leading-tight"
              style={{ fontSize: `${fontSizeSub}px` }}
            >
              {formatNumber(itemCount)} items
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Group Container (for directories with children) =====

function GroupContainer({
  node,
  rect,
  totalSize,
  onDrillDown,
  onSelect,
  containerPx,
}: {
  node: TreemapNode;
  rect: Rect;
  totalSize: number;
  onDrillDown: (node: TreemapNode) => void;
  onSelect: (node: TreemapNode) => void;
  containerPx: { w: number; h: number };
}) {
  const selectedNodeId = useDiskStore((s) => s.selectedNode?.id);
  const children = node.children || [];
  const pct = totalSize > 0 ? (node.size / totalSize) * 100 : 0;

  const groupPxW = (rect.w / 100) * containerPx.w;
  const groupPxH = (rect.h / 100) * containerPx.h;

  const HEADER_PX = 18;
  const showHeader = groupPxH > 30 && groupPxW > 40;

  const innerPx = {
    w: groupPxW - 2,
    h: groupPxH - (showHeader ? HEADER_PX : 0) - 2,
  };

  // Layout inner children
  const innerSizes = children.map((c) => c.size);
  const innerRects = useMemo(
    () => children.length <= 1
      ? [{ x: 0, y: 0, w: 100, h: 100 }]
      : squarify(innerSizes, 0, 0, 100, 100),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [children.length, node.size],
  );

  if (groupPxW < 4 || groupPxH < 4) return null;

  const itemCount = node.file_count + node.dir_count;

  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        border: "1px solid oklch(0.5 0 0 / 30%)",
      }}
    >
      {/* Group header label */}
      {showHeader && (
        <div
          className="flex items-center justify-between px-1.5 shrink-0 bg-black/50 overflow-hidden cursor-pointer"
          style={{ height: `${HEADER_PX}px` }}
          onClick={() => onDrillDown(node)}
        >
          <span
            className="text-white/90 font-bold uppercase truncate"
            style={{ fontSize: "9px", letterSpacing: "0.5px" }}
          >
            {node.name}
            {itemCount > 0 ? ` (${formatNumber(itemCount)})` : ""}
          </span>
          <span
            className="text-white/50 tabular-nums shrink-0 ml-1"
            style={{ fontSize: "8px" }}
          >
            {formatSize(node.size)} · {pct.toFixed(1)}%
          </span>
        </div>
      )}

      {/* Inner cells */}
      <div
        className="relative"
        style={{
          height: showHeader ? `calc(100% - ${HEADER_PX}px)` : "100%",
        }}
      >
        {children.map((child, i) => {
          const childHasChildren = child.children && child.children.length > 0;

          if (childHasChildren) {
            return (
              <GroupContainer
                key={`${child.path}-${i}`}
                node={child}
                rect={innerRects[i] || { x: 0, y: 0, w: 0, h: 0 }}
                totalSize={totalSize}
                onDrillDown={onDrillDown}
                onSelect={onSelect}
                containerPx={innerPx}
              />
            );
          }

          return (
            <TreemapCell
              key={`${child.path}-${i}`}
              node={child}
              rect={innerRects[i] || { x: 0, y: 0, w: 0, h: 0 }}
              totalSize={totalSize}
              onDrillDown={onDrillDown}
              onSelect={onSelect}
              isSelected={selectedNodeId === child.id}
              containerPx={innerPx}
            />
          );
        })}
      </div>
    </div>
  );
}

// ===== Legend Dot =====

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="w-2 h-2 rounded-sm shrink-0"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

// ===== Main Disk Treemap =====

export function DiskTreemap() {
  const { treemapData } = useDiskStore();
  const [breadcrumbs, setBreadcrumbs] = useState<TreemapNode[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useContainerSize(containerRef);

  const currentData = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : treemapData;

  // Layout top-level children
  const children = currentData?.children || [];
  const childSizes = children.map((c) => c.size);
  const childRects = useMemo(
    () => squarify(childSizes, 0, 0, 100, 100),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [children.length, currentData?.size],
  );

  const handleDrillDown = (node: TreemapNode) => {
    if (node.children && node.children.length > 0) {
      setBreadcrumbs((prev) => [...prev, node]);
    }
  };

  const handleSelect = (node: TreemapNode) => {
    // Could sync with tree view selection in the future
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index < 0) {
      setBreadcrumbs([]);
    } else {
      setBreadcrumbs((prev) => prev.slice(0, index + 1));
    }
  };

  if (!treemapData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <div className="relative mx-auto w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-muted" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p>Scan a drive to view treemap</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Legend */}
      <div className="flex items-center gap-3 px-2 py-1 border-b text-[10px] text-muted-foreground shrink-0">
        <span className="font-medium text-foreground">Disk Treemap</span>
        <span className="text-muted-foreground/40">|</span>
        <span>Cell size = disk usage</span>
        <span className="text-muted-foreground/40">|</span>
        <LegendDot color="oklch(0.33 0.14 145)" label="Safe" />
        <LegendDot color="oklch(0.38 0.14 75)" label="Caution" />
        <LegendDot color="oklch(0.35 0.18 25)" label="Dangerous" />
        <LegendDot color="oklch(0.32 0.12 250)" label="Folder" />
        <LegendDot color="oklch(0.35 0.10 200)" label="File" />
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b text-xs bg-muted/20 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1 text-xs"
          onClick={() => handleBreadcrumbClick(-1)}
        >
          {treemapData.name}
        </Button>
        {breadcrumbs.map((crumb, idx) => (
          <span key={idx} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-xs"
              onClick={() => handleBreadcrumbClick(idx)}
            >
              {crumb.name}
            </Button>
          </span>
        ))}

        {/* Current view info */}
        {currentData && (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {formatSize(currentData.size)} · {formatNumber(currentData.file_count)} files · {formatNumber(currentData.dir_count)} dirs
          </span>
        )}
      </div>

      {/* Treemap */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-black/80 m-0.5 rounded-sm overflow-hidden"
      >
        {children.map((child, i) => {
          const childHasChildren = child.children && child.children.length > 0;

          if (childHasChildren) {
            return (
              <GroupContainer
                key={`${child.path}-${i}`}
                node={child}
                rect={childRects[i] || { x: 0, y: 0, w: 0, h: 0 }}
                totalSize={currentData?.size || 1}
                onDrillDown={handleDrillDown}
                onSelect={handleSelect}
                containerPx={containerSize}
              />
            );
          }

          return (
            <TreemapCell
              key={`${child.path}-${i}`}
              node={child}
              rect={childRects[i] || { x: 0, y: 0, w: 0, h: 0 }}
              totalSize={currentData?.size || 1}
              onDrillDown={handleDrillDown}
              onSelect={handleSelect}
              isSelected={false}
              containerPx={containerSize}
            />
          );
        })}
      </div>
    </div>
  );
}
