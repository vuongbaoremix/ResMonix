use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    pub mount_point: String,
    pub label: String,
    pub total_space: u64,
    pub free_space: u64,
    pub used_space: u64,
    pub usage_percent: f64,
    pub file_system: String,
    pub drive_type: String,
    pub is_ready: bool,
}

/// Get all available drives on the system
pub fn get_drives() -> Vec<DriveInfo> {
    let mut drives = Vec::new();

    // Check drive letters A-Z
    for letter in b'A'..=b'Z' {
        let mount = format!("{}:\\", letter as char);
        let path = Path::new(&mount);

        if !path.exists() {
            continue;
        }

        match get_drive_info(&mount) {
            Some(info) => drives.push(info),
            None => continue,
        }
    }

    drives
}

#[cfg(target_os = "windows")]
fn get_drive_info(mount_point: &str) -> Option<DriveInfo> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeInformationW,
    };
    use windows::core::PCWSTR;

    let wide_path: Vec<u16> = OsStr::new(mount_point)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // Get drive type
    let drive_type = unsafe { GetDriveTypeW(PCWSTR(wide_path.as_ptr())) };
    let drive_type_str = match drive_type {
        0 => "Unknown",
        1 => "No Root",
        2 => "Removable",
        3 => "Fixed",
        4 => "Network",
        5 => "CD-ROM",
        6 => "RAM Disk",
        _ => "Unknown",
    };

    // Get volume information
    let mut volume_name = vec![0u16; 261];
    let mut fs_name = vec![0u16; 261];
    let mut serial_number: u32 = 0;
    let mut max_component_len: u32 = 0;
    let mut fs_flags: u32 = 0;

    let vol_info_ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(wide_path.as_ptr()),
            Some(&mut volume_name),
            Some(&mut serial_number),
            Some(&mut max_component_len),
            Some(&mut fs_flags),
            Some(&mut fs_name),
        )
        .is_ok()
    };

    let label = if vol_info_ok {
        String::from_utf16_lossy(&volume_name)
            .trim_end_matches('\0')
            .to_string()
    } else {
        String::new()
    };

    let file_system = if vol_info_ok {
        String::from_utf16_lossy(&fs_name)
            .trim_end_matches('\0')
            .to_string()
    } else {
        String::new()
    };

    // Get disk space
    let mut free_bytes_available: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free_bytes: u64 = 0;

    let space_ok = unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(wide_path.as_ptr()),
            Some(&mut free_bytes_available as *mut u64),
            Some(&mut total_bytes as *mut u64),
            Some(&mut total_free_bytes as *mut u64),
        )
        .is_ok()
    };

    if !space_ok {
        return None;
    }

    let used = total_bytes.saturating_sub(total_free_bytes);
    let usage_percent = if total_bytes > 0 {
        (used as f64 / total_bytes as f64) * 100.0
    } else {
        0.0
    };

    Some(DriveInfo {
        mount_point: mount_point.to_string(),
        label: if label.is_empty() {
            format!("Local Disk ({})", &mount_point[..2])
        } else {
            format!("{} ({})", label, &mount_point[..2])
        },
        total_space: total_bytes,
        free_space: total_free_bytes,
        used_space: used,
        usage_percent,
        file_system,
        drive_type: drive_type_str.to_string(),
        is_ready: true,
    })
}

#[cfg(not(target_os = "windows"))]
fn get_drive_info(_mount_point: &str) -> Option<DriveInfo> {
    None
}
