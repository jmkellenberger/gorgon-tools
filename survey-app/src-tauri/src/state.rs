use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Record,
    Find,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Survey {
    pub resource: String,
    pub dx: i32, // meters east(+)/west(-)
    pub dy: i32, // meters south(+)/north(-)
    pub found: bool,
}

pub struct AppState {
    pub mode: Mode,
    pub zone: String,
    pub surveys: Vec<Survey>,
    pub player_pos: (f64, f64), // 0.0–1.0 relative
    pub map_width: f64,
    pub map_height: f64,
    pub log_directory: Option<PathBuf>,
    pub file_position: u64,
    pub batch_size: usize,
    pub path_order: Vec<usize>,
    /// Buffer for record mode — accumulates survey lines before batch is finalized
    pub record_buffer: Vec<Survey>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            mode: Mode::Record,
            zone: "Serbule".into(),
            surveys: Vec::new(),
            player_pos: (0.5, 0.5),
            map_width: 750.0,
            map_height: 750.0,
            log_directory: None,
            file_position: 0,
            batch_size: 5,
            path_order: Vec::new(),
            record_buffer: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DotRender {
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub found: bool,
    pub resource: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResourceCount {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct RenderPayload {
    pub mode: String,
    pub zone: String,
    pub player_pos: (f64, f64),
    pub dots: Vec<DotRender>,
    pub path_indices: Vec<usize>,
    pub summary: String,
    pub resources: Vec<ResourceCount>,
}
