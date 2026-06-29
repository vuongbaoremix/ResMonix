import { useDiskStore } from "@/store/useDiskStore";
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
  label: string;
}[] = [
  { module: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { module: "disk", icon: HardDrive, label: "Disk" },
  { module: "memory", icon: MemoryStick, label: "Memory" },
  { module: "suggestions", icon: Lightbulb, label: "Đề xuất" },
];

export function Sidebar() {
  const activeModule = useDiskStore((s) => s.activeModule);
  const setActiveModule = useDiskStore((s) => s.setActiveModule);

  return (
    <div className="sidebar">
      <div className="flex flex-col items-center gap-1 py-2">
        {SIDEBAR_ITEMS.map(({ module, icon: Icon, label }) => {
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
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
