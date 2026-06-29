use serde::{Deserialize, Serialize};
use std::fmt;

/// Represents a node in the file system tree.
/// Uses arena-based indexing instead of recursive Box<> pointers
/// for memory efficiency and cache locality with millions of nodes.
///
/// Each node is ~128 bytes, so 1M nodes ≈ 128MB RAM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    /// Unique index within the arena
    pub id: u32,
    /// Parent node index (None for root)
    pub parent_id: Option<u32>,
    /// File/directory name (not full path)
    pub name: String,
    /// Full path on disk
    pub path: String,
    /// Size in bytes (for directories: sum of all children)
    pub size: u64,
    /// Number of files in this subtree
    pub file_count: u32,
    /// Number of directories in this subtree
    pub dir_count: u32,
    /// Type of node
    pub node_type: NodeType,
    /// Last modified timestamp (unix seconds)
    pub last_modified: i64,
    /// Indices of direct children in the arena
    pub children: Vec<u32>,
    /// Risk level for deletion
    pub risk_level: RiskLevel,
    /// Whether this node's children have been loaded
    pub is_expanded: bool,
    /// Whether access was denied during scanning
    pub access_denied: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    File,
    Directory,
    Symlink,
    Junction,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    /// Safe to delete (temp files, caches, logs)
    Safe,
    /// Needs careful review (app data, config files)
    Caution,
    /// Should not be deleted (system files, boot files)
    Dangerous,
    /// Not yet classified
    Unknown,
}

impl fmt::Display for RiskLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RiskLevel::Safe => write!(f, "Safe"),
            RiskLevel::Caution => write!(f, "Caution"),
            RiskLevel::Dangerous => write!(f, "Dangerous"),
            RiskLevel::Unknown => write!(f, "Unknown"),
        }
    }
}

/// The arena that holds all file nodes.
/// This is the central data structure for the scanned file tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTree {
    /// All nodes stored in a flat Vec for cache-friendly access
    pub nodes: Vec<FileNode>,
    /// Index of the root node
    pub root_id: u32,
    /// Total size of all files
    pub total_size: u64,
    /// Total number of files
    pub total_files: u32,
    /// Total number of directories
    pub total_dirs: u32,
}

impl FileTree {
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            root_id: 0,
            total_size: 0,
            total_files: 0,
            total_dirs: 0,
        }
    }

    /// Pre-allocate capacity for expected number of nodes
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            nodes: Vec::with_capacity(capacity),
            root_id: 0,
            total_size: 0,
            total_files: 0,
            total_dirs: 0,
        }
    }

    /// Add a new node to the arena, returns its index
    pub fn add_node(&mut self, mut node: FileNode) -> u32 {
        let id = self.nodes.len() as u32;
        node.id = id;

        match node.node_type {
            NodeType::File => self.total_files += 1,
            NodeType::Directory => self.total_dirs += 1,
            _ => {}
        }

        self.nodes.push(node);
        id
    }

    /// Get a reference to a node by its index
    pub fn get(&self, id: u32) -> Option<&FileNode> {
        self.nodes.get(id as usize)
    }

    /// Get a mutable reference to a node by its index
    pub fn get_mut(&mut self, id: u32) -> Option<&mut FileNode> {
        self.nodes.get_mut(id as usize)
    }

    /// Add a child to a parent node
    pub fn add_child(&mut self, parent_id: u32, child_id: u32) {
        if let Some(parent) = self.nodes.get_mut(parent_id as usize) {
            parent.children.push(child_id);
        }
    }

    /// Get all direct children of a node, sorted by size descending
    pub fn get_children_sorted(&self, parent_id: u32) -> Vec<&FileNode> {
        if let Some(parent) = self.get(parent_id) {
            let mut children: Vec<&FileNode> = parent
                .children
                .iter()
                .filter_map(|&id| self.get(id))
                .collect();
            children.sort_by(|a, b| b.size.cmp(&a.size));
            children
        } else {
            Vec::new()
        }
    }

    /// Calculate the total size for a directory by summing children
    pub fn calculate_sizes(&mut self, node_id: u32) -> u64 {
        // Collect children first to avoid borrow issues
        let children: Vec<u32> = if let Some(node) = self.get(node_id) {
            node.children.clone()
        } else {
            return 0;
        };

        let mut total_size: u64 = 0;
        let mut file_count: u32 = 0;
        let mut dir_count: u32 = 0;

        for child_id in children {
            let child_size = self.calculate_sizes(child_id);
            if let Some(child) = self.get(child_id) {
                total_size += child_size;
                file_count += child.file_count;
                dir_count += child.dir_count;
            }
        }

        if let Some(node) = self.get_mut(node_id) {
            match node.node_type {
                NodeType::File => {
                    node.file_count = 1;
                    node.dir_count = 0;
                    return node.size;
                }
                NodeType::Directory => {
                    node.size = total_size;
                    node.file_count = file_count;
                    node.dir_count = dir_count + 1; // Count self
                }
                _ => {}
            }
        }

        total_size
    }
}

/// Lightweight version of FileNode sent to the frontend
/// to minimize IPC payload size
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNodeSummary {
    pub id: u32,
    pub parent_id: Option<u32>,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub file_count: u32,
    pub dir_count: u32,
    pub node_type: NodeType,
    pub last_modified: i64,
    pub has_children: bool,
    pub child_count: u32,
    pub risk_level: RiskLevel,
    pub access_denied: bool,
}

impl From<&FileNode> for FileNodeSummary {
    fn from(node: &FileNode) -> Self {
        Self {
            id: node.id,
            parent_id: node.parent_id,
            name: node.name.clone(),
            path: node.path.clone(),
            size: node.size,
            file_count: node.file_count,
            dir_count: node.dir_count,
            node_type: node.node_type,
            last_modified: node.last_modified,
            has_children: !node.children.is_empty(),
            child_count: node.children.len() as u32,
            risk_level: node.risk_level,
            access_denied: node.access_denied,
        }
    }
}

/// Treemap data optimized for frontend visualization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreemapNode {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub node_type: NodeType,
    pub risk_level: RiskLevel,
    pub children: Option<Vec<TreemapNode>>,
}

impl FileTree {
    /// Generate treemap data with a depth limit to avoid sending too much data
    pub fn to_treemap(&self, node_id: u32, max_depth: u32, min_size_ratio: f64) -> Option<TreemapNode> {
        let node = self.get(node_id)?;
        let min_size = (node.size as f64 * min_size_ratio) as u64;

        let children = if max_depth > 0 && node.node_type == NodeType::Directory {
            let mut child_nodes: Vec<TreemapNode> = node
                .children
                .iter()
                .filter_map(|&child_id| {
                    let child = self.get(child_id)?;
                    if child.size >= min_size {
                        self.to_treemap(child_id, max_depth - 1, min_size_ratio)
                    } else {
                        None
                    }
                })
                .collect();
            child_nodes.sort_by(|a, b| b.size.cmp(&a.size));

            if child_nodes.is_empty() {
                None
            } else {
                Some(child_nodes)
            }
        } else {
            None
        };

        Some(TreemapNode {
            name: node.name.clone(),
            path: node.path.clone(),
            size: node.size,
            node_type: node.node_type,
            risk_level: node.risk_level,
            children,
        })
    }
}
