use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, UNIX_EPOCH};
use crossbeam_channel::{unbounded, Sender};
use rayon::prelude::*;

use crate::scanner::tree::{FileNode, FileTree, NodeType, RiskLevel};
use crate::analyzer::classifier;

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

/// Progress information emitted during scanning
#[derive(Debug, Clone, serde::Serialize)]
pub struct ScanProgress {
    pub scanned_files: u64,
    pub scanned_dirs: u64,
    pub total_size: u64,
    pub active_dirs: Vec<String>,
    pub is_complete: bool,
}

/// Scanner configuration
#[derive(Debug, Clone)]
pub struct ScanConfig {
    pub max_depth: usize,
    pub follow_symlinks: bool,
    pub include_hidden: bool,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            max_depth: 0,
            follow_symlinks: false,
            include_hidden: true,
        }
    }
}

/// Cancellation token for stopping scans
#[derive(Debug, Clone)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

pub enum ScanEvent {
    DirStart(String),
    DirEnd(String),
    Entry {
        path: String,
        parent_path: String,
        name: String,
        is_dir: bool,
        size: u64,
        last_modified: i64,
        node_type: NodeType,
        risk_level: RiskLevel,
        access_denied: bool,
    },
}

fn scan_dir_recursive(
    dir_path: PathBuf,
    tx: &Sender<ScanEvent>,
    config: &ScanConfig,
    cancel: &CancellationToken,
    current_depth: usize,
) {
    if cancel.is_cancelled() || (config.max_depth > 0 && current_depth >= config.max_depth) {
        return;
    }

    let dir_path_str = dir_path.to_string_lossy().to_string();
    let _ = tx.send(ScanEvent::DirStart(dir_path_str.clone()));

    let mut sub_dirs = Vec::new();

    match std::fs::read_dir(&dir_path) {
        Ok(entries) => {
            for entry_res in entries {
                if cancel.is_cancelled() {
                    break;
                }
                
                let entry = match entry_res {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                
                let file_name_os = entry.file_name();
                let file_name = file_name_os.to_string_lossy();
                
                if !config.include_hidden && file_name.starts_with('.') {
                    continue;
                }

                let path = entry.path();
                let path_str = path.to_string_lossy().to_string();
                
                let metadata = if config.follow_symlinks {
                    std::fs::metadata(&path)
                } else {
                    std::fs::symlink_metadata(&path)
                };
                
                let (is_dir, size, last_modified, is_symlink) = match metadata {
                    Ok(ref m) => {
                        let is_d = m.is_dir();
                        let s = if is_d { 0 } else { m.len() };
                        let lm = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
                        let is_sym = m.file_type().is_symlink();
                        (is_d, s, lm, is_sym)
                    },
                    Err(_) => {
                        // Access denied or unreadable
                        let _ = tx.send(ScanEvent::Entry {
                            path: path_str,
                            parent_path: dir_path_str.clone(),
                            name: file_name.to_string(),
                            is_dir: false, // fallback
                            size: 0,
                            last_modified: 0,
                            node_type: NodeType::File,
                            risk_level: RiskLevel::Unknown,
                            access_denied: true,
                        });
                        continue;
                    }
                };
                
                let node_type = if is_symlink {
                    NodeType::Symlink
                } else if is_dir {
                    NodeType::Directory
                } else {
                    NodeType::File
                };
                
                let risk_level = classifier::classify_path(&path_str, node_type.clone());
                
                let _ = tx.send(ScanEvent::Entry {
                    path: path_str.clone(),
                    parent_path: dir_path_str.clone(),
                    name: file_name.to_string(),
                    is_dir,
                    size,
                    last_modified,
                    node_type,
                    risk_level,
                    access_denied: false,
                });
                
                let is_reparse = {
                    #[cfg(windows)]
                    {
                        metadata.as_ref().map(|m| (m.file_attributes() & 0x400) != 0).unwrap_or(false)
                    }
                    #[cfg(not(windows))]
                    {
                        false
                    }
                };

                if is_dir && (!is_symlink && !is_reparse || config.follow_symlinks) {
                    sub_dirs.push(path);
                }
            }
        }
        Err(_) => {
            // Parent already handles this node, but we could mark it access denied if we wanted
        }
    }
    
    // Spawn threads for sub-directories
    sub_dirs.into_par_iter().for_each(|d| {
        scan_dir_recursive(d, tx, config, cancel, current_depth + 1);
    });

    let _ = tx.send(ScanEvent::DirEnd(dir_path_str));
}

/// Scans a directory and updates the tree state
pub fn scan_directory(
    root_path: &str,
    config: &ScanConfig,
    tree_state: Arc<parking_lot::RwLock<Option<FileTree>>>,
    cancel_token: &CancellationToken,
    progress_callback: impl Fn(ScanProgress) + Send + Sync,
) {
    let root = Path::new(root_path);
    if !root.exists() {
        return;
    }

    let scanned_count = Arc::new(AtomicU64::new(0));
    let total_size = Arc::new(AtomicU64::new(0));

    // Initialize the root node
    let root_node = FileNode {
        id: 0,
        parent_id: None,
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| root_path.to_string()),
        path: root_path.to_string(),
        size: 0,
        file_count: 0,
        dir_count: 0,
        node_type: NodeType::Directory,
        last_modified: 0,
        children: Vec::new(),
        risk_level: RiskLevel::Unknown,
        is_expanded: false,
        access_denied: false,
    };

    let root_id = {
        let mut tree_lock = tree_state.write();
        if let Some(tree) = tree_lock.as_mut() {
            let id = tree.add_node(root_node);
            tree.root_id = id;
            id
        } else {
            return;
        }
    };

    let (tx, rx) = unbounded();

    // Spawn producer threads via rayon on a separate native thread to avoid blocking main thread event loop
    let root_buf = root.to_path_buf();
    let tx_clone = tx.clone();
    let config_clone = config.clone();
    let cancel_clone = cancel_token.clone();
    
    std::thread::spawn(move || {
        scan_dir_recursive(root_buf, &tx_clone, &config_clone, &cancel_clone, 0);
    });
    
    // Drop the original sender so `rx.recv()` terminates when all producers finish
    drop(tx);

    let mut path_to_id: std::collections::HashMap<String, u32> =
        std::collections::HashMap::with_capacity(100_000);
    path_to_id.insert(root_path.to_string(), root_id);

    let mut last_progress_time = Instant::now();
    let mut total_dirs = 0;
    let mut batch_count = 0;
    
    let mut active_dirs = std::collections::HashSet::new();

    let mut tree_lock = tree_state.write();

    while let Ok(event) = rx.recv() {
        batch_count += 1;

        match event {
            ScanEvent::DirStart(p) => {
                active_dirs.insert(p);
            }
            ScanEvent::DirEnd(p) => {
                active_dirs.remove(&p);
            }
            ScanEvent::Entry {
                path,
                parent_path,
                name,
                is_dir,
                size,
                last_modified,
                node_type,
                risk_level,
                access_denied,
            } => {
                let parent_id = path_to_id.get(&parent_path).copied();

                let node = FileNode {
                    id: 0,
                    parent_id,
                    name,
                    path: path.clone(),
                    size,
                    file_count: 0,
                    dir_count: 0,
                    node_type,
                    last_modified,
                    children: Vec::new(),
                    risk_level,
                    is_expanded: false,
                    access_denied,
                };

                if let Some(tree) = tree_lock.as_mut() {
                    let node_id = tree.add_node(node);
                    if let Some(pid) = parent_id {
                        tree.add_child(pid, node_id);
                        
                        let mut current_pid = Some(pid);
                        while let Some(c_pid) = current_pid {
                            if let Some(p_node) = tree.get_mut(c_pid) {
                                p_node.size += size;
                                if !is_dir {
                                    p_node.file_count += 1;
                                }
                                current_pid = p_node.parent_id;
                            } else {
                                break;
                            }
                        }
                    }

                    if is_dir {
                        path_to_id.insert(path, node_id);
                        tree.total_dirs += 1;
                        total_dirs = tree.total_dirs;
                    } else {
                        total_size.fetch_add(size, Ordering::Relaxed);
                        tree.total_size += size;
                    }
                }
                
                scanned_count.fetch_add(1, Ordering::Relaxed);
            }
        }

        if cancel_token.is_cancelled() {
            let t_dirs = tree_lock.as_ref().map(|t| t.total_dirs as u64).unwrap_or(0);
            drop(tree_lock);
            progress_callback(ScanProgress {
                scanned_files: scanned_count.load(Ordering::Relaxed),
                scanned_dirs: t_dirs,
                total_size: total_size.load(Ordering::Relaxed),
                active_dirs: vec!["Scan cancelled".to_string()],
                is_complete: false,
            });
            return;
        }

        let now = Instant::now();
        if now.duration_since(last_progress_time).as_millis() >= 50 || batch_count >= 1000 {
            drop(tree_lock);
            
            // Sleep for 1ms to force the OS to schedule the reader thread (Tauri UI)
            // This prevents RwLock writer starvation!
            std::thread::sleep(std::time::Duration::from_millis(1));

            if now.duration_since(last_progress_time).as_millis() >= 50 {
                last_progress_time = now;
                let t_dirs = total_dirs as u64;
                let active: Vec<String> = active_dirs.iter().take(15).cloned().collect();
                progress_callback(ScanProgress {
                    scanned_files: scanned_count.load(Ordering::Relaxed),
                    scanned_dirs: t_dirs,
                    total_size: total_size.load(Ordering::Relaxed),
                    active_dirs: active,
                    is_complete: false,
                });
            }

            tree_lock = tree_state.write();
            batch_count = 0;
        }
    }

    if let Some(tree) = tree_lock.as_mut() {
        tree.calculate_sizes(root_id);
        tree.total_size = tree.get(root_id).map(|n| n.size).unwrap_or(0);
        
        progress_callback(ScanProgress {
            scanned_files: tree.total_files as u64,
            scanned_dirs: tree.total_dirs as u64,
            total_size: tree.total_size,
            active_dirs: Vec::new(),
            is_complete: true,
        });
    }
}
