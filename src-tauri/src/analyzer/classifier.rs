use crate::scanner::tree::{NodeType, RiskLevel};

/// Classify a file/directory path into a risk level for deletion.
/// Uses pattern matching against known Windows paths and file types.
pub fn classify_path(path: &str, node_type: NodeType) -> RiskLevel {
    let lower = path.to_lowercase();
    let lower = lower.replace('/', "\\");

    // === DANGEROUS — System critical files ===
    if is_dangerous(&lower) {
        return RiskLevel::Dangerous;
    }

    // === SAFE — Known safe-to-delete patterns ===
    if is_safe(&lower, node_type) {
        return RiskLevel::Safe;
    }

    // === CAUTION — Needs review ===
    if is_caution(&lower) {
        return RiskLevel::Caution;
    }

    RiskLevel::Unknown
}

fn is_dangerous(path: &str) -> bool {
    // Windows system directories
    if path.starts_with("c:\\windows\\")
        || path == "c:\\windows"
        || path.starts_with("c:\\windows\\system32\\")
        || path.starts_with("c:\\windows\\syswow64\\")
        || path.starts_with("c:\\windows\\winsxs\\")
    {
        return true;
    }

    // Boot files
    let dangerous_files = [
        "bootmgr",
        "ntldr",
        "boot.ini",
        "pagefile.sys",
        "swapfile.sys",
        "ntuser.dat",
    ];
    for name in &dangerous_files {
        if path.ends_with(name) {
            return true;
        }
    }

    // Program Files (installed applications)
    if path.starts_with("c:\\program files\\") || path.starts_with("c:\\program files (x86)\\") {
        return true;
    }

    // Driver files
    if path.contains("\\system32\\drivers\\") && path.ends_with(".sys") {
        return true;
    }

    // Registry hives
    if path.contains("\\config\\") {
        let registry_files = ["system", "software", "sam", "security", "default"];
        for reg in &registry_files {
            if path.ends_with(reg) {
                return true;
            }
        }
    }

    false
}

fn is_safe(path: &str, _node_type: NodeType) -> bool {
    // Temp directories
    if path.contains("\\temp\\") || path.contains("\\tmp\\") {
        return true;
    }

    // Browser caches
    let cache_patterns = [
        "\\google\\chrome\\user data\\default\\cache\\",
        "\\google\\chrome\\user data\\default\\code cache\\",
        "\\mozilla\\firefox\\profiles\\",
        "\\microsoft\\edge\\user data\\default\\cache\\",
        "\\cache2\\entries\\",
    ];
    for pattern in &cache_patterns {
        if path.contains(pattern) {
            return true;
        }
    }

    // Windows thumbnail cache
    if path.contains("thumbcache_") && path.ends_with(".db") {
        return true;
    }

    // Log files
    if path.ends_with(".log") || path.ends_with(".log.old") || path.ends_with(".log.bak") {
        return true;
    }

    // Crash dumps
    if path.ends_with(".dmp") || path.ends_with(".mdmp") {
        return true;
    }

    // Installer temp files
    if path.ends_with(".tmp") && !path.contains("\\appdata\\") {
        return true;
    }

    // Windows Update cache
    if path.contains("\\softwaredistribution\\download\\") {
        return true;
    }

    // Recycle Bin
    if path.contains("\\$recycle.bin\\") {
        return true;
    }

    // Python cache
    if path.contains("\\__pycache__\\") || path.ends_with(".pyc") {
        return true;
    }

    // npm/yarn/pnpm cache (global)
    if path.contains("\\npm-cache\\")
        || path.contains("\\yarn\\cache\\")
        || path.contains("\\pnpm-store\\")
    {
        return true;
    }

    // NuGet cache
    if path.contains("\\.nuget\\packages\\") {
        return true;
    }

    // Gradle cache
    if path.contains("\\.gradle\\caches\\") {
        return true;
    }

    false
}

