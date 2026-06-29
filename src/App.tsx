import { useEffect } from "react";
import { useDiskStore } from "@/store/useDiskStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toolbar, StatusBar } from "@/components/Layout/Toolbar";
import { Sidebar } from "@/components/Layout/Sidebar";
import { DiskToolbar } from "@/components/Layout/DiskToolbar";
import { Dashboard } from "@/components/Dashboard/Dashboard";
import { VirtualTree } from "@/components/TreeView/VirtualTree";
import { DiskTreemap } from "@/components/Treemap/DiskTreemap";
import { FileDetail } from "@/components/DetailPanel/FileDetail";
import { SuggestionPanel } from "@/components/Suggestions/SuggestionPanel";
import { MemoryView } from "@/components/Memory/MemoryView";
import { DriveSelector } from "@/components/DiskOverview/DriveSelector";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

// ===== Disk Module Content =====

function DiskContent() {
  const { scanComplete, isScanning, diskSubView } = useDiskStore();

  // Show drive selector if no scan is done and not scanning
  if (!scanComplete && !isScanning) {
    return (
      <div className="flex flex-col h-full">
        <DiskToolbar />
        <div className="flex-1 overflow-hidden">
          <DriveSelector />
        </div>
      </div>
    );
  }

  // Main disk view with toolbar
  return (
    <div className="flex flex-col h-full">
      <DiskToolbar />
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          {/* Left panel: Tree or Treemap */}
          <ResizablePanel defaultSize={60} minSize={40}>
            {diskSubView === "tree" && <VirtualTree />}
            {diskSubView === "treemap" && <DiskTreemap />}
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right panel: File Detail */}
          <ResizablePanel defaultSize={40} minSize={25}>
            <FileDetail />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

// ===== Module Router =====

function ModuleContent() {
  const activeModule = useDiskStore((s) => s.activeModule);

  switch (activeModule) {
    case "dashboard":
      return <Dashboard />;
    case "disk":
      return <DiskContent />;
    case "memory":
      return <MemoryView />;
    case "suggestions":
      return <SuggestionPanel />;
    default:
      return <Dashboard />;
  }
}

// ===== App Root =====

export default function App() {
  const { fetchDrives, initEventListeners } = useDiskStore();

  useEffect(() => {
    fetchDrives();
    initEventListeners();
  }, [fetchDrives, initEventListeners]);

  return (
    <TooltipProvider>
      <div className="h-full flex flex-col bg-background text-foreground">
        {/* Top Toolbar */}
        <Toolbar />

        {/* Main area: Sidebar + Content */}
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <div className="flex-1 overflow-hidden">
            <ModuleContent />
          </div>
        </div>

        {/* Status bar */}
        <StatusBar />
      </div>
    </TooltipProvider>
  );
}
