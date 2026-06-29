use parking_lot::RwLock;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

use crate::analyzer::{classifier, suggestions};
use crate::memory::{self, MemorySummary, OnlineProcessInfo, ProcessAnalysis, ProcessTreeNode};
use crate::scanner::tree::{FileNodeSummary, FileTree, TreemapNode, SortField, SortOrder};
use crate::scanner::walker::{self, CancellationToken, ScanConfig, ScanProgress};
use crate::utils::drives::{self, DriveInfo};

/// Shared application state
pub struct AppState {
    pub tree: Arc<RwLock<Option<FileTree>>>,
    pub cancel_token: Mutex<Option<CancellationToken>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            tree: Arc::new(RwLock::new(None)),
            cancel_token: Mutex::new(None),
        }
    }
}

/// Get all available drives
#[tauri::command]
pub fn get_drives() -> Vec<DriveInfo> {
    drives::get_drives()
}

/// Start scanning a directory
#[tauri::command]
pub async fn scan_directory(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    // Cancel any existing scan
    {
        let token = state.cancel_token.lock().map_err(|e| e.to_string())?;
        if let Some(ref t) = *token {
            t.cancel();
        }
    }

    // Create new cancellation token
    let cancel_token = CancellationToken::new();
    {
        let mut token_lock = state.cancel_token.lock().map_err(|e| e.to_string())?;
        *token_lock = Some(cancel_token.clone());
    }

    // Pre-initialize empty tree in state so frontend can subscribe
    let tree_state = state.tree.clone();
    {
        let mut tree_lock = tree_state.write();
        *tree_lock = Some(FileTree::with_capacity(100_000));
    }

    let config = ScanConfig::default();
    let app_handle = app.clone();

    // Run scan in background thread
    tokio::task::spawn_blocking(move || {
        walker::scan_directory(&path, &config, tree_state, &cancel_token, |progress: ScanProgress| {
            let _ = app_handle.emit("scan:progress", &progress);
        })
    })
    .await
    .map_err(|e| {
        let err = format!("Scan task failed: {}", e);
        let _ = app.emit("scan:error", &err);
        err
    })?;

    // Retrieve final stats
    let tree_lock = state.tree.read();
    if let Some(tree) = tree_lock.as_ref() {
        let _ = app.emit(
            "scan:complete",
            serde_json::json!({
                "total_size": tree.total_size,
                "total_files": tree.total_files,
                "total_dirs": tree.total_dirs,
            }),
        );
    }
    
    Ok(())
}

/// Cancel an ongoing scan
#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> Result<(), String> {
    let token = state.cancel_token.lock().map_err(|e| e.to_string())?;
    if let Some(ref t) = *token {
        t.cancel();
    }
    Ok(())
}

/// Get children of a node (for lazy loading in the tree view)
#[tauri::command]
pub fn get_node_children(
    state: State<'_, AppState>,
    node_id: u32,
) -> Result<Vec<FileNodeSummary>, String> {
    let mut tree_lock = state.tree.write();
    let tree = tree_lock.as_mut().ok_or("No scan data available")?;

    // Classify children on demand (deferred from scan)
    tree.classify_children(node_id);

    let children = tree.get_children_sorted(node_id);
    Ok(children.iter().map(|n| FileNodeSummary::from(*n)).collect())
}

/// Get children of a node with custom sort field and order
#[tauri::command]
pub fn get_node_children_sorted(
    state: State<'_, AppState>,
    node_id: u32,
    sort_by: String,
    sort_order: String,
) -> Result<Vec<FileNodeSummary>, String> {
    let mut tree_lock = state.tree.write();
    let tree = tree_lock.as_mut().ok_or("No scan data available")?;

    // Classify children on demand
    tree.classify_children(node_id);

    let field = match sort_by.as_str() {
        "name" => SortField::Name,
        "size" => SortField::Size,
        "items" => SortField::Items,
        "modified" => SortField::Modified,
        _ => SortField::Size,
    };
    let order = match sort_order.as_str() {
        "asc" => SortOrder::Asc,
        "desc" => SortOrder::Desc,
        _ => SortOrder::Desc,
    };

    let children = tree.get_children_sorted_by(node_id, field, order);
    Ok(children.iter().map(|n| FileNodeSummary::from(*n)).collect())
}

/// Get the root node summary
#[tauri::command]
pub fn get_root_node(state: State<'_, AppState>) -> Result<FileNodeSummary, String> {
    let tree_lock = state.tree.read();
    let tree = tree_lock.as_ref().ok_or("No scan data available")?;

    tree.get(tree.root_id)
        .map(|n| FileNodeSummary::from(n))
        .ok_or("Root node not found".to_string())
}

/// Get latest sizes for specific nodes (used for live updates during scanning)
#[tauri::command]
pub fn get_nodes_info(
    state: State<'_, AppState>,
    node_ids: Vec<u32>,
) -> Result<Vec<FileNodeSummary>, String> {
    let tree_lock = state.tree.read();
    let tree = tree_lock.as_ref().ok_or("No scan data available")?;

    let mut result = Vec::with_capacity(node_ids.len());
    for id in node_ids {
        if let Some(node) = tree.get(id) {
            result.push(FileNodeSummary::from(node));
        }
    }
    Ok(result)
}

