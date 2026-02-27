use crate::state::Survey;
use crate::survey::zone_dimensions;

/// Compute an optimized visit order for unvisited surveys.
/// Returns indices into the surveys vec, ordered by path.
/// Uses greedy nearest-neighbor followed by 2-opt improvement.
pub fn find_path(
    player_pos: (f64, f64),
    surveys: &[Survey],
    zone: &str,
) -> Vec<usize> {
    let (zw, zh) = zone_dimensions(zone);
    let zw = zw as f64;
    let zh = zh as f64;

    // Player position in meters
    let px = player_pos.0 * zw;
    let py = player_pos.1 * zh;

    // Collect unvisited survey indices and their meter positions
    let unvisited: Vec<(usize, f64, f64)> = surveys
        .iter()
        .enumerate()
        .filter(|(_, s)| !s.found)
        .map(|(i, s)| {
            let sx = (px + s.dx as f64).clamp(0.0, zw);
            let sy = (py + s.dy as f64).clamp(0.0, zh);
            (i, sx, sy)
        })
        .collect();

    if unvisited.is_empty() {
        return Vec::new();
    }

    let n = unvisited.len();
    if n == 1 {
        return vec![unvisited[0].0];
    }

    // Build distance matrix (including player as node 0)
    // Nodes: 0 = player, 1..n = unvisited surveys
    let node_count = n + 1;
    let mut dist = vec![vec![0.0f64; node_count]; node_count];

    // Player to each survey
    for i in 0..n {
        let d = ((unvisited[i].1 - px).powi(2) + (unvisited[i].2 - py).powi(2)).sqrt();
        dist[0][i + 1] = d;
        dist[i + 1][0] = d;
    }

    // Survey to survey
    for i in 0..n {
        for j in (i + 1)..n {
            let d = ((unvisited[i].1 - unvisited[j].1).powi(2)
                + (unvisited[i].2 - unvisited[j].2).powi(2))
            .sqrt();
            dist[i + 1][j + 1] = d;
            dist[j + 1][i + 1] = d;
        }
    }

    // Greedy nearest-neighbor starting from player (node 0)
    let mut visited_set = vec![false; node_count];
    visited_set[0] = true;
    let mut route: Vec<usize> = vec![0]; // internal node indices
    let mut current = 0;

    for _ in 0..n {
        let mut best = usize::MAX;
        let mut best_dist = f64::MAX;
        for j in 1..node_count {
            if !visited_set[j] && dist[current][j] < best_dist {
                best_dist = dist[current][j];
                best = j;
            }
        }
        visited_set[best] = true;
        route.push(best);
        current = best;
    }

    // 2-opt improvement (skip node 0 which is player start)
    // Route is [0, a, b, c, ...] — we optimize the survey portion [1..]
    let mut improved = true;
    while improved {
        improved = false;
        for i in 1..route.len() - 1 {
            for j in (i + 1)..route.len() {
                let delta = two_opt_delta(&dist, &route, i, j);
                if delta < -1e-6 {
                    route[i..=j].reverse();
                    improved = true;
                }
            }
        }
    }

    // Convert internal node indices back to survey indices
    route[1..]
        .iter()
        .map(|&node| unvisited[node - 1].0)
        .collect()
}

/// Calculate the change in total distance if we reverse the segment route[i..=j].
fn two_opt_delta(dist: &[Vec<f64>], route: &[usize], i: usize, j: usize) -> f64 {
    let a = route[i - 1];
    let b = route[i];
    let c = route[j];
    let d = if j + 1 < route.len() {
        route[j + 1]
    } else {
        // Open path — no return to start. The "after j" edge doesn't exist.
        return dist[a][c] - dist[a][b];
    };
    // Old edges: a-b and c-d. New edges: a-c and b-d.
    (dist[a][c] + dist[b][d]) - (dist[a][b] + dist[c][d])
}
