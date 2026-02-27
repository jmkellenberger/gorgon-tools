// Survey Helper — Tauri frontend (presentation only)
// All logic lives in Rust. This file renders state and forwards user actions.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Tauri v2 dialog plugin is exposed under its own global
const dialogOpen = () => {
  const api = window.__TAURI_PLUGIN_DIALOG__;
  if (api && api.open) return api.open;
  // Fallback: some Tauri v2 builds expose it here
  if (window.__TAURI__.dialog) return window.__TAURI__.dialog.open;
  return null;
};

const ZONE_MAPS = {
  'Serbule':       'assets/serbule_map.webp',
  'Serbule Hills': 'assets/serbule_hills_map.webp',
  'Eltibule':      'assets/eltibule_map.webp',
  'Ilmari':        'assets/ilmari_map.webp',
  'Kur Mountains': 'assets/kur_mountains_map.webp',
};

const $ = (s) => document.querySelector(s);
const mapContainer = () => $('#map-container');
const mapImg = () => $('#zone-map');
const pathCanvas = () => $('#path-canvas');

let currentPayload = null;
let dragging = false;

// ── Initialization ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Listen for Rust events
  await listen('state-updated', (event) => {
    render(event.payload);
  });

  await listen('zone-changed', async () => {
    const payload = await invoke('get_render_state');
    updateZoneMap(payload.zone);
    render(payload);
  });

  // Mode toggle
  $('#mode-record').addEventListener('click', async () => {
    const payload = await invoke('set_mode', { mode: 'record' });
    render(payload);
  });

  $('#mode-find').addEventListener('click', async () => {
    const payload = await invoke('set_mode', { mode: 'find' });
    render(payload);
  });

  // Zone select
  $('#zone-select').addEventListener('change', async (e) => {
    const payload = await invoke('set_zone', { zone: e.target.value });
    updateZoneMap(e.target.value);
    render(payload);
  });

  // Batch size
  $('#batch-size').addEventListener('change', async (e) => {
    const n = parseInt(e.target.value, 10) || 5;
    await invoke('set_batch_size', { n });
  });

  // Clear
  $('#clear-btn').addEventListener('click', async () => {
    const payload = await invoke('clear_surveys');
    render(payload);
  });

  // Browse for log directory
  $('#browse-btn').addEventListener('click', async () => {
    const openFn = dialogOpen();
    if (!openFn) {
      $('#log-status').textContent = 'Error: dialog plugin not available';
      return;
    }
    try {
      const dir = await openFn({ directory: true, title: 'Select ChatLogs folder' });
      if (dir) {
        const payload = await invoke('set_log_directory', { path: dir });
        $('#log-dir').value = dir;
        $('#log-status').textContent = 'Watching for chat log changes...';
        render(payload);
      }
    } catch (e) {
      $('#log-status').textContent = 'Error: ' + e;
    }
  });

  // Map resize observer
  new ResizeObserver(() => {
    const img = mapImg();
    if (img) {
      const rect = img.getBoundingClientRect();
      updateMapSize(rect.width, rect.height);
    }
  }).observe(mapContainer());

  // Player drag on map
  mapContainer().addEventListener('pointerdown', onPointerDown);
  mapContainer().addEventListener('pointermove', onPointerMove);
  mapContainer().addEventListener('pointerup', onPointerUp);
  mapContainer().addEventListener('lostpointercapture', onPointerUp);

  // Initial state
  const payload = await invoke('get_render_state');
  render(payload);
});

// ── Map size sync ───────────────────────────────────────────────────
async function updateMapSize(w, h) {
  if (w > 0 && h > 0) {
    const payload = await invoke('set_map_size', { w, h });
    render(payload);
  }
}

function updateZoneMap(zone) {
  const src = ZONE_MAPS[zone];
  if (src) mapImg().src = src;
  $('#zone-select').value = zone;
}

// ── Player dragging ─────────────────────────────────────────────────
function onPointerDown(e) {
  const target = e.target;
  if (!target.classList.contains('player-icon')) return;
  e.preventDefault();
  dragging = true;
  target.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!dragging) return;
  const img = mapImg();
  const rect = img.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  invoke('set_player_pos', {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  }).then(render);
}

function onPointerUp() {
  dragging = false;
}

// ── Render ──────────────────────────────────────────────────────────
function render(payload) {
  if (!payload) return;
  currentPayload = payload;

  // Mode toggle
  const isRecord = payload.mode === 'record';
  $('#mode-record').classList.toggle('active', isRecord);
  $('#mode-find').classList.toggle('active', !isRecord);

  // Zone display
  $('#zone-display').textContent = payload.zone;

  // Summary
  $('#result-summary').textContent = payload.summary;

  // Resource pills
  const pillsEl = $('#resource-pills');
  pillsEl.innerHTML = payload.resources
    .map(r => `<span class="resource-pill"><span class="count">${r.count}</span>${r.name}</span>`)
    .join('');

  // Clear existing dots and player icon
  const mc = mapContainer();
  mc.querySelectorAll('.survey-dot, .survey-label, .player-icon').forEach(el => el.remove());

  // Player icon
  const player = document.createElement('div');
  player.className = 'player-icon';
  const img = mapImg();
  const imgW = img.clientWidth;
  const imgH = img.clientHeight;
  player.style.left = (payload.player_pos[0] * imgW) + 'px';
  player.style.top = (payload.player_pos[1] * imgH) + 'px';
  mc.appendChild(player);

  // Survey dots
  for (let i = 0; i < payload.dots.length; i++) {
    const dot = payload.dots[i];

    const dotEl = document.createElement('span');
    dotEl.className = 'survey-dot' + (dot.found ? ' found' : '');
    dotEl.style.left = dot.x + 'px';
    dotEl.style.top = dot.y + 'px';
    dotEl.addEventListener('click', () => onDotClick(i));
    mc.appendChild(dotEl);

    const lbl = document.createElement('span');
    lbl.className = 'survey-label' + (dot.found ? ' found' : '');
    lbl.textContent = dot.label;
    lbl.style.left = (dot.x + 8) + 'px';
    lbl.style.top = (dot.y - 10) + 'px';
    lbl.addEventListener('click', () => onDotClick(i));
    mc.appendChild(lbl);
  }

  // Path canvas
  drawPath(payload);
}

async function onDotClick(index) {
  const payload = await invoke('toggle_found', { index });
  render(payload);
}

// ── Path drawing ────────────────────────────────────────────────────
function drawPath(payload) {
  const canvas = pathCanvas();
  const img = mapImg();
  canvas.width = img.clientWidth;
  canvas.height = img.clientHeight;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (payload.path_indices.length < 2) return;

  ctx.strokeStyle = '#7fbbb3';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.globalAlpha = 0.6;
  ctx.beginPath();

  // Start from player position
  const px = payload.player_pos[0] * canvas.width;
  const py = payload.player_pos[1] * canvas.height;
  ctx.moveTo(px, py);

  for (const idx of payload.path_indices) {
    const dot = payload.dots[idx];
    if (dot && !dot.found) {
      ctx.lineTo(dot.x, dot.y);
    }
  }

  ctx.stroke();
}
