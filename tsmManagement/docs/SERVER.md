# Web Server API Reference

The Express backend (`server.js`) runs on port `3000`. All endpoints are unauthenticated — access is controlled at the network level via Tailscale.

---

## REST Endpoints

### Status & Stats

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Service status for `tsm-mc`, `tsm-bot`, `tsm-playit` |
| GET | `/api/stats` | CPU %, RAM %, uptime, disk usage of server dir |
| GET | `/api/serverip` | Tailscale IP (or fallback `hostname -I`) |

**GET /api/status** response:
```json
{ "mc": "running", "bot": "stopped", "playit": "running" }
```

**GET /api/stats** response:
```json
{ "cpu": "12.3%", "ram": "4.5%", "uptime": "1:23:45", "diskUsage": "4.2G" }
```

---

### Service Control

| Method | Path | Description |
|---|---|---|
| POST | `/api/service/:name/:action` | Control a systemd service |

`:name` — one of `tsm-mc`, `tsm-bot`, `tsm-playit`
`:action` — one of `start`, `stop`, `restart`

Starting `tsm-mc` also clears session lock files automatically.

---

### RCON

| Method | Path | Description |
|---|---|---|
| POST | `/api/rcon` | Send a command to the MC server |

Body: `{ "command": "say Hello" }`
Response: `{ "result": "..." }`

---

### Players

| Method | Path | Description |
|---|---|---|
| GET | `/api/players` | List online players (TSMBridge → RCON fallback) |
| GET | `/api/player/:name/stats` | Player stats (health, food, location, etc.) |
| GET | `/api/player/:name/inventory` | Inventory slots array (41 elements, nulls for empty) |
| GET | `/api/player/:name/enderchest` | Ender chest slots array (27 elements) |
| DELETE | `/api/player/:name/inventory/:slot` | Remove item from inventory slot |
| DELETE | `/api/player/:name/enderchest/:slot` | Remove item from ender chest slot |
| POST | `/api/player/:name/give` | Give item to player |

**Give body**: `{ "material": "DIAMOND", "amount": 1 }`

Inventory and ender chest endpoints always return arrays. If TSMBridge is unavailable they return `500` with an error.

---

### Backups

| Method | Path | Description |
|---|---|---|
| GET | `/api/backups` | List backups in `~/projects/tsm/backups/` |
| POST | `/api/backups/create` | Start a zip backup of the entire server dir |
| POST | `/api/backups/restore/:name` | Emit restore event (actual restore is manual) |
| DELETE | `/api/backups/:name` | Delete a backup file |

Backup creation is async — the response returns immediately and a `backupComplete` or `backupError` WebSocket event is broadcast when done.

---

### Config Editor

| Method | Path | Description |
|---|---|---|
| GET | `/api/configs` | List editable config files |
| GET | `/api/config?file=<path>` | Get file contents |
| POST | `/api/config` | Save file contents (writes `.bak` first) |

Only files in the hardcoded allowlist in `server.js` can be edited. The allowlist includes `server.properties`, `bukkit.yml`, `spigot.yml`, `paper-global.yml`, TSMBridge config, MiniMOTD config, and the shared TSM config.

---

### Map

| Method | Path | Description |
|---|---|---|
| GET | `/api/map` | Render world region as PNG |

Query params:
- `world` — `world`, `world_nether`, or `world_the_end`
- `cx`, `cz` — center block coordinates
- `radius` — region radius (1–3, default 2)

Response: `image/png`

Results are cached for 60 seconds per unique `world:cx:cz:radius` combination.

---

## WebSocket

Connect to `ws://localhost:3000` (or `wss://` over HTTPS).

On connect, the server immediately sends the last 24 hours of log entries as individual `log` messages.

### Message Types (server → client)

| Type | Fields | Description |
|---|---|---|
| `log` | `line`, `category` | New log line. Categories: `info`, `chat`, `command`, `join`, `moderation`, `warn`, `error`, `rcon`, `bot`, `playit` |
| `stats` | `tps`, `tps5m`, `tps15m`, `online`, `max` | Live TPS and player count from TSMBridge (every 5s) |
| `positions` | `players: [{name, world, x, y, z}]` | Bulk player position update (every 5s) |
| `statusUpdate` | — | Services changed, re-fetch `/api/status` |
| `playerUpdate` | — | Player joined/left, re-fetch `/api/players` |
| `tpsWarning` | `tps` | TPS dropped below 15 |
| `backupComplete` | `name` | Backup zip finished |
| `backupError` | `error` | Backup zip failed |
| `restoreInitiated` | `name` | Restore was triggered |