fn is_caution(path: &str) -> bool {
    // AppData - may contain important settings
    if path.contains("\\appdata\\local\\") || path.contains("\\appdata\\roaming\\") {
        return true;
    }

    // ProgramData
    if path.starts_with("c:\\programdata\\") {
        return true;
    }

    // WSL/Docker virtual disks
    if path.ends_with("ext4.vhdx") {
        return true;
    }

    // Git repositories
    if path.contains("\\.git\\") {
        return true;
    }

    // node_modules (can be reinstalled but takes time)
    if path.contains("\\node_modules\\") || path.ends_with("\\node_modules") {
        return true;
    }

    // Database files
    if path.ends_with(".mdf") || path.ends_with(".ldf") || path.ends_with(".sqlite") || path.ends_with(".sqlite3") {
        return true;
    }

    // Hibernation file
    if path.ends_with("hiberfil.sys") {
        return true;
    }

    false
}

/// Get a human-readable description of what a file/directory is
pub fn describe_path(path: &str) -> Option<FileDescription> {
    let lower = path.to_lowercase().replace('/', "\\");

    // System directories
    if lower.contains("\\windows\\winsxs") {
        return Some(FileDescription {
            what: "Windows Component Store".to_string(),
            description: "Lưu trữ các phiên bản DLL, driver cho Windows Update. Không thể xóa thủ công.".to_string(),
            belongs_to: "Windows OS".to_string(),
            importance: "Rất quan trọng — hệ thống sẽ bị lỗi nếu xóa".to_string(),
        });
    }

    if lower.ends_with("ext4.vhdx") {
        return Some(FileDescription {
            what: "WSL/Docker Virtual Disk".to_string(),
            description: "Ổ đĩa ảo chứa toàn bộ dữ liệu Linux/Docker containers. Dùng 'docker system prune' + 'Optimize-VHD' để thu nhỏ.".to_string(),
            belongs_to: "WSL / Docker Desktop".to_string(),
            importance: "Quan trọng — chứa dữ liệu containers, không xóa thủ công".to_string(),
        });
    }

    if lower.ends_with("hiberfil.sys") {
        return Some(FileDescription {
            what: "Hibernation File".to_string(),
            description: "File hibernation, kích thước bằng RAM. Tắt hibernate bằng 'powercfg -h off' để xóa.".to_string(),
            belongs_to: "Windows Power Management".to_string(),
            importance: "Có thể tắt nếu không dùng hibernate".to_string(),
        });
    }

    if lower.ends_with("pagefile.sys") {
        return Some(FileDescription {
            what: "Virtual Memory Page File".to_string(),
            description: "File bộ nhớ ảo, Windows sử dụng khi RAM đầy. Không xóa trực tiếp.".to_string(),
            belongs_to: "Windows Memory Manager".to_string(),
            importance: "Rất quan trọng — hệ thống cần để hoạt động ổn định".to_string(),
        });
    }

    if lower.contains("\\node_modules") {
        return Some(FileDescription {
            what: "Node.js Dependencies".to_string(),
            description: "Thư viện JavaScript của dự án. Có thể xóa và chạy 'npm install' hoặc 'bun install' để cài lại.".to_string(),
            belongs_to: "Node.js Project".to_string(),
            importance: "Có thể xóa — cài lại bằng package manager".to_string(),
        });
    }

    if lower.contains("\\.git\\") || lower.ends_with("\\.git") {
        return Some(FileDescription {
            what: "Git Repository Data".to_string(),
            description: "Chứa toàn bộ lịch sử version control. Xóa sẽ mất lịch sử commit.".to_string(),
            belongs_to: "Git Version Control".to_string(),
            importance: "Quan trọng — chứa lịch sử code, nên push remote trước khi xóa".to_string(),
        });
    }

    if lower.contains("\\softwaredistribution\\") {
        return Some(FileDescription {
            what: "Windows Update Cache".to_string(),
            description: "Cache các bản cập nhật Windows đã tải. An toàn để xóa, Windows sẽ tải lại khi cần.".to_string(),
            belongs_to: "Windows Update".to_string(),
            importance: "An toàn xóa — dùng Disk Cleanup để xóa đúng cách".to_string(),
        });
    }

    None
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileDescription {
    pub what: String,
    pub description: String,
    pub belongs_to: String,
    pub importance: String,
}
