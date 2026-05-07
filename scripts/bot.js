// ============================================================
// BOT ENTRY POINT — Slim module (imports, client setup, login)
// ============================================================
// ============================================================
// GLOBAL ERROR HANDLERS — Must be registered before any async code
// Uses fs.writeSync to ensure logs flush before process exit
// ============================================================
const fs = require('fs');
function logFatal(msg) {
  const line = `[FATAL] ${new Date().toISOString()} ${msg}\n`;
  try { fs.writeSync(2, line); } catch {}
}
process.on('unhandledRejection', (reason) => {
  logFatal(`Unhandled Rejection: ${reason?.stack || reason}`);
});
process.on('uncaughtException', (err) => {
  logFatal(`Uncaught Exception: ${err?.stack || err}`);
});

const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
require('dotenv').config();

const { SERVER_MAP } = require('./bot-registry');
const core = require('./bot-core');
const {
  CONFIG,
  activeWorks,
  buildChannelMap,
  scheduleRebuildChannelMap,
  setupMessageHandler,
  completeWork
} = core;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

// ============================================================
// BOT READY
// ============================================================
client.once(Events.ClientReady, (c) => {
  console.log(`✅ OpenClaw Bot logged in as ${c.user.tag}`);

  // Build the dynamic channel map (mutates CHANNEL_MAP in-place)
  buildChannelMap(c);

  const agentChannels = Object.values(core.CHANNEL_MAP).filter(ch => ch.agentDisplay !== null).length;
  const byType = {};
  Object.values(core.CHANNEL_MAP).forEach(ch => {
    byType[ch.type] = (byType[ch.type] || 0) + 1;
  });

  console.log(`📋 ${Object.keys(core.CHANNEL_MAP).length} channels monitored (${agentChannels} with agent assignments)`);
  console.log(`📊 Channel breakdown: ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', ')}`);

  const controlServers = Object.values(core.CHANNEL_MAP).filter(ch => ch.type === 'control').map(ch => ch.server);
  const uniqueControlServers = [...new Set(controlServers)];
  console.log(`🎮 Control channels (#ai-work) on: ${uniqueControlServers.join(', ') || 'NONE'}`);

  if (CONFIG.openclawApiBase && CONFIG.openclawApiBase !== 'http://localhost:8080') {
    console.log(`🔗 OpenClaw Gateway: ${CONFIG.openclawApiBase}`);
  } else {
    console.log(`🔗 OpenClaw Gateway: NOT CONFIGURED (set OPENCLAW_API_BASE env var to enable sub-agent spawning)`);
  }
});

// ============================================================
// INTERVAL: Clean up stale work channels
// ============================================================
setInterval(() => {
  const now = Date.now();
  for (const [channelId, work] of Object.entries(activeWorks)) {
    if (work.status === 'completed') continue;
    const elapsed = (now - work.startedAt) / 1000 / 60;
    if (elapsed > CONFIG.workChannelInactiveMinutes) {
      console.log(`⏰ [CLEANUP] Work ${work.issueId} inactive for ${Math.round(elapsed)}m — auto-archiving`);
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        work.status = 'inactive';
        completeWork(client, channelId, work.server, work.issueId);
      } else {
        delete activeWorks[channelId];
      }
    }
  }
}, 60000);

// ============================================================
// SETUP MESSAGE HANDLER
// ============================================================
setupMessageHandler(client);

// ============================================================
// LOGIN
// ============================================================
client.login(process.env.DISCORD_BOT_TOKEN)
  .then(() => console.log('🔑 Bot authenticated successfully'))
  .catch(err => {
    console.error('❌ Bot authentication failed:', err.message);
    process.exit(1);
  });