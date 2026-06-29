// ===== File Tree Types =====

export type NodeType = "file" | "directory" | "symlink" | "junction" | "unknown";
export type RiskLevel = "safe" | "caution" | "dangerous" | "unknown";

export interface FileNodeSummary {
  id: number;
  parent_id: number | null;
  name: string;
  path: string;
  size: number;
  file_count: number;
  dir_count: number;
  node_type: NodeType;
  last_modified: number;
  has_children: boolean;
  child_count: number;
  risk_level: RiskLevel;
  access_denied: boolean;
}

export interface TreemapNode {
  name: string;
  path: string;
  size: number;
  node_type: NodeType;
  risk_level: RiskLevel;
  children?: TreemapNode[];
}

// ===== Drive Types =====

export interface DriveInfo {
  mount_point: string;
  label: string;
  total_space: number;
  free_space: number;
  used_space: number;
  usage_percent: number;
  file_system: string;
  drive_type: string;
  is_ready: boolean;
}

// ===== Scan Types =====

export interface ScanProgress {
  scanned_files: number;
  scanned_dirs: number;
  total_size: number;
  active_dirs: string[];
  is_complete: boolean;
}

export interface ScanComplete {
  total_size: number;
  total_files: number;
  total_dirs: number;
}

// ===== Analyzer Types =====

export type ActionType =
  | "direct_delete"
  | "tool_required"
  | "config_change"
  | "reinstallable"
  | "move_to_other_drive";

export interface Suggestion {
  title: string;
  description: string;
  action_type: ActionType;
  estimated_savings: number;
  command: string | null;
  risk_level: string;
  paths: string[];
  category: string;
}

export interface FileDescription {
  what: string;
  description: string;
  belongs_to: string;
  importance: string;
}

// ===== Memory Types =====

export type ProcessType = "Normal" | "Service" | "Vm" | "Subsystem" | "Container" | "System";

export interface ProcessInfo {
  pid: number;
  parent_pid: number;
  name: string;
  working_set: number;
  private_bytes: number;
  process_type: ProcessType;
}

export interface ProcessTreeNode {
  process: ProcessInfo;
  children: ProcessTreeNode[];
  subtree_working_set: number;
  subtree_private_bytes: number;
}

export interface MemorySummary {
  total_physical: number;
  used_physical: number;
  available_physical: number;
  commit_total: number;
  commit_limit: number;
  memory_load: number;
  process_count: number;
  // Detailed breakdown
  kernel_total: number;
  kernel_paged: number;
  kernel_nonpaged: number;
  system_cache: number;
  total_process_ws: number;
  non_process_memory: number;
}

export interface MemoryHistoryPoint {
  timestamp: number;
  totalUsed: number;
  processUsage: Record<number, number>;
}

export interface ProcessDescription {
  what: string;
  description: string;
  belongs_to: string;
  importance: string;
  can_kill: boolean;
}

export interface ProcessAnalysis {
  exe_path: string | null;
  file_description: string | null;
  company_name: string | null;
  product_name: string | null;
  product_version: string | null;
  legal_copyright: string | null;
  original_filename: string | null;
  is_signed: boolean;
  analysis_summary: string;
}

export interface OnlineProcessInfo {
  title: string;
  description: string;
  belongs_to: string | null;
  developer: string | null;
  danger_rating: string | null;
  source_url: string;
}

// ===== UI State Types =====

export type ActiveModule = "dashboard" | "disk" | "memory" | "suggestions";
export type DiskSubView = "tree" | "treemap";
export type MemorySubView = "tree" | "treemap";

export interface AppState {
  // Drives
  drives: DriveInfo[];
  selectedDrive: string | null;

  // Scan
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  scanComplete: ScanComplete | null;

  // Tree
  rootNode: FileNodeSummary | null;
  selectedNode: FileNodeSummary | null;
  expandedNodes: Set<number>;
  childrenCache: Map<number, FileNodeSummary[]>;

  // View
  activeModule: ActiveModule;
  diskSubView: DiskSubView;
  treemapData: TreemapNode | null;
  treemapRootId: number;

  // Detail
  fileDescription: FileDescription | null;
  suggestions: Suggestion[];
}
