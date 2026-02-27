// Survey Helper — vanilla JS port
// Original: defenestration.co/pg/surveying (public domain)

// ── Zone constants ────────────────────────────────────────────────────
const ZONES = {
  'Serbule':       { size: [2382, 2488], map: 'assets/serbule_map.webp' },
  'Serbule Hills': { size: [2748, 2668], map: 'assets/serbule_hills_map.webp' },
  'Eltibule':      { size: [2684, 2778], map: 'assets/eltibule_map.webp' },
  'Ilmari':        { size: [2920, 2920], map: 'assets/ilmari_map.webp' },
  'Kur Mountains': { size: [3000, 3000], map: 'assets/kur_mountains_map.webp' },
};

const SURVEY_REGEX = /\[Status\] The (.+) is (\d+)m (east|west) and (\d+)m (north|south)\./;
const MOTHERLODE_REGEX = /\[Status\] The treasure is (\d+) meters from here/;
const JUST_NUMBER_REGEX = /^(\d+)$/;
const LABEL_HEIGHT = 16;
const LABEL_CHAR_W = 10;
const DOT_SIZE = 8;

// ── State ─────────────────────────────────────────────────────────────
let zone = 'Serbule';
let surveyType = 'regular';
let renumbering = false;

// Player positions as 0-1 fractions: [regular, motherlodeA, motherlodeB]
let playerPos = [[0.5, 0.5], [0.4, 0.5], [0.6, 0.5]];

// Regular survey data
let surveyDistances = [];   // [[dx, dy], …] in meters
let surveyDotPos = [];      // [[px, py], …] in pixels relative to map container
let surveyLabelPos = [];    // label positions
let surveyVisited = [];     // booleans
let resourceCounts = {};

// Motherlode survey data
let mlDistancesA = [];
let mlDistancesB = [];
let mlDotLocations = [];    // [[posA, posB], …] in meters
let mlDotPos = [];          // pixel positions
let mlLabelPos = [];
let mlVisited = [];

// ── DOM refs ──────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const mapContainer = () => $('#map-container');
const mapImg = () => $('#zone-map');

// ── Initialization ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Drop zone
  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) readFileIntoTextarea(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) readFileIntoTextarea(fileInput.files[0]);
  });

  // Controls
  $('#zone-select').addEventListener('change', (e) => {
    zone = e.target.value;
    const z = ZONES[zone];
    mapImg().src = z.map;
    recalcAndRender();
  });

  $('#survey-type-select').addEventListener('change', (e) => {
    surveyType = e.target.value;
    $('#motherlode-card').style.display = surveyType === 'motherlode' ? '' : 'none';
    // Relabel textarea
    const ta = $('#chat-log');
    ta.placeholder = surveyType === 'motherlode'
      ? 'Paste chat log from first position (Location A) here'
      : '…or paste chat log text here';
  });

  $('#find-btn').addEventListener('click', parseLogs);
  $('#clear-btn').addEventListener('click', clearLogs);
  $('#renumber-toggle').addEventListener('change', (e) => {
    renumbering = e.target.checked;
    renumberPins();
  });

  // Recalculate dot positions on resize
  new ResizeObserver(() => {
    if (surveyDistances.length || mlDistancesA.length) recalcAndRender();
  }).observe(mapContainer());
});

// ── File reading ──────────────────────────────────────────────────────
function readFileIntoTextarea(file) {
  const reader = new FileReader();
  reader.onload = (e) => { $('#chat-log').value = e.target.result; };
  reader.readAsText(file);
}

// ── Clear ─────────────────────────────────────────────────────────────
function clearLogs() {
  $('#chat-log').value = '';
  if (surveyType === 'motherlode') $('#motherlode-log-b').value = '';
  surveyDistances = [];
  mlDistancesA = [];
  mlDistancesB = [];
  clearPins();
  $('#results-bar').style.display = 'none';
}

function clearPins() {
  const mc = mapContainer();
  mc.querySelectorAll('.survey-dot, .survey-label, .player-icon').forEach(el => el.remove());
}

