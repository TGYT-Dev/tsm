
// ── Browser Debug Bridge ──
window.onerror = function(message, source, lineno, colno, error) {
  const msg = `ERROR: ${message} at ${source}:${lineno}:${colno}` + (error ? `\nStack: ${error.stack}` : '');
  fetch(`/api/debug-log?msg=${encodeURIComponent(msg)}`).catch(()=>{});
};
window.addEventListener('unhandledrejection', function(event) {
  const msg = `PROMISE REJECTION: ${event.reason}`;
  fetch(`/api/debug-log?msg=${encodeURIComponent(msg)}`).catch(()=>{});
});
const originalConsoleError = console.error;
console.error = function(...args) {
  originalConsoleError.apply(console, args);
  const msg = `CONSOLE ERROR: ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
  fetch(`/api/debug-log?msg=${encodeURIComponent(msg)}`).catch(()=>{});
};

// ── State ──────────────────────────────────────────────────────────────────────
const allLogs = [];
let autoScrollOn = true;
const activeCategories = new Set(['info','chat','command','join','moderation','warn','error','rcon','bot','playit']);
const openTabs = {}; // name -> { type, data }
let ctxTarget = null; // { playerName, invType, slot }

const logOutput  = document.getElementById('logOutput');
const autoScroll = document.getElementById('autoScroll');
autoScroll.addEventListener('change', () => { autoScrollOn = autoScroll.checked; });

const catClass = { info:'log-info', chat:'log-chat', command:'log-command', join:'log-join', moderation:'log-moderation', warn:'log-warn', error:'log-error', rcon:'log-rcon', bot:'log-bot', playit:'log-playit' };

// ── Log ────────────────────────────────────────────────────────────────────────
const appendToLog = (line, category) => {
  if (!activeCategories.has(category)) return;
  const div = document.createElement('div');
  div.className = `log-line ${catClass[category] || 'log-info'}`;
  div.textContent = line;
  logOutput.appendChild(div);
  while (logOutput.children.length > 500) logOutput.removeChild(logOutput.firstChild);
  if (autoScrollOn) logOutput.scrollTop = logOutput.scrollHeight;
};

const appendLog = (line, category) => {
  allLogs.push({ line, category });
  if (allLogs.length > 500) allLogs.shift();
  appendToLog(line, category);
};

const rerenderLogs = () => {
  logOutput.innerHTML = '';
  allLogs.forEach(({ line, category }) => appendToLog(line, category));
};

// Restore saved toggle state
const savedToggles = JSON.parse(localStorage.getItem('logToggles') || '{}');
document.querySelectorAll('#filterToggles input[data-cat]').forEach(cb => {
  if (cb.dataset.cat in savedToggles) {
    cb.checked = savedToggles[cb.dataset.cat];
    if (!cb.checked) activeCategories.delete(cb.dataset.cat);
  }
});

document.getElementById('filterToggles').addEventListener('change', (e) => {
  const cb = e.target;
  if (!cb.dataset.cat) return;
  if (cb.checked) activeCategories.add(cb.dataset.cat);
  else activeCategories.delete(cb.dataset.cat);
  // Save state
  const saved = JSON.parse(localStorage.getItem('logToggles') || '{}');
  saved[cb.dataset.cat] = cb.checked;
  localStorage.setItem('logToggles', JSON.stringify(saved));
  rerenderLogs();
});

// ── WebSocket ──────────────────────────────────────────────────────────────────
const connectWs = () => {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'log')          appendLog(msg.line, msg.category);
    if (msg.type === 'statusUpdate') fetchStatus();
    if (msg.type === 'stats')        { updateLiveStats(msg); }
    if (msg.type === 'positions')    handlePositions(msg.players);
    if (msg.type === 'tpsWarning')   appendLog(`[WARNING] TPS dropped to ${msg.tps}`, 'warn');
    if (msg.type === 'playerUpdate') fetchPlayers();
    if (msg.type === 'backupComplete') { toast(`Backup complete: ${msg.name}`); loadBackups(); }
    if (msg.type === 'backupError')    toast(`Backup error: ${msg.error}`);
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
};
connectWs();

// ── Toast ──────────────────────────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer;
const toast = (msg) => {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
};

// ── Status ─────────────────────────────────────────────────────────────────────
const fetchStatus = async () => {
  try {
    const d = await (await fetch('/api/status')).json();
    updateSvcUI('mc', d.mc); updateSvcUI('bot', d.bot); updateSvcUI('playit', d.playit);
  } catch {}
};

const updateSvcUI = (name, status) => {
  const badge = document.getElementById(`status-${name}`);
  const btn   = document.getElementById(`btn-${name}-toggle`);
  if (!badge || !btn) return;
  const running = status === 'running';
  badge.textContent = status.toUpperCase();
  badge.className   = `status-badge ${status}`;
  btn.textContent   = running ? 'Stop' : 'Start';
  btn.className     = `btn ${running ? 'btn-stop' : 'btn-start'}`;
};

const serviceAction = async (name, action) => {
  await fetch(`/api/service/${name}/${action}`, { method: 'POST' });
  toast(`${name} ${action}...`);
  setTimeout(fetchStatus, 1200);
};

const toggleService = async (name) => {
  try {
    const d = await (await fetch('/api/status')).json();
    const key = name.replace('tsm-', '');
    serviceAction(name, d[key] === 'running' ? 'stop' : 'start');
  } catch {}
};

// ── Stats ──────────────────────────────────────────────────────────────────────
// Live stats and history for charts
const tpsHistory = [];
const playersHistory = [];
const cpuHistory = [];
const ramHistory = [];
let maxPlayers = 20;

const updateLiveStats = (msg) => {
  if (msg.tps  !== undefined) {
    document.getElementById('stat-tps').textContent = msg.tps;
    tpsHistory.push(Number(msg.tps)); if (tpsHistory.length > 120) tpsHistory.shift();
  }
  if (msg.online !== undefined) {
    if (msg.max !== undefined) maxPlayers = Number(msg.max) || maxPlayers;
    document.getElementById('stat-players').textContent = `${msg.online}/${maxPlayers}`;
    playersHistory.push(Number(msg.online)); if (playersHistory.length > 120) playersHistory.shift();
  }
  if (msg.cpu !== undefined) { cpuHistory.push(Number(msg.cpu)||0); if (cpuHistory.length>120) cpuHistory.shift(); }
  if (msg.ram !== undefined) { ramHistory.push(Number(msg.ram)||0); if (ramHistory.length>120) ramHistory.shift(); }
};

function drawPerformanceChart(canvasId, data, color, type) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  
  const displayWidth = c.clientWidth || 300;
  const displayHeight = c.clientHeight || 120;
  
  // Set up crisp high-DPI scaling
  const dpr = window.devicePixelRatio || 1;
  c.width = displayWidth * dpr;
  c.height = displayHeight * dpr;
  
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  
  // Padding around the actual chart content to allow ticks/labels
  const leftMargin = 42;
  const rightMargin = 10;
  const topMargin = 15;
  const bottomMargin = 15;
  
  const chartW = displayWidth - leftMargin - rightMargin;
  const chartH = displayHeight - topMargin - bottomMargin;
  
  // Determine bounds and tick values based on type
  let yMin = 0;
  let yMax = 100;
  let ticks = [];
  
  if (type === 'tps') {
    yMin = 0;
    yMax = 20;
    ticks = [
      { val: 0, label: '0' },
      { val: 5, label: '5' },
      { val: 10, label: '10' },
      { val: 15, label: '15' },
      { val: 20, label: '20' }
    ];
  } else if (type === 'players') {
    yMin = 0;
    const maxVal = data.length > 0 ? Math.max(...data) : 0;
    yMax = Math.max(5, maxPlayers, maxVal);
    const mid = Math.round(yMax / 2);
    ticks = [
      { val: 0, label: '0' },
      { val: mid, label: String(mid) },
      { val: yMax, label: String(yMax) }
    ];
  } else if (type === 'cpu') {
    const maxVal = data.length > 0 ? Math.max(...data) : 0;
    yMax = Math.max(100, Math.ceil(maxVal / 25) * 25); // round to multiple of 25 above 100
    if (yMax <= 100) {
      yMax = 100;
      ticks = [
        { val: 0, label: '0%' },
        { val: 25, label: '25%' },
        { val: 50, label: '50%' },
        { val: 75, label: '75%' },
        { val: 100, label: '100%' }
      ];
    } else {
      const step = yMax / 4;
      ticks = [
        { val: 0, label: '0%' },
        { val: Math.round(step), label: Math.round(step) + '%' },
        { val: Math.round(step * 2), label: Math.round(step * 2) + '%' },
        { val: Math.round(step * 3), label: Math.round(step * 3) + '%' },
        { val: yMax, label: yMax + '%' }
      ];
    }
  } else if (type === 'ram') {
    yMin = 0;
    yMax = 100;
    ticks = [
      { val: 0, label: '0%' },
      { val: 25, label: '25%' },
      { val: 50, label: '50%' },
      { val: 75, label: '75%' },
      { val: 100, label: '100%' }
    ];
  }
  
  const getX = (index) => {
    if (data.length <= 1) return leftMargin;
    return leftMargin + (index / (data.length - 1)) * chartW;
  };
  
  const getY = (val) => {
    const range = yMax - yMin;
    const pct = (val - yMin) / (range || 1);
    return displayHeight - bottomMargin - pct * chartH;
  };
  
  // 1. Draw horizontal grid lines and Y-axis labels
  ctx.save();
  ctx.strokeStyle = 'rgba(235, 219, 178, 0.08)'; // var(--bg2) opacity
  ctx.lineWidth = 1;
  ctx.fillStyle = '#a89984'; // var(--fg4)
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  ticks.forEach(tick => {
    const y = getY(tick.val);
    
    // Grid Line
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(displayWidth - rightMargin, y);
    ctx.stroke();
    
    // Label
    ctx.fillText(tick.label, leftMargin - 8, y);
  });
  ctx.restore();
  
  if (!data || data.length === 0) return;
  
  // 2. Draw beautiful linear area gradient under the curve
  ctx.save();
  const gradient = ctx.createLinearGradient(0, topMargin, 0, displayHeight - bottomMargin);
  gradient.addColorStop(0, color + '26'); // ~15% opacity
  gradient.addColorStop(1, color + '00'); // transparent
  ctx.fillStyle = gradient;
  
  ctx.beginPath();
  ctx.moveTo(leftMargin, displayHeight - bottomMargin);
  data.forEach((v, i) => {
    ctx.lineTo(getX(i), getY(v));
  });
  ctx.lineTo(getX(data.length - 1), displayHeight - bottomMargin);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  
  // 3. Draw bold colored performance line
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = getX(i);
    const y = getY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
  
  // 4. Draw a pulsing highlighted dot on the latest value
  ctx.save();
  const lastIdx = data.length - 1;
  const lastVal = data[lastIdx];
  const lastX = getX(lastIdx);
  const lastY = getY(lastVal);
  
  // Glow outer dot
  ctx.fillStyle = color + '40'; // 25% opacity
  ctx.beginPath();
  ctx.arc(lastX, lastY, 6, 0, 2 * Math.PI);
  ctx.fill();
  
  // Solid inner dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

function updateCharts(){
  drawPerformanceChart('tpsChart', tpsHistory, '#f6bf26', 'tps');
  drawPerformanceChart('playersChart', playersHistory, '#8ec07c', 'players');
  drawPerformanceChart('cpuChart', cpuHistory, '#83a598', 'cpu');
  drawPerformanceChart('ramChart', ramHistory, '#b8bb26', 'ram');
}

// refresh charts periodically
setInterval(()=>{ if (document.getElementById('page-perf')?.classList.contains('active')) updateCharts(); }, 2000);

const fetchStats = async () => {
  try {
    const d = await (await fetch('/api/stats')).json();
    document.getElementById('stat-cpu').textContent  = d.cpu      ?? '—';
    document.getElementById('stat-ram').textContent  = d.ram      ?? '—';
    document.getElementById('stat-disk').textContent = d.diskUsage ?? '—';
    const secs = parseUptimeToSeconds(d.uptime);
    if (secs !== null) {
      uptimeSeconds = secs;
      uptimeTicking = true;
      document.getElementById('stat-uptime').textContent = formatUptime(uptimeSeconds);
    } else {
      uptimeTicking = false;
      document.getElementById('stat-uptime').textContent = d.uptime ?? '—';
    }
  } catch {}
};

// ── Players ────────────────────────────────────────────────────────────────────
const fetchPlayers = async () => {
  try {
    const players = await (await fetch('/api/players')).json();
    const el = document.getElementById('playerList');
    if (!players.length) {
      el.className = 'no-players';
      el.textContent = 'No players online';
    } else {
      el.className = 'player-list';
      el.innerHTML = players.map(p => `<span class="player-tag" onclick="openPlayerTab('${p.name}')">${p.name}</span>`).join('');
    }
  } catch {}
};

// ── Server IP ──────────────────────────────────────────────────────────────────
const fetchIp = async () => {
  try {
    const d = await (await fetch('/api/serverip')).json();
    document.getElementById('serverIp').textContent = d.ip || 'unknown';
  } catch {}
};

// ── RCON command ───────────────────────────────────────────────────────────────
const sendCommand = async () => {
  const input = document.getElementById('commandInput');
  const cmd   = input.value.trim();
  if (!cmd) return;
  input.value = '';
  appendLog(`> ${cmd}`, 'command');
  try {
    const d = await (await fetch('/api/rcon', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ command:cmd }) })).json();
    if (d.result) appendLog(d.result, 'info');
    if (d.error)  appendLog(`[ERROR] ${d.error}`, 'error');
  } catch (err) { appendLog(`[ERROR] ${err.message}`, 'error'); }
};
document.getElementById('commandInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendCommand(); });

// ── Tabs ───────────────────────────────────────────────────────────────────────
const switchTab = (id) => {
  fetch(`/api/debug-log?msg=${encodeURIComponent(`SWITCH_TAB: id=${id}`)}`).catch(()=>{});
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === id));
  document.querySelectorAll('.page').forEach(p => {
    const isActive = p.id === `page-${id}`;
    p.style.display = isActive ? 'flex' : 'none';
    p.classList.toggle('active', isActive);
  });
  
  const isConsole = id === 'console';
  document.getElementById('sidebar').style.display = isConsole ? '' : 'none';
  
  if (id === 'map') {
    const triggerResize = () => {
      if (typeof window.resizeMap === 'function') window.resizeMap();
    };
    triggerResize();
    setTimeout(triggerResize, 50);
    setTimeout(triggerResize, 150);
    setTimeout(triggerResize, 300);
    if (typeof window.fetchMapRenderStats === 'function') window.fetchMapRenderStats();
  }
  if (id === 'perf')    { setTimeout(() => { updateCharts(); }, 100); }
  if (id === 'configs') { loadConfigFiles(); }
};

const openPlayerTab = async (name) => {
  if (openTabs[name]) { switchTab(`player-${name}`); return; }
  openTabs[name] = true;

  // Add tab
  const tabBar = document.getElementById('tabBar');
  const tab    = document.createElement('div');
  tab.className    = 'tab';
  tab.dataset.page = `player-${name}`;
  tab.innerHTML    = `<span onclick="switchTab('player-${name}')">${name}</span><span class="tab-close" onclick="closePlayerTab('${name}')">✕</span>`;
  tabBar.appendChild(tab);

  // Create page
  const page = document.createElement('div');
  page.className = 'page';
  page.id        = `page-player-${name}`;
  page.innerHTML = `<div class="player-page" id="pp-${name}"><div style="color:var(--fg4);font-family:'JetBrains Mono',monospace;font-size:11px;">Loading ${name}...</div></div>`;
  
  // Insert before global sidebar in the flex container
  const flexContainer = document.querySelector('body > div[style*="flex:1"]');
  const sidebar = document.getElementById('sidebar');
  if (flexContainer && sidebar) {
    flexContainer.insertBefore(page, sidebar);
  } else if (flexContainer) {
    flexContainer.appendChild(page);
  }

  switchTab(`player-${name}`);
  await loadPlayerPage(name);
};

const closePlayerTab = (name) => {
  delete openTabs[name];
  document.querySelector(`.tab[data-page="player-${name}"]`)?.remove();
  document.getElementById(`page-player-${name}`)?.remove();
  switchTab('console');
};

// ── Player page ────────────────────────────────────────────────────────────────
const ITEM_TEXTURE_BASE = 'https://mc-item-renderer.vercel.app/item/';

// Blocks that have textures in /block/ rather than /item/
const BLOCK_TEXTURE_NAMES = new Set([
  'stone','granite','polished_granite','diorite','polished_diorite','andesite','polished_andesite',
  'grass_block','dirt','coarse_dirt','podzol','cobblestone','oak_planks','spruce_planks',
  'birch_planks','jungle_planks','acacia_planks','dark_oak_planks','mangrove_planks','cherry_planks',
  'oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log',
  'oak_leaves','spruce_leaves','birch_leaves','jungle_leaves','acacia_leaves','dark_oak_leaves',
  'mangrove_leaves','cherry_leaves','azalea_leaves','sponge','wet_sponge','glass','lapis_block',
  'sandstone','chiseled_sandstone','cut_sandstone','gold_block','iron_block','bricks','tnt',
  'bookshelf','mossy_cobblestone','obsidian','crafting_table','furnace','cobblestone_stairs',
  'chest','diamond_block','farmland','sand','gravel','gold_ore','deepslate_gold_ore',
  'iron_ore','deepslate_iron_ore','coal_ore','deepslate_coal_ore','oak_slab','stone_slab',
  'smooth_stone_slab','sandstone_slab','snow','clay','jukebox','oak_fence','pumpkin',
  'netherrack','soul_sand','glowstone','carved_pumpkin','jack_o_lantern','melon',
  'mycelium','nether_brick','end_stone','emerald_block','redstone_block','quartz_block',
  'white_concrete','orange_concrete','magenta_concrete','light_blue_concrete','yellow_concrete',
  'lime_concrete','pink_concrete','gray_concrete','light_gray_concrete','cyan_concrete',
  'purple_concrete','blue_concrete','brown_concrete','green_concrete','red_concrete','black_concrete',
  'white_wool','orange_wool','magenta_wool','light_blue_wool','yellow_wool','lime_wool',
  'pink_wool','gray_wool','light_gray_wool','cyan_wool','purple_wool','blue_wool',
  'brown_wool','green_wool','red_wool','black_wool',
  'white_terracotta','orange_terracotta','magenta_terracotta','light_blue_terracotta',
  'yellow_terracotta','lime_terracotta','pink_terracotta','gray_terracotta',
  'light_gray_terracotta','cyan_terracotta','purple_terracotta','blue_terracotta',
  'brown_terracotta','green_terracotta','red_terracotta','black_terracotta','terracotta',
  'basalt','polished_basalt','smooth_basalt','blackstone','gilded_blackstone',
  'ancient_debris','netherite_block','crying_obsidian','magma_block','soul_soil',
  'warped_nylium','crimson_nylium','warped_stem','crimson_stem','shroomlight',
  'target','honey_block','honeycomb_block','lodestone','respawn_anchor',
  'amethyst_block','calcite','tuff','dripstone_block','moss_block','sculk',
  'sculk_catalyst','deepslate','cobbled_deepslate','polished_deepslate',
  'deepslate_bricks','deepslate_tiles','chiseled_deepslate',
  'raw_iron_block','raw_gold_block','raw_copper_block','copper_block',
  'exposed_copper','weathered_copper','oxidized_copper',
  'cut_copper','exposed_cut_copper','weathered_cut_copper','oxidized_cut_copper',
  'mud','packed_mud','mud_bricks','mangrove_roots','muddy_mangrove_roots',
  'bamboo_block','stripped_bamboo_block','cherry_log','cherry_planks','pink_petals',
  'sniffer_egg','suspicious_sand','suspicious_gravel','decorated_pot',
]);

const ASSET_BASE = 'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures';

// Returns candidate URLs to try in order
const itemIconUrls = (material) => {
  const lower = material.toLowerCase().replace('minecraft:', '');
  const urls = [];
  if (BLOCK_TEXTURE_NAMES.has(lower)) {
    urls.push(`${ASSET_BASE}/block/${lower}.png`);
    urls.push(`${ASSET_BASE}/item/${lower}.png`);
  } else {
    urls.push(`${ASSET_BASE}/item/${lower}.png`);
    urls.push(`${ASSET_BASE}/block/${lower}.png`);
  }
  // Some blocks use _side or _top suffix
  urls.push(`${ASSET_BASE}/block/${lower}_side.png`);
  urls.push(`${ASSET_BASE}/block/${lower}_top.png`);
  return urls;
};

// Try multiple URLs in sequence
const tryLoadImage = (img, urls, index = 0) => {
  if (index >= urls.length) {
    img.style.display = 'none';
    const fallback = img.nextElementSibling;
    if (fallback) fallback.style.display = 'flex';
    return;
  }
  img.src = urls[index];
  img.onerror = () => tryLoadImage(img, urls, index + 1);
};

const renderSlot = (item, index, invType, playerName) => {
  if (!item) return `<div class="inv-slot empty"></div>`;
  const name        = (item.displayName || item.material || '').replace(/_/g, ' ');
  const urlsJson    = JSON.stringify(itemIconUrls(item.material || '')).replace(/"/g, '&quot;');
  return `
    <div class="inv-slot" oncontextmenu="showCtxMenu(event,'${playerName}','${invType}',${index})" title="${name}">
      <img class="item-icon"
        src="${itemIconUrls(item.material || '')[0]}"
        onload="this.style.display=''"
        onerror="tryLoadImage(this, JSON.parse(this.dataset.urls), 1)"
        data-urls="${urlsJson}"
        style="display:block;">
      <span class="item-fallback" style="display:none;font-size:7px;text-align:center;color:var(--fg4);word-break:break-all;padding:2px;align-items:center;justify-content:center;">${(item.material||'').replace('minecraft:','').replace(/_/g,' ').substring(0,8)}</span>
      ${item.amount > 1 ? `<span class="item-count">${item.amount}</span>` : ''}
      <div class="item-tooltip">${name} ×${item.amount}</div>
    </div>`;
};

const loadPlayerPage = async (name) => {
  const pp = document.getElementById(`pp-${name}`);
  try {
    const [stats, invRaw, enderRaw] = await Promise.all([
      fetch(`/api/player/${name}/stats`).then(r => r.json()),
      fetch(`/api/player/${name}/inventory`).then(r => r.json()),
      fetch(`/api/player/${name}/enderchest`).then(r => r.json()),
    ]);

    // Guard: ensure arrays even if plugin returns error object
    const inv   = Array.isArray(invRaw)   ? invRaw   : [];
    const ender = Array.isArray(enderRaw) ? enderRaw : [];

    // Pad to expected sizes so slice/index is safe
    while (inv.length   < 41) inv.push(null);
    while (ender.length < 27) ender.push(null);

    // Main inv: slots 9-35 = main (27), slots 0-8 = hotbar, slots 36-39 = armor, 40 = offhand
    const hotbar  = inv.slice(0, 9);
    const main    = inv.slice(9, 36);
    const armor   = inv.slice(36, 40);
    const offhand = inv[40];

    pp.innerHTML = `
      <div class="player-header">
        <img class="player-avatar" src="https://mc-heads.net/avatar/${name}/48" onerror="this.src='https://mc-heads.net/avatar/Steve/48'">
        <div>
          <div class="player-name-big">${name}</div>
          <div class="player-meta">${stats.world || ''} · ${stats.gamemode || ''}</div>
          <div class="player-meta">X:${Math.round(stats.x)} Y:${Math.round(stats.y)} Z:${Math.round(stats.z)}</div>
        </div>
      </div>

      <div class="player-stats-grid">
        <div class="p-stat"><div class="p-stat-label">Health</div><div class="p-stat-value">${stats.health?.toFixed(1) ?? '—'}/${stats.maxHealth?.toFixed(0) ?? '—'}</div></div>
        <div class="p-stat"><div class="p-stat-label">Food</div><div class="p-stat-value">${stats.food ?? '—'}/20</div></div>
        <div class="p-stat"><div class="p-stat-label">Level</div><div class="p-stat-value">${stats.level ?? '—'}</div></div>
        <div class="p-stat"><div class="p-stat-label">XP</div><div class="p-stat-value">${stats.xp ?? '—'}%</div></div>
      </div>

      <div>
        <div class="inv-section-title">Inventory</div>
        <div class="inv-grid main" style="margin-bottom:2px;">${main.map((it,i) => renderSlot(it, i+9, 'inventory', name)).join('')}</div>
        <div class="inv-grid hotbar">${hotbar.map((it,i) => renderSlot(it, i, 'inventory', name)).join('')}</div>
      </div>

      <div>
        <div class="inv-section-title">
          Ender Chest
          <button class="btn btn-action" style="font-size:9px;padding:2px 6px;" onclick="refreshPlayerPage('${name}')">Refresh</button>
        </div>
        <div class="inv-grid ender">${ender.map((it,i) => renderSlot(it, i, 'enderchest', name)).join('')}</div>
      </div>

      <div>
        <div class="inv-section-title">Give Item</div>
        <div class="give-form">
          <input class="give-input" id="give-mat-${name}" placeholder="minecraft:diamond" autocomplete="off">
          <input class="give-input give-qty" id="give-qty-${name}" type="number" value="1" min="1" max="64">
          <button class="btn btn-action" onclick="giveItem('${name}')">Give</button>
        </div>
      </div>
    `;
  } catch (err) {
    pp.innerHTML = `<div style="color:var(--red2);font-family:'JetBrains Mono',monospace;font-size:11px;padding:16px;">Failed to load player data: ${err.message}</div>`;
  }
};

const refreshPlayerPage = (name) => loadPlayerPage(name);

// ── Give item ──────────────────────────────────────────────────────────────────
const giveItem = async (name) => {
  const mat = document.getElementById(`give-mat-${name}`).value.trim().replace('minecraft:','').toUpperCase();
  const qty = parseInt(document.getElementById(`give-qty-${name}`).value) || 1;
  if (!mat) return;
  try {
    const d = await (await fetch(`/api/player/${name}/give`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ material: mat, amount: qty }) })).json();
    if (d.ok) { toast(`Gave ${qty}x ${mat} to ${name}`); refreshPlayerPage(name); }
    else toast(`Error: ${d.error}`);
  } catch (err) { toast(`Error: ${err.message}`); }
};

// ── Context menu ───────────────────────────────────────────────────────────────
const ctxMenu = document.getElementById('ctxMenu');

const showCtxMenu = (e, playerName, invType, slot) => {
  e.preventDefault();
  ctxTarget = { playerName, invType, slot };
  ctxMenu.style.display = 'block';
  ctxMenu.style.left    = e.clientX + 'px';
  ctxMenu.style.top     = e.clientY + 'px';
};

const ctxAction = async (action) => {
  ctxMenu.style.display = 'none';
  if (!ctxTarget) return;
  const { playerName, invType, slot } = ctxTarget;
  if (action === 'remove') {
    try {
      await fetch(`/api/player/${playerName}/${invType}/${slot}`, { method:'DELETE' });
      toast('Item removed');
      refreshPlayerPage(playerName);
    } catch (err) { toast(`Error: ${err.message}`); }
  }
  ctxTarget = null;
};

document.addEventListener('click', () => { ctxMenu.style.display = 'none'; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') ctxMenu.style.display = 'none'; });

// ── Backups ────────────────────────────────────────────────────────────────────
const fmtSize = (b) => b > 1e9 ? (b/1e9).toFixed(1)+' GB' : b > 1e6 ? (b/1e6).toFixed(1)+' MB' : (b/1e3).toFixed(0)+' KB';

const loadBackups = async () => {
  try {
    const items = await (await fetch('/api/backups')).json();
    const list  = document.getElementById('backupList');
    if (!items.length) { list.innerHTML = '<div class="no-players">No backups found</div>'; return; }
    list.innerHTML = items.map(b => `
      <div class="backup-item">
        <div class="backup-info">
          <div class="backup-name">${b.name}</div>
          <div class="backup-meta">${new Date(b.created).toLocaleString()} · ${fmtSize(b.size)}</div>
        </div>
        <div class="backup-btns">
          <button class="btn btn-action" style="font-size:9px;padding:3px 6px;" onclick="restoreBackup('${b.name}')">Restore</button>
          <button class="btn btn-danger" style="font-size:9px;padding:3px 6px;" onclick="deleteBackup('${b.name}')">Del</button>
        </div>
      </div>`).join('');
  } catch {}
};

const createBackup  = async () => { toast('Creating backup...'); await fetch('/api/backups/create', { method:'POST' }); };
const restoreBackup = async (n) => { if (!confirm(`Restore ${n}?\nServer should be stopped first.`)) return; await fetch(`/api/backups/restore/${n}`, { method:'POST' }); toast(`Restore initiated: ${n}`); };
const deleteBackup  = async (n) => { if (!confirm(`Delete ${n}?`)) return; await fetch(`/api/backups/${n}`, { method:'DELETE' }); toast('Deleted'); loadBackups(); };

// ── Uptime ticker ──────────────────────────────────────────────────────────────
let uptimeSeconds = 0;
let uptimeTicking = false;

const parseUptimeToSeconds = (str) => {
  if (!str || str === '—' || str === 'N/A') return null;
  // formats: HH:MM:SS or MM:SS or D-HH:MM:SS
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return null;
};

const formatUptime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
};

setInterval(() => {
  if (!uptimeTicking) return;
  uptimeSeconds++;
  document.getElementById('stat-uptime').textContent = formatUptime(uptimeSeconds);
}, 1000);

// ── Map rendering (viewport-driven lazy loading)
// Lazy-loads chunks only when visible and supports drag-to-pan and wheel zoom.
(function(){
  const TILE = 16; // base device pixels per chunk at zoom=1
  const MAX_CONCURRENT = 6;
  let world = 'world';
  const canvas = document.getElementById('mapCanvas');
  const statusEl = document.getElementById('mapStatus');
  const dpr = window.devicePixelRatio || 1;

  // state
  let zoom = 1; // multiplier
  let offsetX = 0; // pixel offset (global world pixels) where chunk 0,0 is at (0,0)
  let offsetZ = 0;
  let isDragging = false;
  let dragStart = null;

  const cache = new Map(); // key -> ImageBitmap
  const ungenerated = new Set(); // key -> true (prevent retrying ungenerated chunks)
  const inflight = new Map(); // key -> AbortController

  // limit concurrency
  let activeCount = 0;

  // Coordinate ruler size in pixels (scales with dpr)
  const rulerSize = 36 * dpr;

  // Player tracking state
  let mapPlayers = [];
  let initiallyCentered = false;
  let genChunksPct = 0;

  async function fetchRenderStats() {
    try {
      const res = await fetch(`/api/map/render-stats?world=${encodeURIComponent(world)}`);
      if (!res.ok) return;
      const data = await res.json();
      genChunksPct = data.percent || 0;
      const labelEl = document.getElementById('genProgressLabel');
      if (labelEl) {
        labelEl.textContent = `Generated (${data.rendered}/${data.generated})`;
      }
      document.getElementById('genProgressPct').textContent = `${genChunksPct}%`;
      document.getElementById('genProgressBar').style.width = `${genChunksPct}%`;
    } catch (e) {}
  }

  window.handlePositions = (players) => {
    mapPlayers = players || [];
    requestRender();

    // Auto-center on the first player on initial load
    if (!initiallyCentered && mapPlayers.length > 0) {
      const activeDim = mapWorldToDimension(world);
      const firstPlayer = mapPlayers.find(p => {
        const pw = p.world ? p.world.toLowerCase() : '';
        if (activeDim === 'minecraft:overworld') return pw === 'minecraft:overworld' || pw === 'overworld' || pw === 'world';
        if (activeDim === 'minecraft:the_nether') return pw === 'minecraft:the_nether' || pw === 'the_nether' || pw === 'nether' || pw === 'world_nether';
        if (activeDim === 'minecraft:the_end') return pw === 'minecraft:the_end' || pw === 'the_end' || pw === 'end' || pw === 'world_the_end';
        return false;
      });
      if (firstPlayer) {
        centerAt(firstPlayer.x / 16, firstPlayer.z / 16);
        initiallyCentered = true;
      }
    }
  };

  function mapWorldToDimension(w) {
    if (w === 'world') return 'minecraft:overworld';
    if (w === 'world_nether') return 'minecraft:the_nether';
    if (w === 'world_the_end') return 'minecraft:the_end';
    return '';
  }

  function worldToCanvasPx(cx, cz) {
    const pxPerChunk = TILE * zoom * dpr;
    const x = Math.round((cx * pxPerChunk) + offsetX);
    const y = Math.round((cz * pxPerChunk) + offsetZ);
    return [x, y, pxPerChunk];
  }

  let centeredInitially = false;
  appendLog("[MAP DEBUG] Map module loaded", "info");

  function canvasSizeUpdate() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    if (!centeredInitially && rect.width > 0) {
      centerAt(0, 0);
      centeredInitially = true;
    } else {
      requestRender();
    }
  }

  // Draw cached tiles and placeholders
  let pendingRender = false;
  function requestRender(){ if(pendingRender) return; pendingRender = true; requestAnimationFrame(render); }

  function preloadNeighboringChunks() {
    if (activeCount > 0) return;
    const pxPerChunk = TILE * zoom * dpr;
    if (pxPerChunk <= 0) return;

    const minCX = Math.floor((rulerSize - offsetX) / pxPerChunk);
    const minCZ = Math.floor((rulerSize - offsetZ) / pxPerChunk);
    const maxCX = Math.floor((canvas.width - offsetX) / pxPerChunk);
    const maxCZ = Math.floor((canvas.height - offsetZ) / pxPerChunk);

    const drawCenterCX = (minCX + maxCX) / 2;
    const drawCenterCZ = (minCZ + maxCZ) / 2;

    const preloadList = [];
    const ring = 2; // prefetch 2 rings of chunks outside screen
    for (let cz = minCZ - ring; cz <= maxCZ + ring; cz++) {
      for (let cx = minCX - ring; cx <= maxCX + ring; cx++) {
        if (cx >= minCX && cx <= maxCX && cz >= minCZ && cz <= maxCZ) continue;

        const key = `${world}:${cx}:${cz}`;
        if (cache.has(key) || inflight.has(key) || ungenerated.has(key)) continue;

        preloadList.push({cx, cz, dist: Math.hypot(cx - drawCenterCX, cz - drawCenterCZ)});
      }
    }

    if (preloadList.length === 0) return;
    preloadList.sort((a,b) => a.dist - b.dist);

    for (const item of preloadList) {
      if (activeCount >= MAX_CONCURRENT) break;
      fetchChunk(item.cx, item.cz);
    }
  }

  function updateProgressHUD() {
    const pxPerChunk = TILE * zoom * dpr;
    if (pxPerChunk <= 0) return;

    // 1. Viewed Chunks Progress
    const minCX = Math.floor((rulerSize - offsetX) / pxPerChunk);
    const minCZ = Math.floor((rulerSize - offsetZ) / pxPerChunk);
    const maxCX = Math.floor((canvas.width - offsetX) / pxPerChunk);
    const maxCZ = Math.floor((canvas.height - offsetZ) / pxPerChunk);

    let totalViewed = 0;
    let loadedViewed = 0;
    let ungeneratedViewed = 0;

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        totalViewed++;
        const key = `${world}:${cx}:${cz}`;
        if (cache.has(key)) loadedViewed++;
        else if (ungenerated.has(key)) ungeneratedViewed++;
      }
    }

    const viewedPct = totalViewed > 0 ? Math.round(((loadedViewed + ungeneratedViewed) / totalViewed) * 100) : 0;
    document.getElementById('viewedProgressPct').textContent = `${viewedPct}%`;
    document.getElementById('viewedProgressBar').style.width = `${viewedPct}%`;

    // 2. Generated Chunks Progress (Cached global world percentage)
    document.getElementById('genProgressPct').textContent = `${genChunksPct}%`;
    document.getElementById('genProgressBar').style.width = `${genChunksPct}%`;
  }

  function render(){
    try {
      pendingRender = false;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0,0,canvas.width,canvas.height);

      const pxPerChunk = TILE * zoom * dpr;
      if (pxPerChunk <= 0) return;

      // compute visible chunk range (excluding the ruler overlays for efficiency)
      const minCX = Math.floor((rulerSize - offsetX) / pxPerChunk);
      const minCZ = Math.floor((rulerSize - offsetZ) / pxPerChunk);
      const maxCX = Math.floor((canvas.width - offsetX) / pxPerChunk);
      const maxCZ = Math.floor((canvas.height - offsetZ) / pxPerChunk);

      const drawCenterCX = (minCX + maxCX) / 2;
      const drawCenterCZ = (minCZ + maxCZ) / 2;

      const toLoad = [];
      for (let cz = minCZ; cz <= maxCZ; cz++){
        for (let cx = minCX; cx <= maxCX; cx++){
          const key = `${world}:${cx}:${cz}`;
          const [x,y] = worldToCanvasPx(cx, cz);
          if (cache.has(key)){
            const img = cache.get(key);
            try { ctx.drawImage(img, x, y, pxPerChunk, pxPerChunk); } catch(e){}
          } else {
            // placeholder
            ctx.fillStyle = '#222'; ctx.fillRect(x, y, pxPerChunk, pxPerChunk);
            toLoad.push({cx,cz,dist: Math.hypot(cx - drawCenterCX, cz - drawCenterCZ)});
          }
        }
      }

      // prioritize nearest
      toLoad.sort((a,b)=>a.dist - b.dist);
      scheduleLoads(toLoad);

      if (toLoad.length === 0) {
        preloadNeighboringChunks();
      }

      // ── Draw subtle grid lines ──
      const pxPerBlock = zoom * dpr;
      const min_block_x = (rulerSize - offsetX) / pxPerBlock;
      const max_block_x = (canvas.width - offsetX) / pxPerBlock;
      const min_block_z = (rulerSize - offsetZ) / pxPerBlock;
      const max_block_z = (canvas.height - offsetZ) / pxPerBlock;

      // Pick nice power-of-two block step for coordinates based on zoom
      const steps = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
      let stepBlocks = 512;
      for (const s of steps) {
        if (s * pxPerBlock >= 80) {
          stepBlocks = s;
          break;
        }
      }
      const halfStep = stepBlocks / 2;

      ctx.strokeStyle = 'rgba(250, 189, 47, 0.04)'; // extremely subtle yellow grid
      ctx.lineWidth = 1 * dpr;

      // Vertical grid lines (constant block X)
      let startX = Math.ceil(min_block_x / stepBlocks) * stepBlocks;
      for (let bx = startX; bx <= max_block_x; bx += stepBlocks) {
        const x = (bx * pxPerBlock) + offsetX;
        if (x < rulerSize) continue;
        ctx.beginPath();
        ctx.moveTo(x, rulerSize);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      // Horizontal grid lines (constant block Z)
      let startZ = Math.ceil(min_block_z / stepBlocks) * stepBlocks;
      for (let bz = startZ; bz <= max_block_z; bz += stepBlocks) {
        const y = (bz * pxPerBlock) + offsetZ;
        if (y < rulerSize) continue;
        ctx.beginPath();
        ctx.moveTo(rulerSize, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // ── Draw Players ──
      const activeDim = mapWorldToDimension(world);
      const visiblePlayers = mapPlayers.filter(p => {
        const pw = p.world ? p.world.toLowerCase() : '';
        if (activeDim === 'minecraft:overworld') return pw === 'minecraft:overworld' || pw === 'overworld' || pw === 'world';
        if (activeDim === 'minecraft:the_nether') return pw === 'minecraft:the_nether' || pw === 'the_nether' || pw === 'nether' || pw === 'world_nether';
        if (activeDim === 'minecraft:the_end') return pw === 'minecraft:the_end' || pw === 'the_end' || pw === 'end' || pw === 'world_the_end';
        return false;
      });

      for (const p of visiblePlayers) {
        const px = (p.x * pxPerBlock) + offsetX;
        const py = (p.z * pxPerBlock) + offsetZ;

        // Draw expanding pulse halo
        const pulse = (Date.now() % 2000) / 2000;
        const pulseRadius = 6 * dpr + (12 * dpr * pulse);
        const pulseAlpha = 0.5 * (1 - pulse);
        ctx.beginPath();
        ctx.arc(px, py, pulseRadius, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(142, 192, 124, ${pulseAlpha})`; // Gruvbox Aqua
        ctx.fill();

        // Draw player core dot
        ctx.beginPath();
        ctx.arc(px, py, 5 * dpr, 0, 2 * Math.PI);
        ctx.fillStyle = '#8ec07c';
        ctx.strokeStyle = '#1d2021';
        ctx.lineWidth = 1.5 * dpr;
        ctx.fill();
        ctx.stroke();

        // Draw player label with black stroke outline for excellent contrast
        ctx.fillStyle = '#fbf1c7';
        ctx.font = `bold ${10 * dpr}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.strokeStyle = '#1d2021';
        ctx.lineWidth = 3 * dpr;
        ctx.strokeText(p.name, px, py - 8 * dpr);
        ctx.fillText(p.name, px, py - 8 * dpr);
      }

      // ── Draw Rulers Overlay ──
      // Top ruler background
      ctx.fillStyle = 'rgba(29, 32, 33, 0.92)'; // Gruvbox bg0_h
      ctx.fillRect(0, 0, canvas.width, rulerSize);

      // Left ruler background
      ctx.fillRect(0, 0, rulerSize, canvas.height);

      // Separator lines
      ctx.strokeStyle = '#504945'; // Gruvbox bg2
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(rulerSize, rulerSize);
      ctx.lineTo(canvas.width, rulerSize);
      ctx.moveTo(rulerSize, rulerSize);
      ctx.lineTo(rulerSize, canvas.height);
      ctx.stroke();

      // ── Top Ruler Ticks and Labels ──
      let startXTicks = Math.ceil(min_block_x / halfStep) * halfStep;
      for (let bx = startXTicks; bx <= max_block_x; bx += halfStep) {
        const x = (bx * pxPerBlock) + offsetX;
        if (x < rulerSize) continue;
        const isMajor = (bx % stepBlocks === 0);

        ctx.beginPath();
        ctx.moveTo(x, rulerSize);
        if (isMajor) {
          ctx.lineTo(x, rulerSize - 8 * dpr);
          ctx.strokeStyle = '#504945';
          ctx.stroke();

          ctx.fillStyle = '#fabd2f'; // Gruvbox yellow
          ctx.font = `bold ${9 * dpr}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(bx.toString(), x, rulerSize - 10 * dpr);
        } else {
          ctx.lineTo(x, rulerSize - 4 * dpr);
          ctx.strokeStyle = '#504945';
          ctx.stroke();
        }
      }

      // ── Left Ruler Ticks and Labels ──
      let startZTicks = Math.ceil(min_block_z / halfStep) * halfStep;
      for (let bz = startZTicks; bz <= max_block_z; bz += halfStep) {
        const y = (bz * pxPerBlock) + offsetZ;
        if (y < rulerSize) continue;
        const isMajor = (bz % stepBlocks === 0);

        ctx.beginPath();
        ctx.moveTo(rulerSize, y);
        if (isMajor) {
          ctx.lineTo(rulerSize - 8 * dpr, y);
          ctx.strokeStyle = '#504945';
          ctx.stroke();

          ctx.fillStyle = '#fabd2f';
          ctx.font = `bold ${9 * dpr}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(bz.toString(), rulerSize - 11 * dpr, y);
        } else {
          ctx.lineTo(rulerSize - 4 * dpr, y);
          ctx.strokeStyle = '#504945';
          ctx.stroke();
        }
      }

      // ── Top-Left Corner Box ──
      ctx.fillStyle = 'rgba(29, 32, 33, 0.96)';
      ctx.fillRect(0, 0, rulerSize, rulerSize);

      ctx.strokeStyle = '#504945';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, rulerSize);
      ctx.lineTo(rulerSize, rulerSize);
      ctx.lineTo(rulerSize, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(rulerSize, rulerSize);
      ctx.stroke();

      ctx.fillStyle = '#a89984'; // Gruvbox gray
      ctx.font = `${8 * dpr}px "JetBrains Mono", monospace`;

      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('X', rulerSize - 4 * dpr, 4 * dpr);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Z', 4 * dpr, rulerSize - 4 * dpr);

      // If there are players online and the map is active, continue requestAnimationFrame
      if (visiblePlayers.length > 0 && document.getElementById('page-map').classList.contains('active')) {
        requestAnimationFrame(requestRender);
      }

      // Update the progress bars
      updateProgressHUD();
    } catch (err) {
      appendLog(`[MAP DEBUG] render error: ${err.message}`, "error");
      fetch(`/api/debug-log?msg=${encodeURIComponent(`RENDER_ERROR: ${err.message}\n${err.stack}`)}`).catch(()=>{});
    }
  }

  function scheduleLoads(list){
    for (const item of list){
      const key = `${world}:${item.cx}:${item.cz}`;
      if (cache.has(key) || inflight.has(key) || ungenerated.has(key)) continue;
      if (activeCount >= MAX_CONCURRENT) break;
      fetchChunk(item.cx, item.cz);
    }
  }

  async function fetchChunk(cx, cz){
    const key = `${world}:${cx}:${cz}`;
    const ac = new AbortController();
    inflight.set(key, ac);
    activeCount++;
    statusEl.textContent = `Loading ${cx},${cz} (${activeCount} active)`;

    try {
      const res = await fetch(`/api/map/chunk?world=${encodeURIComponent(world)}&cx=${cx}&cz=${cz}`, {signal: ac.signal});
      if (!res.ok) {
        if (res.status === 404) {
          ungenerated.add(key);
        }
        throw new Error('not found');
      }
      const blob = await res.blob();
      const img = await createImageBitmap(blob);
      cache.set(key, img);
      inflight.delete(key);
    } catch (e){
      inflight.delete(key);
    } finally {
      activeCount--;
      requestRender();
      if (activeCount === 0) statusEl.textContent = 'Idle';
    }
  }

  // Interaction
  let dragDistance = 0;
  canvas.addEventListener('mousedown', (e)=>{
    isDragging = true; dragStart = {x:e.clientX, y:e.clientY, offX:offsetX, offZ:offsetZ};
    dragDistance = 0;
  });
  window.addEventListener('mousemove', (e)=>{
    if (!isDragging) return;
    const dx = (e.clientX - dragStart.x) * dpr;
    const dy = (e.clientY - dragStart.y) * dpr;
    dragDistance += Math.hypot(dx, dy);
    offsetX = dragStart.offX + dx;
    offsetZ = dragStart.offZ + dy;
    requestRender();
  });
  window.addEventListener('mouseup', (e)=>{
    if (isDragging) {
      isDragging = false;
      dragStart = null;

      // If clicked without dragging significantly, check if hovering/clicking a player dot
      if (dragDistance < 4 * dpr && e.target === canvas) {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * dpr;
        const my = (e.clientY - rect.top) * dpr;

        const activeDim = mapWorldToDimension(world);
        const visiblePlayers = mapPlayers.filter(p => {
          const pw = p.world ? p.world.toLowerCase() : '';
          if (activeDim === 'minecraft:overworld') return pw === 'minecraft:overworld' || pw === 'overworld' || pw === 'world';
          if (activeDim === 'minecraft:the_nether') return pw === 'minecraft:the_nether' || pw === 'the_nether' || pw === 'nether' || pw === 'world_nether';
          if (activeDim === 'minecraft:the_end') return pw === 'minecraft:the_end' || pw === 'the_end' || pw === 'end' || pw === 'world_the_end';
          return false;
        });

        for (const p of visiblePlayers) {
          const px = (p.x * zoom * dpr) + offsetX;
          const py = (p.z * zoom * dpr) + offsetZ;
          const dist = Math.hypot(mx - px, my - py);
          if (dist < 12 * dpr) {
            zoom = 2; // zoom in on player
            centerAt(p.x / 16, p.z / 16);
            break;
          }
        }
      }
    }
  });

  canvas.addEventListener('wheel', (e)=>{
    e.preventDefault(); const oldZoom = zoom; const delta = -e.deltaY; const factor = delta > 0 ? 1.12 : 0.9; zoom = Math.min(4, Math.max(0.5, zoom * factor));
    // zoom about cursor
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * dpr; const cz = (e.clientY - rect.top) * dpr;
    offsetX = cx - ((cx - offsetX) * (zoom / oldZoom));
    offsetZ = cz - ((cz - offsetZ) * (zoom / oldZoom));
    requestRender();
  }, { passive:false });

  // Hover Tooltip tracking coordinate/players
  const tooltip = document.getElementById('mapTooltip');

  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      tooltip.style.display = 'none';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr;
    const my = (e.clientY - rect.top) * dpr;

    if (mx < rulerSize || my < rulerSize) {
      tooltip.style.display = 'none';
      return;
    }

    const bx = Math.round((mx - offsetX) / (zoom * dpr));
    const bz = Math.round((my - offsetZ) / (zoom * dpr));

    const activeDim = mapWorldToDimension(world);
    const visiblePlayers = mapPlayers.filter(p => {
      const pw = p.world ? p.world.toLowerCase() : '';
      if (activeDim === 'minecraft:overworld') return pw === 'minecraft:overworld' || pw === 'overworld' || pw === 'world';
      if (activeDim === 'minecraft:the_nether') return pw === 'minecraft:the_nether' || pw === 'the_nether' || pw === 'nether' || pw === 'world_nether';
      if (activeDim === 'minecraft:the_end') return pw === 'minecraft:the_end' || pw === 'the_end' || pw === 'end' || pw === 'world_the_end';
      return false;
    });

    let hoveredPlayer = null;
    for (const p of visiblePlayers) {
      const px = (p.x * zoom * dpr) + offsetX;
      const py = (p.z * zoom * dpr) + offsetZ;
      const dist = Math.hypot(mx - px, my - py);
      if (dist < 12 * dpr) {
        hoveredPlayer = p;
        break;
      }
    }

    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
    tooltip.style.top = (e.clientY - rect.top + 15) + 'px';

    if (hoveredPlayer) {
      tooltip.innerHTML = `<strong style="color:var(--yellow);">${hoveredPlayer.name}</strong><br/>X: ${hoveredPlayer.x}, Y: ${hoveredPlayer.y}, Z: ${hoveredPlayer.z}`;
    } else {
      tooltip.innerHTML = `X: ${bx}<br/>Z: ${bz}`;
    }
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

  // world select
  document.getElementById('worldSelect').addEventListener('change', (e)=>{ 
    world = e.target.value; 
    cache.clear(); 
    ungenerated.clear(); 
    inflight.forEach(ac=>ac.abort()); 
    inflight.clear(); 
    fetchRenderStats(); 
    requestRender(); 
  });

  // resize
  window.addEventListener('resize', canvasSizeUpdate);
  canvasSizeUpdate();

  // expose resizeMap to handle tab switches correctly
  window.resizeMap = () => {
    canvasSizeUpdate();
  };

  // initial centering: put chunk 0,0 at center
  function centerAt(chunkX, chunkZ){
    const pxPerChunk = TILE * zoom * dpr;
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    offsetX = Math.round((rect.width * dpr)/2 - (chunkX * pxPerChunk));
    offsetZ = Math.round((rect.height * dpr)/2 - (chunkZ * pxPerChunk));
    requestRender();
  }
  centerAt(0,0);

  // Expose manual Render button to reflow
  window.renderMap = () => { requestRender(); };

  // Expose statistics fetch
  window.fetchMapRenderStats = () => { fetchRenderStats(); };

  // Initial fetch and background sync
  fetchRenderStats();
  setInterval(fetchRenderStats, 8000);
})();

// ── Config editor utilities
let currentConfigFile = null;
async function loadConfigFiles(){
  try {
    const files = await (await fetch('/api/configs')).json();
    const list = document.getElementById('configFileList');
    if (!files.length) { list.innerHTML = '<div style="padding:12px;color:var(--fg4);font-family:\'JetBrains Mono\',monospace;font-size:11px;">No editable config files found</div>'; return; }
    list.innerHTML = files.map(f => `
      <div class="ctx-item" style="padding:8px 12px;border-bottom:1px solid var(--bg1);cursor:pointer;" data-path="${encodeURIComponent(f.path)}">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--fg2);">${f.name}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--fg4);">${f.path.replace(/^\/home\/[^\/]+\//,'~\/')}</div>
      </div>`).join('');
    // attach handlers
    list.querySelectorAll('.ctx-item').forEach(el => el.addEventListener('click', () => loadConfig(decodeURIComponent(el.dataset.path))));
  } catch (err) { toast('Failed to load config list'); }
}

async function loadConfig(path){
  try {
    const res = await fetch(`/api/config?file=${encodeURIComponent(path)}`);
    if (!res.ok) { toast('Failed to open file'); return; }
    const d = await res.json();
    const editor = document.getElementById('configEditor');
    editor.value = d.content || '';
    document.getElementById('configFileName').textContent = path.replace(/^\/home\/[^\/]+\//,'~\/');
    document.getElementById('saveConfigBtn').style.display = '';
    currentConfigFile = path;
  } catch (err) { toast('Failed to load file'); }
}

async function saveConfig(){
  if (!currentConfigFile) { toast('No file selected'); return; }
  const content = document.getElementById('configEditor').value;
  try {
    const res = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ file: currentConfigFile, content }) });
    const d = await res.json();
    if (res.ok && d.ok) { toast('Saved'); }
    else { toast('Save failed: ' + (d.error || res.statusText)); }
  } catch (err) { toast('Save failed'); }
}

// ── Init ───────────────────────────────────────────────────────────────────────
fetchStatus();
fetchStats();
fetchPlayers();
fetchIp();
loadBackups();
setInterval(fetchStatus, 5000);
setInterval(fetchStats, 15000);
setInterval(fetchPlayers, 10000);
