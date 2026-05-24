# TSMBridge Plugin API

TSMBridge is a Paper plugin that exposes player data and game events to the web dashboard via HTTP and WebSocket.

---

## Configuration

`plugins/TSMBridge/config.yml`:

```yaml
secret: "changeme"       # Must match statusSecret in ~/projects/tsm/config.json
http-port: 4001          # HTTP API port
websocket-port: 4002     # WebSocket port
```

---

## HTTP API

All requests must include the header:
```
X-TSM-Secret: <secret>
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/players` | List online players |
| GET | `/player/:name/stats` | Player stats |
| GET | `/player/:name/inventory` | Inventory slots (41-element array) |
| GET | `/player/:name/enderchest` | Ender chest slots (27-element array) |
| DELETE | `/player/:name/inventory/:slot` | Remove item from inventory slot |
| DELETE | `/player/:name/enderchest/:slot` | Remove item from ender chest slot |
| POST | `/player/:name/give` | Give item to player |

**GET /players** response:
```json
[
  { "name": "Steve", "uuid": "a1b2c3d4-..." },
  { "name": "Alex",  "uuid": "e5f6g7h8-..." }
]
```

**GET /player/:name/stats** response:
```json
{
  "name": "Steve",
  "health": 20.0,
  "maxHealth": 20.0,
  "food": 18,
  "gamemode": "SURVIVAL",
  "xp": 45,
  "level": 3,
  "world": "world",
  "x": 120.5,
  "y": 64.0,
  "z": -88.3
}
```

**Inventory slot object:**
```json
{ "slot": 0, "material": "minecraft:diamond_sword", "amount": 1, "displayName": "Sharp Sword" }
```
Null slots are returned as JSON `null`.

**POST /player/:name/give** body:
```json
{ "material": "DIAMOND", "amount": 10 }
```

---

## WebSocket

Connect to `ws://<server>:4002?secret=<secret>`.

The server broadcasts JSON messages for game events. The web dashboard connects to this via `server.js` which relays relevant events to UI clients.

### Event Types

| Type | Fields | Description |
|---|---|---|
| `tps` | `tps1m`, `tps5m`, `tps15m`, `online`, `max` | TPS + player count, every 5s |
| `positions` | `players: [{name, world, x, y, z}]` | All player positions, every 5s |
| `join` | `player`, `world`, `x`, `y`, `z` | Player joined |
| `quit` | `player` | Player left |
| `chat` | `player`, `message` | Chat message |
| `command` | `player`, `command` | Player ran a command |
| `death` | `player`, `message`, `killer`, `world`, `x`, `y`, `z` | Player died |
| `tpsWarning` | `tps` | TPS dropped below 15 |

---

## Building

Requires Maven and JDK 21:

```bash
cd ~/projects/tsm/tsmBridge
mvn package
cp target/TSMBridge-1.0.0.jar ~/projects/tsm/tsmMcServer/plugins/
```

After updating the plugin, restart the server for changes to take effect.
