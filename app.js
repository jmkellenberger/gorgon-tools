const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const pickBtn = document.getElementById('pick-btn');
const output = document.getElementById('output');
const errorMsg = document.getElementById('error-msg');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const resetBtn = document.getElementById('reset-btn');
const shareBtn = document.getElementById('share-btn');
const shareBanner = document.getElementById('share-banner');

let charData = null;
let itemsData = null;
let isShareMode = false;

const CURRENCY_NAMES = {
  GOLD: 'Councils',
  GUILDCREDITS: 'Guild Credits',
  COMBAT_WISDOM: 'Combat Wisdom',
  DRUIDCREDITS: 'Dreva Blessings',
  WARDENPOINTS: 'Warden Points',
  FAEENERGY: 'Fae Energy',
  LIVEEVENTCREDITS: 'Live Event Credits',
  GLAMOUR_CREDITS: 'Glamour Credits',
  BLOOD_OATHS: 'Blood Oaths',
  VIDARIA_RENOWN: 'Vidaria Renown',
  STATEHELM_RENOWN: 'Statehelm Renown',
  STATEHELM_DEMERITS: 'Statehelm Demerits',
  NORALA_TOKENS: 'Norala Tokens',
  REDWINGTOKENS: 'Red Wing Tokens',
};

// ── Utilities ───────────────────────────────────────────────────────────

function formatSkillName(key) {
  if (/^Anatomy_/.test(key)) return 'Anatomy (' + key.replace('Anatomy_', '') + ')';
  if (/^Phrenology_/.test(key)) return 'Phrenology (' + key.replace('Phrenology_', '') + ')';
  if (/^Performance_/.test(key)) return 'Performance (' + key.replace('Performance_', '') + ')';
  return key.replace(/([A-Z])/g, ' $1').trim();
}

function formatCamelCase(str) {
  return str.replace(/([A-Z])/g, ' $1').trim();
}

function formatVaultName(vault) {
  if (!vault) return 'Unknown';
  if (vault === 'Inventory') return 'Inventory';
  if (vault.startsWith('*AccountStorage_')) {
    const suffix = vault.replace('*AccountStorage_', '');
    return 'Account Storage (' + formatCamelCase(suffix) + ')';
  }
  if (vault.startsWith('NPC_')) return vault.substring(4);
  return formatCamelCase(vault);
}

function formatQuestName(name) {
  // Strip common prefixes
  let clean = name
    .replace(/^HuntingQuest_/, '')
    .replace(/^Quest_/, '')
    .replace(/^WorkOrder_/, '');
  // Convert camelCase and underscores to readable text
  clean = clean.replace(/_/g, ' ');
  clean = clean.replace(/([a-z])([A-Z])/g, '$1 $2');
  clean = clean.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return clean;
}

function rarityColor(rarity) {
  switch (rarity) {
    case 'Uncommon': return 'var(--rarity-uncommon)';
    case 'Rare': return 'var(--rarity-rare)';
    case 'Exceptional': return 'var(--rarity-exceptional)';
    case 'Epic': return 'var(--rarity-epic)';
    case 'Legendary': return 'var(--rarity-legendary)';
    default: return 'var(--rarity-common)';
  }
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
}

function hideError() {
  errorMsg.style.display = 'none';
}

// ── Sharing ──────────────────────────────────────────────────────────────

function buildSharePayload() {
  const payload = { v: 1 };
  if (charData) {
    payload.C = charData.Character;
    payload.R = charData.Race;
    payload.S = charData.ServerName;
    if (charData.CurrentStats) {
      payload.CS = {
        MAX_HEALTH: charData.CurrentStats.MAX_HEALTH,
        MAX_ARMOR: charData.CurrentStats.MAX_ARMOR,
        MAX_POWER: charData.CurrentStats.MAX_POWER,
      };
    }
    // Skills — compact: { key: [level, bonus, xpToward, xpNeeded, abilities[]] }
    const sk = {};
    Object.entries(charData.Skills).forEach(([key, val]) => {
      if (key === 'Unknown') return;
      sk[key] = [
        val.Level || 0,
        val.BonusLevels || 0,
        val.XpTowardNextLevel || 0,
        val.XpNeededForNextLevel || 0,
        val.Abilities || [],
      ];
    });
    payload.Sk = sk;
    // NPCs — non-neutral only
    if (charData.NPCs) {
      const npc = {};
      Object.entries(charData.NPCs).forEach(([name, data]) => {
        const favor = data.FavorLevel || 'Neutral';
        if (favor !== 'Neutral') npc[name] = favor;
      });
      if (Object.keys(npc).length > 0) payload.NPC = npc;
    }
  }
  // Inventory — on-person items (no StorageVault)
  if (itemsData && itemsData.Items) {
    const onPerson = itemsData.Items.filter(it => !it.StorageVault);
    if (onPerson.length > 0) {
      payload.Eq = onPerson.map(it => {
        const entry = { N: it.Name };
        if (it.Slot) entry.S = it.Slot;
        if (it.Rarity && it.Rarity !== 'Common') entry.R = it.Rarity;
        if (it.Level) entry.L = it.Level;
        if ((it.StackSize || 1) > 1) entry.Q = it.StackSize;
        if (it.TSysPowers && it.TSysPowers.length > 0) {
          entry.P = it.TSysPowers.map(p => ({ T: p.Tier, P: p.Power }));
        }
        return entry;
      });
    }
  }
  return payload;
}

function compressToHash(payload) {
  const json = JSON.stringify(payload);
  const compressed = pako.deflateRaw(new TextEncoder().encode(json));
  // base64url encode — chunk to avoid call stack overflow
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < compressed.length; i += chunk) {
    binary += String.fromCharCode.apply(null, compressed.subarray(i, i + chunk));
  }
  let b64 = btoa(binary);
  b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}

