use serde::Serialize;
use std::collections::HashMap;
use std::ffi::c_void;
use std::mem;

use windows::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, LUID};
use windows::Win32::Security::{
    AdjustTokenPrivileges, GetTokenInformation, LookupPrivilegeValueW, TokenElevation, 
    LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES, TOKEN_ELEVATION, 
    TOKEN_PRIVILEGES, TOKEN_QUERY,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Memory::SetSystemFileCacheSize;
use windows::Win32::System::ProcessStatus::{EmptyWorkingSet, GetPerformanceInfo, PERFORMANCE_INFORMATION};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA,
};

// ===== NtQuerySystemInformation FFI =====
// This NT API gets memory info for ALL processes without needing OpenProcess.
// Critical for vmmem (Hyper-V/WSL VM memory), System, and other protected processes
// that OpenProcess cannot access, causing them to report 0 bytes.

#[link(name = "ntdll")]
extern "system" {
    fn NtQuerySystemInformation(
        system_information_class: u32,
        system_information: *mut c_void,
        system_information_length: u32,
        return_length: *mut u32,
    ) -> i32;

    fn NtSetSystemInformation(
        system_information_class: u32,
        system_information: *mut c_void,
        system_information_length: u32,
    ) -> i32;
}

const SYSTEM_PROCESS_INFO_CLASS: u32 = 5; // SystemProcessInformation
const SYSTEM_POOL_TAG_INFORMATION: u32 = 22; // SystemPoolTagInformation
const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC0000004u32 as i32;

#[repr(C)]
#[derive(Debug, Clone)]
pub struct SYSTEM_POOLTAG {
    pub tag: [u8; 4],
    pub paged_allocs: u32,
    pub paged_frees: u32,
    pub paged_used: usize,
    pub non_paged_allocs: u32,
    pub non_paged_frees: u32,
    pub non_paged_used: usize,
}

// Field offsets in SYSTEM_PROCESS_INFORMATION on x64 Windows.
// These are stable across all Windows 10/11 versions.
const OFF_NEXT_ENTRY: usize = 0; // ULONG NextEntryOffset
const OFF_IMAGE_NAME_LEN: usize = 56; // UNICODE_STRING.Length (u16, in bytes)
const OFF_IMAGE_NAME_BUF: usize = 64; // UNICODE_STRING.Buffer (*const u16)
const OFF_PID: usize = 80; // HANDLE UniqueProcessId
const OFF_PPID: usize = 88; // HANDLE InheritedFromUniqueProcessId
const OFF_WORKING_SET: usize = 144; // SIZE_T WorkingSetSize
const OFF_PAGEFILE_USAGE: usize = 184; // SIZE_T PagefileUsage (= Private Bytes)
const MIN_ENTRY_SIZE: usize = 208; // Minimum bytes needed to safely read all fields

// ===== Data Structures =====

