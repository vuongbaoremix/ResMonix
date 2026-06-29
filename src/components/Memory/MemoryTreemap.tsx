import { useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMemoryStore } from "@/store/useMemoryStore";
import { formatSize } from "@/lib/format";
import type { ProcessTreeNode, ProcessType } from "@/types";

// ===== Color Scheme =====

const PROCESS_TYPE_BG: Record<ProcessType, { base: string; hover: string }> = {
  Normal: { base: "oklch(0.35 0.12 250)", hover: "oklch(0.40 0.14 250)" },
  Service: { base: "oklch(0.30 0.04 260)", hover: "oklch(0.36 0.05 260)" },
  Vm: { base: "oklch(0.33 0.16 310)", hover: "oklch(0.38 0.18 310)" },
  Subsystem: { base: "oklch(0.38 0.12 55)", hover: "oklch(0.43 0.14 55)" },
  Container: { base: "oklch(0.35 0.10 200)", hover: "oklch(0.40 0.12 200)" },
  System: { base: "oklch(0.33 0.16 25)", hover: "oklch(0.38 0.18 25)" },
};

// ===== Squarified Treemap Layout =====

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(
  sizes: number[],
  x: number,
  y: number,
  w: number,
  h: number,
): Rect[] {
  if (sizes.length === 0 || w <= 0 || h <= 0) return [];

  const totalSize = sizes.reduce((sum, s) => sum + s, 0);
  if (totalSize === 0) return sizes.map(() => ({ x, y, w: 0, h: 0 }));

  const rects: Rect[] = new Array(sizes.length);

  const indices = sizes.map((s, i) => ({ size: s, idx: i }));
  indices.sort((a, b) => b.size - a.size);

  let cx = x,
    cy = y,
    rw = w,
    rh = h;
  let i = 0;

  while (i < indices.length) {
    const isHoriz = rw >= rh;
    const totalRemaining = indices
      .slice(i)
      .reduce((s, v) => s + v.size, 0);

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

    const rowTotal = indices
      .slice(i, rowEnd + 1)
      .reduce((s, v) => s + v.size, 0);
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

// ===== Group Data Structure =====

interface ProcessGroup {
  parent: ProcessTreeNode;
  members: ProcessTreeNode[];
  totalWs: number;
}

function flattenMembers(node: ProcessTreeNode): ProcessTreeNode[] {
  const result: ProcessTreeNode[] = [];
  result.push({ ...node, children: [] });
  for (const child of node.children) {
    result.push(...flattenMembers(child));
  }
  return result;
}

function buildGroups(tree: ProcessTreeNode[]): ProcessGroup[] {
  return tree
    .filter((root) => root.subtree_working_set > 0)
    .map((root) => {
      const members = flattenMembers(root).filter(
        (m) => m.process.working_set > 0,
      );
      return {
        parent: root,
        members,
        totalWs: root.subtree_working_set,
      };
    })
    .sort((a, b) => b.totalWs - a.totalWs);
}

// ===== Hook: measure container pixel size =====

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
    // Initial measurement
    const { width, height } = ref.current.getBoundingClientRect();
    setSize({ w: width, h: height });
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

// ===== Inner Process Cell =====

function ProcessCell({
  node,
  rect,
  totalRam,
  isSelected,
  onSelect,
  containerPx,
}: {
  node: ProcessTreeNode;
  rect: Rect;
  totalRam: number;
  isSelected: boolean;
  onSelect: (pid: number) => void;
  containerPx: { w: number; h: number };
}) {
  const [hovered, setHovered] = useState(false);
  const { process } = node;
  const pct = totalRam > 0 ? (process.working_set / totalRam) * 100 : 0;
  const colors = PROCESS_TYPE_BG[process.process_type];

  // Calculate actual pixel dimensions
  const pxW = (rect.w / 100) * containerPx.w;
  const pxH = (rect.h / 100) * containerPx.h;

  if (pxW < 3 || pxH < 3) return null;

  // Use pixel sizes for visibility thresholds
  const showName = pxW > 35 && pxH > 16;
  const showSize = pxW > 50 && pxH > 28;
  const showPct = pxW > 50 && pxH > 40;

  const fontSize = pxW > 90 ? 11 : pxW > 60 ? 10 : 8;
  const fontSizeSub = pxW > 90 ? 10 : pxW > 60 ? 9 : 7;

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
        onSelect(process.pid);
      }}
      title={`${process.name}\n${formatSize(process.working_set)} (${pct.toFixed(2)}%)\nPID: ${process.pid}`}
    >
      {showName && (
        <div className="p-[2px] flex flex-col items-center justify-center h-full text-center">
          <div
            className="text-white font-bold truncate w-full leading-tight"
            style={{ fontSize: `${fontSize}px` }}
          >
            {process.name}
          </div>
          {showSize && (
            <div
              className="text-white/70 tabular-nums truncate w-full leading-tight"
              style={{ fontSize: `${fontSizeSub}px` }}
            >
              {formatSize(process.working_set)}
            </div>
          )}
          {showPct && (
            <div
              className="tabular-nums truncate w-full leading-tight font-semibold"
              style={{
                fontSize: `${fontSize}px`,
                color:
                  pct > 5
                    ? "oklch(0.85 0.18 25)"
                    : pct > 1
                      ? "oklch(0.85 0.14 75)"
                      : "oklch(0.8 0 0 / 60%)",
              }}
            >
              {pct.toFixed(1)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Group Container =====

function GroupContainer({
  group,
  rect,
  totalRam,
  onSelect,
  containerPx,
}: {
  group: ProcessGroup;
  rect: Rect;
  totalRam: number;
  onSelect: (pid: number) => void;
  containerPx: { w: number; h: number };
}) {
  const selectedPid = useMemoryStore((s) => s.selectedPid);
  const { parent, members } = group;
  const pct = totalRam > 0 ? (group.totalWs / totalRam) * 100 : 0;

  // Calculate actual pixel dimensions of this group
  const groupPxW = (rect.w / 100) * containerPx.w;
  const groupPxH = (rect.h / 100) * containerPx.h;

  const HEADER_PX = 18;
  const showHeader = groupPxH > 30 && groupPxW > 40;

  // Calculate inner area pixel size from math (no ResizeObserver needed)
  const innerPx = {
    w: groupPxW - 2, // minus border
    h: groupPxH - (showHeader ? HEADER_PX : 0) - 2,
  };

  // If only 1 member, don't need inner layout
  const isSingle = members.length <= 1;

  // Layout inner members — must be called before any early return (Rules of Hooks)
  const innerSizes = members.map((m) => m.process.working_set);
  const innerRects = useMemo(
    () =>
      isSingle
        ? [{ x: 0, y: 0, w: 100, h: 100 }]
        : squarify(innerSizes, 0, 0, 100, 100),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members.length, group.totalWs, isSingle],
  );

  // Early return AFTER all hooks
  if (groupPxW < 4 || groupPxH < 4) return null;

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
          className="flex items-center justify-between px-1.5 shrink-0 bg-black/50 overflow-hidden"
          style={{ height: `${HEADER_PX}px` }}
        >
          <span
            className="text-white/90 font-bold uppercase truncate"
            style={{ fontSize: "9px", letterSpacing: "0.5px" }}
          >
            {parent.process.name}
            {members.length > 1 ? ` (${members.length})` : ""}
          </span>
          <span
            className="text-white/50 tabular-nums shrink-0 ml-1"
            style={{ fontSize: "8px" }}
          >
            {formatSize(group.totalWs)} · {pct.toFixed(1)}%
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
        {members.map((member, i) => (
          <ProcessCell
            key={member.process.pid}
            node={member}
            rect={innerRects[i] || { x: 0, y: 0, w: 0, h: 0 }}
            totalRam={totalRam}
            isSelected={selectedPid === member.process.pid}
            onSelect={onSelect}
            containerPx={innerPx}
          />
        ))}
      </div>
    </div>
  );
}

// ===== Main Memory Treemap =====

export function MemoryTreemap() {
  const { t } = useTranslation();
  const processTree = useMemoryStore((s) => s.processTree);
  const memorySummary = useMemoryStore((s) => s.memorySummary);
  const selectProcess = useMemoryStore((s) => s.selectProcess);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useContainerSize(containerRef);

  const totalRam = memorySummary?.total_physical ?? 0;

  // Build groups from process tree
  const groups = useMemo(() => buildGroups(processTree), [processTree]);

  // Layout groups
  const groupSizes = groups.map((g) => g.totalWs);
  const groupRects = useMemo(
    () => squarify(groupSizes, 0, 0, 100, 100),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups.length, totalRam],
  );

  if (processTree.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <p>{t("memory.loading_data")}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Legend */}
      <div className="flex items-center gap-3 px-2 py-1 border-b text-[10px] text-muted-foreground shrink-0">
        <span className="font-medium text-foreground">Memory Treemap</span>
        <span className="text-muted-foreground/40">|</span>
        <span>{t("memory.cell_size")}</span>
        <span className="text-muted-foreground/40">|</span>
        <LegendDot color="oklch(0.35 0.12 250)" label="Normal" />
        <LegendDot color="oklch(0.30 0.04 260)" label="Service" />
        <LegendDot color="oklch(0.33 0.16 25)" label="System" />
        <LegendDot color="oklch(0.33 0.16 310)" label="VM" />
        <LegendDot color="oklch(0.38 0.12 55)" label="WSL" />
        <LegendDot color="oklch(0.35 0.10 200)" label="Docker" />
      </div>

      {/* Treemap */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-black/80 m-0.5 rounded-sm overflow-hidden"
      >
        {groups.map((group, i) => (
          <GroupContainer
            key={group.parent.process.pid}
            group={group}
            rect={groupRects[i] || { x: 0, y: 0, w: 0, h: 0 }}
            totalRam={totalRam}
            onSelect={selectProcess}
            containerPx={containerSize}
          />
        ))}
      </div>
    </div>
  );
}

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
