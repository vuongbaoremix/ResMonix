import { useDiskStore } from "@/store/useDiskStore";
import { formatSize, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScanSearch, X, List, LayoutGrid } from "lucide-react";

export function DiskToolbar() {
  const {
    drives,
    selectedDrive,
    isScanning,
    scanProgress,
    selectDrive,
    startScan,
    cancelScan,
    diskSubView,
    setDiskSubView,
    scanComplete,
  } = useDiskStore();

  const showSubViewTabs = scanComplete || isScanning;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-card/30">
      {/* Drive selector */}
      <select
        className="h-7 px-2 text-xs bg-background border rounded-md cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        value={selectedDrive || ""}
        onChange={(e) => selectDrive(e.target.value)}
        disabled={isScanning}
      >
        <option value="" disabled>
          Chọn ổ đĩa...
        </option>
        {drives.map((drive) => (
          <option key={drive.mount_point} value={drive.mount_point}>
            {drive.label} — {formatSize(drive.free_space)} trống /{" "}
            {formatSize(drive.total_space)}
          </option>
        ))}
      </select>

      {/* Scan button */}
      {isScanning ? (
        <Button
          size="sm"
          variant="destructive"
          onClick={cancelScan}
          className="gap-1.5 h-7 text-xs"
        >
          <X className="h-3 w-3" />
          Dừng
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => selectedDrive && startScan(selectedDrive)}
          disabled={!selectedDrive}
          className="gap-1.5 h-7 text-xs"
        >
          <ScanSearch className="h-3 w-3" />
          Quét
        </Button>
      )}

      {/* Scan progress */}
      {isScanning && scanProgress && (
        <div className="flex-1 min-w-0 flex items-center gap-2 text-[11px] text-muted-foreground scan-pulse pr-4">
          <span className="shrink-0">
            {formatNumber(scanProgress.scanned_files)} files
          </span>
          <span className="shrink-0">•</span>
          <span className="shrink-0">{formatSize(scanProgress.total_size)}</span>
          <span className="shrink-0">•</span>
          <span
            className="truncate"
            title={scanProgress.active_dirs?.join("\n") || ""}
          >
            {scanProgress.active_dirs?.length > 1
              ? `${scanProgress.active_dirs[0]} (+${scanProgress.active_dirs.length - 1} threads)`
              : scanProgress.active_dirs?.[0] || "Scanning..."}
          </span>
        </div>
      )}

      {!(isScanning && scanProgress) && <div className="flex-1" />}

      {/* Sub-view tabs (Tree / Treemap) — only show after scan */}
      {showSubViewTabs && (
        <div className="flex items-center bg-muted rounded-md p-0.5">
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon"
                variant={diskSubView === "tree" ? "secondary" : "ghost"}
                className="h-6 w-6"
                onClick={() => setDiskSubView("tree")}
              >
                <List className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Tree View</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon"
                variant={diskSubView === "treemap" ? "secondary" : "ghost"}
                className="h-6 w-6"
                onClick={() => setDiskSubView("treemap")}
              >
                <LayoutGrid className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Treemap</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