// ── Parsing ───────────────────────────────────────────────────────────
function parseLogs() {
  if (surveyType === 'regular') parseRegularLogs();
  else parseMotherlodeLogs();
}

function parseRegularLogs() {
  const lines = $('#chat-log').value.split('\n');
  surveyDistances = [];
  resourceCounts = {};
  const kept = [];

  for (const line of lines) {
    const m = SURVEY_REGEX.exec(line);
    if (!m) continue;
    const resource = m[1];
    let dx = parseInt(m[2], 10);
    if (m[3] === 'west') dx = -dx;
    let dy = parseInt(m[4], 10);
    if (m[5] === 'north') dy = -dy;
    surveyDistances.push([dx, dy]);
    resourceCounts[resource] = (resourceCounts[resource] || 0) + 1;
    kept.push(line);
  }

  // Replace textarea with resource summary + matched lines
  const sorted = Object.entries(resourceCounts).sort((a, b) => a[0].localeCompare(b[0]));
  let summary = 'Resources Found:\n';
  for (const [name, count] of sorted) summary += `${count}: ${name}\n`;
  $('#chat-log').value = summary + '\n' + kept.join('\n');

  showResults();
  createSurveyPoints();
  buildPins();
  recalcAndRender();
}

function parseMotherlodeLogs() {
  mlDistancesA = parseDistanceList($('#chat-log'));
  mlDistancesB = parseDistanceList($('#motherlode-log-b'));
  const count = Math.min(mlDistancesA.length, mlDistancesB.length);

  showResults();
  createMotherlodePoints(count);
  buildMotherlodePins(count);
  recalcAndRender();
}

function parseDistanceList(textarea) {
  const lines = textarea.value.split('\n');
  const distances = [];
  const kept = [];
  for (const line of lines) {
    let d;
    const m1 = MOTHERLODE_REGEX.exec(line);
    const m2 = JUST_NUMBER_REGEX.exec(line.trim());
    if (m1) d = parseInt(m1[1], 10);
    else if (m2) d = parseInt(m2[1], 10);
    if (d !== undefined) {
      distances.push(d);
      kept.push(d);
    }
  }
  textarea.value = kept.join('\n');
  return distances;
}

// ── Show results section ──────────────────────────────────────────────
function showResults() {
  $('#results-bar').style.display = '';
  updateResultSummary();
}

function updateResultSummary() {
  const summaryEl = $('#result-summary');
  const pillsEl = $('#resource-pills');

  if (surveyType === 'regular') {
    summaryEl.innerHTML = `<strong>${surveyDistances.length}</strong> surveys found`;
    pillsEl.innerHTML = Object.entries(resourceCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => `<span class="resource-pill"><span class="count">${count}</span>${name}</span>`)
      .join('');
  } else {
    const count = Math.min(mlDistancesA.length, mlDistancesB.length);
    summaryEl.innerHTML = `<strong>${count}</strong> motherlode surveys. Drag markers to locate.`;
    pillsEl.innerHTML = '';
  }
}

// ── Create survey points (meters) ─────────────────────────────────────
function createSurveyPoints() {
  const z = ZONES[zone];
  const px = playerPos[0][0] * z.size[0];
  const py = playerPos[0][1] * z.size[1];

  surveyDotPos = [];
  surveyLabelPos = [];
  surveyVisited = [];

  for (const [dx, dy] of surveyDistances) {
    const sx = px + dx;
    const sy = py + dy;
    surveyDotPos.push([sx, sy]);
    surveyLabelPos.push([sx, sy]);
    surveyVisited.push(false);
  }
}

function createMotherlodePoints(count) {
  const z = ZONES[zone];
  const pxA = playerPos[1][0] * z.size[0];
  const pyA = playerPos[1][1] * z.size[1];
  const pxB = playerPos[2][0] * z.size[0];
  const pyB = playerPos[2][1] * z.size[1];

  mlDotLocations = [];
  mlDotPos = [];
  mlLabelPos = [];
  mlVisited = [];

  for (let i = 0; i < count; i++) {
    const positions = circlIntersect(
      [pxA, pyA], [pxB, pyB],
      mlDistancesA[i], mlDistancesB[i]
    );
    mlDotLocations.push(positions);
    mlDotPos.push([positions[0].slice(), positions[1].slice()]);
    mlLabelPos.push([positions[0].slice(), positions[1].slice()]);
    mlVisited.push(false);
  }
}