function decompressFromHash(hash) {
  // base64url decode
  let b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const inflated = pako.inflateRaw(bytes);
  return JSON.parse(new TextDecoder().decode(inflated));
}

function generateShareLink() {
  const payload = buildSharePayload();
  const hash = compressToHash(payload);
  const url = window.location.origin + window.location.pathname + '#s=' + hash;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied!');
  }).catch(() => {
    // Fallback: select-and-copy
    const tmp = document.createElement('textarea');
    tmp.value = url;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
    showToast('Link copied!');
  });
  history.replaceState(null, '', '#s=' + hash);
}

function expandSharePayload(p) {
  // Expand compact payload back into charData / itemsData shapes
  if (p.C || p.Sk) {
    charData = {
      Character: p.C,
      Race: p.R,
      ServerName: p.S,
    };
    if (p.CS) charData.CurrentStats = p.CS;
    if (p.Sk) {
      const skills = {};
      Object.entries(p.Sk).forEach(([key, arr]) => {
        skills[key] = {
          Level: arr[0],
          BonusLevels: arr[1],
          XpTowardNextLevel: arr[2],
          XpNeededForNextLevel: arr[3],
          Abilities: arr[4] || [],
        };
      });
      charData.Skills = skills;
    }
    if (p.NPC) {
      const npcs = {};
      Object.entries(p.NPC).forEach(([name, favor]) => {
        npcs[name] = { FavorLevel: favor };
      });
      charData.NPCs = npcs;
    }
  }
  if (p.Eq) {
    const items = p.Eq.map(it => {
      const item = { Name: it.N };
      if (it.S) item.Slot = it.S;
      if (it.R) item.Rarity = it.R;
      if (it.L) item.Level = it.L;
      if (it.Q) item.StackSize = it.Q;
      if (it.P) item.TSysPowers = it.P.map(pw => ({ Tier: pw.T, Power: pw.P }));
      return item;
    });
    itemsData = { Items: items };
  }
}

function checkForShareHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#s=')) return false;
  try {
    const encoded = hash.substring(3);
    const payload = decompressFromHash(encoded);
    expandSharePayload(payload);
    isShareMode = true;
    renderAll();
    return true;
  } catch (e) {
    showError('Could not load shared character: ' + e.message);
    return false;
  }
}

