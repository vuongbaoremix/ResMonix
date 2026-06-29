use serde::{Deserialize, Serialize};

/// Type of cleanup action suggested
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    /// Direct deletion (move to Recycle Bin)
    DirectDelete,
    /// Requires a specific tool/command
    ToolRequired,
    /// Configuration change needed
    ConfigChange,
    /// Can be deleted and reinstalled
    Reinstallable,
    /// Should be moved to another drive
    MoveToOtherDrive,
}

/// A cleanup suggestion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suggestion {
    pub title: String,
    pub description: String,
    pub action_type: ActionType,
    pub estimated_savings: u64,
    pub command: Option<String>,
    pub risk_level: String,
    pub paths: Vec<String>,
    pub category: String,
}

/// Generate cleanup suggestions based on the scanned tree
pub fn generate_suggestions(tree: &crate::scanner::tree::FileTree) -> Vec<Suggestion> {
    let mut suggestions: Vec<Suggestion> = Vec::new();

    // Gather statistics by category
    let mut temp_size: u64 = 0;
    let mut cache_size: u64 = 0;
    let mut log_size: u64 = 0;
    let mut node_modules_size: u64 = 0;
    let mut recycle_size: u64 = 0;
    let mut crash_dump_size: u64 = 0;
    let mut pycache_size: u64 = 0;

    let temp_paths: Vec<String> = Vec::new();
    let cache_paths: Vec<String> = Vec::new();
    let mut node_modules_paths: Vec<String> = Vec::new();

    for node in &tree.nodes {
        let lower = node.path.to_lowercase();

        if lower.contains("\\temp\\") || lower.contains("\\tmp\\") {
            if node.node_type == crate::scanner::tree::NodeType::File {
                temp_size += node.size;
            }
        }

        if lower.contains("\\cache\\") || lower.contains("\\cache2\\") {
            if node.node_type == crate::scanner::tree::NodeType::File {
                cache_size += node.size;
            }
        }

        if lower.ends_with(".log") {
            log_size += node.size;
        }

        if lower.ends_with(".dmp") || lower.ends_with(".mdmp") {
            crash_dump_size += node.size;
        }

        if lower.contains("\\__pycache__\\") || lower.ends_with(".pyc") {
            pycache_size += node.size;
        }

        if lower.contains("\\$recycle.bin\\") {
            if node.node_type == crate::scanner::tree::NodeType::File {
                recycle_size += node.size;
            }
        }

        // Track node_modules directories (top-level only, not nested)
        if lower.ends_with("\\node_modules") && !lower.contains("\\node_modules\\") {
            node_modules_size += node.size;
            node_modules_paths.push(node.path.clone());
        }
    }

    // Generate suggestions for each category
    if temp_size > 1_000_000 {
        // > 1MB
        suggestions.push(Suggestion {
            title: "🗑️ Temporary Files".to_string(),
            description: "Các file tạm không còn cần thiết. An toàn để xóa.".to_string(),
            action_type: ActionType::DirectDelete,
            estimated_savings: temp_size,
            command: None,
            risk_level: "safe".to_string(),
            paths: temp_paths,
            category: "Temp Files".to_string(),
        });
    }

    if cache_size > 10_000_000 {
        // > 10MB
        suggestions.push(Suggestion {
            title: "🌐 Browser & App Cache".to_string(),
            description: "Cache từ trình duyệt và ứng dụng. Xóa sẽ không ảnh hưởng dữ liệu.".to_string(),
            action_type: ActionType::DirectDelete,
            estimated_savings: cache_size,
            command: None,
            risk_level: "safe".to_string(),
            paths: cache_paths,
            category: "Cache".to_string(),
        });
    }

    if log_size > 5_000_000 {
        // > 5MB
        suggestions.push(Suggestion {
            title: "📝 Log Files".to_string(),
            description: "File log từ ứng dụng và hệ thống. An toàn để xóa.".to_string(),
            action_type: ActionType::DirectDelete,
            estimated_savings: log_size,
            command: None,
            risk_level: "safe".to_string(),
            paths: Vec::new(),
            category: "Logs".to_string(),
        });
    }

    if crash_dump_size > 1_000_000 {
        suggestions.push(Suggestion {
            title: "💥 Crash Dumps".to_string(),
            description: "File crash dump từ các ứng dụng bị lỗi. An toàn để xóa nếu không cần debug."
                .to_string(),
            action_type: ActionType::DirectDelete,
            estimated_savings: crash_dump_size,
            command: None,
            risk_level: "safe".to_string(),
            paths: Vec::new(),
            category: "Crash Dumps".to_string(),
        });
    }

    if node_modules_size > 100_000_000 {
        // > 100MB
        suggestions.push(Suggestion {
            title: "📦 Node Modules".to_string(),
            description: format!(
                "Tìm thấy {} thư mục node_modules. Có thể xóa và chạy 'npm install' để cài lại.",
                node_modules_paths.len()
            ),
            action_type: ActionType::Reinstallable,
            estimated_savings: node_modules_size,
            command: Some("npm install".to_string()),
            risk_level: "caution".to_string(),
            paths: node_modules_paths,
            category: "Development".to_string(),
        });
    }

    if recycle_size > 1_000_000 {
        suggestions.push(Suggestion {
            title: "♻️ Recycle Bin".to_string(),
            description: "Dữ liệu trong Recycle Bin. Xóa vĩnh viễn để giải phóng dung lượng.".to_string(),
            action_type: ActionType::DirectDelete,
            estimated_savings: recycle_size,
            command: None,
            risk_level: "safe".to_string(),
            paths: Vec::new(),
            category: "Recycle Bin".to_string(),
        });
    }

    if pycache_size > 1_000_000 {
        suggestions.push(Suggestion {
            title: "🐍 Python Cache".to_string(),
            description: "Python bytecode cache (__pycache__). An toàn xóa, Python sẽ tạo lại.".to_string(),
            action_type: ActionType::DirectDelete,
            estimated_savings: pycache_size,
            command: None,
            risk_level: "safe".to_string(),
            paths: Vec::new(),
            category: "Development".to_string(),
        });
    }

    // Sort by estimated savings descending
    suggestions.sort_by(|a, b| b.estimated_savings.cmp(&a.estimated_savings));

    suggestions
}
