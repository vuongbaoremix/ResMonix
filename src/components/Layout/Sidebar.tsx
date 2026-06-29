import { useDiskStore } from "@/store/useDiskStore";
import { useTranslation } from "react-i18next";
import type { ActiveModule } from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  HardDrive,
  MemoryStick,
  Lightbulb,
} from "lucide-react";

const SIDEBAR_ITEMS: {
  module: ActiveModule;
  icon: typeof LayoutDashboard;
  labelKey: string;
}[] = [
  { module: "dashboard", icon: LayoutDashboard, labelKey: "ui.dashboard_tab" },
  { module: "disk", icon: HardDrive, labelKey: "ui.disk_tab" },
  { module: "memory", icon: MemoryStick, labelKey: "ui.memory_tab" },
  { module: "suggestions", icon: Lightbulb, labelKey: "ui.suggestions_tab" },
];

export function Sidebar() {
  const { t } = useTranslation();
  const activeModule = useDiskStore((s) => s.activeModule);
  const setActiveModule = useDiskStore((s) => s.setActiveModule);

  return (
    <div className="sidebar">
      <div className="flex flex-col items-center gap-1 py-2">
        {SIDEBAR_ITEMS.map(({ module, icon: Icon, labelKey }) => {
          const isActive = activeModule === module;
          return (
            <Tooltip key={module}>
              <TooltipTrigger>
                <button
                  className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
                  onClick={() => setActiveModule(module)}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {t(labelKey)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