#[derive(Debug, Clone, Serialize)]
pub enum ProcessType {
    Normal,
    Service,
    Vm,
    Subsystem,
    Container,
    System,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: u32,
    pub name: String,
    pub working_set: u64,
    pub private_bytes: u64,
    pub process_type: ProcessType,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessTreeNode {
    pub process: ProcessInfo,
    pub children: Vec<ProcessTreeNode>,
    pub subtree_working_set: u64,
    pub subtree_private_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemorySummary {
    pub total_physical: u64,
    pub used_physical: u64,
    pub available_physical: u64,
    pub commit_total: u64,
    pub commit_limit: u64,
    pub memory_load: u32,
    pub process_count: u32,
    // Detailed breakdown
    pub kernel_total: u64,
    pub kernel_paged: u64,
    pub kernel_nonpaged: u64,
    pub system_cache: u64,
    pub total_process_ws: u64,   // Sum of all process working sets
    pub non_process_memory: u64, // used - process WS (kernel + cache + drivers + ...)
}

// ===== Process Enumeration via NtQuerySystemInformation =====

/// Enumerate ALL processes using NtQuerySystemInformation (SystemProcessInformation).
/// This returns accurate memory data for every process including:
/// - vmmem / vmmemWSL (Hyper-V/WSL VM memory)
/// - System (PID 4)
/// - Protected processes that OpenProcess() cannot open
///
/// Falls back to Toolhelp32 (with no memory data) if NT query fails.
pub fn enumerate_all_processes() -> Vec<ProcessInfo> {
    if let Some(processes) = enumerate_via_nt_query() {
        return processes;
    }
    // Fallback: Toolhelp32 (memory will be 0 for protected processes)
    enumerate_via_toolhelp()
}

/// Primary enumeration via NtQuerySystemInformation.
fn enumerate_via_nt_query() -> Option<Vec<ProcessInfo>> {
    unsafe {
        let mut buf_size: u32 = 4 * 1024 * 1024; // Start with 4 MB
        let mut buffer: Vec<u8>;
        let mut return_length: u32 = 0;

        // Allocate buffer and call, growing if STATUS_INFO_LENGTH_MISMATCH
        loop {
            buffer = vec![0u8; buf_size as usize];
            let status = NtQuerySystemInformation(
                SYSTEM_PROCESS_INFO_CLASS,
                buffer.as_mut_ptr() as *mut c_void,
                buf_size,
                &mut return_length,
            );

            if status == STATUS_INFO_LENGTH_MISMATCH {
                buf_size = return_length + 8192;
                continue;
            }

            if status < 0 {
                // NT error — fall back to Toolhelp32
                return None;
            }

            break;
        }

        let mut processes = Vec::with_capacity(500);
        let mut offset: usize = 0;

        // Parse linked list of SYSTEM_PROCESS_INFORMATION entries
        loop {
            if offset + MIN_ENTRY_SIZE > buffer.len() {
                break;
            }

            let base = buffer.as_ptr().add(offset);
            let next = *(base.add(OFF_NEXT_ENTRY) as *const u32);

            let pid = *(base.add(OFF_PID) as *const usize) as u32;
            let ppid = *(base.add(OFF_PPID) as *const usize) as u32;
            let ws = *(base.add(OFF_WORKING_SET) as *const usize) as u64;
            let pb = *(base.add(OFF_PAGEFILE_USAGE) as *const usize) as u64;

            // Read process name from embedded UNICODE_STRING
            let name_len_bytes = *(base.add(OFF_IMAGE_NAME_LEN) as *const u16) as usize;
            let name_buf = *(base.add(OFF_IMAGE_NAME_BUF) as *const *const u16);
            let name = if !name_buf.is_null() && name_len_bytes > 0 {
                let name_chars = name_len_bytes / 2;
                String::from_utf16_lossy(std::slice::from_raw_parts(name_buf, name_chars))
            } else if pid == 0 {
                "[System Process]".to_string()
            } else {
                format!("PID {}", pid)
            };

            let process_type = classify_process(&name);

            processes.push(ProcessInfo {
                pid,
                parent_pid: ppid,
                name,
                working_set: ws,
                private_bytes: pb,
                process_type,
            });

            if next == 0 {
                break;
            }
            offset += next as usize;
        }

        Some(processes)
    }
}

/// Fallback enumeration using Toolhelp32 snapshot (no memory data for protected processes).
fn enumerate_via_toolhelp() -> Vec<ProcessInfo> {
    let mut processes = Vec::new();

    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return processes,
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                let parent_pid = entry.th32ParentProcessID;

                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
                let process_type = classify_process(&name);

                processes.push(ProcessInfo {
                    pid,
                    parent_pid,
                    name,
                    working_set: 0, // No memory info in fallback mode
                    private_bytes: 0,
                    process_type,
                });

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }

    processes
}

// ===== Process Classification =====

/// Classify a process based on its executable name.
fn classify_process(name: &str) -> ProcessType {
    let lower = name.to_lowercase();

    // Hyper-V virtual machine worker processes
    if lower == "vmwp.exe" || lower == "vmms.exe" || lower == "vmcompute.exe" {
        return ProcessType::Vm;
    }

    // WSL / Linux subsystem / VM memory
    if lower == "vmmem"
        || lower == "vmmemwsl"
        || lower == "wslhost.exe"
        || lower == "wsl.exe"
        || lower == "wslservice.exe"
    {
        return ProcessType::Subsystem;
    }

    // Docker
    if lower.starts_with("com.docker")
        || lower == "dockerd.exe"
        || lower == "docker.exe"
        || lower == "docker-compose.exe"
    {
        return ProcessType::Container;
    }

    // System processes
    if lower == "system"
        || lower == "registry"
        || lower == "smss.exe"
        || lower == "csrss.exe"
        || lower == "wininit.exe"
        || lower == "winlogon.exe"
        || lower == "lsass.exe"
        || lower == "services.exe"
        || lower == "ntoskrnl.exe"
        || lower == "[system process]"
        || lower == "memory compression"
        || lower == "idle"
    {
        return ProcessType::System;
    }

    // Windows services
    if lower == "svchost.exe"
        || lower == "spoolsv.exe"
        || lower == "wuauserv.exe"
        || lower.ends_with("service.exe")
        || lower.ends_with("svc.exe")
    {
        return ProcessType::Service;
    }

    ProcessType::Normal
}

// ===== Pool Tag resolution =====

fn resolve_pool_tag(tag: &str) -> String {
    // Reverse the tag for friendly display if it contains trailing spaces or standard format
    // A simplified knowledge base of common pool tags:
    match tag {
        "FMfn" => "File System (NTFS)".to_string(),
        "MmSt" => "Memory Manager Section".to_string(),
        "Thre" => "Thread Objects".to_string(),
        "Proc" => "Process Objects".to_string(),
        "EtwB" => "Event Tracing (ETW)".to_string(),
        "CMnb" | "CMpb" => "Registry Config Manager".to_string(),
        "Toke" => "Security Tokens".to_string(),
        "DxgK" | "Dxg " => "DirectX Graphics Kernel".to_string(),
        "Cont" => "Contiguous Physical Memory".to_string(),
        "File" => "File Objects".to_string(),
        "ConT" => "Console Terminal".to_string(),
        "Se  " => "Security Subsystem".to_string(),
        "Net " => "Network System".to_string(),
        "NDnd" | "Ndis" => "NDIS Network Driver".to_string(),
        "Mup " => "Multiple UNC Provider".to_string(),
        "VfFh" | "Vf  " => "Driver Verifier".to_string(),
        "Ntfs" | "NtFf" | "NtFD" => "NTFS File System".to_string(),
        "tcp " | "Tcp " | "TCPT" => "TCP/IP Protocol".to_string(),
        "afd " | "Afd " => "Ancillary Function Driver".to_string(),
        "NpFs" => "Named Pipe File System".to_string(),
        "ViGk" => "Video Graphics Kernel".to_string(),
        "Udp " | "UdpA" => "UDP Protocol".to_string(),
        "Wfp " | "WfpE" => "Windows Filtering Platform".to_string(),
        "ALPC" | "Alpc" => "ALPC Port Objects".to_string(),
        _ => format!("Tag: {}", tag),
    }
}

pub fn get_pool_tags() -> Vec<SYSTEM_POOLTAG> {
    unsafe {
        let mut buffer_size = 1024 * 1024;
        let mut buffer: Vec<u8> = vec![0; buffer_size as usize];
        let mut return_length: u32 = 0;
        
        let mut status;
        loop {
            status = NtQuerySystemInformation(
                SYSTEM_POOL_TAG_INFORMATION,
                buffer.as_mut_ptr() as *mut c_void,
                buffer_size,
                &mut return_length,
            );
            
            if status == 0xC0000004u32 as i32 { // STATUS_INFO_LENGTH_MISMATCH
                buffer_size *= 2;
                buffer = vec![0; buffer_size as usize];
            } else {
                break;
            }
        }

        if status != 0 {
            return Vec::new();
        }

        let count = *(buffer.as_ptr() as *const u32);
        let offset = if cfg!(target_pointer_width = "64") { 8 } else { 4 };
        let tags_ptr = (buffer.as_ptr() as *const u8).add(offset) as *const SYSTEM_POOLTAG;
        let tags = std::slice::from_raw_parts(tags_ptr, count as usize);

        tags.to_vec()
    }
}

// ===== System Memory Info =====

/// Get system-wide memory information using GlobalMemoryStatusEx + GetPerformanceInfo.
pub fn get_system_memory_info() -> MemorySummary {
    unsafe {
        let mut status = MEMORYSTATUSEX {
            dwLength: mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };

        let mut perf: PERFORMANCE_INFORMATION = mem::zeroed();
        perf.cb = mem::size_of::<PERFORMANCE_INFORMATION>() as u32;

        let has_status = GlobalMemoryStatusEx(&mut status).is_ok();
        let has_perf = GetPerformanceInfo(&mut perf, perf.cb).is_ok();

        if has_status {
            let page_size = if has_perf { perf.PageSize as u64 } else { 4096 };

            let kernel_total = if has_perf {
                perf.KernelTotal as u64 * page_size
            } else {
                0
            };
            let kernel_paged = if has_perf {
                perf.KernelPaged as u64 * page_size
            } else {
                0
            };
            let kernel_nonpaged = if has_perf {
                perf.KernelNonpaged as u64 * page_size
            } else {
                0
            };
            let system_cache = if has_perf {
                perf.SystemCache as u64 * page_size
            } else {
                0
            };
            let commit_total = if has_perf {
                perf.CommitTotal as u64 * page_size
            } else {
                0
            };
            let commit_limit = if has_perf {
                perf.CommitLimit as u64 * page_size
            } else {
                0
            };

            MemorySummary {
                total_physical: status.ullTotalPhys,
                available_physical: status.ullAvailPhys,
                used_physical: status.ullTotalPhys.saturating_sub(status.ullAvailPhys),
                commit_total,
                commit_limit,
                memory_load: status.dwMemoryLoad,
                process_count: 0,
                kernel_total,
                kernel_paged,
                kernel_nonpaged,
                system_cache,
                total_process_ws: 0,
                non_process_memory: 0,
            }
        } else {
            MemorySummary {
                total_physical: 0,
                available_physical: 0,
                used_physical: 0,
                commit_total: 0,
                commit_limit: 0,
                memory_load: 0,
                process_count: 0,
                kernel_total: 0,
                kernel_paged: 0,
                kernel_nonpaged: 0,
                system_cache: 0,
                total_process_ws: 0,
                non_process_memory: 0,
            }
        }
    }
}

// ===== Process Tree Building =====

/// Build a process tree from a flat list of processes.
/// Returns root-level nodes (processes whose parent is not in the list or is PID 0).
pub fn build_process_tree(processes: Vec<ProcessInfo>) -> Vec<ProcessTreeNode> {
    let pid_set: std::collections::HashSet<u32> = processes.iter().map(|p| p.pid).collect();
    let mut children_map: HashMap<u32, Vec<ProcessInfo>> = HashMap::new();
    let mut roots: Vec<ProcessInfo> = Vec::new();

    for process in processes {
        if process.pid == 0
            || process.parent_pid == 0
            || process.parent_pid == process.pid
            || !pid_set.contains(&process.parent_pid)
        {
            roots.push(process);
        } else {
            children_map
                .entry(process.parent_pid)
                .or_default()
                .push(process);
        }
    }

    // Sort roots by working_set descending
    roots.sort_by(|a, b| b.working_set.cmp(&a.working_set));

    roots
        .into_iter()
        .map(|p| build_tree_node(p, &mut children_map))
        .collect()
}

fn build_tree_node(
    process: ProcessInfo,
    children_map: &mut HashMap<u32, Vec<ProcessInfo>>,
) -> ProcessTreeNode {
    let mut child_procs = children_map.remove(&process.pid).unwrap_or_default();
    child_procs.sort_by(|a, b| b.working_set.cmp(&a.working_set));

    let children: Vec<ProcessTreeNode> = child_procs
        .into_iter()
        .map(|c| build_tree_node(c, children_map))
        .collect();

    let subtree_working_set = process.working_set
        + children.iter().map(|c| c.subtree_working_set).sum::<u64>();
    let subtree_private_bytes = process.private_bytes
        + children
            .iter()
            .map(|c| c.subtree_private_bytes)
            .sum::<u64>();

    ProcessTreeNode {
        process,
        children,
        subtree_working_set,
        subtree_private_bytes,
    }
}

// ===== Public API =====

/// Get the full process tree and system memory summary.
/// This is the main entry point called from Tauri commands.
pub fn get_process_tree_with_summary() -> (MemorySummary, Vec<ProcessTreeNode>) {
    let processes = enumerate_all_processes();
    let process_count = processes.len() as u32;

    // Sum all process working sets
    let total_process_ws: u64 = processes.iter().map(|p| p.working_set).sum();

    let mut summary = get_system_memory_info();
    summary.process_count = process_count;
    summary.total_process_ws = total_process_ws;
    // Non-process memory = total used - sum of process working sets
    // This includes kernel pools, system cache, drivers, page tables, etc.
    summary.non_process_memory = summary.used_physical.saturating_sub(total_process_ws);

    let mut tree = build_process_tree(processes);

    // --- Fetch Pool Tags ---
    let pool_tags = get_pool_tags();
    
    let mut nonpaged_tags = pool_tags.clone();
    nonpaged_tags.sort_by(|a, b| b.non_paged_used.cmp(&a.non_paged_used));
    
    let mut paged_tags = pool_tags;
    paged_tags.sort_by(|a, b| b.paged_used.cmp(&a.paged_used));

    // --- Thêm các node ảo để hiển thị phần RAM hệ thống bị chiếm giữ trên Treemap ---
    let create_virtual_node_with_children = |pid: u32, name: &str, size: u64, mut children: Vec<ProcessTreeNode>| -> ProcessTreeNode {
        // Adjust children sizes so they don't exceed the parent size
        let mut accounted = 0;
        let mut valid_children = Vec::new();
        for mut child in children {
            if accounted + child.subtree_working_set > size {
                // Ignore children that would overflow the allocated size
                continue;
            }
            accounted += child.subtree_working_set;
            valid_children.push(child);
        }
        
        ProcessTreeNode {
            process: ProcessInfo {
                pid,
                parent_pid: 0,
                name: name.to_string(),
                working_set: size.saturating_sub(accounted), // The parent itself takes the remaining unaccounted space
                private_bytes: size.saturating_sub(accounted),
                process_type: ProcessType::System,
            },
            children: valid_children,
            subtree_working_set: size,
            subtree_private_bytes: size,
        }
    };
    
    let create_child_node = |pid: u32, parent_pid: u32, name: &str, size: u64| -> ProcessTreeNode {
        ProcessTreeNode {
            process: ProcessInfo {
                pid,
                parent_pid,
                name: name.to_string(),
                working_set: size,
                private_bytes: size,
                process_type: ProcessType::System,
            },
            children: Vec::new(),
            subtree_working_set: size,
            subtree_private_bytes: size,
        }
    };

    let mut remaining = summary.non_process_memory;
    
    let nonpaged_to_show = remaining.min(summary.kernel_nonpaged);
    if nonpaged_to_show > 0 {
        let parent_pid = u32::MAX - 1;
        let mut children = Vec::new();
        for (i, tag) in nonpaged_tags.into_iter().take(40).enumerate() {
            if tag.non_paged_used > 0 {
                let tag_str = String::from_utf8_lossy(&tag.tag);
                let friendly_name = resolve_pool_tag(&tag_str);
                children.push(create_child_node(u32::MAX - 100 - i as u32, parent_pid, &friendly_name, tag.non_paged_used as u64));
            }
        }
        
        tree.push(create_virtual_node_with_children(parent_pid, "Kernel NonPaged Pool", nonpaged_to_show, children));
        remaining -= nonpaged_to_show;
    }

    let paged_to_show = remaining.min(summary.kernel_paged);
    if paged_to_show > 0 {
        let parent_pid = u32::MAX - 2;
        let mut children = Vec::new();
        for (i, tag) in paged_tags.into_iter().take(40).enumerate() {
            if tag.paged_used > 0 {
                let tag_str = String::from_utf8_lossy(&tag.tag);
                let friendly_name = resolve_pool_tag(&tag_str);
                children.push(create_child_node(u32::MAX - 1000 - i as u32, parent_pid, &friendly_name, tag.paged_used as u64));
            }
        }
        
        tree.push(create_virtual_node_with_children(parent_pid, "Kernel Paged Pool", paged_to_show, children));
        remaining -= paged_to_show;
    }
    
    if remaining > 0 {
        tree.push(create_virtual_node_with_children(u32::MAX - 3, "Hardware Drivers / Page Tables", remaining, Vec::new()));
    }

    // Sắp xếp lại tree để các node hệ thống lớn nằm lên trên
    tree.sort_by(|a, b| b.subtree_working_set.cmp(&a.subtree_working_set));

    (summary, tree)
}

// ===== Kill Process =====

/// Kill a process by PID using Win32 TerminateProcess API.
pub fn kill_process(pid: u32) -> Result<(), String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, false, pid)
            .map_err(|e| format!("Không thể mở process (PID {}): {}. Thử chạy với quyền Administrator.", pid, e))?;

        let result = TerminateProcess(handle, 1);
        let _ = CloseHandle(handle);

        result.map_err(|e| format!("Không thể tắt process (PID {}): {}", pid, e))?;
        Ok(())
    }
}