function exitShareMode() {
  history.replaceState(null, '', window.location.pathname);
  isShareMode = false;
  charData = null;
  itemsData = null;
  shareBanner.style.display = 'none';
  output.style.display = 'none';
  dropZone.style.display = '';
  hideError();
  switchTab('skills');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ── File Loading ────────────────────────────────────────────────────────

function parseAndRender(json) {
  hideError();
  let data;
  try {
    data = JSON.parse(json);
  } catch (e) {
    showError('Could not parse JSON: ' + e.message);
    return;
  }

  const report = data.Report;

  if (report === 'CharacterSheet') {
    if (!data.Skills) {
      showError('CharacterSheet is missing the "Skills" field.');
      return;
    }
    charData = data;
  } else if (report === 'Storage') {
    if (!data.Items || !Array.isArray(data.Items)) {
      showError('Storage report is missing the "Items" field.');
      return;
    }
    itemsData = data;
  } else if (data.Skills) {
    charData = data;
  } else if (data.Items && Array.isArray(data.Items)) {
    itemsData = data;
  } else {
    showError('Unrecognized report type. Expected a CharacterSheet or Storage JSON export.');
    return;
  }

  renderAll();
}

function renderAll() {
  if (!charData && !itemsData) return;

  if (charData) {
    renderCharacter();
  }

  // Show/hide character-specific sections
  const charHeader = document.querySelector('.char-header');
  charHeader.style.display = charData ? '' : 'none';

  // Tab visibility
  const skillsBtn = document.getElementById('skills-tab-button');
  const npcsBtn = document.getElementById('npcs-tab-button');
  const favorsBtn = document.getElementById('favors-tab-button');
  const currenciesBtn = document.getElementById('currencies-tab-button');
  const craftingBtn = document.getElementById('crafting-tab-button');
  const storageBtn = document.getElementById('storage-tab-button');

  if (isShareMode) {
    // Share mode: only show Skills, NPC Favor, Storage
    skillsBtn.style.display = charData ? '' : 'none';
    npcsBtn.style.display = charData && charData.NPCs ? '' : 'none';
    favorsBtn.style.display = 'none';
    currenciesBtn.style.display = 'none';
    craftingBtn.style.display = 'none';
    storageBtn.style.display = itemsData ? '' : 'none';

    // Hide interactive elements
    dropZone.style.display = 'none';
    shareBtn.style.display = 'none';
    resetBtn.style.display = 'none';

    // Show share banner
    shareBanner.style.display = '';
    shareBanner.innerHTML = '';
    const bannerText = document.createElement('span');
    bannerText.innerHTML = 'Viewing <strong>' + (charData ? charData.Character : 'Unknown') + '</strong>\u2019s Character';
    const loadOwnLink = document.createElement('a');
    loadOwnLink.href = '#';
    loadOwnLink.className = 'share-banner-link';
    loadOwnLink.textContent = 'Load your own';
    loadOwnLink.addEventListener('click', e => {
      e.preventDefault();
      exitShareMode();
    });
    shareBanner.appendChild(bannerText);
    shareBanner.appendChild(loadOwnLink);
  } else {
    // Normal mode
    skillsBtn.style.display = '';
    npcsBtn.style.display = '';
    favorsBtn.style.display = '';
    currenciesBtn.style.display = '';
    storageBtn.style.display = '';
    shareBanner.style.display = 'none';
    shareBtn.style.display = charData ? 'inline-block' : 'none';
    resetBtn.style.display = '';
  }

  // Crafting tab only shown when there are recipes (never in share mode)
  const hasRecipes = !isShareMode && charData && charData.RecipeCompletions && Object.keys(charData.RecipeCompletions).length > 0;
  craftingBtn.style.display = hasRecipes ? '' : (isShareMode ? 'none' : craftingBtn.style.display);

  if (itemsData) {
    renderStorage();
  }

  // If only items loaded, activate storage tab
  if (!charData && itemsData) {
    switchTab('storage');
  }

  if (!isShareMode) {
    updateUploadPrompts();
  } else {
    // In share mode, hide all upload prompts
    document.querySelectorAll('.tab-upload-prompt').forEach(p => p.style.display = 'none');
    // Ensure content containers are visible for the data we have
    const skillControls = document.querySelector('#skills-tab .controls');
    const skillGrid = document.getElementById('skill-grid');
    if (skillControls) skillControls.style.display = charData ? '' : 'none';
    if (skillGrid) skillGrid.style.display = charData ? '' : 'none';
    document.getElementById('favor-summary-chips').style.display = charData ? '' : 'none';
    document.getElementById('favor-section-content').style.display = charData ? '' : 'none';
    document.getElementById('storage-content').style.display = itemsData ? '' : 'none';
  }

  output.style.display = 'block';
}

function updateUploadPrompts() {
  const hasChar = !!charData;
  const hasItems = !!itemsData;

  // Main drop zone: only show when nothing is loaded
  if (hasChar || hasItems) {
    dropZone.style.display = 'none';
  }

  // In-tab upload prompts
  const charTabs = ['skills', 'npcs', 'favors', 'currencies', 'crafting'];
  charTabs.forEach(tab => {
    const prompt = document.getElementById(tab + '-upload-prompt');
    if (prompt) {
      prompt.style.display = hasChar ? 'none' : '';
    }
  });

  const storagePrompt = document.getElementById('storage-upload-prompt');
  if (storagePrompt) {
    storagePrompt.style.display = hasItems ? 'none' : '';
  }

  // Hide content containers when data not loaded
  const skillControls = document.querySelector('#skills-tab .controls');
  const skillGrid = document.getElementById('skill-grid');
  if (skillControls) skillControls.style.display = hasChar ? '' : 'none';
  if (skillGrid) skillGrid.style.display = hasChar ? '' : 'none';

  document.getElementById('favor-summary-chips').style.display = hasChar ? '' : 'none';
  document.getElementById('favor-section-content').style.display = hasChar ? '' : 'none';
  document.getElementById('favors-content').style.display = hasChar ? '' : 'none';
  document.getElementById('currencies-content').style.display = hasChar ? '' : 'none';
  document.getElementById('crafting-content').style.display = hasChar ? '' : 'none';
  document.getElementById('storage-content').style.display = hasItems ? '' : 'none';
}

// ── Tab Upload Prompt DnD handlers ──────────────────────────────────────

function setupTabUploadPrompt(promptEl) {
  promptEl.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    promptEl.classList.add('drag-over');
  });
  promptEl.addEventListener('dragleave', () => promptEl.classList.remove('drag-over'));
  promptEl.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    promptEl.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) readFile(files[i]);
  });
  promptEl.addEventListener('click', () => fileInput.click());
  promptEl.style.cursor = 'pointer';
}

document.querySelectorAll('.tab-upload-prompt').forEach(setupTabUploadPrompt);

// ── Character Rendering ─────────────────────────────────────────────────

