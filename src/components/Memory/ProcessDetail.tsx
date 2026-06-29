import { useMemoryStore } from "@/store/useMemoryStore";
import { useTranslation } from "react-i18next";
import { formatSize, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProcessMemoryChart } from "./ProcessMemoryChart";
import type { ProcessTreeNode, ProcessType, ProcessDescription } from "@/types";
import {
  Monitor,
  Cog,
  Server,
  Container,
  Terminal,
  Cpu,
  Info,
  Shield,
  Skull,
  AlertTriangle,
  FileText,
  Building2,
  FolderOpen,
  Copyright,
  Loader2,
  CheckCircle,
  XCircle,
  Globe,
  ShieldAlert,
} from "lucide-react";

// ===== Process Type Config =====

const PROCESS_TYPE_CONFIG: Record<
  ProcessType,
  { icon: typeof Monitor; color: string; label: string }
> = {
  Normal: { icon: Monitor, color: "oklch(0.65 0.18 250)", label: "Normal Process" },
  Service: { icon: Cog, color: "oklch(0.6 0.06 260)", label: "Windows Service" },
  Vm: { icon: Server, color: "oklch(0.6 0.22 310)", label: "Virtual Machine" },
  Subsystem: { icon: Terminal, color: "oklch(0.7 0.18 55)", label: "WSL/Subsystem" },
  Container: { icon: Container, color: "oklch(0.65 0.15 200)", label: "Docker/Container" },
  System: { icon: Cpu, color: "oklch(0.63 0.24 25)", label: "System Process" },
};

// ===== Helper: Find process in tree =====

function findProcessInTree(
  nodes: ProcessTreeNode[],
  pid: number,
): ProcessTreeNode | null {
  for (const node of nodes) {
    if (node.process.pid === pid) return node;
    const found = findProcessInTree(node.children, pid);
    if (found) return found;
  }
  return null;
}

// ===== Main Component =====