// ===== Process Analysis (EXE metadata) =====

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProcessAnalysis {
    pub exe_path: Option<String>,
    pub file_description: Option<String>,
    pub company_name: Option<String>,
    pub product_name: Option<String>,
    pub product_version: Option<String>,
    pub legal_copyright: Option<String>,
    pub original_filename: Option<String>,
    pub is_signed: bool,
    pub analysis_summary: String,
}

/// Analyze a process: get its executable path and read PE version info.
pub fn analyze_process(pid: u32) -> Result<ProcessAnalysis, String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let exe_path = unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .map_err(|e| format!("Không thể mở process: {}", e))?;

        let mut buf = vec![0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);

        if ok.is_ok() && size > 0 {
            Some(String::from_utf16_lossy(&buf[..size as usize]))
        } else {
            None
        }
    };

    // Read PE version info
    let (file_description, company_name, product_name, product_version, legal_copyright, original_filename) =
        if let Some(ref path) = exe_path {
            read_version_info(path)
        } else {
            (None, None, None, None, None, None)
        };

    // Check if file is signed (simple check: has version info with company name)
    let is_signed = company_name.is_some();

    // Build analysis summary
    let summary = build_analysis_summary(
        pid,
        exe_path.as_deref(),
        file_description.as_deref(),
        company_name.as_deref(),
        product_name.as_deref(),
    );

    Ok(ProcessAnalysis {
        exe_path,
        file_description,
        company_name,
        product_name,
        product_version,
        legal_copyright,
        original_filename,
        is_signed,
        analysis_summary: summary,
    })
}

