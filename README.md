# TSM — Totally Safe Minecraft

A self-hosted Minecraft server management stack built around a Paper server, a Discord bot, and a web dashboard. Access is controlled via Tailscale — no login page, no OAuth, just add devices to your tailnet.

---

## Project Structure

```
~/projects/tsm/
├── config.json             # Shared config for all components
├── backups/                # Created automatically by the web UI
│
├── tsmMcServer/            # Paper server files
│   ├── plugins/
│   │   └── TSMBridge.jar   # Custom plugin — HTTP + WS bridge
│   ├── world/
│   ├── world_nether/
│   ├── world_the_end/
│   └── ...
│
├── tsmWhitelistBot/        # Discord bot
│   ├── index.js
│   ├── package.json
│   └── queue.json          # Created automatically
│
├── tsmManagement/          # Web dashboard
│   ├── server.js           # Express backend
│   ├── chunkRenderer.js    # Region file → PNG renderer
│   ├── package.json
│   └── public/
│       └── index.html      # Single-page frontend
│
└── tsmBridge/              # TSMBridge plugin source (Maven)
    ├── pom.xml
    └── src/
```

---

## Components

| Component | What it does |
|---|---|
| **Paper server** | The Minecraft server itself |
| **TSMBridge** | Paper plugin exposing HTTP + WebSocket APIs for inventory, player data, events |
| **tsmWhitelistBot** | Discord bot for whitelist requests, `/status`, `/players` |
| **tsmManagement** | Web dashboard — logs, service control, map, backups, config editor |

---

## Quick Start

See [docs/SETUP.md](docs/SETUP.md) for full setup instructions.

```bash
# 1. Install plugin
cd ~/projects/tsm/tsmBridge && mvn package
cp target/TSMBridge-1.0.0.jar ~/projects/tsm/tsmMcServer/plugins/

# 2. Install systemd services
chmod +x installServices.fish && ./installServices.fish

# 3. Start everything
systemctl --user start tsm-mc tsm-bot tsm-playit

# 4. Start web UI
cd ~/projects/tsm/tsmManagement && npm install && node server.js
```

---

## Docs

- [docs/SETUP.md](docs/SETUP.md) — Installation and configuration
- [docs/SERVER.md](docs/SERVER.md) — Web server API reference
- [docs/INVENTORY.md](docs/INVENTORY.md) — Inventory rendering
- [docs/TSMBRIDGE.md](docs/TSMBRIDGE.md) — Plugin HTTP/WS API
- [docs/BOT.md](docs/BOT.md) — Discord bot commands
