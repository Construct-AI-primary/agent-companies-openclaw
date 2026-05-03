#!/bin/bash
# ============================================================
# create-control-channels.sh
# Creates #ai-work and #project-log control channels in all
# OpenClaw Discord servers that don't already have them.
#
# Usage:
#   export DISCORD_BOT_TOKEN="YOUR_BOT_TOKEN"
#   bash scripts/create-control-channels.sh
#
# Requires:
#   - DISCORD_BOT_TOKEN environment variable
#   - curl, jq
# ============================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────
DISCORD_API="https://discord.com/api/v10"
BOT_TOKEN="${DISCORD_BOT_TOKEN:-}"

# Servers that need control channels (all except Openclaw-comms which is ops-only)
SERVERS=(
  "VOICE-COMM:1500106236669071534"
  "PROCURE-TEST:1500115728769093632"
  "PROCUREMENT-BIDDING:1500116207552954540"
  "SAFETY:1500117103817134131"
  "ELEC-TEST:1500117452238098554"
  "ELEC-PROJECTS:1500129930053161010"
  "QS-TEST:1500129675916214486"
  "CONTRACTS-QS:1500130883154219258"
  "MEASUREMENT:1500131294879809696"
  "LOGIS-TEST:1500131631833288926"
  "LOGISTICS:1500131961761566851"
  "ENGINEERING:1500132315949699177"
  "ALL-DISCIPLINES:1500134557649731634"
)

# ─── Helpers ─────────────────────────────────────────────────
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

check_deps() {
  if ! command -v curl &>/dev/null; then
    red "Error: curl is required but not installed."
    exit 1
  fi
  if ! command -v jq &>/dev/null; then
    red "Error: jq is required but not installed."
    echo "Install with: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
  fi
}

check_token() {
  if [[ -z "$BOT_TOKEN" ]]; then
    red "Error: DISCORD_BOT_TOKEN is not set."
    echo "Usage: export DISCORD_BOT_TOKEN=\"YOUR_BOT_TOKEN\""
    echo "Get your token from: https://discord.com/developers/applications"
    exit 1
  fi
}

# ─── API Wrappers ────────────────────────────────────────────

# Get existing channels for a guild
get_channels() {
  local guild_id="$1"
  curl -s -H "Authorization: Bot $BOT_TOKEN" \
    "$DISCORD_API/guilds/$guild_id/channels" 2>/dev/null
}

# Create a channel in a guild
create_channel() {
  local guild_id="$1"
  local channel_name="$2"
  local channel_type="$3"  # 0 = text, 2 = voice, 5 = announcement, etc.

  curl -s -X POST \
    -H "Authorization: Bot $BOT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$channel_name\",\"type\":$channel_type}" \
    "$DISCORD_API/guilds/$guild_id/channels" 2>/dev/null
}

# ─── Main ────────────────────────────────────────────────────

main() {
  echo "============================================"
  echo " OpenClaw Control Channel Creator"
  echo "============================================"
  echo ""

  check_deps
  check_token

  # Verify bot token is valid
  local me
  me=$(curl -s -H "Authorization: Bot $BOT_TOKEN" "$DISCORD_API/users/@me")
  if echo "$me" | jq -e '.id' &>/dev/null; then
    local bot_name
    bot_name=$(echo "$me" | jq -r '.username')
    green "✅ Bot authenticated: $bot_name"
  else
    local err
    err=$(echo "$me" | jq -r '.message // "Unknown error"')
    red "❌ Bot authentication failed: $err"
    exit 1
  fi
  echo ""

  # Process each server
  local created_total=0
  local skipped_total=0
  local error_total=0

  for server_entry in "${SERVERS[@]}"; do
    IFS=':' read -r server_name guild_id <<< "$server_entry"

    echo "─── Server: $server_name ($guild_id) ───"

    # Get existing channels
    local channels
    channels=$(get_channels "$guild_id")

    if echo "$channels" | jq -e '.message' &>/dev/null; then
      local err_msg
      err_msg=$(echo "$channels" | jq -r '.message')
      red "  ❌ Error fetching channels: $err_msg"
      error_total=$((error_total + 1))
      echo ""
      continue
    fi

    # Check/create #ai-work
    local has_ai_work
    has_ai_work=$(echo "$channels" | jq -r '[.[] | select(.name == "ai-work")] | length')
    if [[ "$has_ai_work" -gt 0 ]]; then
      yellow "  ⏭️  #ai-work already exists (skipping)"
      skipped_total=$((skipped_total + 1))
    else
      local result
      result=$(create_channel "$guild_id" "ai-work" 0)
      if echo "$result" | jq -e '.id' &>/dev/null; then
        green "  ✅ Created #ai-work"
        created_total=$((created_total + 1))
      else
        local err_msg
        err_msg=$(echo "$result" | jq -r '.message // "Unknown error"')
        red "  ❌ Failed to create #ai-work: $err_msg"
        error_total=$((error_total + 1))
      fi
    fi

    # Check/create #project-log
    local has_project_log
    has_project_log=$(echo "$channels" | jq -r '[.[] | select(.name == "project-log")] | length')
    if [[ "$has_project_log" -gt 0 ]]; then
      yellow "  ⏭️  #project-log already exists (skipping)"
      skipped_total=$((skipped_total + 1))
    else
      local result
      result=$(create_channel "$guild_id" "project-log" 0)
      if echo "$result" | jq -e '.id' &>/dev/null; then
        green "  ✅ Created #project-log"
        created_total=$((created_total + 1))
      else
        local err_msg
        err_msg=$(echo "$result" | jq -r '.message // "Unknown error"')
        red "  ❌ Failed to create #project-log: $err_msg"
        error_total=$((error_total + 1))
      fi
    fi

    echo ""
  done

  # Summary
  echo "============================================"
  echo " Summary"
  echo "============================================"
  green "  ✅ Created:  $created_total channels"
  yellow "  ⏭️  Skipped:  $skipped_total (already existed)"
  red    "  ❌ Errors:   $error_total"
  echo ""
  echo "Servers processed: ${#SERVERS[@]}"
  echo ""

  if [[ "$error_total" -gt 0 ]]; then
    echo "⚠️  Some channels failed to create. Check the errors above."
    echo "  Common issues:"
    echo "  - Bot lacks 'Manage Channels' permission in the server"
    echo "  - Rate limiting (wait a few seconds and retry)"
    echo "  - Bot token is invalid or expired"
    exit 1
  else
    echo "✅ All control channels created successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Deploy updated bot.js to VPS: bash scripts/deploy-discord-bot.sh"
    echo "  2. Restart bot: systemctl restart openclaw-discord-bot"
    echo "  3. Verify: In #agent-commands, run: !taxonomy"
  fi
}

main "$@"