fn read_version_info(path: &str) -> (Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>) {
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    use windows::core::PCWSTR;

    let path_wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let path_pcwstr = PCWSTR(path_wide.as_ptr());

    unsafe {
        let size = GetFileVersionInfoSizeW(path_pcwstr, None);
        if size == 0 {
            return (None, None, None, None, None, None);
        }

        let mut data = vec![0u8; size as usize];
        if GetFileVersionInfoW(path_pcwstr, 0, size, data.as_mut_ptr() as *mut _).is_err() {
            return (None, None, None, None, None, None);
        }

        // Try to find the translation table
        let mut lang_ptr: *mut u8 = std::ptr::null_mut();
        let mut lang_len: u32 = 0;
        let trans_key: Vec<u16> = "\\VarFileInfo\\Translation\0".encode_utf16().collect();

        let has_trans = VerQueryValueW(
            data.as_ptr() as *const _,
            PCWSTR(trans_key.as_ptr()),
            &mut lang_ptr as *mut *mut u8 as *mut *mut _,
            &mut lang_len,
        ).as_bool();

        // Default to English (0409, 04B0)
        let (lang, codepage) = if has_trans && lang_len >= 4 && !lang_ptr.is_null() {
            let lang = *(lang_ptr as *const u16);
            let cp = *((lang_ptr as *const u16).add(1));
            (lang, cp)
        } else {
            (0x0409, 0x04B0)
        };

        let prefix = format!("\\StringFileInfo\\{:04x}{:04x}\\", lang, codepage);

        let file_description = query_string_value(&data, &prefix, "FileDescription");
        let company_name = query_string_value(&data, &prefix, "CompanyName");
        let product_name = query_string_value(&data, &prefix, "ProductName");
        let product_version = query_string_value(&data, &prefix, "ProductVersion");
        let legal_copyright = query_string_value(&data, &prefix, "LegalCopyright");
        let original_filename = query_string_value(&data, &prefix, "OriginalFilename");

        (file_description, company_name, product_name, product_version, legal_copyright, original_filename)
    }
}

