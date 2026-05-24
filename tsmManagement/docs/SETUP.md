# Setup & Installation

## Prerequisites

- Arch Linux (or similar systemd-based distro)
- Node.js 20+
- Java 21 (for Paper + Maven builds)
- Maven
- Tailscale (for access control)
- A Discord bot application

```bash
sudo pacman -S nodejs npm jdk21-openjdk maven tailscale
```

---

## 1. Config

All components share `~/projects/tsm/config.json`:

```json
{
    "botToken":           "YOUR_DISCORD_BOT_TOKEN",
    "guildId":            "YOUR_GUILD_ID",
    "adminChannelId":     "CHANNEL_FOR_WHITELIST_LOGS",
    "statusChannelId":    "CHANNEL_FOR_SERVER_STATUS",
    "adminRoleId":        "MODERATOR_ROLE_ID",
    "rconHost":           "localhost",
    "rconPort":           25575,
    "rconPassword":       "your_rcon_password",
    "statusSecret":       "random_secret_string",
    "statusPort":         4444,
    "bridgeHttpPort":     4001,
    "bridgeWsPort":       4002,
    "allowedUserIds":     []
}
```

`allowedUserIds` is auto-populated by the bot when users gain/lose the moderator role. You don't need to edit it manually.

---

## 2. Paper Server

Enable RCON in `tsmMcServer/server.properties`:

```properties
enable-rcon=true
rcon.port=25575
rcon.password=your_rcon_password
```

The password must match `config.json`.

---

## 3. TSMBridge Plugin

Build and install:

```bash
cd ~/projects/tsm/tsmBridge
mvn package
cp target/TSMBridge-1.0.0.jar ~/projects/tsm/tsmMcServer/plugins/
```

Configure `tsmMcServer/plugins/TSMBridge/config.yml` (generated on first server start):

```yaml
secret: "your_status_secret"   # must match config.json statusSecret
http-port: 4001
websocket-port: 4002
```

---

## 4. Discord Bot

```bash
cd ~/projects/tsm/tsmWhitelistBot
npm install
```

In the Discord Developer Portal:
- Enable **Server Members Intent** under Bot → Privileged Gateway Intents
- Invite the bot with scopes: `bot`, `applications.commands`
- Required permissions integer: `277025508352`

---

## 5. Web Dashboard

```bash
cd ~/projects/tsm/tsmManagement
npm install
node server.js
```

Access at `http://localhost:3000` or via your Tailscale IP.

---

## 6. Systemd Services

Service files go in `~/.config/systemd/user/`. See the provided `installServices.fish` script.

```bash
chmod +x installServices.fish && ./installServices.fish
loginctl enable-linger $USER   # keep services running after logout
```

Services:
- `tsm-mc` — Paper server
- `tsm-bot` — Discord bot
- `tsm-playit` — Playit tunnel

The web UI (`tsmManagement`) is run manually or you can add a fourth service for it.

---

## 7. Playit

Playit is the `playit-linux-amd64` binary in `tsmMcServer/`. It creates a tunnel so players can connect without port forwarding. Run it with `-s start` to skip the TUI.

---

## Access Control

The dashboard is served on port `3000` and bound to `0.0.0.0`. It is unauthenticated — access control is entirely handled by Tailscale. Only add devices you trust to your tailnet.

To share with moderators: invite them to your Tailscale network via `tailscale.com/admin`.