function renderCharacter() {
  if (!charData) return;

  const search = searchInput.value.toLowerCase();
  const sort = sortSelect.value;

  const skillKeys = Object.keys(charData.Skills);
  const parentSkills = new Set();
  skillKeys.forEach(key => {
    const underscoreIdx = key.indexOf('_');
    if (underscoreIdx > 0) {
      const parent = key.substring(0, underscoreIdx);
      if (skillKeys.includes(parent)) {
        parentSkills.add(parent);
      }
    }
  });

  let skills = Object.entries(charData.Skills)
    .filter(([key]) => key !== 'Unknown')
    .map(([key, val]) => ({
      key,
      name: formatSkillName(key),
      level: val.Level || 0,
      bonus: val.BonusLevels || 0,
      effectiveLevel: val.Level || 0,
      xpToward: val.XpTowardNextLevel || 0,
      xpNeeded: val.XpNeededForNextLevel || 0,
      hasSubskills: parentSkills.has(key),
      abilities: val.Abilities || [],
    }));

  const allSkills = skills;
  const skillsForTotal = allSkills.filter(sk => !sk.hasSubskills);
  const totalLevel = skillsForTotal.reduce((s, sk) => s + sk.level, 0);
  const skillCount = allSkills.filter(sk => sk.level > 0).length;

  // ── Hero Header ──
  const nameEl = document.getElementById('char-name-text');
  nameEl.textContent = charData.Character || 'Unknown';
  if (charData.Timestamp) nameEl.title = charData.Timestamp;

  document.getElementById('char-race').textContent = charData.Race || '';
  document.getElementById('char-server').textContent = charData.ServerName || '';

  // Top 5 highest-level non-parent skills
  const topSkills = allSkills
    .filter(sk => !sk.hasSubskills && sk.level > 0)
    .sort((a, b) => b.level - a.level)
    .slice(0, 5);

  const topSkillsEl = document.getElementById('char-top-skills');
  topSkillsEl.innerHTML = '';
  topSkills.forEach(sk => {
    const chip = document.createElement('span');
    chip.className = 'top-skill-chip';
    chip.textContent = sk.name + ' ' + sk.level;
    topSkillsEl.appendChild(chip);
  });

  // Combat stats
  const combatEl = document.getElementById('char-combat-stats');
  combatEl.innerHTML = '';
  if (charData.CurrentStats) {
    const stats = [
      { label: 'Health', value: charData.CurrentStats.MAX_HEALTH, color: 'var(--red)' },
      { label: 'Armor', value: charData.CurrentStats.MAX_ARMOR, color: 'var(--gold)' },
      { label: 'Power', value: charData.CurrentStats.MAX_POWER, color: 'var(--accent)' },
    ];
    stats.forEach(s => {
      if (!s.value) return;
      const div = document.createElement('div');
      div.className = 'combat-stat';
      const val = document.createElement('div');
      val.className = 'combat-stat-value';
      val.style.color = s.color;
      val.textContent = s.value.toLocaleString();
      const lbl = document.createElement('div');
      lbl.className = 'combat-stat-label';
      lbl.textContent = s.label;
      div.appendChild(val);
      div.appendChild(lbl);
      combatEl.appendChild(div);
    });
  }

  // Total level badge
  document.getElementById('total-level-num').textContent = totalLevel.toLocaleString();
  document.getElementById('total-level-sub').textContent = skillCount + ' skills trained';

  renderFavor(charData);
  renderFavorSummary(charData);
  renderActiveFavors(charData);
  renderCurrencies(charData);
  renderCrafting(charData);

  // Filter & sort for display
  let displayed = skills.slice();
  if (search) displayed = displayed.filter(sk => sk.name.toLowerCase().includes(search));

  displayed.sort((a, b) => {
    if (sort === 'level-desc') return b.effectiveLevel - a.effectiveLevel || a.name.localeCompare(b.name);
    if (sort === 'level-asc') return a.effectiveLevel - b.effectiveLevel || a.name.localeCompare(b.name);
    if (sort === 'name-asc') return a.name.localeCompare(b.name);
    if (sort === 'name-desc') return b.name.localeCompare(a.name);
    return 0;
  });

  // Render skill grid
  const grid = document.getElementById('skill-grid');
  grid.innerHTML = '';
  displayed.forEach(sk => {
    const xpPct = sk.xpNeeded > 0 ? Math.min(100, (sk.xpToward / sk.xpNeeded) * 100) : (sk.xpNeeded === -1 ? 100 : 0);
    const card = document.createElement('div');
    card.className = 'skill-card';

    const levelDiv = document.createElement('div');
    levelDiv.className = 'skill-level';
    levelDiv.textContent = sk.effectiveLevel;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'skill-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'skill-name';
    nameDiv.title = sk.name;
    nameDiv.textContent = sk.name;

    const xpBar = document.createElement('div');
    xpBar.className = 'skill-xp-bar';
    const xpFill = document.createElement('div');
    xpFill.className = 'skill-xp-fill';
    xpFill.style.width = xpPct + '%';
    xpBar.appendChild(xpFill);

    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(xpBar);

    if (sk.bonus > 0) {
      const bonusDiv = document.createElement('div');
      bonusDiv.className = 'skill-bonus';
      bonusDiv.textContent = '+' + sk.bonus + ' bonus';
      infoDiv.appendChild(bonusDiv);
    }

    // Abilities expandable section
    if (sk.abilities.length > 0) {
      const toggle = document.createElement('div');
      toggle.className = 'skill-abilities-toggle';
      toggle.textContent = sk.abilities.length + ' abilities';
      toggle.addEventListener('click', e => {
        e.stopPropagation();
        const container = toggle.nextElementSibling;
        const isOpen = container.style.display !== 'none';
        container.style.display = isOpen ? 'none' : '';
        toggle.classList.toggle('open', !isOpen);
      });

      const abilitiesDiv = document.createElement('div');
      abilitiesDiv.className = 'skill-abilities';
      abilitiesDiv.style.display = 'none';
      sk.abilities.forEach(ab => {
        const chip = document.createElement('span');
        chip.className = 'ability-chip';
        chip.textContent = formatCamelCase(ab);
        abilitiesDiv.appendChild(chip);
      });

      infoDiv.appendChild(toggle);
      infoDiv.appendChild(abilitiesDiv);
    }

    card.appendChild(levelDiv);
    card.appendChild(infoDiv);
    grid.appendChild(card);
  });

  if (displayed.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-message';
    empty.style.cssText = 'grid-column:1/-1;padding:1rem 0;';
    empty.textContent = 'No skills match your filter.';
    grid.appendChild(empty);
  }
}

// ── NPC Favor ──────────────────────────────────────────────────────────

function trimNpcPrefix(name) {
  return name.startsWith('NPC_') ? name.substring(4) : name;
}

const FAVOR_TIERS = [
  { key: 'Neutral',      label: 'Neutral',      color: '#7a8478' },
  { key: 'Tolerated',    label: 'Tolerated',    color: '#859289' },
  { key: 'Comfortable',  label: 'Comfortable',  color: '#7fbbb3' },
  { key: 'Friends',      label: 'Friends',      color: '#a7c080' },
  { key: 'CloseFriends', label: 'Close Friends',color: '#83c092' },
  { key: 'BestFriends',  label: 'Best Friends', color: '#dbbc7f' },
  { key: 'LikeFamily',   label: 'Like Family',  color: '#e69875' },
  { key: 'SoulMates',    label: 'Soul Mates',   color: '#d699b6' },
];

const FAVOR_RANK = Object.fromEntries(FAVOR_TIERS.map((t, i) => [t.key, i]));

let favorFilter = null; // null = show all, or a tier key string