unsafe fn query_string_value(data: &[u8], prefix: &str, key: &str) -> Option<String> {
    use windows::Win32::Storage::FileSystem::VerQueryValueW;
    use windows::core::PCWSTR;

    let query = format!("{}{}\0", prefix, key);
    let query_wide: Vec<u16> = query.encode_utf16().collect();

    let mut ptr: *mut u8 = std::ptr::null_mut();
    let mut len: u32 = 0;

    let ok = VerQueryValueW(
        data.as_ptr() as *const _,
        PCWSTR(query_wide.as_ptr()),
        &mut ptr as *mut *mut u8 as *mut *mut _,
        &mut len,
    );

    if ok.as_bool() && !ptr.is_null() && len > 0 {
        let slice = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        // Trim trailing null
        let trimmed = if slice.last() == Some(&0) {
            &slice[..slice.len() - 1]
        } else {
            slice
        };
        let s = String::from_utf16_lossy(trimmed);
        if s.is_empty() { None } else { Some(s) }
    } else {
        None
    }
}

fn build_analysis_summary(
    pid: u32,
    exe_path: Option<&str>,
    file_description: Option<&str>,
    company_name: Option<&str>,
    product_name: Option<&str>,
) -> String {
    let mut parts = Vec::new();

    if let Some(desc) = file_description {
        parts.push(format!("📝 {}", desc));
    }

    if let Some(product) = product_name {
        if let Some(company) = company_name {
            parts.push(format!("🏢 {} — {}", product, company));
        } else {
            parts.push(format!("📦 {}", product));
        }
    } else if let Some(company) = company_name {
        parts.push(format!("🏢 Phát hành bởi {}", company));
    }

    if let Some(path) = exe_path {
        // Determine safety based on path and publisher
        let lower = path.to_lowercase();
        if lower.starts_with("c:\\windows\\") {
            parts.push("✅ Thành phần Windows — thường an toàn".to_string());
        } else if lower.contains("\\program files") {
            parts.push("✅ Ứng dụng đã cài đặt chính thức".to_string());
        } else if company_name.is_some() {
            parts.push("ℹ️ Có thông tin nhà phát hành".to_string());
        } else {
            parts.push("⚠️ Không có thông tin nhà phát hành — nên kiểm tra kỹ".to_string());
        }
    }

    if parts.is_empty() {
        format!("Không thể đọc thông tin chi tiết của process (PID {}). Có thể cần quyền Administrator.", pid)
    } else {
        parts.join("\n")
    }
}

