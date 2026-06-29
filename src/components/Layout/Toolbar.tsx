import { useDiskStore } from "@/store/useDiskStore";
import { useMemoryStore } from "@/store/useMemoryStore";
import { formatSize, formatNumber } from "@/lib/format";
import {
  HardDrive,
  FolderTree,
  Files,
  Moon,
  Sun,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Toolbar() {
  const { isDarkMode, toggleDarkMode } = useDiskStore();

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-card shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <Activity className="h-4.5 w-4.5 text-primary" />
        <span className="font-semibold text-sm tracking-tight">ResMonix</span>
      </div>

      <div className="flex-1" />

      {/* Dark mode toggle */}
      <Tooltip>
        <TooltipTrigger>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={toggleDarkMode}
          >
            {isDarkMode ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isDarkMode ? "Light Mode" : "Dark Mode"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function StatusBar() {
  const activeModule = useDiskStore((s) => s.activeModule);
  const isScanning = useDiskStore((s) => s.isScanning);
  const scanProgress = useDiskStore((s) => s.scanProgress);
  const scanComplete = useDiskStore((s) => s.scanComplete);
  const selectedDrive = useDiskStore((s) => s.selectedDrive);
  const drives = useDiskStore((s) => s.drives);
  const memorySummary = useMemoryStore((s) => s.memorySummary);

  const drive = drives.find((d) => d.mount_point === selectedDrive);

  return (
    <div className="flex items-center justify-between px-3 py-1 border-t bg-card text-[11px] text-muted-foreground shrink-0">
      <div className="flex items-center gap-3">
        {/* Module-specific content */}
        {activeModule === "dashboard" && (
          <>
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              {drives.length} ổ đĩa
            </span>
            {memorySummary && (
              <span>
                RAM: {formatSize(memorySummary.used_physical)} /{" "}
                {formatSize(memorySummary.total_physical)}
              </span>
            )}
          </>
        )}

        {activeModule === "disk" && (
          <>
            {isScanning ? (
              <>
                <span className="scan-pulse">⏳ Đang quét...</span>
                {scanProgress && (
                  <span>
                    {formatNumber(scanProgress.scanned_files)} files •{" "}
                    {formatSize(scanProgress.total_size)}
                  </span>
                )}
              </>
            ) : scanComplete ? (
              <>
                <span className="flex items-center gap-1">
                  <Files className="h-3 w-3" />
                  {formatNumber(scanComplete.total_files)} files
                </span>
                <span className="flex items-center gap-1">
                  <FolderTree className="h-3 w-3" />
                  {formatNumber(scanComplete.total_dirs)} thư mục
                </span>
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {formatSize(scanComplete.total_size)}
                </span>
              </>
            ) : (
              <span>Chọn ổ đĩa và bấm Quét để bắt đầu</span>
            )}
          </>
        )}

        {activeModule === "memory" && memorySummary && (
          <>
            <span>
              RAM: {formatSize(memorySummary.used_physical)} /{" "}
              {formatSize(memorySummary.total_physical)} (
              {((memorySummary.used_physical / memorySummary.total_physical) * 100).toFixed(0)}%)
            </span>
            <span>
              Commit: {formatSize(memorySummary.commit_total)} /{" "}
              {formatSize(memorySummary.commit_limit)}
            </span>
            <span>
              {formatNumber(memorySummary.process_count)} processes
            </span>
          </>
        )}

        {activeModule === "suggestions" && (
          <span>Đề xuất tối ưu tài nguyên hệ thống</span>
        )}
      </div>

      {/* Drive info (when in disk module) */}
      {activeModule === "disk" && drive && (
        <div className="flex items-center gap-2">
          <span>
            {drive.file_system} • {drive.drive_type}
          </span>
          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${drive.usage_percent}%`,
                backgroundColor:
                  drive.usage_percent > 90
                    ? "oklch(0.63 0.24 25)"
                    : drive.usage_percent > 70
                      ? "oklch(0.75 0.18 75)"
                      : "oklch(0.65 0.19 145)",
              }}
            />
          </div>
          <span>{drive.usage_percent.toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}
