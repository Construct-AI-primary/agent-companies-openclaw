#!/bin/bash
# Discord Bot Deployment Script for OpenClaw
# Run this on the Hostinger VPS (srv1628373.hstgr.cloud)
# Usage: bash scripts/deploy-discord-bot.sh

set -e

BOT_DIR="/opt/openclaw-discord-bot"
BOT_TOKEN="${DISCORD_BOT_TOKEN:-MTQ5OTcyODMxMjA3MzcxNTg0Mg.GjI8yx.hG9jrQVlHMeVYBvdHH_q0B8IFQDqfbqMLGelgw}"
SERVER_ID="${DISCORD_SERVER_ID:-1481205775710949428}"

echo "=== OpenClaw Discord Bot Deployment ==="
echo "Target: $BOT_DIR"

# Step 1: Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    apt update && apt install -y nodejs npm
fi

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Step 2: Create bot directory
mkdir -p "$BOT_DIR"
cd "$BOT_DIR"

# Step 3: Create package.json
cat > package.json << 'PKGJSON'
{
  "name": "openclaw-discord-bot",
  "version": "1.0.0",
  "description": "Discord bot for OpenClaw platform communications",
  "main": "bot.js",
  "scripts": {
    "start": "node bot.js",
    "test": "node -e \"console.log('OK')\""
  },
  "dependencies": {
    "discord.js": "^14.14.1",
    "dotenv": "^16.3.1"
  }
}
PKGJSON

# Step 4: Create .env file
cat > .env << ENVFILE
DISCORD_BOT_TOKEN=$BOT_TOKEN
DISCORD_SERVER_ID=$SERVER_ID
ENVFILE

# Step 5: Create the bot application
cat > bot.js << 'BOTJS'
const { Client, GatewayIntentBits, Events } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const CHANNELS = {
  deployments: '1499729446494802011',
  monitoring: '1499729509572808834',
  security: '1499729511611367544',
  operations: '1499729513486090350',
  'agent-commands': '1499729515088314429'
};

client.once(Events.ClientReady, (c) => {
  console.log(`✅ OpenClaw Bot logged in as ${c.user.tag}`);
  console.log(`📡 Connected to server ID: ${process.env.DISCORD_SERVER_ID}`);
  console.log(`📋 Channels ready: ${Object.keys(CHANNELS).join(', ')}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== CHANNELS['agent-commands']) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  switch (command) {
    case '!ping':
      await message.reply('🏓 Pong! Bot is online.');
      break;
    case '!status':
      await message.reply('🟢 OpenClaw Bot is running and connected.');
      break;
    case '!help':
      await message.reply(
        '**OpenClaw Bot Commands:**\n' +
        '`!ping` - Check bot is alive\n' +
        '`!status` - Get bot status\n' +
        '`!help` - Show this help\n' +
        '`!channels` - List available channels'
      );
      break;
    case '!channels':
      const channelList = Object.entries(CHANNELS)
        .map(([name, id]) => `#${name} (<#${id}>)`)
        .join('\n');
      await message.reply(`**Available Channels:**\n${channelList}`);
      break;
    default:
      if (command.startsWith('!')) {
        await message.reply(`Unknown command: ${command}. Try \`!help\``);
      }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN)
  .then(() => console.log('🔑 Bot authenticated successfully'))
  .catch(err => {
    console.error('❌ Bot authentication failed:', err.message);
    process.exit(1);
  });
BOTJS

# Step 6: Install dependencies
echo "Installing npm dependencies..."
npm install

# Step 7: Create systemd service
cat > /etc/systemd/system/openclaw-discord-bot.service << SERVICE
[Unit]
Description=OpenClaw Discord Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$BOT_DIR
ExecStart=/usr/bin/node $BOT_DIR/bot.js
Restart=always
RestartSec=10
EnvironmentFile=$BOT_DIR/.env

[Install]
WantedBy=multi-user.target
SERVICE

# Step 8: Enable and start the service
systemctl daemon-reload
systemctl enable openclaw-discord-bot
systemctl start openclaw-discord-bot

echo ""
echo "=== Deployment Complete ==="
echo "Bot service: openclaw-discord-bot"
echo "Check status: systemctl status openclaw-discord-bot"
echo "View logs: journalctl -u openclaw-discord-bot -f"