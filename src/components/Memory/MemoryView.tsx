import { useEffect, useRef, useState } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { useMemoryStore } from "@/store/useMemoryStore";
import { formatSize, formatNumber } from "@/lib/format";
import { ProcessTree } from "./ProcessTree";
import { MemoryTreemap } from "./MemoryTreemap";
import { ProcessDetail } from "./ProcessDetail";
import { GlobalMemoryChart } from "./GlobalMemoryChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  RefreshCw,
  Search,
  Wand2,
  ChevronsUpDown,
  ChevronsDownUp,
  Play,
  Pause,
  Cpu,
  Server,
  Terminal,
  Container,
  Cog,
  Monitor,
  MemoryStick,
  List,
  LayoutGrid,
} from "lucide-react";

// ===== Memory Overview Bar =====

function MemoryOverviewBar() {
  const summary = useMemoryStore((s) => s.memorySummary);

  if (!summary) return null;

  const total = summary.total_physical;
  const usedPercent = (summary.used_physical / total) * 100;

  // Breakdown percentages (of total physical)
  const processWsPercent = (summary.total_process_ws / total) * 100;
  const kernelPercent = (summary.kernel_total / total) * 100;
  // "Other" = used - process WS - kernel (includes cache, drivers, page tables, modified pages)
  const otherUsed = summary.used_physical
    - Math.min(summary.total_process_ws + summary.kernel_total, summary.used_physical);
  const otherPercent = (otherUsed / total) * 100;

  const commitPercent = summary.commit_limit > 0
    ? (summary.commit_total / summary.commit_limit) * 100
    : 0;

  return (
    <div className="flex flex-col gap-2.5 px-3 py-2.5 border-b bg-card/50">
      {/* RAM Usage with stacked breakdown bar */}
      <div className="flex items-center gap-3">
        <MemoryStick className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium">
              Physical Memory
            </span>
            <span className="text-muted-foreground tabular-nums">
              {formatSize(summary.used_physical)} / {formatSize(total)}
              <span className="ml-1.5 font-medium" style={{
                color: usedPercent > 90
                  ? "oklch(0.63 0.24 25)"
                  : usedPercent > 70
                    ? "oklch(0.75 0.18 75)"
                    : "oklch(0.65 0.19 145)",
              }}>
                ({usedPercent.toFixed(1)}%)
              </span>
            </span>
          </div>
          {/* Stacked breakdown bar */}
          <div className="h-2.5 bg-muted rounded-full overflow-hidden flex">
            {/* Process Working Sets */}
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${processWsPercent}%`,
                backgroundColor: "oklch(0.65 0.18 250)",
              }}
              title={`Processes: ${formatSize(summary.total_process_ws)} (${processWsPercent.toFixed(1)}%)`}
            />
            {/* Kernel Memory */}
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${kernelPercent}%`,
                backgroundColor: "oklch(0.63 0.24 25 / 80%)",
              }}
              title={`Kernel: ${formatSize(summary.kernel_total)} (${kernelPercent.toFixed(1)}%)`}
            />
            {/* Other (cache, drivers, modified pages, etc.) */}
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${otherPercent}%`,
                backgroundColor: "oklch(0.75 0.18 75 / 70%)",
              }}
              title={`Cache/Drivers/Other: ${formatSize(otherUsed)} (${otherPercent.toFixed(1)}%)`}
            />
          </div>
        </div>
      </div>

      {/* Detailed stats row */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
        {/* Breakdown */}
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: "oklch(0.65 0.18 250)" }} />
          Processes: <strong className="text-foreground">{formatSize(summary.total_process_ws)}</strong>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: "oklch(0.63 0.24 25 / 80%)" }} />
          Kernel: <strong className="text-foreground">{formatSize(summary.kernel_total)}</strong>
          <span className="text-muted-foreground/60">(Paged {formatSize(summary.kernel_paged)} + NonPaged {formatSize(summary.kernel_nonpaged)})</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: "oklch(0.75 0.18 75 / 70%)" }} />
          Cache/Other: <strong className="text-foreground">{formatSize(otherUsed)}</strong>
        </span>

        <span className="text-muted-foreground/40">|</span>

        <span className="flex items-center gap-1">
          Available: <strong className="text-foreground">{formatSize(summary.available_physical)}</strong>
        </span>
        <span className="flex items-center gap-1">
          Commit: <strong className="text-foreground">{formatSize(summary.commit_total)}</strong>
          <span className="text-muted-foreground/60">/ {formatSize(summary.commit_limit)}</span>
          <span className="font-medium" style={{
            color: commitPercent > 80 ? "oklch(0.75 0.18 75)" : "inherit",
          }}>
            ({commitPercent.toFixed(0)}%)
          </span>
        </span>
        <span>
          Processes: <strong className="text-foreground">{formatNumber(summary.process_count)}</strong>
        </span>

        {/* Process type legend */}
        <div className="flex-1" />
        <div className="flex items-center gap-2.5">
          <LegendItem icon={Monitor} color="oklch(0.65 0.18 250)" label="Normal" />
          <LegendItem icon={Cog} color="oklch(0.6 0.06 260)" label="Service" />
          <LegendItem icon={Server} color="oklch(0.6 0.22 310)" label="VM" />
          <LegendItem icon={Terminal} color="oklch(0.7 0.18 55)" label="WSL" />
          <LegendItem icon={Container} color="oklch(0.65 0.15 200)" label="Docker" />
          <LegendItem icon={Cpu} color="oklch(0.63 0.24 25)" label="System" />
        </div>
      </div>
    </div>
  );
}

function LegendItem({
  icon: Icon,
  color,
  label,
}: {
  icon: typeof Monitor;
  color: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-0.5 text-[10px]">
      <Icon className="h-3 w-3" style={{ color }} />
      {label}
    </span>
  );
}

// ===== Toolbar =====

function MemoryToolbar() {
  const fetchProcessTree = useMemoryStore((s) => s.fetchProcessTree);
  const isLoading = useMemoryStore((s) => s.isLoading);
  const searchQuery = useMemoryStore((s) => s.searchQuery);
  const setSearch = useMemoryStore((s) => s.setSearch);
  const autoRefresh = useMemoryStore((s) => s.autoRefresh);
  const toggleAutoRefresh = useMemoryStore((s) => s.toggleAutoRefresh);
  const expandAll = useMemoryStore((s) => s.expandAll);
  const collapseAll = useMemoryStore((s) => s.collapseAll);
  const memorySubView = useMemoryStore((s) => s.memorySubView);
  const setMemorySubView = useMemoryStore((s) => s.setMemorySubView);
  const optimizeMemory = useMemoryStore((s) => s.optimizeMemory);
  const [isOptimizing, setIsOptimizing] = useState(false);

  const handleOptimize = async (mode: number) => {
    setIsOptimizing(true);
    try {
      const freedBytes = await optimizeMemory(mode);
      if (freedBytes > 0) {
        await message(`Thành công! Đã giải phóng ${formatSize(freedBytes)} RAM.`, { title: "Tối ưu RAM", kind: "info" });
      } else {
        await message("Đã tối ưu RAM thành công.", { title: "Tối ưu RAM", kind: "info" });
      }
    } catch (e: any) {
      await message(`Lỗi: ${e}`, { title: "Lỗi Tối ưu RAM", kind: "error" });
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-card/30">
      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Tìm process..."
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 pl-7 text-xs"
        />
      </div>

      <div className="h-5 w-px bg-border" />

      {/* Expand/Collapse (only for tree view) */}
      {memorySubView === "tree" && (
        <>
          <Tooltip>
            <TooltipTrigger>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={expandAll}>
                <ChevronsUpDown className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Expand All</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={collapseAll}>
                <ChevronsDownUp className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse All</TooltipContent>
          </Tooltip>

          <div className="h-5 w-px bg-border" />
        </>
      )}

      {/* Auto-refresh toggle */}
      <Tooltip>
        <TooltipTrigger>
          <Button
            size="sm"
            variant={autoRefresh ? "secondary" : "ghost"}
            className="h-7 gap-1 text-xs"
            onClick={toggleAutoRefresh}
          >
            {autoRefresh ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {autoRefresh ? "Auto" : "Auto"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {autoRefresh ? "Tắt auto-refresh (3s)" : "Bật auto-refresh (3s)"}
        </TooltipContent>
      </Tooltip>

      {/* Manual refresh */}
      <Tooltip>
        <TooltipTrigger>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={fetchProcessTree}
            disabled={isLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      {/* Optimize Memory */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="sm" variant="secondary" className="h-7 gap-1.5 text-xs bg-oklch-primary/10 text-primary hover:bg-oklch-primary/20" disabled={isOptimizing} />}
        >
          <Wand2 className={`h-3.5 w-3.5 ${isOptimizing ? "animate-pulse" : ""}`} />
          {isOptimizing ? "Đang tối ưu..." : "Tối ưu RAM"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs">Chế độ tối ưu</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleOptimize(0)} className="text-xs cursor-pointer">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-[oklch(0.65_0.19_145)]">🟢 Cơ bản</span>
              <span className="text-muted-foreground text-[10px]">Dọn dẹp app người dùng</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleOptimize(1)} className="text-xs cursor-pointer">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-[oklch(0.75_0.18_75)]">🟡 Tiêu chuẩn</span>
              <span className="text-muted-foreground text-[10px]">Dọn dẹp toàn bộ ứng dụng</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleOptimize(2)} className="text-xs cursor-pointer">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-[oklch(0.63_0.24_25)]">🔴 Tối đa (Cần Admin)</span>
              <span className="text-muted-foreground text-[10px]">Dọn toàn bộ ứng dụng + File Cache</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="h-5 w-px bg-border ml-1" />

      {/* Sub-view tabs (Tree / Treemap) */}
      <div className="flex items-center bg-muted rounded-md p-0.5">
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon"
              variant={memorySubView === "tree" ? "secondary" : "ghost"}
              className="h-6 w-6"
              onClick={() => setMemorySubView("tree")}
            >
              <List className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Process Tree</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon"
              variant={memorySubView === "treemap" ? "secondary" : "ghost"}
              className="h-6 w-6"
              onClick={() => setMemorySubView("treemap")}
            >
              <LayoutGrid className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Memory Treemap</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

// ===== Main Memory View =====

export function MemoryView() {
  const fetchProcessTree = useMemoryStore((s) => s.fetchProcessTree);
  const autoRefresh = useMemoryStore((s) => s.autoRefresh);
  const processTree = useMemoryStore((s) => s.processTree);
  const isLoading = useMemoryStore((s) => s.isLoading);
  const memorySubView = useMemoryStore((s) => s.memorySubView);
  const hasLoaded = useRef(false);

  // Initial load
  useEffect(() => {
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      fetchProcessTree();
    }
  }, [fetchProcessTree]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchProcessTree();
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchProcessTree]);

  if (processTree.length === 0 && isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-4">
          <div className="relative mx-auto w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-muted" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p>Đang tải danh sách process...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <MemoryOverviewBar />
      <GlobalMemoryChart />
      <MemoryToolbar />
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          {/* Left panel: Tree or Treemap */}
          <ResizablePanel defaultSize={60} minSize={40}>
            {memorySubView === "tree" && <ProcessTree />}
            {memorySubView === "treemap" && <MemoryTreemap />}
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right panel: Process Detail */}
          <ResizablePanel defaultSize={40} minSize={25}>
            <ProcessDetail />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