function renderFavorSummary(data) {
  const container = document.getElementById('favor-summary-chips');
  container.innerHTML = '';
  if (!data.NPCs) return;

  const counts = {};
  Object.values(data.NPCs).forEach(npcData => {
    const favor = npcData.FavorLevel || 'Neutral';
    if (favor === 'Neutral') return;
    counts[favor] = (counts[favor] || 0) + 1;
  });

  // Render chips in reverse order (highest tier first)
  FAVOR_TIERS.slice().reverse().forEach(tier => {
    const count = counts[tier.key];
    if (!count) return;
    const chip = document.createElement('span');
    chip.className = 'favor-summary-chip';
    if (favorFilter === tier.key) chip.classList.add('active');
    chip.style.borderColor = tier.color;
    chip.style.color = tier.color;
    chip.textContent = count + ' ' + tier.label;
    chip.addEventListener('click', () => {
      favorFilter = favorFilter === tier.key ? null : tier.key;
      renderFavorSummary(data);
      renderFavorGrid(data);
    });
    container.appendChild(chip);
  });
}

function renderFavor(data) {
  favorFilter = null;
  renderFavorSummary(data);
  renderFavorGrid(data);
}

function renderFavorGrid(data) {
  const content = document.getElementById('favor-section-content');
  if (!data.NPCs || Object.keys(data.NPCs).length === 0) {
    content.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty-message';
    p.textContent = 'No NPC favor data available.';
    content.appendChild(p);
    return;
  }

  const npcList = [];
  Object.entries(data.NPCs).forEach(([name, npcData]) => {
    const favor = npcData.FavorLevel || 'Neutral';
    if (favor === 'Neutral') return;
    if (favorFilter && favor !== favorFilter) return;
    npcList.push({
      name: trimNpcPrefix(name),
      favor,
      rank: FAVOR_RANK[favor] ?? 0
    });
  });

  if (npcList.length === 0) {
    content.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty-message';
    p.textContent = favorFilter ? 'No NPCs at this favor level.' : 'No non-neutral NPC favor found.';
    content.appendChild(p);
    return;
  }

  npcList.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));

  const grid = document.createElement('div');
  grid.className = 'favor-grid';

  npcList.forEach(npc => {
    const tier = FAVOR_TIERS[npc.rank];
    const card = document.createElement('div');
    card.className = 'favor-card';

    const dot = document.createElement('div');
    dot.className = 'favor-dot';
    dot.style.background = tier.color;

    const info = document.createElement('div');
    info.className = 'favor-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'favor-npc-name';
    nameDiv.title = npc.name;
    nameDiv.textContent = npc.name;

    const levelDiv = document.createElement('div');
    levelDiv.className = 'favor-level-text';
    levelDiv.textContent = tier.label;

    info.appendChild(nameDiv);
    info.appendChild(levelDiv);
    card.appendChild(dot);
    card.appendChild(info);
    grid.appendChild(card);
  });

  content.innerHTML = '';
  content.appendChild(grid);
}

// ── Active Favors ──────────────────────────────────────────────────────

function renderActiveFavors(data) {
  const container = document.getElementById('favors-content');
  container.innerHTML = '';

  if (!data.ActiveQuests || data.ActiveQuests.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-message';
    p.textContent = 'No active favors.';
    container.appendChild(p);
    return;
  }

  const quests = data.ActiveQuests.map(q => ({
    raw: q,
    display: formatQuestName(q),
  }));

  // Header with count
  const headerDiv = document.createElement('div');
  headerDiv.className = 'favors-header';
  const countChip = document.createElement('span');
  countChip.className = 'favors-count-chip';
  countChip.textContent = quests.length + ' active favor' + (quests.length !== 1 ? 's' : '');
  headerDiv.appendChild(countChip);

  // Search input
  const searchBox = document.createElement('input');
  searchBox.type = 'text';
  searchBox.placeholder = 'Search favors\u2026';
  searchBox.className = 'favors-search';

  const listDiv = document.createElement('div');
  listDiv.className = 'favors-list';

  function renderList() {
    const term = searchBox.value.toLowerCase();
    listDiv.innerHTML = '';
    const filtered = quests.filter(q => q.display.toLowerCase().includes(term));
    filtered.forEach(q => {
      const item = document.createElement('div');
      item.className = 'favor-item';
      item.textContent = q.display;
      listDiv.appendChild(item);
    });
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-message';
      empty.textContent = 'No favors match your search.';
      listDiv.appendChild(empty);
    }
  }

  searchBox.addEventListener('input', renderList);

  container.appendChild(headerDiv);
  container.appendChild(searchBox);
  container.appendChild(listDiv);
  renderList();
}

// ── Currencies ─────────────────────────────────────────────────────────

