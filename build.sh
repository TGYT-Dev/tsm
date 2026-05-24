#!/usr/bin/env bash
# TSM Build Script
# Installs dependencies, builds the plugin, and sets up systemd services.
# Run from ~/projects/tsm/

set -e

TSM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$TSM_ROOT/tsmBridge"
MANAGEMENT_DIR="$TSM_ROOT/tsmManagement"
BOT_DIR="$TSM_ROOT/tsmWhitelistBot"
SERVER_DIR="$TSM_ROOT/tsmMcServer"
SYSTEMD_DIR="$TSM_ROOT/systemd"
SERVICE_DEST="$HOME/.config/systemd/user"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[TSM]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

echo ""
echo "  TSM Build Script"
echo "  ================"
echo ""

# ── Check prerequisites ───────────────────────────────────────────────────────
log "Checking prerequisites..."

command -v node  >/dev/null 2>&1 || err "Node.js not found. Install with: sudo pacman -S nodejs"
command -v npm   >/dev/null 2>&1 || err "npm not found. Install with: sudo pacman -S npm"
command -v mvn   >/dev/null 2>&1 || err "Maven not found. Install with: sudo pacman -S maven"
command -v java  >/dev/null 2>&1 || err "Java not found. Install with: sudo pacman -S jdk21-openjdk"

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
    err "Node.js 20+ required. Found: $(node -v)"
fi

log "Node $(node -v), npm $(npm -v), Java $(java -version 2>&1 | head -1 | cut -d'"' -f2)"

# ── Check config ──────────────────────────────────────────────────────────────
CONFIG="$TSM_ROOT/config.json"
if [ ! -f "$CONFIG" ]; then
    err "config.json not found at $CONFIG"
fi

if grep -q "YOUR_BOT_TOKEN" "$CONFIG"; then
    warn "config.json still has placeholder values. Edit it before running the bot."
fi

# ── Build TSMBridge plugin ────────────────────────────────────────────────────
log "Building TSMBridge plugin..."

if [ ! -d "$BRIDGE_DIR" ]; then
    err "tsmBridge directory not found at $BRIDGE_DIR"
fi

cd "$BRIDGE_DIR"
mvn package -q || err "Maven build failed"

JAR=$(find "$BRIDGE_DIR/target" -name "TSMBridge-*.jar" ! -name "*-shaded.jar" | head -1)
if [ -z "$JAR" ]; then
    # Try shaded jar if no plain jar
    JAR=$(find "$BRIDGE_DIR/target" -name "TSMBridge-*.jar" | head -1)
fi

if [ -z "$JAR" ]; then
    err "Could not find built jar in $BRIDGE_DIR/target"
fi

mkdir -p "$SERVER_DIR/plugins"
cp "$JAR" "$SERVER_DIR/plugins/TSMBridge.jar"
log "Copied $(basename "$JAR") → tsmMcServer/plugins/TSMBridge.jar"

# ── Install web UI dependencies ───────────────────────────────────────────────
log "Installing tsmManagement dependencies..."
cd "$MANAGEMENT_DIR"
npm install --silent || err "npm install failed for tsmManagement"

# ── Install bot dependencies ──────────────────────────────────────────────────
log "Installing tsmWhitelistBot dependencies..."
cd "$BOT_DIR"
npm install --silent || err "npm install failed for tsmWhitelistBot"

# ── Install systemd services ──────────────────────────────────────────────────
log "Installing systemd services..."

mkdir -p "$SERVICE_DEST"

for service in tsm-mc.service tsm-bot.service tsm-playit.service; do
    if [ -f "$SYSTEMD_DIR/$service" ]; then
        cp "$SYSTEMD_DIR/$service" "$SERVICE_DEST/$service"
        log "Installed $service"
    else
        warn "$service not found in $SYSTEMD_DIR, skipping"
    fi
done

systemctl --user daemon-reload
systemctl --user enable tsm-mc tsm-bot tsm-playit 2>/dev/null || warn "Could not enable services (may need loginctl enable-linger)"

# ── Enable linger ─────────────────────────────────────────────────────────────
if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$USER" 2>/dev/null && log "Enabled linger for $USER" || warn "Could not enable linger"
fi

# ── Build C renderer ─────────────────────────────────────────────────────────
log "Building C chunk renderer..."

RENDERER_DIR="$TSM_ROOT/tsmManagement/renderer"
MAP_FILES_DIR="$TSM_ROOT/tsmManagement/mapFiles"

# Install deps if needed
if ! pkg-config --exists libpng 2>/dev/null; then
    warn "libpng not found, installing..."
    sudo pacman -S --noconfirm libpng 2>/dev/null || warn "Could not install libpng automatically"
fi

if [ -d "$RENDERER_DIR" ] && [ -f "$RENDERER_DIR/tsm-renderer.c" ]; then
    cd "$RENDERER_DIR"
    make -s || warn "C renderer build failed — map rendering will be unavailable"
    log "C renderer built: $RENDERER_DIR/tsm-renderer"
else
    warn "renderer directory not found at $RENDERER_DIR, skipping"
fi

mkdir -p "$MAP_FILES_DIR"
log "Created mapFiles directory"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  Build complete!${NC}"
echo ""
echo "  Next steps:"
echo "  1. Edit ~/projects/tsm/config.json if you haven't already"
echo "  2. Set up server.properties (enable-rcon=true)"
echo "  3. Start services:"
echo "     systemctl --user start tsm-mc tsm-bot tsm-playit"
echo "  4. Start the web UI:"
echo "     cd ~/projects/tsm/tsmManagement && node server.js"
echo ""
