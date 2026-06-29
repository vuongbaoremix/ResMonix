import { useEffect, useRef } from "react";
import { useDiskStore } from "@/store/useDiskStore";
import { useMemoryStore } from "@/store/useMemoryStore";
import { useTranslation } from "react-i18next";
import { formatSize, formatNumber } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import {
  HardDrive,
  MemoryStick,
  Usb,
  Network,
  Disc,
  ArrowRight,
  Cpu,
} from "lucide-react";

// ===== Disk Summary Card =====

function getDriveIcon(driveType: string) {
  const iconClass = "h-5 w-5";
  switch (driveType) {
    case "Fixed":
      return <HardDrive className={iconClass} />;
    case "Removable":
      return <Usb className={iconClass} />;
    case "Network":
      return <Network className={iconClass} />;
    case "CD-ROM":
      return <Disc className={iconClass} />;
    default:
      return <HardDrive className={iconClass} />;
  }
}

function DiskSummaryCard() {
  const { t } = useTranslation();
  const drives = useDiskStore((s) => s.drives);
  const selectDrive = useDiskStore((s) => s.selectDrive);
  const startScan = useDiskStore((s) => s.startScan);
  const setActiveModule = useDiskStore((s) => s.setActiveModule);

  const handleDriveClick = (mountPoint: string) => {
    selectDrive(mountPoint);
    startScan(mountPoint);
    setActiveModule("disk");
  };

  return (
    <Card className="dashboard-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="dashboard-icon-box dashboard-icon-disk">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Disk Storage</h2>
            <p className="text-[11px] text-muted-foreground">
              {t("dashboard.available_drives", { count: drives.length })}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {drives.map((drive) => (
            <div
              key={drive.mount_point}
              className="group flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 hover:bg-muted/70 cursor-pointer transition-all"
              onClick={() => handleDriveClick(drive.mount_point)}
            >
              <div className="text-muted-foreground group-hover:text-primary transition-colors">
                {getDriveIcon(drive.drive_type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium truncate">
                    {drive.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 ml-2">
                    {formatSize(drive.free_space)} {t("dashboard.free_space")}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${drive.usage_percent}%`,
                      backgroundColor:
                        drive.usage_percent > 90
                          ? "oklch(0.63 0.24 25)"
                          : drive.usage_percent > 70
                            ? "oklch(0.75 0.18 75)"
                            : "oklch(0.65 0.19 250)",
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                  <span>
                    {formatSize(drive.used_space)} / {formatSize(drive.total_space)}
                  </span>
                  <span className="font-medium" style={{
                    color:
                      drive.usage_percent > 90
                        ? "oklch(0.63 0.24 25)"
                        : drive.usage_percent > 70
                          ? "oklch(0.75 0.18 75)"
                          : "oklch(0.65 0.19 145)",
                  }}>
                    {drive.usage_percent.toFixed(0)}%
                  </span>
                </div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors shrink-0" />
            </div>
          ))}

          {drives.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-4">
              {t("dashboard.loading_drives")}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Memory Summary Card =====

function MemorySummaryCard() {
  const { t } = useTranslation();
  const summary = useMemoryStore((s) => s.memorySummary);
  const processTree = useMemoryStore((s) => s.processTree);
  const fetchProcessTree = useMemoryStore((s) => s.fetchProcessTree);
  const setActiveModule = useDiskStore((s) => s.setActiveModule);
  const hasLoaded = useRef(false);

  // Load memory data on mount
  useEffect(() => {
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      fetchProcessTree();
    }
  }, [fetchProcessTree]);

  const usedPercent = summary
    ? (summary.used_physical / summary.total_physical) * 100
    : 0;

  const commitPercent =
    summary && summary.commit_limit > 0
      ? (summary.commit_total / summary.commit_limit) * 100
      : 0;

  // Get top 5 processes by working set
  const topProcesses = processTree
    .flatMap(function flattenAll(node: (typeof processTree)[0]): (typeof processTree)[0][] {
      return [node, ...node.children.flatMap(flattenAll)];
    })
    .sort((a, b) => b.process.working_set - a.process.working_set)
    .slice(0, 5);

  return (
    <Card className="dashboard-card">
      <CardContent className="p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="dashboard-icon-box dashboard-icon-memory">
            <MemoryStick className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Memory</h2>
            <p className="text-[11px] text-muted-foreground">
              {summary
                ? `${formatSize(summary.available_physical)} ${t("dashboard.available")}`
                : t("dashboard.loading")}
            </p>
          </div>
        </div>

        {summary ? (
          <div className="space-y-4">
            {/* Physical RAM */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Physical RAM</span>
                <span className="tabular-nums font-medium">
                  {formatSize(summary.used_physical)} /{" "}
                  {formatSize(summary.total_physical)}
                  <span
                    className="ml-1.5"
                    style={{
                      color:
                        usedPercent > 90
                          ? "oklch(0.63 0.24 25)"
                          : usedPercent > 70
                            ? "oklch(0.75 0.18 75)"
                            : "oklch(0.65 0.19 145)",
                    }}
                  >
                    ({usedPercent.toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${usedPercent}%`,
                    backgroundColor:
                      usedPercent > 90
                        ? "oklch(0.63 0.24 25)"
                        : usedPercent > 70
                          ? "oklch(0.75 0.18 75)"
                          : "oklch(0.65 0.18 250)",
                  }}
                />
              </div>
            </div>

            {/* Commit Charge */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Commit Charge</span>
                <span className="tabular-nums font-medium">
                  {formatSize(summary.commit_total)} /{" "}
                  {formatSize(summary.commit_limit)}
                  <span
                    className="ml-1.5"
                    style={{
                      color: commitPercent > 80 ? "oklch(0.75 0.18 75)" : "inherit",
                    }}
                  >
                    ({commitPercent.toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${commitPercent}%`,
                    backgroundColor:
                      commitPercent > 80
                        ? "oklch(0.75 0.18 75 / 70%)"
                        : "oklch(0.6 0.06 260 / 60%)",
                  }}
                />
              </div>
            </div>

            {/* Top 5 Processes */}
            {topProcesses.length > 0 && (
              <div>
                <div className="text-[11px] text-muted-foreground font-medium mb-2">
                  {t("dashboard.top_processes")}
                </div>
                <div className="space-y-1">
                  {topProcesses.map((node) => (
                    <div
                      key={node.process.pid}
                      className="flex items-center justify-between text-[11px] py-0.5"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <Cpu className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{node.process.name}</span>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          [{node.process.pid}]
                        </span>
                      </div>
                      <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                        {formatSize(node.process.working_set)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Navigate button */}
            <button
              className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 rounded-md hover:bg-muted/50 transition-colors"
              onClick={() => setActiveModule("memory")}
            >
              {t("dashboard.view_details")}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
            <div className="text-center space-y-3">
              <div className="relative mx-auto w-8 h-8">
                <div className="absolute inset-0 rounded-full border-2 border-muted" />
                <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
              <p>{t("dashboard.loading_memory")}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===== Quick Stats =====

function QuickStats() {
  const { t } = useTranslation();
  const drives = useDiskStore((s) => s.drives);
  const summary = useMemoryStore((s) => s.memorySummary);

  const totalDiskSpace = drives.reduce((sum, d) => sum + d.total_space, 0);
  const totalDiskUsed = drives.reduce((sum, d) => sum + d.used_space, 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="stat-card">
        <span className="text-[11px] text-muted-foreground">{t("dashboard.total_disk")}</span>
        <span className="text-lg font-semibold tabular-nums">{formatSize(totalDiskSpace)}</span>
      </div>
      <div className="stat-card">
        <span className="text-[11px] text-muted-foreground">{t("dashboard.used_disk")}</span>
        <span className="text-lg font-semibold tabular-nums">{formatSize(totalDiskUsed)}</span>
      </div>
      <div className="stat-card">
        <span className="text-[11px] text-muted-foreground">{t("dashboard.used_ram")}</span>
        <span className="text-lg font-semibold tabular-nums">
          {summary ? formatSize(summary.used_physical) : "—"}
        </span>
      </div>
      <div className="stat-card">
        <span className="text-[11px] text-muted-foreground">{t("dashboard.processes")}</span>
        <span className="text-lg font-semibold tabular-nums">
          {summary ? formatNumber(summary.process_count) : "—"}
        </span>
      </div>
    </div>
  );
}

// ===== Main Dashboard =====

export function Dashboard() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("dashboard.subtitle")}
          </p>
        </div>

        {/* Quick Stats */}
        <QuickStats />

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DiskSummaryCard />
          <MemorySummaryCard />
        </div>
      </div>
    </div>
  );
}
