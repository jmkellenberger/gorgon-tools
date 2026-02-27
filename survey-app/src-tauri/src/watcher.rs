use crate::pathfinder;
use crate::state::{AppState, Mode, Survey};
use crate::survey::{compute_render_payload, deduplicate_surveys};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

fn survey_regex() -> Regex {
    Regex::new(r"\[Status\] The (.+) is (\d+)m (east|west) and (\d+)m (north|south)\.").unwrap()
}

fn collected_regex() -> Regex {
    Regex::new(r"\[Status\] (.+?) collected!").unwrap()
}

fn zone_regex() -> Regex {
    Regex::new(r"Entering Area: (.+)").unwrap()
}

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn start(
        app: AppHandle,
        state: Arc<Mutex<AppState>>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = {
            let s = state.lock().unwrap();
            s.log_directory
                .clone()
                .ok_or("No log directory configured")?
        };

        // Do an initial read of any existing content from file_position
        initial_read(&app, &state);

        let (tx, rx) = mpsc::channel::<Event>();
        let state_clone = state.clone();
        let app_clone = app.clone();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, _>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        })?;

        watcher.watch(dir.as_ref(), RecursiveMode::NonRecursive)?;

        // Spawn a thread to process file events
        thread::spawn(move || {
            let survey_re = survey_regex();
            let collected_re = collected_regex();
            let zone_re = zone_regex();

            for event in rx {
                if !matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_)
                ) {
                    continue;
                }

                process_new_lines(
                    &app_clone,
                    &state_clone,
                    &survey_re,
                    &collected_re,
                    &zone_re,
                );
            }
        });

        Ok(FileWatcher { _watcher: watcher })
    }
}

fn initial_read(app: &AppHandle, state: &Arc<Mutex<AppState>>) {
    let survey_re = survey_regex();
    let collected_re = collected_regex();
    let zone_re = zone_regex();
    process_new_lines(app, state, &survey_re, &collected_re, &zone_re);
}

fn find_latest_log(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("Chat-") && n.ends_with(".log"))
                .unwrap_or(false)
        })
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
}

fn process_new_lines(
    app: &AppHandle,
    state: &Arc<Mutex<AppState>>,
    survey_re: &Regex,
    collected_re: &Regex,
    zone_re: &Regex,
) {
    let (dir, pos) = {
        let s = state.lock().unwrap();
        match &s.log_directory {
            Some(d) => (d.clone(), s.file_position),
            None => return,
        }
    };

    let log_path = match find_latest_log(&dir) {
        Some(p) => p,
        None => return,
    };

    let mut file = match File::open(&log_path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file_len <= pos {
        return;
    }

    if file.seek(SeekFrom::Start(pos)).is_err() {
        return;
    }

    let mut buf = String::new();
    if file.read_to_string(&mut buf).is_err() {
        return;
    }

    let new_pos = file_len;
    let mut state_changed = false;
    let mut zone_changed = false;

    {
        let mut s = state.lock().unwrap();
        s.file_position = new_pos;

        for line in buf.lines() {
            // Zone detection (always active)
            if let Some(caps) = zone_re.captures(line) {
                let new_zone = caps[1].trim().to_string();
                if new_zone != s.zone {
                    s.zone = new_zone;
                    zone_changed = true;
                    state_changed = true;
                }
            }

            match s.mode {
                Mode::Record => {
                    if let Some(caps) = survey_re.captures(line) {
                        let resource = caps[1].to_string();
                        let mut dx: i32 = caps[2].parse().unwrap_or(0);
                        if &caps[3] == "west" {
                            dx = -dx;
                        }
                        let mut dy: i32 = caps[4].parse().unwrap_or(0);
                        if &caps[5] == "north" {
                            dy = -dy;
                        }

                        s.record_buffer.push(Survey {
                            resource,
                            dx,
                            dy,
                            found: false,
                        });

                        // Last-N semantics: keep only last batch_size entries
                        let batch = s.batch_size;
                        if s.record_buffer.len() > batch {
                            let excess = s.record_buffer.len() - batch;
                            s.record_buffer.drain(..excess);
                        }

                        state_changed = true;

                        // Auto-stop when we hit batch_size
                        if s.record_buffer.len() == batch {
                            // Move buffer into surveys, deduplicate, switch to Find
                            s.surveys = deduplicate_surveys(&s.record_buffer);
                            s.record_buffer.clear();
                            s.path_order = pathfinder::find_path(
                                s.player_pos,
                                &s.surveys,
                                &s.zone,
                            );
                            s.mode = Mode::Find;
                        }
                    }
                }
                Mode::Find => {
                    // Only respond to "collected!" lines
                    if let Some(_caps) = collected_re.captures(line) {
                        // Sequential path-order matching: find next unvisited in path order
                        let next = s
                            .path_order
                            .iter()
                            .find(|&&idx| idx < s.surveys.len() && !s.surveys[idx].found)
                            .copied();
                        if let Some(idx) = next {
                            s.surveys[idx].found = true;
                            state_changed = true;
                        }
                    }
                    // Location lines are ignored in Find mode
                }
            }
        }

        // Recompute path if state changed and in Find mode
        if state_changed && s.mode == Mode::Find {
            s.path_order =
                pathfinder::find_path(s.player_pos, &s.surveys, &s.zone);
        }
    }

    if zone_changed {
        let _ = app.emit("zone-changed", ());
    }

    if state_changed {
        let s = state.lock().unwrap();
        let payload = compute_render_payload(&s);
        let _ = app.emit("state-updated", payload);
    }
}
