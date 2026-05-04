#!/bin/bash
# ============================================================
# create-ops-channels.sh
# Creates #project-ops channels in all project servers.
#
# Usage:
#   bash scripts/create-ops-channels.sh <DISCORD_BOT_TOKEN>
#
# Requirements:
#   - curl, jq
# ============================================================

set -euo pipefail

TOKEN="$1"
if [ -z "$TOKEN" ]; then
    echo "Usage: bash scripts/create-ops-channels.sh <DISCORD_BOT_TOKEN>"
    exit 1
fi

# All 13 project servers (excludes Openclaw-comms)
declare -A SERVERS=(
    ["VOICE-COMM"]="1500106236669071534"
    ["PROCURE-TEST"]="1500115728769093632"
    ["PROCUREMENT-BIDDING"]="1500116207552954540"
    ["SAFETY"]="1500117103817134131"
    ["ELEC-TEST"]="1500117452238098554"
    ["ELEC-PROJECTS"]="1500129930053161010"
    ["QS-TEST"]="1500129675916214486"
    ["CONTRACTS-QS"]="1500130883154219258"
    ["MEASUREMENT"]="1500131294879809696"
    ["LOGIS-TEST"]="1500131631833288926"
    ["LOGISTICS"]="1500131961761566851"
    ["ENGINEERING"]="1500132315949699177"
    ["ALL-DISCIPLINES"]="1500134557649731634"
)

API_BASE="https://discord.com/api/v10"
CREATED=0
SKIPPED=0

echo "=== Creating #project-ops channels ==="
echo ""

for server_name in "${!SERVERS[@]}"; do
    guild_id="${SERVERS[$server_name]}"
    
    # Check if #project-ops already exists
    existing=$(curl -s -H "Authorization: Bot $TOKEN" "${API_BASE}/guilds/${guild_id}/channels" | \
        jq -r '.[] | select(.name == "project-ops") | .id')
    
    if [ -n "$existing" ]; then
        echo "⏭️  $server_name: #project-ops already exists (${existing})"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    
    # Create the channel
    response=$(curl -s -X POST \
        -H "Authorization: Bot $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"name":"project-ops","type":0,"topic":"Operations channel — infrastructure commands and system status"}' \
        "${API_BASE}/guilds/${guild_id}/channels")
    
    channel_id=$(echo "$response" | jq -r '.id // empty')
    
    if [ -n "$channel_id" ] && [ "$channel_id" != "null" ]; then
        echo "✅ $server_name: Created #project-ops (${channel_id})"
        CREATED=$((CREATED + 1))
    else
        error=$(echo "$response" | jq -r '.message // "unknown error"')
        echo "❌ $server_name: Failed to create #project-ops: $error"
    fi
done

echo ""
echo "=== Summary ==="
echo "Created: $CREATED"
echo "Skipped (already exist): $SKIPPED"
echo "Total servers: ${#SERVERS[@]}"