// Circle-circle intersection (Paul Bourke method)
function circlIntersect(p0, p1, r0, r1) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const d = Math.sqrt(dx * dx + dy * dy);
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(r0 * r0 - a * a);
  const mx = p0[0] + dx * a / d;
  const my = p0[1] + dy * a / d;
  return [
    [mx + h * dy / d, my - h * dx / d],
    [mx - h * dy / d, my + h * dx / d],
  ];
}

// ── Build DOM pins ────────────────────────────────────────────────────
function buildPins() {
  clearPins();
  const mc = mapContainer();

  // Player icon (regular)
  const icon = createPlayerIcon(0);
  mc.appendChild(icon);

  // Survey dots + labels
  for (let i = 0; i < surveyDistances.length; i++) {
    const dot = document.createElement('span');
    dot.className = 'survey-dot';
    dot.dataset.index = i;
    dot.dataset.group = 'regular';
    dot.addEventListener('click', () => togglePin(i));
    mc.appendChild(dot);

    const lbl = document.createElement('span');
    lbl.className = 'survey-label';
    lbl.dataset.index = i;
    lbl.textContent = i + 1;
    lbl.addEventListener('click', () => togglePin(i));
    mc.appendChild(lbl);
  }
}

function buildMotherlodePins(count) {
  clearPins();
  const mc = mapContainer();

  // Two player icons for motherlode
  const iconA = createPlayerIcon(1, 'A');
  const iconB = createPlayerIcon(2, 'B');
  mc.appendChild(iconA);
  mc.appendChild(iconB);

  const suffixes = ['a', 'b'];
  for (let i = 0; i < count; i++) {
    for (let s = 0; s < 2; s++) {
      const dot = document.createElement('span');
      dot.className = 'survey-dot';
      dot.dataset.index = i;
      dot.dataset.sub = suffixes[s];
      dot.dataset.group = 'motherlode';
      dot.addEventListener('click', () => toggleMotherlodePin(i));
      mc.appendChild(dot);

      const lbl = document.createElement('span');
      lbl.className = 'survey-label';
      lbl.dataset.index = i;
      lbl.dataset.sub = suffixes[s];
      lbl.textContent = i + 1;
      lbl.addEventListener('click', () => toggleMotherlodePin(i));
      mc.appendChild(lbl);
    }
  }
}