// ===== Online Process Lookup =====

#[derive(Debug, Clone, serde::Serialize)]
pub struct OnlineProcessInfo {
    pub title: String,
    pub description: String,
    pub belongs_to: Option<String>,
    pub developer: Option<String>,
    pub danger_rating: Option<String>,
    pub source_url: String,
}

/// Lookup process info from file.net (no API key needed).
pub fn lookup_process_online(process_name: &str) -> Result<OnlineProcessInfo, String> {
    let name = process_name.to_lowercase();
    // Ensure .exe extension
    let name = if name.ends_with(".exe") {
        name.clone()
    } else {
        format!("{}.exe", name)
    };

    let url = format!("https://www.file.net/process/{}.html", name);

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) ResMonix/1.0")
        .build()
        .map_err(|e| format!("Không thể tạo HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("Không thể kết nối: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Không tìm thấy thông tin cho '{}' (HTTP {})",
            process_name,
            response.status()
        ));
    }

    let html = response
        .text()
        .map_err(|e| format!("Không thể đọc response: {}", e))?;

    // Parse key fields from HTML
    let title = extract_between(&html, "<h1 itemprop=\"headline\">", "</h1>")
        .map(|t| strip_html_tags(&t))
        .unwrap_or_else(|| format!("What is {}?", name));

    // Get description from itemprop="description" — clean and truncate
    let description = extract_between(&html, "itemprop=\"description\">", "</span>")
        .map(|d| {
            let cleaned = strip_html_tags(&d);
            // Take first ~400 chars at a sentence boundary
            truncate_at_sentence(&cleaned, 400)
        })
        .unwrap_or_else(|| "Không có mô tả.".to_string());

    // belongs_to: extract clean text from itemprop="isPartOf"
    let belongs_to = extract_between(&html, "itemprop=\"isPartOf\">", "</em>")
        .map(|s| strip_html_tags(&s));

    // developer: from first itemprop="name" inside author span
    let developer = extract_between(&html, "itemprop=\"name\">", "</em>")
        .map(|s| strip_html_tags(&s))
        .or_else(|| {
            extract_between(&html, "itemprop=\"name\">", "</span>")
                .map(|s| strip_html_tags(&s))
        });

    // Extract danger rating
    let danger_rating = extract_between(&html, "security rating is <em>", "</em>");

    Ok(OnlineProcessInfo {
        title,
        description,
        belongs_to,
        developer,
        danger_rating,
        source_url: url,
    })
}

