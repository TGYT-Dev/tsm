# Discord Bot

The TSM whitelist bot handles player whitelist requests and provides server status commands.

---

## Commands

| Command | Who | Description |
|---|---|---|
| `/requestwhitelist <username>` | Anyone | Request server whitelist |
| `/approve <username>` | Moderator | Approve a whitelist request |
| `/deny <username>` | Moderator | Deny a whitelist request |
| `/queue` | Moderator | View pending requests |
| `/status` | Anyone | Server status embed |
| `/players` | Anyone | Online players list |

---

## Whitelist Flow

1. User runs `/requestwhitelist <username>`
2. Bot validates username against Mojang API
3. Request added to `queue.json`, embed sent to `adminChannelId`
4. Moderator runs `/approve <username>`
5. Bot runs `whitelist add` via RCON
6. Player gets roles: `allowedUserIds` role added, pending role removed
7. DM sent to player

---

## Role Sync

The bot listens for `guildMemberUpdate` events. Whenever a member gains or loses the moderator role (`adminRoleId`), the bot re-fetches all members with that role and writes the list to `allowedUserIds` in `config.json`. This is used by the web dashboard to determine who can access it via Tailscale.

---

## Status Messages

The bot sends embeds to `statusChannelId` when the MC server starts, stops, crashes, or restarts. These are triggered by HTTP POST requests from `start.sh` (or the web dashboard's service control) to the bot's HTTP endpoint on port `statusPort` (default 4444).

### Status Types

| Type | Color | Meaning |
|---|---|---|
| `manualStart` | Green | Server started manually |
| `autoStart` | Yellow | Server auto-restarted after crash |
| `manualStop` | Red | Server stopped manually |
| `crash` | Red | Server crashed |
| `restart` | Yellow | Server restarting |

---

## Config Fields Used

```json
{
  "botToken":        "Discord bot token",
  "guildId":         "Your Discord server ID",
  "adminChannelId":  "Channel for whitelist logs",
  "statusChannelId": "Channel for server status",
  "adminRoleId":     "Moderator role ID",
  "rconHost":        "localhost",
  "rconPort":        25575,
  "rconPassword":    "RCON password",
  "statusSecret":    "Shared secret for HTTP status endpoint",
  "statusPort":      4444,
  "allowedUserIds":  ["auto-populated by bot"]
}
```
