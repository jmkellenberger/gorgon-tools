mod pathfinder;
mod state;
mod survey;
mod watcher;

use state::{AppState, Mode, RenderPayload};
use std::sync::{Arc, Mutex};
use survey::compute_render_payload;
use tauri::{Manager, State};
use watcher::FileWatcher;

type SharedState = Arc<Mutex<AppState>>;

#[tauri::command]
fn get_render_state(state: State<'_, SharedState>) -> RenderPayload {
    let s = state.lock().unwrap();
    compute_render_payload(&s)
}

#[tauri::command]
fn set_mode(mode: String, state: State<'_, SharedState>) -> RenderPayload {
    let mut s = state.lock().unwrap();
    s.mode = match mode.as_str() {
        "find" => Mode::Find,
        _ => Mode::Record,
    };
    if s.mode == Mode::Find {
        s.path_order = pathfinder::find_path(s.player_pos, &s.surveys, &s.zone);
    }
    compute_render_payload(&s)
}

#[tauri::command]
fn set_batch_size(n: usize, state: State<'_, SharedState>) -> RenderPayload {
    let mut s = state.lock().unwrap();
    s.batch_size = n.max(1);
    compute_render_payload(&s)
}

#[tauri::command]
fn set_player_pos(x: f64, y: f64, state: State<'_, SharedState>) -> RenderPayload {
    let mut s = state.lock().unwrap();
    s.player_pos = (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0));
    if s.mode == Mode::Find {
        s.path_order = pathfinder::find_path(s.player_pos, &s.surveys, &s.zone);
    }
    compute_render_payload(&s)
}

#[tauri::command]
fn set_map_size(w: f64, h: f64, state: State<'_, SharedState>) -> RenderPayload {
    let mut s = state.lock().unwrap();
    s.map_width = w.max(1.0);
    s.map_height = h.max(1.0);
    compute_render_payload(&s)
}

#[tauri::command]
fn set_zone(zone: String, state: State<'_, SharedState>) -> RenderPayload {
    let mut s = state.lock().unwrap();
    s.zone = zone;
    if s.mode == Mode::Find {
        s.path_order = pathfinder::find_path(s.player_pos, &s.surveys, &s.zone);
    }
    compute_render_payload(&s)
}

#[tauri::command]
fn toggle_found(index: usize, state: State<'_, SharedState>) -> RenderPayload {
    let mut s = state.lock().unwrap();
    if index < s.surveys.len() {
        s.surveys[index].found = !s.surveys[index].found;
        s.path_order = pathfinder::find_path(s.player_pos, &s.surveys, &s.zone);
    }
    compute_render_payload(&s)
}

#[tauri::command]
fn clear_surveys(state: State<'_, SharedState>) -> RenderPayload {
    let mut s = state.lock().unwrap();
    s.surveys.clear();
    s.record_buffer.clear();
    s.path_order.clear();
    s.mode = Mode::Record;
    compute_render_payload(&s)
}

#[tauri::command]
fn set_log_directory(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    watcher_state: State<'_, Mutex<Option<FileWatcher>>>,
) -> Result<RenderPayload, String> {
    let path = std::path::PathBuf::from(&path);
    if !path.is_dir() {
        return Err("Not a valid directory".into());
    }

    {
        let mut s = state.lock().unwrap();
        s.log_directory = Some(path);
        s.file_position = 0;
    }

    let fw = FileWatcher::start(app, state.inner().clone())
        .map_err(|e| e.to_string())?;

    *watcher_state.lock().unwrap() = Some(fw);

    let s = state.lock().unwrap();
    Ok(compute_render_payload(&s))
}

fn main() {
    let shared_state: SharedState = Arc::new(Mutex::new(AppState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(shared_state)
        .manage(Mutex::new(None::<FileWatcher>))
        .invoke_handler(tauri::generate_handler![
            get_render_state,
            set_mode,
            set_batch_size,
            set_player_pos,
            set_map_size,
            set_zone,
            toggle_found,
            clear_surveys,
            set_log_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
