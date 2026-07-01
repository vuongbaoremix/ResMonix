import { useCallback, useMemo, useRef } from "react";
import { useMemoryStore } from "@/store/useMemoryStore";
import { formatSize } from "@/lib/format";
import type { ProcessTreeNode, ProcessType } from "@/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ProcessSparkline } from "./ProcessSparkline";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  ChevronDown,
  Monitor,
  Cog,
  Server,
  Container,
  Terminal,
  Cpu,
} from "lucide-react";

interface FlatProcessNode {
  node: ProcessTreeNode;
  depth: number;
  matchesSearch: boolean;
}

// ===== Process Type Config =====

const PROCESS_TYPE_CONFIG: Record<
  ProcessType,
  { icon: typeof Monitor; color: string; label: string }
> = {
  Normal: { icon: Monitor, color: "oklch(0.65 0.18 250)", label: "Process" },
  Service: { icon: Cog, color: "oklch(0.6 0.06 260)", label: "Service" },
  Vm: { icon: Server, color: "oklch(0.6 0.22 310)", label: "Hyper-V VM" },
  Subsystem: {
    icon: Terminal,
    color: "oklch(0.7 0.18 55)",
    label: "WSL/Subsystem",
  },
  Container: {
    icon: Container,
    color: "oklch(0.65 0.15 200)",
    label: "Docker/Container",
  },
  System: { icon: Cpu, color: "oklch(0.63 0.24 25)", label: "System" },
};

// ===== Process Row Component =====