fn extract_between(html: &str, start: &str, end: &str) -> Option<String> {
    let start_idx = html.find(start)?;
    let content_start = start_idx + start.len();
    let remaining = &html[content_start..];
    let end_idx = remaining.find(end)?;
    let result = remaining[..end_idx].trim().to_string();
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    // Clean up HTML entities
    result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn truncate_at_sentence(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        return text.to_string();
    }
    // Find the last sentence-ending punctuation before max_len
    let search_area = &text[..max_len];
    let last_period = search_area.rfind(". ");
    let last_excl = search_area.rfind("! ");
    let cut = [last_period, last_excl]
        .iter()
        .filter_map(|x| *x)
        .max()
        .map(|i| i + 1) // include the period
        .unwrap_or(max_len);
    format!("{}...", text[..cut].trim())
}

// ===== RAM Optimization =====

pub fn is_elevated() -> bool {
    unsafe {
        let mut token = windows::Win32::Foundation::HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }

        let mut elevation: TOKEN_ELEVATION = std::mem::zeroed();
        let mut size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;

        let result = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            size,
            &mut size,
        );

        let _ = CloseHandle(token);

        if result.is_ok() {
            elevation.TokenIsElevated != 0
        } else {
            false
        }
    }
}

/// Optimize RAM based on mode
/// Mode 0: Light (Clear common user apps)
/// Mode 1: Medium (Clear all accessible processes)
/// Mode 2: Heavy (Clear all accessible + System File Cache)
pub fn optimize_memory(mode: u8) -> Result<u64, String> {
    if !is_elevated() {
        return Err("Vui lòng chạy ứng dụng dưới quyền Administrator để tối ưu hóa bộ nhớ.".to_string());
    }

    // Get memory before
    let mut mem_status = MEMORYSTATUSEX::default();
    mem_status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    unsafe { GlobalMemoryStatusEx(&mut mem_status).map_err(|e| e.to_string())? };
    let avail_before = mem_status.ullAvailPhys;

    let processes = enumerate_all_processes();

    for p in processes {
        // In Mode 0, avoid emptying system or service processes
        if mode == 0 && !matches!(p.process_type, ProcessType::Normal) {
            continue;
        }

        unsafe {
            // OpenProcess to empty working set
            let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, false, p.pid);
            if let Ok(h) = handle {
                let _ = EmptyWorkingSet(h);
                let _ = CloseHandle(h);
            }
        }
    }

    if mode == 2 {
        // Clear system file cache
        unsafe {
            let _ = SetSystemFileCacheSize(usize::MAX, usize::MAX, 0);
        }
    }

    // Give system a tiny moment to flush pages before measuring again
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Get memory after
    let mut mem_status_after = MEMORYSTATUSEX::default();
    mem_status_after.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    unsafe { GlobalMemoryStatusEx(&mut mem_status_after).map_err(|e| e.to_string())? };
    let avail_after = mem_status_after.ullAvailPhys;

    let freed = if avail_after > avail_before {
        avail_after - avail_before
    } else {
        0
    };

    Ok(freed)
}