function renderCurrencies(data) {
  const container = document.getElementById('currencies-content');
  container.innerHTML = '';

  if (!data.Currencies) {
    const p = document.createElement('p');
    p.className = 'empty-message';
    p.textContent = 'No currency data available.';
    container.appendChild(p);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'currency-grid';

  // Show GOLD first, then the rest
  const entries = Object.entries(data.Currencies);
  entries.sort((a, b) => {
    if (a[0] === 'GOLD') return -1;
    if (b[0] === 'GOLD') return 1;
    return (b[1] || 0) - (a[1] || 0);
  });

  entries.filter(([, val]) => val).forEach(([key, val]) => {
    const label = CURRENCY_NAMES[key] || formatCamelCase(key);
    const card = document.createElement('div');
    card.className = 'currency-card';
    if (key === 'GOLD') card.classList.add('currency-gold');
    const valueDiv = document.createElement('div');
    valueDiv.className = 'currency-value';
    valueDiv.textContent = (val || 0).toLocaleString();

    const labelDiv = document.createElement('div');
    labelDiv.className = 'currency-label';
    labelDiv.textContent = label;

    card.appendChild(valueDiv);
    card.appendChild(labelDiv);
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

// ── Crafting ────────────────────────────────────────────────────────────

function renderCrafting(data) {
  const summary = document.getElementById('craft-summary');
  const grid = document.getElementById('craft-grid');

  if (!data.RecipeCompletions || Object.keys(data.RecipeCompletions).length === 0) {
    summary.innerHTML = '';
    grid.innerHTML = '';
    return;
  }

  let totalCrafts = 0;
  let uniqueTried = 0;
  let totalRecipes = 0;
  const bySkill = {};

  Object.entries(data.RecipeCompletions).forEach(([key, count]) => {
    const cnt = typeof count === 'number' ? count : 0;
    const underscore = key.indexOf('_');
    let skill;

    if (underscore > 0) {
      skill = key.slice(0, underscore);
    } else {
      skill = 'General';
    }

    totalCrafts += cnt;
    totalRecipes++;
    if (cnt > 0) uniqueTried++;

    if (!bySkill[skill]) bySkill[skill] = { total: 0, tried: 0, unique: 0 };
    bySkill[skill].total += cnt;
    bySkill[skill].unique++;
    if (cnt > 0) bySkill[skill].tried++;
  });

  // Summary chips
  summary.innerHTML = '';
  const skillsWithCrafts = Object.values(bySkill).filter(c => c.total > 0).length;
  [
    { label: 'Total Crafts', value: totalCrafts.toLocaleString() },
    { label: 'Recipes Tried', value: uniqueTried.toLocaleString() + ' / ' + totalRecipes.toLocaleString() },
    { label: 'Crafting Skills', value: skillsWithCrafts },
  ].forEach(c => {
    const el = document.createElement('div');
    el.className = 'stat-chip';
    el.textContent = c.label + ': ';
    const strong = document.createElement('strong');
    strong.textContent = c.value;
    el.appendChild(strong);
    summary.appendChild(el);
  });

  // Category grid
  const maxTotal = Math.max(1, ...Object.values(bySkill).map(c => c.total));
  grid.innerHTML = '';

  Object.entries(bySkill)
    .filter(([, c]) => c.total > 0)
    .sort(([, a], [, b]) => b.total - a.total)
    .forEach(([skill, c]) => {
      const pct = (c.total / maxTotal) * 100;
      const card = document.createElement('div');
      card.className = 'craft-card';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'craft-card-name';
      nameDiv.textContent = skill;

      const statsDiv = document.createElement('div');
      statsDiv.className = 'craft-card-stats';

      const craftsSpan = document.createElement('span');
      const craftsStrong = document.createElement('strong');
      craftsStrong.textContent = c.total.toLocaleString();
      craftsSpan.appendChild(craftsStrong);
      craftsSpan.appendChild(document.createTextNode(' crafts'));

      const recipesSpan = document.createElement('span');
      const recipesStrong = document.createElement('strong');
      recipesStrong.textContent = c.tried + '/' + c.unique;
      recipesSpan.appendChild(recipesStrong);
      recipesSpan.appendChild(document.createTextNode(' recipes'));

      statsDiv.appendChild(craftsSpan);
      statsDiv.appendChild(recipesSpan);

      const bar = document.createElement('div');
      bar.className = 'craft-bar';
      const fill = document.createElement('div');
      fill.className = 'craft-bar-fill';
      fill.style.width = pct.toFixed(1) + '%';
      bar.appendChild(fill);

      card.appendChild(nameDiv);
      card.appendChild(statsDiv);
      card.appendChild(bar);
      grid.appendChild(card);
    });
}

// ── Storage / Items ─────────────────────────────────────────────────────

function renderStorage() {
  if (!itemsData || !itemsData.Items) return;

  const items = itemsData.Items;
  const container = document.getElementById('storage-content');
  container.innerHTML = '';

  // In share mode, only show inventory (on-person) items
  if (isShareMode) {
    const onPerson = items.filter(it => !it.StorageVault);
    if (onPerson.length === 0) return;
    const grid = document.createElement('div');
    grid.className = 'vault-items';
    onPerson.sort((a, b) => {
      if (a.Slot && !b.Slot) return -1;
      if (!a.Slot && b.Slot) return 1;
      return ((b.Value || 0) * (b.StackSize || 1)) - ((a.Value || 0) * (a.StackSize || 1));
    });
    onPerson.forEach(item => grid.appendChild(renderItemCard(item)));
    container.appendChild(grid);
    return;
  }

  // ── Vault Breakdown ──
  const vaultMap = new Map();
  items.forEach(item => {
    const vault = item.StorageVault || 'Inventory';
    if (!vaultMap.has(vault)) vaultMap.set(vault, []);
    vaultMap.get(vault).push(item);
  });

  const vaultCount = vaultMap.size;

  // Summary row
  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'storage-summary';
  container.appendChild(summaryDiv);

  // Controls
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'storage-controls';

  const searchBox = document.createElement('input');
  searchBox.type = 'text';
  searchBox.placeholder = 'Search items\u2026';
  searchBox.id = 'item-search';

  const vaultFilter = document.createElement('select');
  vaultFilter.id = 'vault-filter';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All vaults';
  vaultFilter.appendChild(allOpt);

  const sortedVaultKeys = Array.from(vaultMap.keys()).sort((a, b) =>
    formatVaultName(a).localeCompare(formatVaultName(b))
  );
  sortedVaultKeys.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = formatVaultName(v) + ' (' + vaultMap.get(v).length + ')';
    vaultFilter.appendChild(opt);
  });

  const rarityFilter = document.createElement('select');
  rarityFilter.id = 'rarity-filter';
  const allRarOpt = document.createElement('option');
  allRarOpt.value = '';
  allRarOpt.textContent = 'All rarities';
  rarityFilter.appendChild(allRarOpt);
  ['Common', 'Uncommon', 'Rare', 'Exceptional', 'Epic', 'Legendary'].forEach(r => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    rarityFilter.appendChild(opt);
  });

  controlsDiv.appendChild(searchBox);
  controlsDiv.appendChild(vaultFilter);
  controlsDiv.appendChild(rarityFilter);
  container.appendChild(controlsDiv);

  // Vault sections container
  const vaultsContainer = document.createElement('div');
  vaultsContainer.id = 'vaults-container';
  container.appendChild(vaultsContainer);

  function renderVaults() {
    const searchTerm = searchBox.value.toLowerCase();
    const selectedVault = vaultFilter.value;
    const selectedRarity = rarityFilter.value;

    vaultsContainer.innerHTML = '';

    let filteredItems = items;
    if (selectedVault) filteredItems = filteredItems.filter(it => (it.StorageVault || 'Unknown') === selectedVault);
    if (searchTerm) filteredItems = filteredItems.filter(it => (it.Name || '').toLowerCase().includes(searchTerm));
    if (selectedRarity) filteredItems = filteredItems.filter(it => (it.Rarity || 'Common') === selectedRarity);

    const totalItems = filteredItems.reduce((s, it) => s + (it.StackSize || 1), 0);
    const totalValue = filteredItems.reduce((s, it) => s + (it.Value || 0) * (it.StackSize || 1), 0);
    const equipCount = filteredItems.filter(it => it.Slot).length;

    summaryDiv.innerHTML = '';
    [
      { label: 'Total Items', value: totalItems.toLocaleString() },
      { label: 'Total Value', value: totalValue.toLocaleString() + ' councils' },
      { label: 'Vaults', value: selectedVault ? 1 : vaultCount },
      { label: 'Equipment', value: equipCount },
    ].forEach(c => {
      const el = document.createElement('div');
      el.className = 'stat-chip';
      el.textContent = c.label + ': ';
      const strong = document.createElement('strong');
      strong.textContent = c.value;
      el.appendChild(strong);
      summaryDiv.appendChild(el);
    });

    sortedVaultKeys.forEach(vaultKey => {
      if (selectedVault && vaultKey !== selectedVault) return;

      let vaultItems = vaultMap.get(vaultKey);

      if (searchTerm) {
        vaultItems = vaultItems.filter(it =>
          (it.Name || '').toLowerCase().includes(searchTerm)
        );
      }
      if (selectedRarity) {
        vaultItems = vaultItems.filter(it => {
          const r = it.Rarity || 'Common';
          return r === selectedRarity;
        });
      }

      if (vaultItems.length === 0) return;

      const section = document.createElement('div');
      section.className = 'vault-section';

      const header = document.createElement('div');
      header.className = 'vault-header';

      const chevron = document.createElement('span');
      chevron.className = 'vault-chevron';
      chevron.textContent = '\u25BC';

      const vaultName = document.createElement('span');
      vaultName.className = 'vault-name';
      vaultName.textContent = formatVaultName(vaultKey);

      const count = document.createElement('span');
      count.className = 'vault-count';
      count.textContent = vaultItems.length + ' item' + (vaultItems.length !== 1 ? 's' : '');

      header.appendChild(chevron);
      header.appendChild(vaultName);
      header.appendChild(count);

      const itemsGrid = document.createElement('div');
      itemsGrid.className = 'vault-items';

      header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
        itemsGrid.classList.toggle('hidden');
      });

      vaultItems.sort((a, b) => {
        if (a.Slot && !b.Slot) return -1;
        if (!a.Slot && b.Slot) return 1;
        return ((b.Value || 0) * (b.StackSize || 1)) - ((a.Value || 0) * (a.StackSize || 1));
      });

      vaultItems.forEach(item => {
        itemsGrid.appendChild(renderItemCard(item));
      });

      section.appendChild(header);
      section.appendChild(itemsGrid);
      vaultsContainer.appendChild(section);
    });

    if (vaultsContainer.children.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-message';
      empty.textContent = 'No items match your filter.';
      vaultsContainer.appendChild(empty);
    }
  }

  searchBox.addEventListener('input', renderVaults);
  vaultFilter.addEventListener('change', renderVaults);
  rarityFilter.addEventListener('change', renderVaults);

  renderVaults();
}

function renderItemCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card';

  const headerDiv = document.createElement('div');
  headerDiv.className = 'item-card-header';

  const dot = document.createElement('div');
  dot.className = 'rarity-dot';
  dot.style.background = rarityColor(item.Rarity || 'Common');

  const nameSpan = document.createElement('span');
  nameSpan.className = 'item-name';
  nameSpan.textContent = item.Name || 'Unknown Item';

  headerDiv.appendChild(dot);
  headerDiv.appendChild(nameSpan);

  if ((item.StackSize || 1) > 1) {
    const stackSpan = document.createElement('span');
    stackSpan.className = 'item-stack';
    stackSpan.textContent = '\u00d7' + item.StackSize;
    headerDiv.appendChild(stackSpan);
  }

  card.appendChild(headerDiv);

  const badges = document.createElement('div');
  badges.className = 'item-badges';
  let hasBadges = false;

  if (item.Slot) {
    const b = document.createElement('span');
    b.className = 'item-badge slot-badge';
    b.textContent = formatCamelCase(item.Slot);
    badges.appendChild(b);
    hasBadges = true;
  }

  if (item.Level) {
    const b = document.createElement('span');
    b.className = 'item-badge level-badge';
    b.textContent = 'Lv ' + item.Level;
    badges.appendChild(b);
    hasBadges = true;
  }

  if (item.Rarity && item.Rarity !== 'Common') {
    const b = document.createElement('span');
    b.className = 'item-badge';
    b.style.color = rarityColor(item.Rarity);
    b.textContent = item.Rarity;
    badges.appendChild(b);
    hasBadges = true;
  }

  if (item.Value) {
    const b = document.createElement('span');
    b.className = 'item-badge value-badge';
    const totalVal = item.Value * (item.StackSize || 1);
    b.textContent = totalVal.toLocaleString() + 'g';
    badges.appendChild(b);
    hasBadges = true;
  }

  if (item.AttunedTo) {
    const b = document.createElement('span');
    b.className = 'item-badge attuned-badge';
    b.textContent = 'Attuned: ' + item.AttunedTo;
    badges.appendChild(b);
    hasBadges = true;
  }

  if (item.TransmuteCount) {
    const b = document.createElement('span');
    b.className = 'item-badge transmute-badge';
    b.textContent = 'Transmuted \u00d7' + item.TransmuteCount;
    badges.appendChild(b);
    hasBadges = true;
  }

  if (item.IsCrafted) {
    const b = document.createElement('span');
    b.className = 'item-badge';
    b.textContent = item.Crafter ? 'Crafted by ' + item.Crafter : 'Crafted';
    badges.appendChild(b);
    hasBadges = true;
  }

  if (hasBadges) card.appendChild(badges);

  if (item.TSysPowers && item.TSysPowers.length > 0) {
    const powersDiv = document.createElement('div');
    powersDiv.className = 'item-powers';

    item.TSysPowers.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'power-chip';

      const tierSpan = document.createElement('span');
      tierSpan.className = 'power-tier';
      tierSpan.textContent = 'T' + p.Tier;

      chip.appendChild(tierSpan);
      chip.appendChild(document.createTextNode(' ' + formatCamelCase(p.Power)));
      powersDiv.appendChild(chip);
    });

    card.appendChild(powersDiv);
  }

  if (item.TSysImbuePower) {
    const powersDiv = document.createElement('div');
    powersDiv.className = 'item-powers';

    const chip = document.createElement('span');
    chip.className = 'power-chip';

    const tierSpan = document.createElement('span');
    tierSpan.className = 'power-tier';
    tierSpan.textContent = 'T' + (item.TSysImbuePowerTier || '?');

    chip.appendChild(tierSpan);
    chip.appendChild(document.createTextNode(' ' + formatCamelCase(item.TSysImbuePower)));
    powersDiv.appendChild(chip);

    card.appendChild(powersDiv);
  }

  if (item.Durability !== undefined && item.Durability !== null) {
    const pct = Math.round(item.Durability * 100);
    const barDiv = document.createElement('div');
    barDiv.className = 'durability-bar';
    const fill = document.createElement('div');
    fill.className = 'durability-fill';
    fill.style.width = pct + '%';
    if (pct > 50) fill.classList.add('high');
    else if (pct > 20) fill.classList.add('medium');
    else fill.classList.add('low');
    barDiv.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'durability-label';
    label.textContent = 'Durability: ' + pct + '%';

    card.appendChild(barDiv);
    card.appendChild(label);
  }

  return card;
}

