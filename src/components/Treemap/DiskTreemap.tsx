import { useMemo, useCallback, useState } from "react";
import { useDiskStore } from "@/store/useDiskStore";
import { formatSize, getTreemapColor, sizePercent } from "@/lib/format";
import type { TreemapNode } from "@/types";
import { Button } from "@/components/ui/button";
import { ChevronRight, LayoutGrid } from "lucide-react";

interface SquarifiedRect {
  x: number;
  y: number;
  w: number;
  h: number;
  node: TreemapNode;
  color: string;
}

/** Squarified treemap layout algorithm */
function squarify(
  nodes: TreemapNode[],
  x: number,
  y: number,
  w: number,
  h: number
): SquarifiedRect[] {
  if (nodes.length === 0 || w <= 0 || h <= 0) return [];

  const totalSize = nodes.reduce((sum, n) => sum + n.size, 0);
  if (totalSize === 0) return [];

  const rects: SquarifiedRect[] = [];
  let cx = x;
  let cy = y;
  let remainingW = w;
  let remainingH = h;

  // Sort descending by size
  const sorted = [...nodes].sort((a, b) => b.size - a.size);

  let i = 0;
  while (i < sorted.length) {
    const isHorizontal = remainingW >= remainingH;
    const totalRemaining = sorted.slice(i).reduce((s, n) => s + n.size, 0);

    // Find the best row
    let rowSize = 0;
    let rowEnd = i;
    let bestAspect = Infinity;

    for (let j = i; j < sorted.length; j++) {
      rowSize += sorted[j].size;
      const ratio = rowSize / totalRemaining;
      const sliceSize = isHorizontal
        ? remainingW * ratio
        : remainingH * ratio;

      // Calculate worst aspect ratio in this row
      let worstAspect = 0;
      const remaining = isHorizontal ? remainingH : remainingW;

      for (let k = i; k <= j; k++) {
        const nodeRatio = sorted[k].size / rowSize;
        const nodeSize = remaining * nodeRatio;
        const aspect = Math.max(sliceSize / nodeSize, nodeSize / sliceSize);
        worstAspect = Math.max(worstAspect, aspect);
      }

      if (worstAspect <= bestAspect) {
        bestAspect = worstAspect;
        rowEnd = j;
      } else {
        break;
      }
    }

    // Layout the row
    const rowTotal = sorted
      .slice(i, rowEnd + 1)
      .reduce((s, n) => s + n.size, 0);
    const rowRatio = rowTotal / totalRemaining;
    const sliceSize = isHorizontal
      ? remainingW * rowRatio
      : remainingH * rowRatio;

    let offset = 0;
    const remaining = isHorizontal ? remainingH : remainingW;

    for (let k = i; k <= rowEnd; k++) {
      const nodeRatio = sorted[k].size / rowTotal;
      const nodeSize = remaining * nodeRatio;

      const rect: SquarifiedRect = isHorizontal
        ? {
            x: cx,
            y: cy + offset,
            w: sliceSize,
            h: nodeSize,
            node: sorted[k],
            color: getTreemapColor(k),
          }
        : {
            x: cx + offset,
            y: cy,
            w: nodeSize,
            h: sliceSize,
            node: sorted[k],
            color: getTreemapColor(k),
          };

      rects.push(rect);
      offset += nodeSize;
    }

    if (isHorizontal) {
      cx += sliceSize;
      remainingW -= sliceSize;
    } else {
      cy += sliceSize;
      remainingH -= sliceSize;
    }

    i = rowEnd + 1;
  }

  return rects;
}

function TreemapCell({
  rect,
  totalSize,
  onDrillDown,
}: {
  rect: SquarifiedRect;
  totalSize: number;
  onDrillDown: (node: TreemapNode) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const { node, x, y, w, h, color } = rect;
  const percent = sizePercent(node.size, totalSize);

  // Don't render tiny cells
  if (w < 3 || h < 3) return null;

  const showLabel = w > 50 && h > 25;
  const showSize = w > 60 && h > 40;

  return (
    <div
      className="absolute treemap-node border border-background/30 overflow-hidden"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: `${h}%`,
        backgroundColor: isHovered ? `color-mix(in oklch, ${color}, white 15%)` : color,
        zIndex: isHovered ? 10 : 1,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => {
        if (node.children && node.children.length > 0) {
          onDrillDown(node);
        }
      }}
    >
      {showLabel && (
        <div className="p-1 text-white/90 overflow-hidden">
          <div className="text-[11px] font-medium truncate leading-tight">
            {node.name}
          </div>
          {showSize && (
            <div className="text-[10px] text-white/60 truncate">
              {formatSize(node.size)} ({percent.toFixed(1)}%)
            </div>
          )}
        </div>
      )}

      {/* Tooltip on hover */}
      {isHovered && !showLabel && (
        <div className="absolute z-50 pointer-events-none bg-popover text-popover-foreground shadow-lg rounded-md px-2 py-1 text-xs whitespace-nowrap -top-8 left-0">
          {node.name} — {formatSize(node.size)}
        </div>
      )}
    </div>
  );
}

export function DiskTreemap() {
  const { treemapData } = useDiskStore();
  const [breadcrumbs, setBreadcrumbs] = useState<TreemapNode[]>([]);

  const currentData = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : treemapData;

  const rects = useMemo(() => {
    if (!currentData?.children) return [];
    return squarify(currentData.children, 0, 0, 100, 100);
  }, [currentData]);

  const handleDrillDown = useCallback(
    (node: TreemapNode) => {
      if (node.children && node.children.length > 0) {
        setBreadcrumbs((prev) => [...prev, node]);
      }
    },
    []
  );

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      if (index < 0) {
        setBreadcrumbs([]);
      } else {
        setBreadcrumbs((prev) => prev.slice(0, index + 1));
      }
    },
    []
  );

  if (!treemapData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <LayoutGrid className="h-12 w-12 mx-auto opacity-20" />
          <p>Quét ổ đĩa để xem treemap</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b text-xs">
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
      </div>

      {/* Treemap */}
      <div className="flex-1 relative m-1">
        {rects.map((rect, i) => (
          <TreemapCell
            key={`${rect.node.path}-${i}`}
            rect={rect}
            totalSize={currentData?.size || 1}
            onDrillDown={handleDrillDown}
          />
        ))}
      </div>
    </div>
  );
}