// ===== Deep Clean (Kernel Caches & Standby List) =====

fn enable_privilege(privilege_name: &str) -> Result<(), String> {
    unsafe {
        let mut token = windows::Win32::Foundation::HANDLE::default();
        if OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_QUERY | TOKEN_ADJUST_PRIVILEGES,
            &mut token,
        )
        .is_err()
        {
            return Err("Failed to open process token".into());
        }

        let mut luid = LUID::default();
        let wide_name: Vec<u16> = privilege_name.encode_utf16().chain(std::iter::once(0)).collect();
        if LookupPrivilegeValueW(None, windows::core::PCWSTR(wide_name.as_ptr()), &mut luid).is_err() {
            let _ = CloseHandle(token);
            return Err(format!("Failed to lookup privilege: {}", privilege_name));
        }

        let mut privileges = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };

        let result = AdjustTokenPrivileges(
            token,
            false,
            Some(&mut privileges as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_PRIVILEGES>() as u32,
            None,
            None,
        );

        let _ = CloseHandle(token);

        if result.is_err() {
            return Err(format!("Failed to adjust privilege: {}", privilege_name));
        }
    }
    Ok(())
}

const SYSTEM_MEMORY_LIST_INFORMATION: u32 = 80;
const MEMORY_EMPTY_WORKING_SETS: u32 = 2;
const MEMORY_PURGE_STANDBY_LIST: u32 = 4;
const MEMORY_PURGE_LOW_PRIORITY_STANDBY_LIST: u32 = 5;

pub fn deep_clean_memory() -> Result<u64, String> {
    if !is_elevated() {
        return Err("Bạn cần chạy ResMonix dưới quyền Administrator để sử dụng Deep Clean.".to_string());
    }

    // Attempt to enable SeProfileSingleProcessPrivilege for NtSetSystemInformation
    let _ = enable_privilege("SeProfileSingleProcessPrivilege");
    // Attempt to enable SeIncreaseQuotaPrivilege for SetSystemFileCacheSize
    let _ = enable_privilege("SeIncreaseQuotaPrivilege");

    // Get memory before
    let mut mem_status = MEMORYSTATUSEX::default();
    mem_status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    unsafe { GlobalMemoryStatusEx(&mut mem_status).map_err(|e| e.to_string())? };
    let avail_before = mem_status.ullAvailPhys;

    // 1. Clear system file cache via standard Win32 API
    unsafe {
        let _ = SetSystemFileCacheSize(usize::MAX, usize::MAX, 0);
    }

    // 2. Clear all process working sets
    let processes = enumerate_all_processes();
    for p in processes {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, false, p.pid);
            if let Ok(h) = handle {
                let _ = EmptyWorkingSet(h);
                let _ = CloseHandle(h);
            }
        }
    }

    // 3. Purge system working set and standby lists using NT API
    unsafe {
        // Empty system working set
        let mut command: u32 = MEMORY_EMPTY_WORKING_SETS;
        let _ = NtSetSystemInformation(
            SYSTEM_MEMORY_LIST_INFORMATION,
            &mut command as *mut _ as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        );

        // Purge standby list (this is where most file cache ends up after being flushed)
        command = MEMORY_PURGE_STANDBY_LIST;
        let _ = NtSetSystemInformation(
            SYSTEM_MEMORY_LIST_INFORMATION,
            &mut command as *mut _ as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        );
        
        // Purge low priority standby list as well
        command = MEMORY_PURGE_LOW_PRIORITY_STANDBY_LIST;
        let _ = NtSetSystemInformation(
            SYSTEM_MEMORY_LIST_INFORMATION,
            &mut command as *mut _ as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }

    // Wait a little for OS to flush
    std::thread::sleep(std::time::Duration::from_millis(800));

    // Get memory after
    let mut mem_status_after = MEMORYSTATUSEX::default();
    mem_status_after.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    unsafe { GlobalMemoryStatusEx(&mut mem_status_after).map_err(|e| e.to_string())? };
    let avail_after = mem_status_after.ullAvailPhys;

    let freed = if avail_after > avail_before {
        avail_after - avail_before
    } else {
        0
    };

    Ok(freed)
}