// ── Create draggable player icon ──────────────────────────────────────
function createPlayerIcon(posIndex, label) {
  const el = document.createElement('div');
  el.className = 'player-icon';
  el.dataset.posIndex = posIndex;
  if (label) el.textContent = label;

  let dragging = false;

  const onPointerDown = (e) => {
    e.preventDefault();
    dragging = true;
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const rect = mapContainer().getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    playerPos[posIndex][0] = Math.max(0, Math.min(1, x));
    playerPos[posIndex][1] = Math.max(0, Math.min(1, y));
    recalcAndRender();
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    if (surveyType === 'regular') {
      applyLabelRepulsion();
      positionPins();
    }
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('lostpointercapture', onPointerUp);

  return el;
}

// ── Toggle pin visited state ──────────────────────────────────────────
function togglePin(index) {
  surveyVisited[index] = !surveyVisited[index];
  const mc = mapContainer();
  const dot = mc.querySelector(`.survey-dot[data-index="${index}"][data-group="regular"]`);
  const lbl = mc.querySelector(`.survey-label[data-index="${index}"]`);
  if (dot) dot.classList.toggle('visited', surveyVisited[index]);
  if (lbl) lbl.classList.toggle('visited', surveyVisited[index]);
  if (renumbering) renumberPins();
}

function toggleMotherlodePin(index) {
  mlVisited[index] = !mlVisited[index];
  const mc = mapContainer();
  for (const sub of ['a', 'b']) {
    const dot = mc.querySelector(`.survey-dot[data-index="${index}"][data-sub="${sub}"]`);
    const lbl = mc.querySelector(`.survey-label[data-index="${index}"][data-sub="${sub}"]`);
    if (dot) dot.classList.toggle('visited', mlVisited[index]);
    if (lbl) lbl.classList.toggle('visited', mlVisited[index]);
  }
}

function renumberPins() {
  const mc = mapContainer();
  let unvisited = 0;
  for (let i = 0; i < surveyDistances.length; i++) {
    const lbl = mc.querySelector(`.survey-label[data-index="${i}"]`);
    if (!lbl) continue;
    if (renumbering) {
      lbl.textContent = surveyVisited[i] ? 'X' : ++unvisited;
    } else {
      lbl.textContent = i + 1;
    }
  }
}

// ── Recalculate positions and render ──────────────────────────────────
function recalcAndRender() {
  if (surveyType === 'regular' && surveyDistances.length) {
    updateRegularPositions();
    applyLabelRepulsion();
  } else if (surveyType === 'motherlode' && mlDistancesA.length) {
    updateMotherlodePositions();
  }
  positionPins();
  positionPlayerIcons();
}

function updateRegularPositions() {
  const z = ZONES[zone];
  const mapW = mapImg().clientWidth;
  const mapH = mapImg().clientHeight;
  const px = playerPos[0][0] * z.size[0];
  const py = playerPos[0][1] * z.size[1];

  for (let i = 0; i < surveyDistances.length; i++) {
    let sx = px + surveyDistances[i][0];
    let sy = py + surveyDistances[i][1];

    // Clamp to map bounds (meters)
    sx = Math.max(0, Math.min(z.size[0], sx));
    sy = Math.max(0, Math.min(z.size[1], sy));

    // Convert to pixels
    surveyDotPos[i] = [sx / z.size[0] * mapW, sy / z.size[1] * mapH];
    surveyLabelPos[i] = [surveyDotPos[i][0] + 8, surveyDotPos[i][1] - 10];
  }
}

function updateMotherlodePositions() {
  const z = ZONES[zone];
  const mapW = mapImg().clientWidth;
  const mapH = mapImg().clientHeight;
  const pxA = playerPos[1][0] * z.size[0];
  const pyA = playerPos[1][1] * z.size[1];
  const pxB = playerPos[2][0] * z.size[0];
  const pyB = playerPos[2][1] * z.size[1];
  const count = Math.min(mlDistancesA.length, mlDistancesB.length);

  for (let i = 0; i < count; i++) {
    const positions = circlIntersect(
      [pxA, pyA], [pxB, pyB],
      mlDistancesA[i], mlDistancesB[i]
    );
    mlDotLocations[i] = positions;

    for (let s = 0; s < 2; s++) {
      const mx = positions[s][0];
      const my = positions[s][1];
      mlDotPos[i][s] = [mx / z.size[0] * mapW, my / z.size[1] * mapH];
      mlLabelPos[i][s] = [mlDotPos[i][s][0] + 8, mlDotPos[i][s][1] - 10];
    }
  }
}

// ── Position DOM elements ─────────────────────────────────────────────
function positionPins() {
  const mc = mapContainer();
  const z = ZONES[zone];

  if (surveyType === 'regular') {
    for (let i = 0; i < surveyDistances.length; i++) {
      const dot = mc.querySelector(`.survey-dot[data-index="${i}"][data-group="regular"]`);
      const lbl = mc.querySelector(`.survey-label[data-index="${i}"]`);
      if (dot) {
        dot.style.left = surveyDotPos[i][0] + 'px';
        dot.style.top = surveyDotPos[i][1] + 'px';
      }
      if (lbl) {
        lbl.style.left = surveyLabelPos[i][0] + 'px';
        lbl.style.top = surveyLabelPos[i][1] + 'px';
      }
    }
  } else {
    const count = Math.min(mlDistancesA.length, mlDistancesB.length);
    const suffixes = ['a', 'b'];
    const mapW = mapImg().clientWidth;
    const mapH = mapImg().clientHeight;

    for (let i = 0; i < count; i++) {
      for (let s = 0; s < 2; s++) {
        const dot = mc.querySelector(`.survey-dot[data-index="${i}"][data-sub="${suffixes[s]}"]`);
        const lbl = mc.querySelector(`.survey-label[data-index="${i}"][data-sub="${suffixes[s]}"]`);
        const loc = mlDotLocations[i][s];
        const hide = isNaN(loc[0]) || isNaN(loc[1])
          || loc[0] < 0 || loc[1] < 0
          || loc[0] > z.size[0] || loc[1] > z.size[1];

        if (dot) {
          dot.style.display = hide ? 'none' : '';
          dot.style.left = mlDotPos[i][s][0] + 'px';
          dot.style.top = mlDotPos[i][s][1] + 'px';
        }
        if (lbl) {
          lbl.style.display = hide ? 'none' : '';
          lbl.style.left = mlLabelPos[i][s][0] + 'px';
          lbl.style.top = mlLabelPos[i][s][1] + 'px';
        }
      }
    }
  }
}

function positionPlayerIcons() {
  const mc = mapContainer();
  const mapW = mapImg().clientWidth;
  const mapH = mapImg().clientHeight;

  mc.querySelectorAll('.player-icon').forEach(icon => {
    const idx = parseInt(icon.dataset.posIndex, 10);
    const x = playerPos[idx][0] * mapW;
    const y = playerPos[idx][1] * mapH;
    icon.style.left = x + 'px';
    icon.style.top = y + 'px';
  });
}

// ── Label repulsion (ported) ──────────────────────────────────────────
function applyLabelRepulsion() {
  adjustLabelPositions(0.2);
  adjustLabelPositions(0.15);
  adjustLabelPositions(0.1);
}

function adjustLabelPositions(strength) {
  const n = surveyDistances.length;
  const impulse = new Float64Array(n);

  // Label vs label
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const imp = labelRepulsion(i, j);
      impulse[i] += imp;
      impulse[j] -= imp;
    }
  }

  // Label vs pin
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      impulse[i] += labelPinRepulsion(i, j);
    }
  }

  for (let i = 0; i < n; i++) {
    const clamped = Math.max(-LABEL_HEIGHT, Math.min(LABEL_HEIGHT, impulse[i]));
    surveyLabelPos[i][1] += clamped * strength;
  }
}

