use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use crate::scanner::tree::{FileNode, FileTree, NodeType, RiskLevel};

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

/// Lightweight entry collected by worker threads
struct ScannedEntry {
    path: String,
    parent_path: String,
    name: String,
    is_dir: bool,
    is_reparse: bool,
    size: u64,
    last_modified: i64,
    node_type: NodeType,
    access_denied: bool,
}

/// Directory waiting to be scanned by a worker thread
struct DirJob {
    path: String,
    depth: usize,
}

/// Number of parallel worker threads for read_dir calls
const NUM_WORKERS: usize = 4;

/// Batch size for inserting entries into the tree
const BATCH_SIZE: usize = 4_000;

/// How long to sleep after releasing the write lock (ms)
const YIELD_MS: u64 = 3;

/// Maximum time (ms) to collect entries before a forced flush + yield
const MAX_COLLECT_MS: u128 = 100;

/// Check if metadata indicates a reparse point (junction/symlink) on Windows.
#[cfg(target_os = "windows")]
fn is_reparse_from_metadata(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}

#[cfg(not(target_os = "windows"))]
fn is_reparse_from_metadata(_meta: &std::fs::Metadata) -> bool {
    false
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
fn is_reparse_point(path: &Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(m) => is_reparse_from_metadata(&m),
        Err(_) => false,
    }
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn is_reparse_point(_path: &Path) -> bool {
    false
}

/// Scans a directory using parallel BFS (breadth-first search).
///
/// Architecture:
/// - A shared FIFO queue holds directories to scan (BFS order)
/// - N worker threads pull directories from the queue, call read_dir,
///   and send discovered entries through a channel
/// - Child directories are pushed to the BACK of the queue (BFS)
/// - Main thread receives entries, batches them, and flushes to the tree
///
/// BFS ensures parent directories are populated before their children,
/// so the user sees the folder structure build up level-by-level instead
/// of waiting for a single deep subtree to finish.
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

    // Initialize root node
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

    // BFS queue: directories waiting to be scanned (FIFO)
    let dir_queue: Arc<Mutex<VecDeque<DirJob>>> = Arc::new(Mutex::new(VecDeque::with_capacity(10_000)));
    dir_queue.lock().unwrap().push_back(DirJob {
        path: root_path.to_string(),
        depth: 0,
    });

    // Channel: workers → main thread
    let (tx, rx) = mpsc::channel::<ScannedEntry>();

    // How many workers are actively scanning a directory
    let active_workers = Arc::new(AtomicU32::new(0));
    // Signal for workers to stop
    let scan_done = Arc::new(AtomicBool::new(false));

    let max_depth = config.max_depth;
    let include_hidden = config.include_hidden;

    // Spawn worker threads
    let mut handles = Vec::with_capacity(NUM_WORKERS);
    for _ in 0..NUM_WORKERS {
        let tx = tx.clone();
        let queue = dir_queue.clone();
        let active = active_workers.clone();
        let done = scan_done.clone();
        let cancel = cancel_token.cancelled.clone();

        let handle = std::thread::spawn(move || {
            loop {
                if cancel.load(Ordering::Relaxed) || done.load(Ordering::Relaxed) {
                    break;
                }

                // Pull a directory from the front of the queue (BFS)
                let job = { queue.lock().unwrap().pop_front() };

                if let Some(job) = job {
                    active.fetch_add(1, Ordering::SeqCst);
                    enumerate_directory(&job, max_depth, include_hidden, &tx, &queue, &cancel);
                    active.fetch_sub(1, Ordering::SeqCst);
                } else {
                    // Queue is empty — check if other workers are still active
                    if active.load(Ordering::SeqCst) == 0 {
                        // All workers idle + queue empty = scan complete
                        done.store(true, Ordering::Relaxed);
                        break;
                    }
                    // Wait briefly for other workers to produce new directories
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
        });
        handles.push(handle);
    }
    // Drop the original tx so rx closes when all workers finish
    drop(tx);

    // === Main thread: receive entries, batch, flush to tree ===

    let mut path_to_id: std::collections::HashMap<String, u32> =
        std::collections::HashMap::with_capacity(50_000);
    path_to_id.insert(root_path.to_string(), root_id);
    path_to_id.insert(normalize_path(root_path), root_id);

    let mut batch: Vec<ScannedEntry> = Vec::with_capacity(BATCH_SIZE);
    let mut files_scanned: u64 = 0;
    let mut dirs_scanned: u64 = 0;
    let mut total_size: u64 = 0;
    let mut last_progress_time = Instant::now();
    let mut last_yield_time = Instant::now();
    let mut active_dir = root_path.to_string();

    for entry in rx {
        if cancel_token.is_cancelled() {
            break;
        }

        // Update counters
        if entry.is_dir {
            dirs_scanned += 1;
            active_dir = entry.path.clone();
        } else {
            files_scanned += 1;
            total_size += entry.size;
        }

        batch.push(entry);

        // Flush when batch full or time exceeded
        let now = Instant::now();
        let time_since_yield = now.duration_since(last_yield_time).as_millis();
        let should_flush = batch.len() >= BATCH_SIZE || time_since_yield >= MAX_COLLECT_MS;

        if should_flush {
            flush_batch(&mut batch, &tree_state, &mut path_to_id);
            std::thread::sleep(Duration::from_millis(YIELD_MS));
            last_yield_time = Instant::now();

            if now.duration_since(last_progress_time).as_millis() >= 50 {
                last_progress_time = now;
                progress_callback(ScanProgress {
                    scanned_files: files_scanned,
                    scanned_dirs: dirs_scanned,
                    total_size,
                    active_dirs: vec![active_dir.clone()],
                    is_complete: false,
                });
            }
        }
    }

    // Flush remaining entries
    if !batch.is_empty() {
        flush_batch(&mut batch, &tree_state, &mut path_to_id);
    }

    // Wait for worker threads
    for h in handles {
        let _ = h.join();
    }

    drop(path_to_id);

    // Final: aggregate sizes from leaves to root
    {
        let mut tree_lock = tree_state.write();
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
}

/// Worker function: enumerate one directory's children.
/// Sends entries through the channel and pushes child directories to the queue.
fn enumerate_directory(
    job: &DirJob,
    max_depth: usize,
    include_hidden: bool,
    tx: &mpsc::Sender<ScannedEntry>,
    dir_queue: &Arc<Mutex<VecDeque<DirJob>>>,
    cancel: &Arc<AtomicBool>,
) {
    let entries = match std::fs::read_dir(&job.path) {
        Ok(e) => e,
        Err(_) => {
            // Send a single access-denied entry for the directory itself
            // (the parent already exists in tree, this just records the error)
            return;
        }
    };

    for entry_result in entries {
        if cancel.load(Ordering::Relaxed) {
            return;
        }

        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files if configured
        if !include_hidden && file_name.starts_with('.') {
            continue;
        }

        // Get metadata — use symlink_metadata for directories to detect reparse points
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        let is_dir_from_ft = ft.is_dir();
        
        // Skip known problematic virtual/sync folders (e.g. Phone Link's CrossDevice)
        if is_dir_from_ft {
            let lower_name = file_name.to_lowercase();
            if lower_name == "crossdevice" {
                continue;
            }
        }
        let path_str = path.to_string_lossy().to_string();

        let (is_dir, size, last_modified, is_symlink, is_reparse, access_denied) = if is_dir_from_ft {
            match std::fs::symlink_metadata(&path) {
                Ok(m) => {
                    let is_rp = is_reparse_from_metadata(&m);
                    let lm = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    (true, 0u64, lm, ft.is_symlink(), is_rp, false)
                }
                Err(_) => (true, 0u64, 0i64, false, false, true),
            }
        } else {
            match entry.metadata() {
                Ok(m) => {
                    let s = m.len();
                    let lm = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    (false, s, lm, ft.is_symlink(), false, false)
                }
                Err(_) => (false, 0u64, 0i64, false, false, true),
            }
        };

        let node_type = if is_symlink {
            NodeType::Symlink
        } else if is_dir {
            NodeType::Directory
        } else {
            NodeType::File
        };

        // Send entry to main thread
        let _ = tx.send(ScannedEntry {
            path: path_str.clone(),
            parent_path: job.path.clone(),
            name: file_name,
            is_dir,
            is_reparse,
            size,
            last_modified,
            node_type,
            access_denied,
        });

        // Queue child directory for scanning (BFS: push to back)
        // Skip reparse points to avoid junction loops
        if is_dir && !is_reparse && !access_denied {
            let child_depth = job.depth + 1;
            if max_depth == 0 || child_depth < max_depth {
                dir_queue.lock().unwrap().push_back(DirJob {
                    path: path_str,
                    depth: child_depth,
                });
            }
        }
    }
}

/// Insert a batch of scanned entries into the tree.
fn flush_batch(
    batch: &mut Vec<ScannedEntry>,
    tree_state: &Arc<parking_lot::RwLock<Option<FileTree>>>,
    path_to_id: &mut std::collections::HashMap<String, u32>,
) {
    let mut tree_lock = tree_state.write();
    if let Some(tree) = tree_lock.as_mut() {
        for entry in batch.drain(..) {
            let parent_id = path_to_id
                .get(&entry.parent_path)
                .or_else(|| path_to_id.get(&normalize_path(&entry.parent_path)))
                .copied();

            let node = FileNode {
                id: 0,
                parent_id,
                name: entry.name,
                path: entry.path.clone(),
                size: entry.size,
                file_count: 0,
                dir_count: 0,
                node_type: entry.node_type,
                last_modified: entry.last_modified,
                children: Vec::new(),
                risk_level: RiskLevel::Unknown,
                is_expanded: false,
                access_denied: entry.access_denied,
            };

            let node_id = tree.add_node(node);
            if let Some(pid) = parent_id {
                tree.add_child(pid, node_id);
                // Propagate the new node's size and item counts up to the root
                // This allows the frontend to display sizes of parent directories
                // instantly as they are being scanned, rather than waiting for the end.
                tree.propagate_stats(pid, entry.size, entry.is_dir);
            }

            if entry.is_dir && !entry.is_reparse {
                path_to_id.insert(entry.path, node_id);
            }
        }
    }
}

/// Normalize a path for consistent HashMap lookups.
fn normalize_path(path: &str) -> String {
    let p = path.replace('/', "\\");
    p.trim_end_matches('\\').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::tree::FileTree;
    use parking_lot::RwLock;

    #[test]
    fn test_scan_directory_workspace() {
        let tree_state = Arc::new(RwLock::new(Some(FileTree::new())));
        let cancel_token = CancellationToken::new();

        let config = ScanConfig::default();
        scan_directory(
            "src",
            &config,
            tree_state.clone(),
            &cancel_token,
            |progress| {
                println!("Progress: {:?}", progress);
            },
        );

        let lock = tree_state.read();
        let tree = lock.as_ref().unwrap();

        assert!(tree.total_files > 0, "Should have scanned some files in src");
        assert!(tree.total_size > 0, "Should have calculated total size greater than 0");
        let total_nodes = tree.nodes.len() as u32;
        assert_eq!(
            tree.total_files + tree.total_dirs, total_nodes,
            "total_files({}) + total_dirs({}) should equal total node count ({})",
            tree.total_files, tree.total_dirs, total_nodes
        );
    }

    #[test]
    fn test_reparse_point_detection() {
        let junction_path = Path::new(r"C:\Documents and Settings");
        if junction_path.exists() {
            assert!(
                is_reparse_point(junction_path),
                "C:\\Documents and Settings should be detected as a reparse point (junction)"
            );
        }
    }
}