function ProcessRow({
  flatNode,
  style,
  totalPhysical,
}: {
  flatNode: FlatProcessNode;
  style: React.CSSProperties;
  totalPhysical: number;
}) {
  const { node, depth, matchesSearch } = flatNode;
  const { process, children, subtree_working_set, subtree_private_bytes } =
    node;

  const toggleNode = useMemoryStore((s) => s.toggleNode);
  const selectProcess = useMemoryStore((s) => s.selectProcess);
  const isExpanded = useMemoryStore((s) => s.expandedPids.has(process.pid));
  const isSelected = useMemoryStore((s) => s.selectedPid === process.pid);

  const hasChildren = children.length > 0;
  const typeConfig = PROCESS_TYPE_CONFIG[process.process_type];
  const TypeIcon = typeConfig.icon;

  const wsPercent =
    totalPhysical > 0 ? (subtree_working_set / totalPhysical) * 100 : 0;

  const handleClick = useCallback(() => {
    selectProcess(process.pid);
  }, [process.pid, selectProcess]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (hasChildren) {
        toggleNode(process.pid);
      }
    },
    [hasChildren, process.pid, toggleNode]
  );

  return (
    <div style={style}>
      <div
        className={`flex items-center gap-1.5 py-0.5 px-1 rounded-sm cursor-pointer text-[13px] leading-5 h-full transition-colors
          ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}
          ${matchesSearch ? "" : "opacity-40"}
        `}
        onClick={handleClick}
        onDoubleClick={handleToggle}
      >
        {/* Name column */}
        <div
          className="flex-1 min-w-0 flex items-center gap-1"
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          {/* Expand/collapse toggle */}
          <span
            className="flex items-center justify-center w-4 h-4 shrink-0"
            onClick={handleToggle}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )
            ) : null}
          </span>

          {/* Type icon */}
          <span className="shrink-0" title={typeConfig.label}>
            <TypeIcon
              className="h-3.5 w-3.5"
              style={{ color: typeConfig.color }}
            />
          </span>

          {/* Process name */}
          <span className="truncate">{process.name}</span>

          {/* PID */}
          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
            [{process.pid}]
          </span>
        </div>

        {/* Sparkline */}
        <div className="w-[80px] shrink-0 flex items-center justify-end pr-3 hidden md:flex">
          <ProcessSparkline pid={process.pid} color={typeConfig.color} />
        </div>

        {/* Working Set bar + percent */}
        <div className="w-[110px] shrink-0 flex items-center gap-1 justify-end text-[11px] tabular-nums text-muted-foreground">
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(Math.max(wsPercent * 5, wsPercent > 0 ? 1 : 0), 100)}%`,
                backgroundColor: typeConfig.color,
                opacity: 0.7,
              }}
            />
          </div>
          <span className="w-10 text-right">
            {wsPercent >= 0.1 ? wsPercent.toFixed(1) : wsPercent > 0 ? "<0.1" : "0"}%
          </span>
        </div>

        {/* Working Set */}
        <span className="text-muted-foreground text-[11px] w-[84px] text-right shrink-0 tabular-nums">
          {process.working_set > 0 ? formatSize(process.working_set) : "—"}
        </span>

        {/* Private Bytes */}
        <span className="text-muted-foreground text-[11px] w-[84px] text-right shrink-0 tabular-nums hidden lg:block">
          {process.private_bytes > 0
            ? formatSize(process.private_bytes)
            : "—"}
        </span>

        {/* Subtree Total (only show if has children and different from own) */}
        <span className="text-muted-foreground text-[11px] w-[84px] text-right shrink-0 tabular-nums">
          {hasChildren && subtree_working_set > process.working_set
            ? formatSize(subtree_working_set)
            : "—"}
        </span>

        {/* Subtree Private (only show if has children) */}
        <span className="text-muted-foreground text-[11px] w-[84px] text-right shrink-0 tabular-nums hidden xl:block">
          {hasChildren && subtree_private_bytes > process.private_bytes
            ? formatSize(subtree_private_bytes)
            : "—"}
        </span>
      </div>
    </div>
  );
}

// ===== Main Process Tree =====

export function ProcessTree() {
  const { t } = useTranslation();
  const processTree = useMemoryStore((s) => s.processTree);
  const expandedPids = useMemoryStore((s) => s.expandedPids);
  const searchQuery = useMemoryStore((s) => s.searchQuery);
  const memorySummary = useMemoryStore((s) => s.memorySummary);
  const totalPhysical = memorySummary?.total_physical ?? 0;
  const sortBy = useMemoryStore((s) => s.sortBy);
  const setSort = useMemoryStore((s) => s.setSort);

  const lowerSearch = searchQuery.toLowerCase();

  // Check if a node or any of its descendants match the search
  const matchesSearch = useCallback(
    (node: ProcessTreeNode): boolean => {
      if (!lowerSearch) return true;
      if (node.process.name.toLowerCase().includes(lowerSearch)) return true;
      if (String(node.process.pid).includes(lowerSearch)) return true;
      return node.children.some((c) => matchesSearch(c));
    },
    [lowerSearch]
  );

  // Flatten the tree for virtualization
  const flattenedData = useMemo(() => {
    const result: FlatProcessNode[] = [];

    const flatten = (nodes: ProcessTreeNode[], depth: number) => {
      for (const node of nodes) {
        const nodeMatches = matchesSearch(node);

        // If searching and this subtree doesn't match, skip entirely
        if (lowerSearch && !nodeMatches) continue;

        result.push({
          node,
          depth,
          matchesSearch: !lowerSearch || node.process.name.toLowerCase().includes(lowerSearch) || String(node.process.pid).includes(lowerSearch),
        });

        if (expandedPids.has(node.process.pid)) {
          flatten(node.children, depth + 1);
        }
      }
    };

    flatten(processTree, 0);
    return result;
  }, [processTree, expandedPids, lowerSearch, matchesSearch]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: flattenedData.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 15,
  });

  const SortHeader = ({
    field,
    label,
    className,
  }: {
    field: typeof sortBy;
    label: string;
    className?: string;
  }) => (
    <div
      className={`cursor-pointer hover:text-foreground transition-colors select-none ${className ?? ""} ${sortBy === field ? "text-foreground" : ""}`}
      onClick={() => setSort(field)}
    >
      {label}
      {sortBy === field && (
        <span className="ml-0.5 text-[9px]">
          {useMemoryStore.getState().sortOrder === "desc" ? "▼" : "▲"}
        </span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header Row */}
      <div className="flex items-center gap-1.5 py-1.5 px-2 border-b text-xs font-semibold text-muted-foreground bg-muted/30 sticky top-0 z-10 shrink-0 pr-4">
        <div className="flex-1 min-w-0 pl-6">
          <SortHeader field="name" label={t("memory.processes", "Process")} />
        </div>
        <div className="w-[80px] shrink-0 text-center pr-3 hidden md:block">
          {t("memory.history", "Lịch sử")}
        </div>
        <div className="w-[110px] shrink-0 text-right">
          <SortHeader field="working_set" label={t("process_detail.ram_percent", "% RAM")} className="text-right" />
        </div>
        <div className="w-[84px] shrink-0 text-right">
          <SortHeader field="working_set" label={t("process_detail.working_set", "Working Set")} className="text-right" />
        </div>
        <div className="w-[84px] shrink-0 text-right hidden lg:block">
          <SortHeader field="private_bytes" label={t("process_detail.private_bytes", "Private")} className="text-right" />
        </div>
        <div className="w-[84px] shrink-0 text-right">{t("process_detail.subtree_ws", "Subtree WS")}</div>
        <div className="w-[84px] shrink-0 text-right hidden xl:block">
          {t("process_detail.subtree_private", "Subtree Priv")}
        </div>
      </div>

      {/* Virtualized Tree Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => (
            <ProcessRow
              key={flattenedData[virtualItem.index].node.process.pid}
              flatNode={flattenedData[virtualItem.index]}
              totalPhysical={totalPhysical}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
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