function labelWidth(index) {
  if (index < 9) return LABEL_CHAR_W;
  if (index < 99) return LABEL_CHAR_W * 2;
  return LABEL_CHAR_W * 3;
}

function labelRepulsion(a, b) {
  const ya = surveyLabelPos[a][1];
  const yb = surveyLabelPos[b][1];
  if (Math.abs(yb - ya) >= LABEL_HEIGHT) return 0;
  const xa = surveyLabelPos[a][0];
  const xb = surveyLabelPos[b][0];
  if (xb - xa >= labelWidth(a)) return 0;
  if (xa - xb >= labelWidth(b)) return 0;
  return ya <= yb
    ? -LABEL_HEIGHT - (yb - ya)
    : LABEL_HEIGHT - (ya - yb);
}

function labelPinRepulsion(labelIdx, pinIdx) {
  const yl = surveyLabelPos[labelIdx][1];
  const yp = surveyDotPos[pinIdx][1];
  if (yp - yl >= LABEL_HEIGHT) return 0;
  if (yl - yp >= DOT_SIZE) return 0;
  const xl = surveyLabelPos[labelIdx][0];
  const xp = surveyDotPos[pinIdx][0];
  if (xp - xl >= labelWidth(labelIdx)) return 0;
  if (xl - xp >= DOT_SIZE) return 0;
  const ycl = yl + LABEL_HEIGHT / 2;
  return ycl <= yp
    ? -LABEL_HEIGHT - (yp - ycl)
    : LABEL_HEIGHT - (ycl - yp);
}
