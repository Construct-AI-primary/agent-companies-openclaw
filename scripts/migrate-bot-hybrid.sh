#!/bin/bash
# ============================================================
# migrate-bot-hybrid.sh
# Migrates the deployed Discord bot on the VPS from the old
# channel-per-issue model to the hybrid channel taxonomy model.
#
# Usage:
#   bash scripts/migrate-bot-hybrid.sh
#
# Run this ON THE VPS (srv1628373.hstgr.cloud), NOT on Mac.
# Or use SCP to copy files first.
# ============================================================

set -euo pipefail

BOT_DIR="/opt/openclaw-discord-bot"
BACKUP_DIR="${BOT_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

echo "============================================"
echo " OpenClaw Bot — Hybrid Channel Migration"
echo "============================================"
echo ""

# ─── Step 1: Verify we're on the VPS ─────────────
if [ ! -d "$BOT_DIR" ]; then
    red "❌ Bot directory not found at $BOT_DIR"
    echo "   This script must be run on the VPS (srv1628373.hstgr.cloud)"
    echo "   or the bot must be deployed first via deploy-discord-bot.sh"
    exit 1
fi
green "✅ Bot directory found: $BOT_DIR"

# ─── Step 2: Backup the current bot.js ────────────
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/bot.js.${TIMESTAMP}.bak"
cp "$BOT_DIR/bot.js" "$BACKUP_FILE"
green "✅ Backed up old bot.js → ${BACKUP_FILE}"

# ─── Step 3: Check if new bot.js is available ─────
CANDIDATES=(
  "/root/agent-companies-openclaw/scripts/bot.js"       # If repo cloned to /root
  "/opt/openclaw/scripts/bot.js"                        # Old clone location
  "$(dirname "$0")/bot.js"                              # Same directory as this script
)

NEW_BOT=""
for candidate in "${CANDIDATES[@]}"; do
  if [ -f "$candidate" ]; then
    NEW_BOT="$candidate"
    break
  fi
done

if [ -z "$NEW_BOT" ]; then
    yellow "⚠️  New bot.js not found locally."
    echo ""
    echo "Choose deployment method:"
    echo "  1) SCP from Mac to VPS (recommended if you have SSH access from Mac)"
    echo "  2) Paste the updated bot.js content manually"
    echo "  3) Skip — I'll deploy it myself later"
    echo ""
    read -rp "Enter choice [1-3]: " choice

    case "$choice" in
      1)
        echo ""
        echo "On your Mac, run:"
        echo "  scp -P 65002 /Users/PROC-TEST/agent-companies-openclaw/scripts/bot.js root@srv1628373.hstgr.cloud:/opt/openclaw-discord-bot/bot.js"
        echo "  ssh -p 65002 root@srv1628373.hstgr.cloud 'systemctl restart openclaw-discord-bot'"
        echo ""
        exit 0
        ;;
      2)
        echo ""
        echo "Open the updated scripts/bot.js on your Mac, copy the entire contents,"
        echo "then paste it here. Press Ctrl+D when done."
        echo ""
        cat > "$BOT_DIR/bot.js"
        green "✅ bot.js updated from paste"
        ;;
      3)
        yellow "⏭️  Skipping. Remember to deploy the new bot.js later."
        exit 0
        ;;
      *)
        red "Invalid choice."
        exit 1
        ;;
    esac
else
    cp "$NEW_BOT" "$BOT_DIR/bot.js"
    green "✅ Copied new bot.js from ${NEW_BOT}"
fi

# ─── Step 4: Install any new dependencies ─────────
cd "$BOT_DIR"
green "✅ Dependencies already installed (discord.js, dotenv)"

# ─── Step 5: Restart the service ──────────────────
echo ""
echo "Restarting bot service..."
systemctl restart openclaw-discord-bot
sleep 2

# ─── Step 6: Verify ───────────────────────────────
echo ""
echo "Checking bot status..."
if systemctl is-active --quiet openclaw-discord-bot; then
    green "✅ Bot service is running"
    echo ""
    echo "Recent logs:"
    journalctl -u openclaw-discord-bot -n 5 --no-pager
    echo ""
    echo "============================================"
    green " Migration complete!"
    echo "============================================"
    echo ""
    echo "Next steps:"
    echo "  1. In Discord #agent-commands, run: !taxonomy"
    echo "  2. Add #ai-work and #project-log channels to each project server:"
    echo "     bash scripts/create-control-channels.sh"
    echo "  3. Verify cross-reference replies work in issue channels"
else
    red "❌ Bot service failed to start"
    echo ""
    echo "Checking logs..."
    journalctl -u openclaw-discord-bot -n 20 --no-pager
    exit 1
fi