export function ProcessDetail() {
  const { t } = useTranslation();
  const selectedPid = useMemoryStore((s) => s.selectedPid);
  const processTree = useMemoryStore((s) => s.processTree);
  const processAnalysis = useMemoryStore((s) => s.processAnalysis);
  const isAnalyzing = useMemoryStore((s) => s.isAnalyzing);
  const memorySummary = useMemoryStore((s) => s.memorySummary);
  const killProcess = useMemoryStore((s) => s.killProcess);
  const onlineInfo = useMemoryStore((s) => s.onlineInfo);

  if (selectedPid === null) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        <div className="text-center space-y-2">
          <Info className="h-8 w-8 mx-auto opacity-20" />
          <p>{t("process_detail.select_process")}</p>
          <p className="text-xs">{t("process_detail.to_view_details")}</p>
        </div>
      </div>
    );
  }

  const processNode = findProcessInTree(processTree, selectedPid);
  if (!processNode) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        <p>{t("process_detail.process_not_exist")}</p>
      </div>
    );
  }

  const { process, children, subtree_working_set, subtree_private_bytes } = processNode;
  const typeConfig = PROCESS_TYPE_CONFIG[process.process_type];
  const TypeIcon = typeConfig.icon;
  const totalPhysical = memorySummary?.total_physical ?? 1;
  const wsPercent = (process.working_set / totalPhysical) * 100;
  const hasChildren = children.length > 0;

  // Retrieve process description from i18n
  let processDescription: ProcessDescription | null = null;
  const processNameLower = process.name.toLowerCase();
  
  const kbEntry = t(`process_kb.${processNameLower}`, { returnObjects: true, defaultValue: null });
  if (kbEntry && typeof kbEntry === "object") {
    processDescription = kbEntry as unknown as ProcessDescription;
  } else if (processNameLower.startsWith("tag: ")) {
    const tag = process.name.substring(5);
    processDescription = t("process_kb.kernel_pool_tag", { returnObjects: true, tag: tag }) as unknown as ProcessDescription;
  }

  const handleKill = async () => {
    const confirmed = window.confirm(
      t("process_detail.confirm_kill", { name: process.name, pid: process.pid }) +
      "\n\n" +
      (processDescription?.can_kill === false
        ? t("process_detail.warning_system_process")
        : t("process_detail.kill_immediately"))
    );
    if (confirmed) {
      try {
        await killProcess(process.pid);
      } catch (e) {
        window.alert(`${t("process_detail.error")} ${e}`);
      }
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <TypeIcon
              className="h-5 w-5 shrink-0 mt-0.5"
              style={{ color: typeConfig.color }}
            />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm truncate">
                {process.name}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                PID: {process.pid} • Parent: {process.parent_pid}
              </p>
            </div>
          </div>

          {/* Type badge */}
          <Badge
            variant="secondary"
            className="text-xs"
            style={{
              backgroundColor: `color-mix(in oklch, ${typeConfig.color}, transparent 85%)`,
              color: typeConfig.color,
            }}
          >
            {typeConfig.label}
          </Badge>
        </div>

        <Separator />

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
          <div>
            <p className="text-muted-foreground">{t("process_detail.working_set")}</p>
            <p className="font-medium">{formatSize(process.working_set)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("process_detail.ram_percent")}</p>
            <p className="font-medium">
              {wsPercent >= 0.1 ? wsPercent.toFixed(1) : wsPercent > 0 ? "<0.1" : "0"}%
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("process_detail.private_bytes")}</p>
            <p className="font-medium">{formatSize(process.private_bytes)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("process_detail.process_type")}</p>
            <p className="font-medium capitalize">{process.process_type}</p>
          </div>

          {hasChildren && (
            <>
              <div>
                <p className="text-muted-foreground">{t("process_detail.subtree_ws")}</p>
                <p className="font-medium">{formatSize(subtree_working_set)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("process_detail.subtree_private")}</p>
                <p className="font-medium">{formatSize(subtree_private_bytes)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground">{t("process_detail.child_processes")}</p>
                <p className="font-medium">{formatNumber(children.length)}</p>
              </div>
            </>
          )}
        </div>

        {/* Process description (from knowledge base) */}
        {processDescription && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">
                  {processDescription.what}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {processDescription.description}
              </p>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("process_detail.belongs_to")}</span>
                  <span className="font-medium">
                    {processDescription.belongs_to}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("process_detail.importance")}</span>
                  <span className="font-medium text-right flex-1 ml-2">
                    {processDescription.importance}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Analysis Results */}
        {isAnalyzing && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("process_detail.analyzing")}
          </div>
        )}

        {/* Analysis Results */}
        {processAnalysis && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">{t("process_detail.analysis_result")}</span>
            </div>

            <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-2">
              {/* File Description */}
              {processAnalysis.file_description && (
                <div className="flex items-start gap-1.5">
                  <Info className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground text-[10px]">{t("process_detail.description")}</p>
                    <p className="font-medium">{processAnalysis.file_description}</p>
                  </div>
                </div>
              )}

              {/* Product + Company */}
              {processAnalysis.product_name && (
                <div className="flex items-start gap-1.5">
                  <Building2 className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground text-[10px]">{t("process_detail.product")}</p>
                    <p className="font-medium">
                      {processAnalysis.product_name}
                      {processAnalysis.product_version && (
                        <span className="text-muted-foreground font-normal ml-1">
                          v{processAnalysis.product_version}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {processAnalysis.company_name && (
                <div className="flex items-start gap-1.5">
                  <Building2 className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground text-[10px]">{t("process_detail.publisher")}</p>
                    <p className="font-medium">{processAnalysis.company_name}</p>
                  </div>
                </div>
              )}

              {/* EXE Path */}
              {processAnalysis.exe_path && (
                <div className="flex items-start gap-1.5">
                  <FolderOpen className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-[10px]">{t("process_detail.path")}</p>
                    <p className="font-medium break-all text-[10px]">
                      {processAnalysis.exe_path}
                    </p>
                  </div>
                </div>
              )}

              {/* Copyright */}
              {processAnalysis.legal_copyright && (
                <div className="flex items-start gap-1.5">
                  <Copyright className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-muted-foreground text-[10px]">{t("process_detail.copyright")}</p>
                    <p className="font-medium text-[10px]">{processAnalysis.legal_copyright}</p>
                  </div>
                </div>
              )}

              {/* Signed status */}
              <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
                {processAnalysis.is_signed ? (
                  <>
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    <span className="text-green-500 text-[10px] font-medium">
                      {t("process_detail.signed")}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3 text-yellow-500" />
                    <span className="text-yellow-500 text-[10px] font-medium">
                      {t("process_detail.unsigned")}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-md bg-card border p-2.5 text-xs space-y-1">
              {processAnalysis.analysis_summary.split("\n").map((line, i) => (
                <p key={i} className="leading-relaxed">{line}</p>
              ))}
            </div>
          </div>
        )}

        {/* Online Info (from file.net) */}
        {onlineInfo && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-xs font-medium">{t("process_detail.online_info")}</span>
              </div>

              <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-2.5">
                <p className="leading-relaxed text-muted-foreground">
                  {onlineInfo.description}
                </p>

                {onlineInfo.belongs_to && (
                  <div>
                    <p className="text-muted-foreground text-[10px] mb-0.5">{t("process_detail.software")}</p>
                    <p className="font-medium">{onlineInfo.belongs_to}</p>
                  </div>
                )}

                {onlineInfo.developer && (
                  <div>
                    <p className="text-muted-foreground text-[10px] mb-0.5">{t("process_detail.developer")}</p>
                    <p className="font-medium">{onlineInfo.developer}</p>
                  </div>
                )}

                {onlineInfo.danger_rating && (
                  <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/50">
                    <ShieldAlert className="h-3 w-3 text-yellow-500 shrink-0" />
                    <span className="text-[10px]">
                      {t("process_detail.danger_level")} <strong>{onlineInfo.danger_rating}</strong>
                    </span>
                  </div>
                )}

                <div className="text-[9px] text-muted-foreground/50 pt-1">
                  {t("process_detail.source")} file.net
                </div>
              </div>
            </div>
          </>
        )}

        <Separator />

        <ProcessMemoryChart pid={process.pid} />
        
        <Separator />

        {/* Kill Process */}
        <div className="space-y-1.5">
          {processDescription?.can_kill === false ? (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {t("process_detail.system_process_warning")}
              </span>
            </div>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              className="w-full justify-start gap-2 text-xs"
              onClick={handleKill}
            >
              <Skull className="h-3.5 w-3.5" />
              {t("process_detail.kill_process")}
            </Button>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