// ── Tab Switching ───────────────────────────────────────────────────────

function switchTab(tabName) {
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const btn = document.querySelector('.tab-button[data-tab="' + tabName + '"]');
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  const panel = document.getElementById(tabName + '-tab');
  if (panel) panel.classList.add('active');
}

// ── Event Listeners ─────────────────────────────────────────────────────

// Drag and drop
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (!files.length) return;
  for (let i = 0; i < files.length; i++) {
    readFile(files[i]);
  }
});

pickBtn.addEventListener('click', e => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

fileInput.addEventListener('change', () => {
  const files = fileInput.files;
  for (let i = 0; i < files.length; i++) {
    readFile(files[i]);
  }
  fileInput.value = '';
});

function readFile(file) {
  if (!file.name.endsWith('.json') && file.type !== 'application/json' && file.type !== 'text/plain') {
    showError('Please choose a JSON file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => parseAndRender(e.target.result);
  reader.onerror = () => showError('Could not read file.');
  reader.readAsText(file);
}

// Re-render on control changes
searchInput.addEventListener('input', () => { if (charData) renderCharacter(); });
sortSelect.addEventListener('change', () => { if (charData) renderCharacter(); });

// Reset
resetBtn.addEventListener('click', () => {
  charData = null;
  itemsData = null;
  output.style.display = 'none';
  dropZone.style.display = '';
  dropZone.classList.remove('compact');
  // Restore original drop zone content
  const dropContent = dropZone.querySelector('.drop-zone-content');
  dropContent.innerHTML = '';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '48');
  svg.setAttribute('height', '48');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', 'M9 13.5l3 3m0 0l3-3m-3 3v-6m1.06-4.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z');
  svg.appendChild(path);
  dropContent.appendChild(svg);

  const p1 = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = 'Drag & drop';
  p1.appendChild(strong);
  p1.appendChild(document.createTextNode(' your character JSON here'));
  dropContent.appendChild(p1);

  const p2 = document.createElement('p');
  p2.style.marginTop = '0.25rem';
  p2.textContent = 'or';
  dropContent.appendChild(p2);

  hideError();
  switchTab('skills');
});

// Paste JSON
document.addEventListener('paste', e => {
  const text = e.clipboardData.getData('text/plain');
  if (text.trim().startsWith('{')) parseAndRender(text);
});

// Share
shareBtn.addEventListener('click', () => {
  if (charData) generateShareLink();
});

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

// Check for share hash on page load
checkForShareHash();
