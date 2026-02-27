use crate::state::{AppState, DotRender, RenderPayload, ResourceCount};
use std::collections::HashMap;

/// Returns (width_meters, height_meters) for a zone.
pub fn zone_dimensions(zone: &str) -> (u32, u32) {
    match zone {
        "Serbule" => (2382, 2488),
        "Serbule Hills" => (2748, 2668),
        "Eltibule" => (2684, 2778),
        "Ilmari" => (2920, 2920),
        "Kur Mountains" => (3000, 3000),
        _ => (2382, 2488), // default to Serbule
    }
}

/// Compute pixel positions for all survey dots given current state.
pub fn compute_render_payload(state: &AppState) -> RenderPayload {
    let (zw, zh) = zone_dimensions(&state.zone);
    let zw = zw as f64;
    let zh = zh as f64;

    // Player position in meters
    let px = state.player_pos.0 * zw;
    let py = state.player_pos.1 * zh;

    let mut dots = Vec::with_capacity(state.surveys.len());
    let mut resource_map: HashMap<String, usize> = HashMap::new();
    let mut found_count = 0usize;

    for (i, survey) in state.surveys.iter().enumerate() {
        // Survey position in meters
        let sx = (px + survey.dx as f64).clamp(0.0, zw);
        let sy = (py + survey.dy as f64).clamp(0.0, zh);

        // Convert to pixel coordinates
        let pixel_x = sx / zw * state.map_width;
        let pixel_y = sy / zh * state.map_height;

        let label = if survey.found {
            "\u{00d7}".to_string() // ×
        } else {
            // Find this survey's position in path_order for labeling
            if let Some(path_pos) = state.path_order.iter().position(|&idx| idx == i) {
                (path_pos + 1).to_string()
            } else {
                (i + 1).to_string()
            }
        };

        dots.push(DotRender {
            x: pixel_x,
            y: pixel_y,
            label,
            found: survey.found,
            resource: survey.resource.clone(),
        });

        *resource_map.entry(survey.resource.clone()).or_insert(0) += 1;
        if survey.found {
            found_count += 1;
        }
    }

    let total = state.surveys.len();
    let summary = format!("{}/{} found", found_count, total);

    let mut resources: Vec<ResourceCount> = resource_map
        .into_iter()
        .map(|(name, count)| ResourceCount { name, count })
        .collect();
    resources.sort_by(|a, b| a.name.cmp(&b.name));

    RenderPayload {
        mode: format!("{:?}", state.mode).to_lowercase(),
        zone: state.zone.clone(),
        player_pos: state.player_pos,
        dots,
        path_indices: state.path_order.clone(),
        summary,
        resources,
    }
}

/// Deduplicate surveys by resource name, keeping the last occurrence of each.
pub fn deduplicate_surveys(surveys: &[crate::state::Survey]) -> Vec<crate::state::Survey> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut result = Vec::new();

    // Track last occurrence index for each resource
    for (i, s) in surveys.iter().enumerate() {
        seen.insert(s.resource.clone(), i);
    }

    // Keep only the last occurrence of each resource
    for (i, s) in surveys.iter().enumerate() {
        if seen.get(&s.resource) == Some(&i) {
            result.push(s.clone());
        }
    }

    result
}
