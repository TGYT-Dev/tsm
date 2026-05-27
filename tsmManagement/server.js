/**
 * TSM Management Server
 * ---------------------
 * Express + WebSocket backend for the TSM web dashboard.
 * Auth is handled at the network level via Tailscale — no login required.
 *
 * Ports:
 *   3000 - Web UI (HTTP + WS)
 *   4001 - TSMBridge HTTP (plugin, local only)
 *   4002 - TSMBridge WebSocket (plugin, local only)
 *
 * See docs/SERVER.md for full API reference.
 */

const express   = require('express');
const http      = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { execSync, spawn } = require('child_process');
const { Rcon }  = require('rcon-client');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const archiver  = require('archiver');


// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.resolve(os.homedir(), 'projects/tsm/config.json');
const getConfig   = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const config      = getConfig();

const TSM_ROOT    = path.resolve(os.homedir(), 'projects/tsm');
const SERVER_DIR  = path.join(TSM_ROOT, 'tsmMcServer');
const BACKUP_DIR  = path.join(TSM_ROOT, 'backups');
const LOG_FILE    = path.join(SERVER_DIR, 'logs/latest.log');
const BRIDGE_HTTP = `http://localhost:${config.bridgeHttpPort || 4001}`;
const BRIDGE_WS   = `ws://localhost:${config.bridgeWsPort || 4002}?secret=${config.statusSecret}`;

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── App ───────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Systemd helpers ───────────────────────────────────────────────────────────
const systemdEnv = {
    ...process.env,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus`,
    XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
};

const systemctl = (action, service) => {
    try { execSync(`systemctl --user ${action} ${service}`, { stdio: 'ignore', env: systemdEnv }); return true; }
    catch { return false; }
};

const svcStatus = (service) => {
    try { execSync(`systemctl --user is-active ${service}`, { stdio: 'ignore', env: systemdEnv }); return 'running'; }
    catch { return 'stopped'; }
};

const clearLocks = () => ['world', 'world_nether', 'world_the_end'].forEach(w => {
    try { fs.unlinkSync(path.join(SERVER_DIR, w, 'session.lock')); } catch {}
});

// ── RCON ──────────────────────────────────────────────────────────────────────
const sendRcon = async (command) => {
    const rcon = await Rcon.connect({
        host: config.rconHost,
        port: config.rconPort,
        password: config.rconPassword,
    });
    const res = await rcon.send(command);
    await rcon.end();
    return res;
};

// ── TSMBridge HTTP proxy ──────────────────────────────────────────────────────
const bridgeFetch = async (bridgePath, options = {}) => {
    const res = await fetch(`${BRIDGE_HTTP}${bridgePath}`, {
        ...options,
        headers: {
            'X-TSM-Secret':  config.statusSecret,
            'Content-Type':  'application/json',
            ...(options.headers || {}),
        },
    });
    if (!res.ok) throw new Error(`Bridge error ${res.status}: ${await res.text()}`);
    return res.json();
};

// ── Broadcast to all UI clients ───────────────────────────────────────────────
const broadcast = (data) => {
    const msg = JSON.stringify(data);
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
};

// ── TSMBridge WebSocket (game events) ────────────────────────────────────────
const connectBridge = () => {
    const ws = new WebSocket(BRIDGE_WS);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            switch (msg.type) {
                case 'tps':
                    let cpu = 0;
                    let ram = 0;
                    try {
                        const pid = execSync('pgrep -f "paper.*jar"').toString().trim().split('\n')[0];
                        if (pid) {
                            const raw = execSync(`ps -p ${pid} -o %cpu,%mem --no-headers`).toString().trim().split(/\s+/);
                            cpu = parseFloat(raw[0]) || 0;
                            ram = parseFloat(raw[1]) || 0;
                        }
                    } catch {}
                    broadcast({ 
                        type: 'stats', 
                        tps: msg.tps1m, 
                        tps5m: msg.tps5m, 
                        tps15m: msg.tps15m, 
                        online: msg.online, 
                        max: msg.max,
                        cpu,
                        ram
                    });
                    break;
                case 'join':
                    broadcast({ type: 'playerUpdate' });
                    pushLog(`[JOIN] ${msg.player}`, 'join');
                    break;
                case 'quit':
                    broadcast({ type: 'playerUpdate' });
                    pushLog(`[QUIT] ${msg.player}`, 'join');
                    break;
                case 'chat':
                    pushLog(`<${msg.player}> ${msg.message}`, 'chat');
                    break;
                case 'command':
                    pushLog(`[CMD] ${msg.player}: ${msg.command}`, 'command');
                    break;
                case 'death':
                    pushLog(`[DEATH] ${msg.message}`, 'moderation');
                    break;
                case 'positions':
                    broadcast({ type: 'positions', players: msg.players });
                    break;
                case 'tpsWarning':
                    broadcast({ type: 'tpsWarning', tps: msg.tps });
                    pushLog(`[WARNING] TPS dropped to ${msg.tps}`, 'warn');
                    break;
            }
        } catch {}
    });

    ws.on('close',  () => setTimeout(connectBridge, 5000));
    ws.on('error',  () => { try { ws.terminate(); } catch {} });
};

connectBridge();

// ── Log pipeline ──────────────────────────────────────────────────────────────
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const logBuffer = []; // { line, category, ts }

const categorise = (line) => {
    if (/RCON Listener|RCON Client/.test(line))                                                                       return 'rcon';
    if (/ERROR|Exception|at java\.|Caused by/.test(line))                                                            return 'error';
    if (/WARN/.test(line))                                                                                            return 'warn';
    if (/kicked|banned|tempban|muted|CoreProtect|command:\/clear|command:\/kill|command:\/ban|command:\/kick/.test(line)) return 'moderation';
    if (/<[^>]+>/.test(line) && !/\[Server\]/.test(line))                                                            return 'chat';
    if (/issued server command/.test(line))                                                                           return 'command';
    if (/joined the game|left the game|logged in with entity id|lost connection|disconnected/.test(line))            return 'join';
    return 'info';
};

const pruneBuffer = () => {
    const cutoff = Date.now() - TWENTY_FOUR_HOURS;
    while (logBuffer.length && logBuffer[0].ts < cutoff) logBuffer.shift();
};

const pushLog = (line, forceCat) => {
    pruneBuffer();
    const category = forceCat || categorise(line);
    logBuffer.push({ line, category, ts: Date.now() });
    broadcast({ type: 'log', line, category });
};

const parseLogTs = (line) => {
    const match = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
    if (!match) return null;
    const now = new Date();
    const ts  = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
        parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    if (ts > now) ts.setDate(ts.getDate() - 1);
    return ts.getTime();
};

// Load latest.log on startup (last 24h)
if (fs.existsSync(LOG_FILE)) {
    try {
        const cutoff = Date.now() - TWENTY_FOUR_HOURS;
        fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(l => l.trim()).forEach(line => {
            const ts = parseLogTs(line) || Date.now();
            if (ts >= cutoff) logBuffer.push({ line, category: categorise(line), ts });
        });
        console.log(`Loaded ${logBuffer.length} log lines from latest.log`);
    } catch (e) { console.error('Failed to load log file:', e.message); }
}

setInterval(pruneBuffer, 60 * 60 * 1000);

// Tail latest.log for new lines
const startTail = () => {
    if (!fs.existsSync(LOG_FILE)) { setTimeout(startTail, 3000); return; }
    const tail = spawn('tail', ['-f', '-n', '0', LOG_FILE]);
    tail.stdout.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) pushLog(l); }));
    tail.on('close', () => setTimeout(startTail, 3000));
};
startTail();

// Tail bot + playit via journald
const startJournalTail = (service, prefix, category) => {
    const proc = spawn('journalctl', ['--user', '-u', service, '-f', '-n', '0', '--output=cat'], { env: systemdEnv });
    proc.stdout.on('data', d => {
        d.toString().split('\n').forEach(l => { if (l.trim()) pushLog(`[${prefix}] ${l.trim()}`, category); });
    });
    proc.on('close', () => setTimeout(() => startJournalTail(service, prefix, category), 3000));
};
startJournalTail('tsm-bot',    'BOT',    'bot');
startJournalTail('tsm-playit', 'PLAYIT', 'playit');

// ── WebSocket: send 24h backlog on connect ────────────────────────────────────
wss.on('connection', (ws) => {
    pruneBuffer();
    logBuffer.forEach(e => {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'log', line: e.line, category: e.category }));
    });
});

app.get('/api/debug-log', (req, res) => {
    console.log('[BROWSER DEBUG]', req.query.msg);
    res.json({ ok: true });
});

// ── API: Status ───────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json({
    mc:     svcStatus('tsm-mc'),
    bot:    svcStatus('tsm-bot'),
    playit: svcStatus('tsm-playit'),
}));

// ── API: Stats (CPU/RAM/disk) ─────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
    const stats = {};
    try {
        stats.diskUsage = execSync(`du -sh ${SERVER_DIR}`, { env: systemdEnv }).toString().split('\t')[0];
    } catch { stats.diskUsage = 'N/A'; }
    try {
        const pid = execSync('pgrep -f "paper.*jar"').toString().trim().split('\n')[0];
        if (pid) {
            const raw    = execSync(`ps -p ${pid} -o %cpu,%mem,etime --no-headers`).toString().trim().split(/\s+/);
            stats.cpu    = raw[0] + '%';
            stats.ram    = raw[1] + '%';
            stats.uptime = raw[2];
        }
    } catch { stats.cpu = 'N/A'; stats.ram = 'N/A'; stats.uptime = 'N/A'; }
    res.json(stats);
});

// ── API: Server IP ────────────────────────────────────────────────────────────
app.get('/api/serverip', (req, res) => {
    try {
        const ip = execSync("tailscale ip -4 2>/dev/null || hostname -I | awk '{print $1}'").toString().trim();
        res.json({ ip });
    } catch { res.json({ ip: 'unknown' }); }
});

// ── API: Service control ──────────────────────────────────────────────────────
app.post('/api/service/:name/:action', (req, res) => {
    const { name, action } = req.params;
    if (!['tsm-mc', 'tsm-bot', 'tsm-playit'].includes(name) ||
        !['start', 'stop', 'restart'].includes(action))
        return res.status(400).json({ error: 'Invalid service or action' });

    if (name === 'tsm-mc') {
        if (action === 'stop')    pushLog('[TSM] MC Server stopping...', 'info');
        if (action === 'start')   { clearLocks(); pushLog('[TSM] MC Server starting...', 'info'); }
        if (action === 'restart') { clearLocks(); pushLog('[TSM] MC Server restarting...', 'info'); }
    }
    systemctl(action, name);
    setTimeout(() => broadcast({ type: 'statusUpdate' }), 1500);
    res.json({ ok: true });
});

// ── API: RCON ─────────────────────────────────────────────────────────────────
app.post('/api/rcon', async (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'No command' });
    try {
        const result = await sendRcon(command);
        res.json({ result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Players ──────────────────────────────────────────────────────────────
app.get('/api/players', async (req, res) => {
    // Try TSMBridge first, fall back to RCON /list
    try {
        const players = await bridgeFetch('/players');
        if (Array.isArray(players)) return res.json(players);
    } catch {}
    try {
        const result = await sendRcon('list');
        const match  = result.match(/There are \d+ of a max of \d+ players online: ?(.*)/);
        const names  = match && match[1] ? match[1].split(', ').filter(Boolean) : [];
        return res.json(names.map(n => ({ name: n.trim(), uuid: '' })));
    } catch { return res.json([]); }
});

// ── API: Player inventory/stats (proxied to TSMBridge) ───────────────────────
app.get('/api/player/:name/stats', async (req, res) => {
    try { res.json(await bridgeFetch(`/player/${req.params.name}/stats`)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/player/:name/inventory', async (req, res) => {
    try {
        const data = await bridgeFetch(`/player/${req.params.name}/inventory`);
        // Ensure we always return an array
        res.json(Array.isArray(data) ? data : []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/player/:name/enderchest', async (req, res) => {
    try {
        const data = await bridgeFetch(`/player/${req.params.name}/enderchest`);
        res.json(Array.isArray(data) ? data : []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/player/:name/inventory/:slot', async (req, res) => {
    try { res.json(await bridgeFetch(`/player/${req.params.name}/inventory/${req.params.slot}`, { method: 'DELETE' })); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/player/:name/enderchest/:slot', async (req, res) => {
    try { res.json(await bridgeFetch(`/player/${req.params.name}/enderchest/${req.params.slot}`, { method: 'DELETE' })); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/player/:name/give', async (req, res) => {
    try { res.json(await bridgeFetch(`/player/${req.params.name}/give`, { method: 'POST', body: JSON.stringify(req.body) })); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Backups ──────────────────────────────────────────────────────────────
app.get('/api/backups', (req, res) => {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.zip'))
        .map(f => {
            const s = fs.statSync(path.join(BACKUP_DIR, f));
            return { name: f, size: s.size, created: s.birthtime };
        })
        .sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json(files);
});

app.post('/api/backups/create', (req, res) => {
    const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const dest = path.join(BACKUP_DIR, name);
    res.json({ message: 'Backup started', name });
    const out = fs.createWriteStream(dest);
    const arc = archiver('zip', { zlib: { level: 6 } });
    arc.on('error', err => broadcast({ type: 'backupError', error: err.message }));
    out.on('close', () => broadcast({ type: 'backupComplete', name }));
    arc.pipe(out);
    arc.directory(SERVER_DIR, false);
    arc.finalize();
});

app.post('/api/backups/restore/:name', (req, res) => {
    const p = path.join(BACKUP_DIR, req.params.name);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Restore initiated', path: p });
    broadcast({ type: 'restoreInitiated', name: req.params.name });
});

app.delete('/api/backups/:name', (req, res) => {
    const p = path.join(BACKUP_DIR, req.params.name);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(p);
    res.json({ ok: true });
});

// ── API: Config editor ────────────────────────────────────────────────────────
const CONFIG_FILES = [
    { name: 'TSM Config',        path: path.resolve(os.homedir(), 'projects/tsm/config.json') },
    { name: 'server.properties', path: path.join(SERVER_DIR, 'server.properties') },
    { name: 'bukkit.yml',        path: path.join(SERVER_DIR, 'bukkit.yml') },
    { name: 'spigot.yml',        path: path.join(SERVER_DIR, 'spigot.yml') },
    { name: 'paper-global.yml',  path: path.join(SERVER_DIR, 'config/paper-global.yml') },
    { name: 'TSMBridge config',  path: path.join(SERVER_DIR, 'plugins/TSMBridge/config.yml') },
    { name: 'MiniMOTD config',   path: path.join(SERVER_DIR, 'plugins/MiniMOTD/main.conf') },
].filter(f => fs.existsSync(f.path));

app.get('/api/configs', (req, res) => res.json(CONFIG_FILES));

app.get('/api/config', (req, res) => {
    const file = CONFIG_FILES.find(f => f.path === req.query.file);
    if (!file) return res.status(404).json({ error: 'File not found' });
    try { res.json({ content: fs.readFileSync(file.path, 'utf8') }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config', (req, res) => {
    const { file, content } = req.body;
    const allowed = CONFIG_FILES.find(f => f.path === file);
    if (!allowed) return res.status(403).json({ error: 'File not in allowlist' });
    try {
        // Write backup first
        fs.writeFileSync(file + '.bak', fs.readFileSync(file));
        fs.writeFileSync(file, content, 'utf8');
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: Map render (uses C renderer) ────────────────────────────────────────
const { execFile } = require('child_process');
const { renderChunkToFile } = require('./chunkRenderer');

const WORLD_DIRS = {
    world:         path.join(SERVER_DIR, 'world/dimensions/minecraft/overworld'),
    world_nether:  path.join(SERVER_DIR, 'world/dimensions/minecraft/the_nether'),
    world_the_end: path.join(SERVER_DIR, 'world/dimensions/minecraft/the_end'),
};

const MAP_FILES_DIR  = path.join(TSM_ROOT, 'tsmManagement', 'mapFiles');
const RENDERER_BIN   = path.join(TSM_ROOT, 'tsmManagement', 'renderer', 'tsm-renderer');
const MAP_CACHE_TTL  = 5 * 60 * 1000; // 5 minutes
const mapCacheMeta   = {}; // cacheKey -> { file, ts }

if (!fs.existsSync(MAP_FILES_DIR)) fs.mkdirSync(MAP_FILES_DIR, { recursive: true });

// Map tiles cache directory
const MAP_TILES_DIR = path.join(TSM_ROOT, 'tsmManagement', 'mapTiles');
if (!fs.existsSync(MAP_TILES_DIR)) fs.mkdirSync(MAP_TILES_DIR, { recursive: true });

// In-flight render promises to deduplicate concurrent requests
const tileInflight = new Map();
// Regions queued for background pre-render
const regionQueue = new Set();

async function preRenderRegion(worldDir, rx, rz) {
    const key = `${worldDir}:${rx}:${rz}`;
    if (regionQueue.has(key)) return;
    regionQueue.add(key);
    // render all 32x32 chunks in region with limited concurrency
    const tasks = [];
    for (let cx = 0; cx < 32; cx++) for (let cz = 0; cz < 32; cz++) tasks.push({cx: rx*32 + cx, cz: rz*32 + cz});
    const CONCURRENCY = 4;
    let i = 0;
    async function worker(){
        while (i < tasks.length) {
            const t = tasks[i++];
            const tilePath = path.join(MAP_TILES_DIR, path.basename(worldDir), `${t.cx}_${t.cz}.png`);
            if (fs.existsSync(tilePath)) continue;
            try { await renderChunkToFile(worldDir, t.cx, t.cz, tilePath); } catch(e){}
        }
    }
    const workers = Array.from({length: CONCURRENCY}, () => worker());
    await Promise.all(workers);
    regionQueue.delete(key);
}


// ── API: Map chunk render (on-demand tile cache + background pre-render)
app.get('/api/map/chunk', async (req, res) => {
    const world = req.query.world || 'world';
    const cx    = parseInt(req.query.cx);
    const cz    = parseInt(req.query.cz);
    if (Number.isNaN(cx) || Number.isNaN(cz)) return res.status(400).json({ error: 'Missing cx/cz' });
    const worldDir = WORLD_DIRS[world];
    if (!worldDir || !fs.existsSync(worldDir)) return res.status(404).json({ error: 'World not found' });

    try {
        const tileDir = path.join(MAP_TILES_DIR, world.replace(/[^a-zA-Z0-9-_]/g, '_'));
        const tilePath = path.join(tileDir, `${cx}_${cz}.png`);
        // Region file mtime to detect stale tiles
        const rx = Math.floor(cx/32), rz = Math.floor(cz/32);
        const regionFile = path.join(worldDir, 'region', `r.${rx}.${rz}.mca`);
        const regionMtime = fs.existsSync(regionFile) ? fs.statSync(regionFile).mtimeMs : 0;

        if (fs.existsSync(tilePath)) {
            const s = fs.statSync(tilePath);
            if (s.mtimeMs >= regionMtime) {
                res.set('Content-Type', 'image/png');
                res.set('Cache-Control', 'public, max-age=86400');
                res.set('ETag', `"${s.size}-${s.mtimeMs}"`);
                return res.sendFile(tilePath);
            }
        }

        // Deduplicate inflight renders
        if (!tileInflight.has(tilePath)) {
            const p = (async () => {
                try {
                    fs.mkdirSync(path.dirname(tilePath), { recursive: true });
                    // Try to render to file (faster overall since we can reuse)
                    const out = await renderChunkToFile(worldDir, cx, cz, tilePath);
                    return out || null;
                } catch (e) { return null; }
            })();
            tileInflight.set(tilePath, p);
            p.finally(() => tileInflight.delete(tilePath));
        }

        const made = await tileInflight.get(tilePath);
        if (!made || !fs.existsSync(made)) return res.status(404).json({ error: 'Chunk not found' });

        // Schedule background pre-render of entire region (async)
        preRenderRegion(worldDir, rx, rz).catch(() => {});

        const s2 = fs.statSync(made);
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('ETag', `"${s2.size}-${s2.mtimeMs}"`);
        return res.sendFile(made);
    } catch (e) {
        console.error('map chunk error', e);
        res.status(500).json({ error: e.message });
    }
});

// ── API: Map render (full image, kept for compatibility)
app.get('/api/map', async (req, res) => {
    const world  = req.query.world  || 'world';
    const cx     = parseInt(req.query.cx)     || 0;
    const cz     = parseInt(req.query.cz)     || 0;
    const radius = Math.min(parseInt(req.query.radius) || 2, 4);

    const cacheKey  = `${world}_${cx}_${cz}_${radius}`;
    const cachedMeta = mapCacheMeta[cacheKey];

    // Serve cached file if fresh
    if (cachedMeta && Date.now() - cachedMeta.ts < MAP_CACHE_TTL && fs.existsSync(cachedMeta.file)) {
        res.set('Content-Type', 'image/png');
        res.set('X-Map-Cached', 'true');
        return res.sendFile(cachedMeta.file);
    }

    const worldDir = WORLD_DIRS[world];
    if (!worldDir || !fs.existsSync(worldDir))
        return res.status(404).json({ error: 'World not found' });

    if (!fs.existsSync(RENDERER_BIN))
        return res.status(500).json({ error: 'Renderer not built. Run: cd ~/projects/tsm/tsmManagement/renderer && make' });

    const outFile = path.join(MAP_FILES_DIR, `${cacheKey}.png`);

    await new Promise((resolve, reject) => {
        execFile(RENDERER_BIN, [worldDir, String(cx), String(cz), String(radius), outFile],
            { timeout: 120000 },
            (err, stdout, stderr) => {
                if (stderr) console.log('[renderer]', stderr.trim());
                if (err) reject(err);
                else resolve();
            }
        );
    }).catch(e => { throw new Error(`Render failed: ${e.message}`); });

    mapCacheMeta[cacheKey] = { file: outFile, ts: Date.now() };
    res.set('Content-Type', 'image/png');
    res.sendFile(outFile);
});

// ── API: Map render statistics (calculates rendered chunks / total generated chunks in region files) ──
const generatedCountCache = new Map(); // world -> { count, ts }

function countGeneratedChunks(worldDir) {
    const regionDir = path.join(worldDir, 'region');
    if (!fs.existsSync(regionDir)) return 0;
    try {
        const files = fs.readdirSync(regionDir).filter(f => f.endsWith('.mca'));
        let totalGenerated = 0;
        for (const file of files) {
            const filePath = path.join(regionDir, file);
            try {
                const fd = fs.openSync(filePath, 'r');
                const buf = Buffer.alloc(4096);
                fs.readSync(fd, buf, 0, 4096, 0);
                fs.closeSync(fd);
                for (let i = 0; i < 1024; i++) {
                    const offset = buf.readUInt32BE(i * 4);
                    if (offset !== 0) {
                        totalGenerated++;
                    }
                }
            } catch (e) {}
        }
        return totalGenerated;
    } catch (e) {
        return 0;
    }
}

function getGeneratedChunksCount(world) {
    const worldDir = WORLD_DIRS[world];
    if (!worldDir || !fs.existsSync(worldDir)) return 0;
    const cached = generatedCountCache.get(world);
    if (cached && Date.now() - cached.ts < 15000) { // cache for 15 seconds
        return cached.count;
    }
    const count = countGeneratedChunks(worldDir);
    generatedCountCache.set(world, { count, ts: Date.now() });
    return count;
}

app.get('/api/map/render-stats', (req, res) => {
    const world = req.query.world || 'world';
    const worldDir = WORLD_DIRS[world];
    if (!worldDir || !fs.existsSync(worldDir)) {
        return res.status(404).json({ error: 'World not found' });
    }

    try {
        const totalGenerated = getGeneratedChunksCount(world);
        const tileDir = path.join(MAP_TILES_DIR, world.replace(/[^a-zA-Z0-9-_]/g, '_'));
        let renderedCount = 0;
        if (fs.existsSync(tileDir)) {
            const files = fs.readdirSync(tileDir);
            renderedCount = files.filter(f => f.endsWith('.png')).length;
        }

        res.json({
            rendered: renderedCount,
            generated: totalGenerated,
            percent: totalGenerated > 0 ? Math.round((renderedCount / totalGenerated) * 100) : 0
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(3000, '0.0.0.0', () => {
    console.log('TSM Management UI running at http://0.0.0.0:3000');
    console.log('Access via Tailscale or localhost only.');
});
