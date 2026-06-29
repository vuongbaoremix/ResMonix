pub mod analyzer;
pub mod commands;
pub mod memory;
pub mod scanner;
pub mod utils;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_drives,
            commands::scan_directory,
            commands::cancel_scan,
            commands::get_node_children,
            commands::get_node_children_sorted,
            commands::get_root_node,
            commands::get_treemap_data,
            commands::describe_path,
            commands::get_suggestions,
            commands::delete_item,
            commands::open_in_explorer,
            commands::get_largest_files,
            commands::get_process_tree,
            commands::describe_process,
            commands::kill_process,
            commands::analyze_process,
            commands::lookup_process_online,
            commands::optimize_memory,
            commands::deep_clean_memory,
        ])
        .on_page_load(|webview, _payload| {
            let _ = webview.set_background_color(Some(tauri::window::Color(18, 18, 18, 255)));
            let _ = webview.window().show();
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