/// Get treemap data for visualization
#[tauri::command]
pub fn get_treemap_data(
    state: State<'_, AppState>,
    node_id: u32,
    max_depth: u32,
) -> Result<Option<TreemapNode>, String> {
    let tree_lock = state.tree.read();
    let tree = tree_lock.as_ref().ok_or("No scan data available")?;

    Ok(tree.to_treemap_flat(node_id, 250)) // Return top 250 largest files
}

/// Get file/directory description
#[tauri::command]
pub fn describe_path(path: String) -> Option<classifier::FileDescription> {
    classifier::describe_path(&path)
}

/// Get cleanup suggestions
#[tauri::command]
pub fn get_suggestions(state: State<'_, AppState>) -> Result<Vec<suggestions::Suggestion>, String> {
    let tree_lock = state.tree.read();
    let tree = tree_lock.as_ref().ok_or("No scan data available")?;

    Ok(suggestions::generate_suggestions(tree))
}

/// Delete a file or directory (move to Recycle Bin)
#[tauri::command]
pub async fn delete_item(path: String, permanent: bool) -> Result<u64, String> {
    let path_clone = path.clone();

    tokio::task::spawn_blocking(move || {
        let metadata = std::fs::metadata(&path_clone).map_err(|e| format!("Cannot access: {}", e))?;
        let size = if metadata.is_dir() {
            // Calculate directory size before deletion
            calculate_dir_size(&path_clone)
        } else {
            metadata.len()
        };

        if permanent {
            if metadata.is_dir() {
                std::fs::remove_dir_all(&path_clone)
                    .map_err(|e| format!("Failed to delete directory: {}", e))?;
            } else {
                std::fs::remove_file(&path_clone)
                    .map_err(|e| format!("Failed to delete file: {}", e))?;
            }
        } else {
            // Move to Recycle Bin using Windows API
            #[cfg(target_os = "windows")]
            {
                move_to_recycle_bin(&path_clone)?;
            }
            #[cfg(not(target_os = "windows"))]
            {
                return Err("Recycle bin not supported on this platform".to_string());
            }
        }

        Ok(size)
    })
    .await
    .map_err(|e| format!("Delete task failed: {}", e))?
}

fn calculate_dir_size(path: &str) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

#[cfg(target_os = "windows")]
fn move_to_recycle_bin(path: &str) -> Result<(), String> {
    // Use SHFileOperation with FOF_ALLOWUNDO to move to Recycle Bin
    // For simplicity, we'll use the `trash` approach via command
    // A more proper approach would use IFileOperation COM interface
    let status = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{}', 'OnlyErrorDialogs', 'SendToRecycleBin')",
                path.replace('\'', "''")
            ),
        ])
        .output()
        .map_err(|e| format!("Failed to execute recycle bin command: {}", e))?;

    if status.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&status.stderr);
        Err(format!("Failed to move to Recycle Bin: {}", stderr))
    }
}

/// Open a path in Windows Explorer
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    Ok(())
}

/// Get top N largest files across the entire tree
#[tauri::command]
pub fn get_largest_files(
    state: State<'_, AppState>,
    count: usize,
) -> Result<Vec<FileNodeSummary>, String> {
    let tree_lock = state.tree.read();
    let tree = tree_lock.as_ref().ok_or("No scan data available")?;

    let mut files: Vec<&crate::scanner::tree::FileNode> = tree
        .nodes
        .iter()
        .filter(|n| n.node_type == crate::scanner::tree::NodeType::File)
        .collect();

    files.sort_by(|a, b| b.size.cmp(&a.size));
    files.truncate(count);

    Ok(files.iter().map(|n| FileNodeSummary::from(*n)).collect())
}

/// Get all processes as a tree with system memory summary
#[tauri::command]
pub async fn get_process_tree() -> Result<(MemorySummary, Vec<ProcessTreeNode>), String> {
    tokio::task::spawn_blocking(|| {
        Ok(memory::get_process_tree_with_summary())
    })
    .await
    .map_err(|e| format!("Failed to get process tree: {}", e))?
}



/// Kill a process by PID
#[tauri::command]
pub async fn kill_process(pid: u32) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        memory::kill_process(pid)
    })
    .await
    .map_err(|e| format!("Kill task failed: {}", e))?
}

/// Analyze a process: get EXE path and PE version info
#[tauri::command]
pub async fn analyze_process(pid: u32) -> Result<ProcessAnalysis, String> {
    tokio::task::spawn_blocking(move || {
        memory::analyze_process(pid)
    })
    .await
    .map_err(|e| format!("Analyze task failed: {}", e))?
}

/// Lookup process info online from file.net
#[tauri::command]
pub async fn lookup_process_online(name: String) -> Result<OnlineProcessInfo, String> {
    tokio::task::spawn_blocking(move || {
        memory::lookup_process_online(&name)
    })
    .await
    .map_err(|e| format!("Lookup task failed: {}", e))?
}

/// Optimize system RAM
#[tauri::command]
pub async fn optimize_memory(mode: u8) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || memory::optimize_memory(mode))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

/// Deep clean kernel caches and standby lists
#[tauri::command]
pub async fn deep_clean_memory() -> Result<u64, String> {
    tokio::task::spawn_blocking(move || memory::deep_clean_memory())
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

