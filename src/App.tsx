import { useEffect, lazy, Suspense } from "react";
import { useDiskStore } from "@/store/useDiskStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toolbar, StatusBar } from "@/components/Layout/Toolbar";
import { Sidebar } from "@/components/Layout/Sidebar";
import { DiskToolbar } from "@/components/Layout/DiskToolbar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

// Lazy-loaded modules — only loaded when the user navigates to them
const Dashboard = lazy(() => import("@/components/Dashboard/Dashboard").then(m => ({ default: m.Dashboard })));
const VirtualTree = lazy(() => import("@/components/TreeView/VirtualTree").then(m => ({ default: m.VirtualTree })));
const DiskTreemap = lazy(() => import("@/components/Treemap/DiskTreemap").then(m => ({ default: m.DiskTreemap })));
const FileDetail = lazy(() => import("@/components/DetailPanel/FileDetail").then(m => ({ default: m.FileDetail })));
const SuggestionPanel = lazy(() => import("@/components/Suggestions/SuggestionPanel").then(m => ({ default: m.SuggestionPanel })));
const MemoryView = lazy(() => import("@/components/Memory/MemoryView").then(m => ({ default: m.MemoryView })));
const DriveSelector = lazy(() => import("@/components/DiskOverview/DriveSelector").then(m => ({ default: m.DriveSelector })));

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
            <Suspense fallback={null}>
              <ModuleContent />
            </Suspense>
          </div>
        </div>

        {/* Status bar */}
        <StatusBar />
      </div>
    </TooltipProvider>
  );
}
