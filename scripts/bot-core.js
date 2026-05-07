// ============================================================
// BOT CORE — Logic module (config, API, helpers, message handler)
// ============================================================
// ============================================================
// GLOBAL ERROR HANDLERS — prevent Node.js crash on thrown rejections
// ============================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[FATAL] Unhandled Rejection at: ${promise}\n  Reason: ${reason?.stack || reason}`);
});
process.on('uncaughtException', (err) => {
  console.error(`[FATAL] Uncaught Exception: ${err?.stack || err}`);
});
const { Client, Events, ChannelType } = require('discord.js');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const { SERVER_MAP, AGENT_REGISTRY } = require('./bot-registry');
const { ISSUE_CHANNELS } = require('./bot-channels');

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  openclawApiBase: process.env.OPENCLAW_API_BASE || 'http://localhost:8080',
  openclawApiKey: process.env.OPENCLAW_API_KEY || '',
  discordToken: process.env.DISCORD_BOT_TOKEN || '',
  maxSubAgentsPerWork: 10,
  workChannelCategoryName: 'WORKSPACES',
  workChannelInactiveMinutes: 60,
  maxConcurrentWorks: parseInt(process.env.MAX_CONCURRENT_WORKS || '1', 10),
  knowledgeRepoPath: process.env.KNOWLEDGE_REPO_PATH || '/root/docs-companies-agents-knowledge',
  botLogPath: process.env.BOT_LOG_PATH || '/root/.pm2/logs/bot-out.log',
};

// ============================================================
// IN-MEMORY STATE
// ============================================================
const activeWorks = {};
const completedWorks = [];

// ============================================================
// CHANNEL TYPE INFERENCE
// ============================================================
function getChannelType(name) {
  if (name === 'ai-work') return 'control';
  if (name === 'project-log') return 'log';
  if (name === 'project-ops') return 'ops';
  if (name.startsWith('work-')) return 'work';
  if (['deployments', 'monitoring', 'security', 'operations', 'agent-commands', 'voice-comm', 'bot-commands'].includes(name)) return 'system';
  return 'issue';
}

function getReplyMode(type) {
  switch (type) {
    case 'control': return 'direct';
    case 'log': return 'agent-write';
    case 'ops': return 'direct';
    case 'work': return 'direct';
    case 'system': return 'agent-write';
    case 'issue': return 'cross-ref';
    default: return 'direct';
  }
}

// ============================================================
// DYNAMIC CHANNEL MAP — Built at startup from Discord guilds
// FIX: Mutates the module-scoped CHANNEL_MAP in-place so that
// all references (including destructured imports in bot.js)
// stay connected. Do NOT reassign CHANNEL_MAP or return a new obj.
// ============================================================
let CHANNEL_MAP = {};

function buildChannelMap(client) {
  // Clear existing entries in-place
  Object.keys(CHANNEL_MAP).forEach(key => delete CHANNEL_MAP[key]);

  const guilds = client.guilds.cache;

  for (const [id, info] of Object.entries(ISSUE_CHANNELS)) {
    let agentDisplay = info.agent;
    let agentRole = '';
    let agentSlug = info.agentSlug || null;

    if (agentSlug && AGENT_REGISTRY[agentSlug]) {
      agentDisplay = AGENT_REGISTRY[agentSlug].display;
      agentRole = AGENT_REGISTRY[agentSlug].role;
    } else if (info.agent) {
      agentDisplay = info.agent;
    }

    CHANNEL_MAP[id] = {
      ...info,
      type: 'issue',
      reply_mode: 'cross-ref',
      agentDisplay,
      agentRole,
      agentSlug
    };
  }

  guilds.forEach(guild => {
    const serverName = guild.name;
    guild.channels.cache.forEach(channel => {
      if (channel.type !== ChannelType.GuildText) return;
      const name = channel.name;
      const type = getChannelType(name);
      if (type === 'issue') return;

      let purpose = '';
      switch (type) {
        case 'control': purpose = 'Agent command hub'; break;
        case 'log': purpose = 'Agent output log'; break;
        case 'ops': purpose = 'Operations channel'; break;
        case 'work': purpose = 'Ephemeral work channel'; break;
        case 'system': purpose = 'System channel'; break;
      }

      CHANNEL_MAP[channel.id] = {
        server: serverName,
        name: name,
        agent: null,
        agentDisplay: null,
        agentRole: null,
        purpose: purpose,
        type: type,
        reply_mode: getReplyMode(type)
      };
    });
  });
}

let rebuildTimeout = null;
function scheduleRebuildChannelMap(client, delayMs = 3000) {
  if (rebuildTimeout) clearTimeout(rebuildTimeout);
  rebuildTimeout = setTimeout(() => {
    buildChannelMap(client);
    console.log(`🔄 Channel map rebuilt: ${Object.keys(CHANNEL_MAP).length} channels`);
    rebuildTimeout = null;
  }, delayMs);
}

// ============================================================
// HELPERS: Find channels
// ============================================================
function findChannelByType(server, type) {
  return Object.entries(CHANNEL_MAP).find(
    ([id, info]) => info.server === server && info.type === type
  );
}

function findChannelByName(server, name) {
  return Object.entries(CHANNEL_MAP).find(
    ([id, info]) => info.server === server && info.name === name
  );
}

// ============================================================
// OPENCLAW GATEWAY API
// ============================================================
function openclawApiRequest(endpoint, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, CONFIG.openclawApiBase);
    const isHttp = url.protocol === 'http:';
    const lib = isHttp ? http : https;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttp ? 80 : 443),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.openclawApiKey}`
      }
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function spawnSubAgents(issueId, serverName, count = 5) {
  try {
    const response = await openclawApiRequest('/api/agents/spawn', 'POST', {
      task: issueId,
      server: serverName,
      count: Math.min(count, CONFIG.maxSubAgentsPerWork),
      model: process.env.SUB_AGENT_MODEL || 'deepseek/deepseek-chat'
    });
    console.log(`🤖 [SPAWN] Spawned ${response.spawned || '?'} sub-agents for ${issueId}`);
    return response;
  } catch (err) {
    console.log(`⚠️ [SPAWN] Gateway not available for ${issueId}: ${err.message}`);
    return { spawned: 0, error: err.message };
  }
}

// ============================================================
// DISCORD API — REST calls
// ============================================================
function discordApiRequest(endpoint, method, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10${endpoint}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${CONFIG.discordToken}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================
// EPHEMERAL WORK CHANNEL — Create
// ============================================================
async function createWorkChannel(client, guildId, serverName, issueId, customName = null) {
  const channelName = customName || `work-${issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

  const existing = findChannelByName(serverName, channelName);
  if (existing) {
    const [existingId] = existing;
    console.log(`📋 [WORK] Channel #${channelName} already exists (${existingId}) — reusing`);
    return existingId;
  }

  for (const [chId, work] of Object.entries(activeWorks)) {
    if (work.issueId === issueId && work.server === serverName) {
      console.log(`📋 [WORK] Active session exists for ${issueId} — reusing channel ${chId}`);
      return chId;
    }
  }

  let categoryId = null;
  const guild = client.guilds.cache.get(guildId);
  if (guild) {
    const category = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildCategory && ch.name === CONFIG.workChannelCategoryName
    );
    if (category) categoryId = category.id;
  }

  try {
    let agentDetails = '';
    const issueChannelEntry = Object.entries(ISSUE_CHANNELS).find(([id, info]) => info.purpose === issueId);
    if (issueChannelEntry) {
      const agentSlug = issueChannelEntry[1].agentSlug;
      if (agentSlug && AGENT_REGISTRY[agentSlug]) {
        const agent = AGENT_REGISTRY[agentSlug];
        agentDetails = ` — Agent: ${agent.display} (${agent.role})`;
      }
    }

    const result = await discordApiRequest(`/guilds/${guildId}/channels`, 'POST', {
      name: channelName,
      type: 0,
      parent_id: categoryId,
      topic: `Active work session for ${issueId}${agentDetails} — spawned sub-agents working in parallel.`
    });

    if (result.id) {
      console.log(`📋 [WORK] Created work channel #${channelName} (${result.id}) in ${serverName}`);
      return result.id;
    } else {
      console.error(`❌ [WORK] Failed to create channel: ${result.message}`);
      return null;
    }
  } catch (err) {
    console.error(`❌ [WORK] Error creating channel: ${err.message}`);
    return null;
  }
}

// ============================================================
// EPHEMERAL WORK CHANNEL — Archive
// ============================================================
async function archiveWorkChannel(client, guildId, channelId) {
  try {
    const result = await discordApiRequest(`/channels/${channelId}`, 'PATCH', {
      name: `archived-${CHANNEL_MAP[channelId]?.name || channelId}`,
      topic: 'Archived work session — sub-agents completed.',
      position: 999
    });
    console.log(`📦 [ARCHIVE] Archived work channel ${channelId}`);
    return result;
  } catch (err) {
    console.error(`❌ [ARCHIVE] Error archiving channel: ${err.message}`);
  }
}

// ============================================================
// POST TO PROJECT-LOG
// ============================================================
async function postToProjectLog(client, serverName, content) {
  const logEntry = findChannelByType(serverName, 'log');
  if (logEntry) {
    const [logId] = logEntry;
    const channel = client.channels.cache.get(logId);
    if (channel) await channel.send(content);
  }
}

// ============================================================
// POST TO ISSUE CHANNEL
// ============================================================
async function postToIssueChannel(client, serverName, issueId, content) {
  const issueEntry = Object.entries(CHANNEL_MAP).find(
    ([id, info]) => info.server === serverName && info.purpose === issueId
  ) || Object.entries(CHANNEL_MAP).find(
    ([id, info]) => info.server === 'ALL-DISCIPLINES' && issueId.startsWith(info.purpose.split('-')[0])
  );
  if (issueEntry) {
    const [issueChannelId] = issueEntry;
    const channel = client.channels.cache.get(issueChannelId);
    if (channel) {
      await channel.send(content);
      console.log(`📨 [ISSUE] Posted to #${CHANNEL_MAP[issueChannelId]?.name} (${serverName}/${issueId})`);
      return true;
    }
  }
  console.log(`⚠️ [ISSUE] No issue channel found for ${issueId} in ${serverName}`);
  return false;
}

// ============================================================
// WORK SESSION COMPLETION
// ============================================================
async function completeWork(client, workChannelId, serverName, issueId) {
  const workInfo = activeWorks[workChannelId];
  if (!workInfo) return;

  workInfo.status = 'completed';

  let agentInfo = '';
  if (workInfo.agentDisplay) {
    agentInfo = `\n🤖 Agent: **${workInfo.agentDisplay}**`;
    if (workInfo.agentRole) agentInfo += ` (${workInfo.agentRole})`;
  }

  const duration = Math.round((Date.now() - workInfo.startedAt) / 1000 / 60);
  await postToProjectLog(client, serverName,
    `📋 **Work Complete: ${issueId}**${agentInfo}\n` +
    `📅 Duration: ${duration} minutes\n` +
    `🤖 Sub-agents: ${workInfo.subAgentCount}\n` +
    `✅ Status: Completed`
  );

  completedWorks.push({ issueId, server: serverName, completedAt: Date.now(), duration, agentDisplay: workInfo.agentDisplay });

  setTimeout(async () => {
    const guildId = SERVER_MAP[serverName];
    if (guildId) await archiveWorkChannel(client, guildId, workChannelId);
    delete activeWorks[workChannelId];
  }, 60000);

  const controlEntry = findChannelByType(serverName, 'control');
  if (controlEntry) {
    const [controlId] = controlEntry;
    const channel = client.channels.cache.get(controlId);
    if (channel) {
      await channel.send(`✅ **Work completed for ${issueId}** — sub-agents finished. Check #project-log for summary.`);
    }
  }
}

// ============================================================
// MESSAGE HANDLER — Channel-type-aware dispatch
// ============================================================
function setupMessageHandler(client) {
  console.log(`📨 [DEBUG] Setting up MessageCreate handler...`);

  client.on(Events.MessageCreate, async (message) => {
    try {
      // DEBUG: Log ALL messages to see if handler is triggered
      console.log(`📨 [MSG] ${message.author.username} in #${message.channel?.name || message.channelId} (${message.channelId}): ${message.content.substring(0, 50)}`);

      if (message.author.bot) {
        console.log(`📨 [MSG] Ignoring bot message`);
        return;
      }

      const channelId = message.channel?.id || message.channelId;
    let channelInfo = CHANNEL_MAP[channelId];

    // ── SELF-HEAL: if channel not in map but exists in guild, rebuild map on demand ──
    if (!channelInfo) {
      console.log(`📨 [MSG] No channelInfo for ${channelId} — CHANNEL_MAP has ${Object.keys(CHANNEL_MAP).length} entries — attempting live lookup`);
      const guildChannel = client.channels.cache.get(channelId);
      if (guildChannel && guildChannel.guild) {
        const guildName = guildChannel.guild.name;
        const channelName = guildChannel.name;
        const chanType = getChannelType(channelName);
        channelInfo = {
          server: guildName,
          name: channelName,
          agent: null,
          agentDisplay: null,
          agentRole: null,
          purpose: chanType === 'control' ? 'Agent command hub' : '',
          type: chanType,
          reply_mode: getReplyMode(chanType)
        };
        // Cache it for future messages
        CHANNEL_MAP[channelId] = channelInfo;
        console.log(`📨 [MSG] Live-looked up #${channelName} in ${guildName} as type=${chanType} — added to CHANNEL_MAP`);
      } else {
        console.log(`📨 [MSG] Cannot find channel ${channelId} in any guild`);
        return;
      }
    }

    const { type, server, name, purpose, agentDisplay } = channelInfo;

    // ── SYSTEM CHANNELS (agent-commands / bot-commands) ──
    if (type === 'system') {
      if (name === 'agent-commands' || name === 'bot-commands') {
        const args = message.content.split(' ');
        const command = args[0].toLowerCase();

        // ── COMMAND REFERENCE (shown on any input in #bot-commands) ──
        function getCommandReference() {
          return (
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            '        🤖 **OpenClaw Bot Commands**\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            '**🔧 Work Management**\n' +
            '`@agent work on {issue-id}` — Start work on an issue\n' +
            '`@agent work on {a}, {b}` — Start work on multiple issues\n' +
            '`@agent plan {issue-id}` — Plan work for an issue\n' +
            '`!cancel {issue-id}` — Cancel a running work session\n' +
            '`!done` or `!complete` — Finish work (in work channels)\n' +
            '`!progress {issue-id}` — Show progress of a work session\n' +
            '`!works` — List all active work sessions\n' +
            '`!recent` — Show recently completed work\n' +
            '`!next` — Show next batch of issues to dispatch\n' +
            '`!gate {project}` — Show gate/tier status for a project\n\n' +
            '**🔍 Discovery**\n' +
            '`!whois {issue-id}` — Find which channel/agent handles an issue\n' +
            '`!channels` — List all channels with agent assignments\n' +
            '`!whoami` — Show this channel type and assignment\n' +
            '`!taxonomy` — Show channel type breakdown\n' +
            '`!search {term}` — Search the knowledge repo for docs\n\n' +
            '**📊 Status & Monitoring**\n' +
            '`!status` — Show all servers, channels, and active works\n' +
            '`!ping` — Check if the bot is alive\n' +
            '`!log [lines]` — Show recent bot logs (default 20)\n\n' +
            '**🚀 Operations**\n' +
            '`!deploy` — Pull latest code from GitHub and restart bot\n' +
            '`!backup` — Backup the database\n' +
            '`!purge` — Clean up archived work channels\n' +
            '`!echo {channel} {msg}` — Send an announcement to a channel\n\n' +
            '**💡 Tips**\n' +
            '• Commands work in `#bot-commands`, `#agent-commands`, and `#ai-work`\n' +
            '• Only **1 concurrent work session** allowed at a time\n' +
            '• Work channels auto-archive after 60 minutes of inactivity\n' +
            '• Type `!help` to see this reference again\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
          );
        }

        // ── In #bot-commands, show command reference for any unrecognized input ──
        if (name === 'bot-commands' && !command.startsWith('!') && !command.startsWith('@')) {
          await message.reply(getCommandReference());
          return;
        }

        switch (command) {
          case '!ping':
            await message.reply('🏓 Pong! Bot is online.');
            break;

          case '!status': {
            const guilds = client.guilds.cache;
            let status = '🟢 **OpenClaw Bot Status**\n\n';
            status += `**Servers (${guilds.size}):**\n`;
            guilds.forEach(g => {
              const serverChannels = Object.values(CHANNEL_MAP).filter(c => c.server === g.name);
              const agentCh = serverChannels.filter(c => c.agentDisplay !== null).length;
              const byType = {};
              serverChannels.forEach(ch => { byType[ch.type] = (byType[ch.type] || 0) + 1; });
              const typeSummary = Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' ');
              status += `  • **${g.name}** — ${agentCh} agent channels (${typeSummary})\n`;
            });
            status += `\n**Total channels:** ${Object.keys(CHANNEL_MAP).length}`;
            if (Object.keys(activeWorks).length > 0) {
              status += `\n**Active works:** ${Object.keys(activeWorks).length}`;
            }
            await message.reply(status);
            break;
          }

          case '!help':
            await message.reply(getCommandReference());
            break;

          case '!channels': {
            let reply = '**All Agent Channels:**\n';
            for (const [id, info] of Object.entries(CHANNEL_MAP)) {
              if (info.agentDisplay) {
                const agentInfo = info.agentSlug && AGENT_REGISTRY[info.agentSlug]
                  ? `**${info.agentDisplay}** (${info.agentRole})`
                  : info.agentDisplay;
                reply += `  • **${info.server}/#${info.name}** → ${agentInfo} — ${info.purpose} [${info.type}]\n`;
              }
            }
            await message.reply(reply);
            break;
          }

          case '!whoami': {
            const thisChannel = CHANNEL_MAP[message.channelId];
            if (thisChannel && thisChannel.agentDisplay) {
              const agentInfo = thisChannel.agentSlug && AGENT_REGISTRY[thisChannel.agentSlug]
                ? `**${thisChannel.agentDisplay}** (${thisChannel.agentRole})`
                : thisChannel.agentDisplay;
              await message.reply(`This channel is assigned to ${agentInfo} for **${thisChannel.purpose}**.`);
            } else {
              await message.reply(`This is a **${thisChannel ? thisChannel.type : 'unknown'}** channel.`);
            }
            break;
          }

          case '!taxonomy': {
            const byType = {};
            Object.values(CHANNEL_MAP).forEach(ch => {
              if (!byType[ch.type]) byType[ch.type] = [];
              byType[ch.type].push(ch);
            });
            let reply = '📊 **Channel Taxonomy Breakdown**\n\n';
            for (const [type, channels] of Object.entries(byType)) {
              reply += `**${type}** (${channels.length}):\n`;
              channels.slice(0, 5).forEach(ch => {
                reply += `  • ${ch.server}/#${ch.name}\n`;
              });
              if (channels.length > 5) reply += `  • ... and ${channels.length - 5} more\n`;
              reply += '\n';
            }
            await message.reply(reply);
            break;
          }

          case '!works': {
            if (Object.keys(activeWorks).length === 0) {
              await message.reply('No active work sessions.');
              return;
            }
            let reply = '🔧 **Active Work Sessions**\n\n';
            for (const [channelId, work] of Object.entries(activeWorks)) {
              const elapsed = Math.round((Date.now() - work.startedAt) / 1000 / 60);
              reply += `  • **${work.issueId}** — ${elapsed}m — ${work.subAgentCount} sub-agents — ${work.status}\n`;
            }
            await message.reply(reply);
            break;
          }

          case '!cancel': {
            const cancelArg = args.find(a => a.includes('-') && a.match(/^[A-Z]+-/));
            if (cancelArg) {
              const targetIssue = cancelArg.replace('#', '').toUpperCase();
              let found = false;
              for (const [chId, work] of Object.entries(activeWorks)) {
                if (work.issueId === targetIssue && work.server === server) {
                  work.status = 'completed';
                  await completeWork(client, chId, work.server, work.issueId);
                  await message.reply(`🛑 **Cancelled work for ${targetIssue}**`);
                  found = true;
                  break;
                }
              }
              if (!found) await message.reply(`❌ No active work found for ${targetIssue}. Use \`!works\` to see active sessions.`);
            } else {
              await message.reply('Usage: `!cancel {issue-id}` (e.g., `!cancel PROD-001`)');
            }
            break;
          }

          case '!whois': {
            const whoisArg = args.find(a => a.includes('-') && a.match(/^[A-Z]+-/));
            if (whoisArg) {
              const targetIssue = whoisArg.replace('#', '').toUpperCase();
              const entry = Object.entries(ISSUE_CHANNELS).find(([id, info]) => info.purpose === targetIssue);
              if (entry) {
                const [channelId, info] = entry;
                const agentInfo = info.agentSlug && AGENT_REGISTRY[info.agentSlug]
                  ? `**${AGENT_REGISTRY[info.agentSlug].display}** (${AGENT_REGISTRY[info.agentSlug].role})`
                  : info.agent || 'Unknown';
                await message.reply(
                  `🔍 **${targetIssue}**\n` +
                  `📌 Channel: **${info.server}/#${info.name}**\n` +
                  `🤖 Agent: ${agentInfo}\n` +
                  `🔗 <#${channelId}>`
                );
              } else {
                await message.reply(`❌ No channel found for ${targetIssue}.`);
              }
            } else {
              await message.reply('Usage: `!whois {issue-id}` (e.g., `!whois PROD-001`)');
            }
            break;
          }

          case '!search': {
            const searchTerm = args.slice(1).join(' ');
            if (!searchTerm) {
              await message.reply('Usage: `!search {term}` (e.g., `!search procurement`)');
              break;
            }
            await message.reply(`🔍 Searching knowledge repo for **"${searchTerm}"**...`);
            try {
              const result = execSync(
                `grep -ril "${searchTerm}" ${CONFIG.knowledgeRepoPath} --include="*.md" 2>/dev/null | head -10`,
                { timeout: 10000 }
              ).toString().trim();
              if (result) {
                const files = result.split('\n').map(f => f.replace(CONFIG.knowledgeRepoPath + '/', '')).join('\n');
                await message.reply(`📚 **Results for "${searchTerm}":**\n\`\`\`\n${files}\n\`\`\``);
              } else {
                await message.reply(`❌ No results found for "${searchTerm}".`);
              }
            } catch (err) {
              await message.reply(`⚠️ Search failed: ${err.message}`);
            }
            break;
          }

          case '!log': {
            const lines = parseInt(args[1]) || 20;
            try {
              const result = execSync(
                `tail -${lines} ${CONFIG.botLogPath} 2>/dev/null || echo "Log file not found"`,
                { timeout: 5000 }
              ).toString().trim();
              const truncated = result.length > 1900 ? result.substring(result.length - 1900) : result;
              await message.reply(`📋 **Last ${lines} log lines:**\n\`\`\`\n${truncated}\n\`\`\``);
            } catch (err) {
              await message.reply(`⚠️ Could not read logs: ${err.message}`);
            }
            break;
          }

          case '!recent': {
            if (completedWorks.length === 0) {
              await message.reply('No completed work sessions recorded.');
              break;
            }
            let reply = '📋 **Recently Completed Work**\n\n';
            const recent = completedWorks.slice(-10).reverse();
            recent.forEach(w => {
              const timeAgo = Math.round((Date.now() - w.completedAt) / 1000 / 60);
              reply += `  • **${w.issueId}** — ${timeAgo}m ago — ${w.duration}m — ${w.agentDisplay || 'Unknown'}\n`;
            });
            await message.reply(reply);
            break;
          }

          case '!next': {
            await message.reply(
              '📋 **Next Batch to Dispatch**\n\n' +
              'Based on the wave plan, the next issues are:\n' +
              '`@agent work on PROD-001, PROD-002 in #ai-work`\n\n' +
              'See `disciplines-orchestration/prompts/00000-PROD-TEST.md` for full details.'
            );
            break;
          }

          case '!gate': {
            const projectArg = args[1] ? args[1].toUpperCase() : 'PROD-TEST';
            await message.reply(
              `🚧 **${projectArg} Gate Status**\n\n` +
              `**Tier 1** — Basic Page Rendering: ⏳ Pending\n` +
              `**Tier 2** — Component Rendering: ⏳ Pending\n` +
              `**Tier 3** — Chatbot Testing: ⏳ Pending\n` +
              `**Tier 4** — Full Integration: ⏳ Pending\n\n` +
              `Use \`!works\` to see active sessions.`
            );
            break;
          }

          case '!progress': {
            const progressArg = args.find(a => a.includes('-') && a.match(/^[A-Z]+-/));
            if (progressArg) {
              const targetIssue = progressArg.replace('#', '').toUpperCase();
              let found = false;
              for (const [chId, work] of Object.entries(activeWorks)) {
                if (work.issueId === targetIssue) {
                  const elapsed = Math.round((Date.now() - work.startedAt) / 1000 / 60);
                  await message.reply(
                    `📊 **Progress: ${targetIssue}**\n` +
                    `⏱️ Elapsed: ${elapsed}m\n` +
                    `🤖 Sub-agents: ${work.subAgentCount}\n` +
                    `📌 Status: ${work.status}\n` +
                    `🤖 Agent: ${work.agentDisplay || 'Unknown'}\n` +
                    `🔗 <#${chId}>`
                  );
                  found = true;
                  break;
                }
              }
              if (!found) await message.reply(`❌ No active work for ${targetIssue}.`);
            } else {
              await message.reply('Usage: `!progress {issue-id}` (e.g., `!progress PROD-001`)');
            }
            break;
          }

          case '!echo': {
            const targetChannel = args[1];
            const echoMessage = args.slice(2).join(' ');
            if (!targetChannel || !echoMessage) {
              await message.reply('Usage: `!echo {channel-name} {message}` (e.g., `!echo project-log Hello world`)');
              break;
            }
            const channelEntry = findChannelByName(server, targetChannel.replace(/^#/, ''));
            if (channelEntry) {
              const [channelId] = channelEntry;
              const channel = client.channels.cache.get(channelId);
              if (channel) {
                await channel.send(`📢 **Announcement:** ${echoMessage}`);
                await message.reply(`✅ Echoed to **#${targetChannel}**.`);
              }
            } else {
              await message.reply(`❌ Channel #${targetChannel} not found.`);
            }
            break;
          }

          case '!purge': {
            let purged = 0;
            for (const [chId, work] of Object.entries(activeWorks)) {
              if (work.status === 'completed' || work.status === 'inactive') {
                const guildId = SERVER_MAP[work.server];
                if (guildId) {
                  await archiveWorkChannel(client, guildId, chId);
                  purged++;
                }
                delete activeWorks[chId];
              }
            }
            await message.reply(`🧹 **Purged ${purged} archived work channels.**`);
            break;
          }

          case '!deploy': {
            await message.reply('🚀 **Deploying...**\n`git pull` + `copy scripts` + `pm2 restart`');
            try {
              const OPS_DIR = '/root/docs-companies-agents-ops';
              const BOT_DIR = '/opt/openclaw-discord-bot';

              // Clone ops repo if not present
              let pullResult;
              if (require('fs').existsSync(`${OPS_DIR}/.git`)) {
                pullResult = execSync(`cd ${OPS_DIR} && git pull origin main 2>&1`, { timeout: 30000 }).toString().trim();
              } else {
                require('fs').mkdirSync(OPS_DIR, { recursive: true });
                pullResult = execSync(
                  `git clone https://github.com/Construct-AI-primary/docs-companies-agents-ops.git ${OPS_DIR} 2>&1`,
                  { timeout: 60000 }
                ).toString().trim();
              }

              // Copy updated scripts to bot directory
              execSync(`cp -f ${OPS_DIR}/scripts/task-worker.js ${BOT_DIR}/task-worker.js 2>&1`, { timeout: 5000 });
              execSync(`cp -f ${OPS_DIR}/scripts/bot-core.js ${BOT_DIR}/bot-core.js 2>&1`, { timeout: 5000 });
              execSync(`cp -f ${OPS_DIR}/scripts/bot.js ${BOT_DIR}/bot.js 2>&1`, { timeout: 5000 });
              execSync(`cp -f ${OPS_DIR}/scripts/bot-channels.js ${BOT_DIR}/bot-channels.js 2>&1`, { timeout: 5000 });
              execSync(`cp -f ${OPS_DIR}/scripts/bot-registry.js ${BOT_DIR}/bot-registry.js 2>&1`, { timeout: 5000 });

              // Install dependencies
              execSync(`cd ${BOT_DIR} && npm install 2>&1`, { timeout: 60000 });

              // Restart bot and worker
              execSync('pm2 restart bot 2>&1', { timeout: 10000 });
              let workerResult = '';
              try {
                execSync('pm2 restart worker 2>&1', { timeout: 10000 });
                workerResult = ' + worker';
              } catch {
                execSync('pm2 start /opt/openclaw-discord-bot/task-worker.js --name worker 2>&1', { timeout: 10000 });
                workerResult = ' + worker (new)';
              }

              await message.reply(
                `✅ **Deploy Complete**\n` +
                `\`\`\`\n${pullResult.split('\n').slice(-2).join('\n')}\n\`\`\`\n` +
                `🔄 Bot${workerResult} restarted.`
              );
            } catch (err) {
              await message.reply(`❌ **Deploy failed:** ${err.message}`);
            }
            break;
          }

          case '!backup': {
            await message.reply('💾 **Backing up database...**');
            try {
      const result = execSync(
        'cp /opt/docs-companies-agents-ops/schema/openclaw-app.db /opt/docs-companies-agents-ops/schema/openclaw-app.db.backup.$(date +%Y%m%d-%H%M%S) 2>&1 && echo "Backup created"',
        { timeout: 10000 }
      ).toString().trim();
              await message.reply(`✅ **Database backup complete:** ${result}`);
            } catch (err) {
              await message.reply(`❌ **Backup failed:** ${err.message}`);
            }
            break;
          }

          default:
            if (command.startsWith('!')) {
              await message.reply(`Unknown command: ${command}. Try \`!help\``);
            }
        }
      }
      return;
    }

    // ── CONTROL CHANNELS (#ai-work) ──
    if (type === 'control') {
      const content = message.content;
      const isAgentMention = message.mentions.users.has(client.user.id);
      const hasAnyRoleMention = message.mentions.roles.size > 0;
      const startsWithExclamation = content.startsWith('!');
      const hasAgentText = content.toLowerCase().includes('@agent');
      const isCommand = startsWithExclamation || hasAnyRoleMention || hasAgentText;

      console.log(`📨 [CONTROL] content="${content.substring(0, 80)}" isAgentMention=${isAgentMention} hasAnyRoleMention=${hasAnyRoleMention} startsWithExclamation=${startsWithExclamation} hasAgentText=${hasAgentText} isCommand=${isCommand}`);

      if (!isAgentMention && !isCommand) return;

      // Strip all mention formats: <@USER_ID>, <@!USER_ID>, <@&ROLE_ID>, and literal @agent
      let cleanContent = content.replace(/<@!?&?[^>]+>/g, '').trim();
      cleanContent = cleanContent.replace(/^@agent\b/i, '').trim();
      const args = cleanContent.split(/\s+/).filter(a => a.length > 0);
      const command = args.length > 0 ? args[0].toLowerCase() : '';

      console.log(`📨 [CONTROL] cleanContent="${cleanContent}" args=[${args.join(', ')}] command="${command}"`);

      // ── !cancel in control channel ──
      if (command === '!cancel') {
        const cancelArg = args.find(a => a.includes('-') && a.match(/^[A-Z]+-/));
        if (cancelArg) {
          const targetIssue = cancelArg.replace('#', '').toUpperCase();
          let found = false;
          for (const [chId, work] of Object.entries(activeWorks)) {
            if (work.issueId === targetIssue && work.server === server) {
              work.status = 'completed';
              await completeWork(client, chId, work.server, work.issueId);
              await message.reply(`🛑 **Cancelled work for ${targetIssue}**`);
              found = true;
              break;
            }
          }
          if (!found) await message.reply(`❌ No active work found for ${targetIssue}. Use \`!works\` to see active sessions.`);
        } else {
          await message.reply('Usage: `!cancel {issue-id}` (e.g., `!cancel PROD-001`)');
        }
        return;
      }

      // ── !whois in control channel ──
      if (command === '!whois') {
        const whoisArg = args.find(a => a.includes('-') && a.match(/^[A-Z]+-/));
        if (whoisArg) {
          const targetIssue = whoisArg.replace('#', '').toUpperCase();
          const entry = Object.entries(ISSUE_CHANNELS).find(([id, info]) => info.purpose === targetIssue);
          if (entry) {
            const [channelId, info] = entry;
            const agentInfo = info.agentSlug && AGENT_REGISTRY[info.agentSlug]
              ? `**${AGENT_REGISTRY[info.agentSlug].display}** (${AGENT_REGISTRY[info.agentSlug].role})`
              : info.agent || 'Unknown';
            await message.reply(
              `🔍 **${targetIssue}**\n` +
              `📌 Channel: **${info.server}/#${info.name}**\n` +
              `🤖 Agent: ${agentInfo}\n` +
              `🔗 <#${channelId}>`
            );
          } else {
            await message.reply(`❌ No channel found for ${targetIssue}.`);
          }
        } else {
          await message.reply('Usage: `!whois {issue-id}` (e.g., `!whois PROD-001`)');
        }
        return;
      }

      // ── !ping in control channel ──
      if (command === '!ping') {
        await message.reply('🏓 Pong! Bot is online.');
        return;
      }

      // ── !status in control channel ──
      if (command === '!status') {
        const guilds = client.guilds.cache;
        let status = '🟢 **OpenClaw Bot Status**\n\n';
        status += `**Servers (${guilds.size}):**\n`;
        guilds.forEach(g => {
          const serverChannels = Object.values(CHANNEL_MAP).filter(c => c.server === g.name);
          const agentCh = serverChannels.filter(c => c.agentDisplay !== null).length;
          const byType = {};
          serverChannels.forEach(ch => { byType[ch.type] = (byType[ch.type] || 0) + 1; });
          const typeSummary = Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' ');
          status += `  • **${g.name}** — ${agentCh} agent channels (${typeSummary})\n`;
        });
        status += `\n**Total channels:** ${Object.keys(CHANNEL_MAP).length}`;
        if (Object.keys(activeWorks).length > 0) {
          status += `\n**Active works:** ${Object.keys(activeWorks).length}`;
        }
        await message.reply(status);
        return;
      }

      // ── !works in control channel ──
      if (command === '!works') {
        if (Object.keys(activeWorks).length === 0) {
          await message.reply('No active work sessions.');
          return;
        }
        let reply = '🔧 **Active Work Sessions**\n\n';
        for (const [channelId, work] of Object.entries(activeWorks)) {
          const elapsed = Math.round((Date.now() - work.startedAt) / 1000 / 60);
          reply += `  • **${work.issueId}** — ${elapsed}m — ${work.subAgentCount} sub-agents — ${work.status}\n`;
        }
        await message.reply(reply);
        return;
      }

      // ── !channels in control channel ──
      if (command === '!channels') {
        let reply = '**All Agent Channels:**\n';
        for (const [id, info] of Object.entries(CHANNEL_MAP)) {
          if (info.agentDisplay) {
            const agentInfo = info.agentSlug && AGENT_REGISTRY[info.agentSlug]
              ? `**${info.agentDisplay}** (${info.agentRole})`
              : info.agentDisplay;
            reply += `  • **${info.server}/#${info.name}** → ${agentInfo} — ${info.purpose} [${info.type}]\n`;
          }
        }
        await message.reply(reply);
        return;
      }

      // ── !log in control channel ──
      if (command === '!log') {
        const lines = parseInt(args[1]) || 20;
        try {
          const result = execSync(
            `tail -${lines} ${CONFIG.botLogPath} 2>/dev/null || echo "Log file not found"`,
            { timeout: 5000 }
          ).toString().trim();
          const truncated = result.length > 1900 ? result.substring(result.length - 1900) : result;
          await message.reply(`📋 **Last ${lines} log lines:**\n\`\`\`\n${truncated}\n\`\`\``);
        } catch (err) {
          await message.reply(`⚠️ Could not read logs: ${err.message}`);
        }
        return;
      }

      if (command === '!help' || (command === '@agent' && args.length === 1)) {
        await message.reply(
          '**Control Channel (#ai-work):**\n' +
          '`@agent work on {issue-id(s)}` — Start work (comma-separated for multiple)\n' +
          '`@agent plan {issue-id}` — Plan work\n' +
          '`@agent status` — Show status\n' +
          '`!help` — Show this\n' +
          '`!ping` — Check bot is alive\n' +
          '`!status` — Show all servers and active works\n' +
          '`!channels` — List all channels with agent assignments\n' +
          '`!whoami` — Show this channel type\n' +
          '`!taxonomy` — Show channel type breakdown\n' +
          '`!works` — List active work sessions\n' +
          '`!cancel {issue-id}` — Cancel a specific work session\n' +
          '`!whois {issue-id}` — Show agent/channel for an issue\n' +
          '`!search {term}` — Search knowledge repo\n' +
          '`!log [lines]` — Show recent bot logs\n' +
          '`!recent` — Show recently completed work\n' +
          '`!next` — Show next batch of issues\n' +
          '`!gate {project}` — Show gate status\n' +
          '`!progress {issue-id}` — Show work progress\n' +
          '`!echo {channel} {message}` — Echo to a channel\n' +
          '`!purge` — Clean up archived channels\n' +
          '`!deploy` — Pull latest code and restart\n' +
          '`!backup` — Backup the database\n' +
          '\n**Channel routing:** Add `in #channel-name` to route output to a specific channel.'
        );
      } else if (command === 'work' || (command.startsWith('@agent') && args.includes('work'))) {
        let targetChannelName = null;
        const inIdx = args.indexOf('in');
        if (inIdx !== -1 && inIdx < args.length - 1) {
          targetChannelName = args[inIdx + 1].replace(/^#/, '');
          args.splice(inIdx, 2);
        }

        const onIdx = args.indexOf('on');
        let issueArgs = [];
        if (onIdx !== -1 && onIdx < args.length - 1) {
          const afterOn = args.slice(onIdx + 1).join(' ');
          issueArgs = afterOn.split(',').map(s => s.trim()).filter(s => s.length > 0);
        } else {
          issueArgs = args.filter(a => a.startsWith('#') || (a.includes('-') && a.match(/^[A-Z]+-/)));
        }

        if (issueArgs.length === 0) {
          await message.reply('Usage: `@agent work on {issue-id}` (e.g., `@agent work on PROCURE-001`)\nFor multiple: `@agent work on PROCURE-001, PROCURE-002`');
          return;
        }

        const issueIds = issueArgs.map(a => a.replace(/^#/, '').replace(/,/g, '').trim().toUpperCase()).filter(a => a.length > 0);

        // ── CONCURRENT WORK LIMIT ──
        const activeCount = Object.values(activeWorks).filter(w => w.status === 'active' || w.status === 'inactive').length;
        if (activeCount >= CONFIG.maxConcurrentWorks) {
          await message.reply(
            `⏸️ **Concurrent work limit reached (${CONFIG.maxConcurrentWorks})**\n` +
            `Complete or cancel existing work first with \`!cancel {issue-id}\`\n` +
            `Use \`!works\` to see active sessions.`
          );
          return;
        }
        // ── END CONCURRENT LIMIT ──

        await message.reply(
          `📋 **Starting work on ${issueIds.length} issue(s)** ...\n` +
          `🔧 Creating work channels...\n` +
          `🤖 Spawning sub-agents...`
        );

        let successCount = 0;
        let failCount = 0;
        const createdChannels = [];

        let sharedChannelId = null;
        if (targetChannelName) {
          const guildId = SERVER_MAP[server];
          if (guildId) {
            sharedChannelId = await createWorkChannel(client, guildId, server, issueIds.join('-'), targetChannelName);
          }
        }

        for (const issueId of issueIds) {
          try {
            const guildId = SERVER_MAP[server];
            if (!guildId) {
              await message.reply(`❌ Unknown server: ${server}`);
              failCount++;
              continue;
            }

            let agentSlug = null;
            let agentDisplay = 'Unknown';
            let agentRole = '';
            let issueChannelEntry = Object.entries(ISSUE_CHANNELS).find(([id, info]) => info.purpose === issueId);
            if (!issueChannelEntry) {
              const prefix = issueId.split('-')[0];
              issueChannelEntry = Object.entries(ISSUE_CHANNELS).find(([id, info]) => {
                const purposePrefix = info.purpose.split('-')[0];
                return purposePrefix === prefix && info.server === server;
              });
            }
            if (issueChannelEntry) {
              agentSlug = issueChannelEntry[1].agentSlug;
              if (agentSlug && AGENT_REGISTRY[agentSlug]) {
                agentDisplay = AGENT_REGISTRY[agentSlug].display;
                agentRole = AGENT_REGISTRY[agentSlug].role;
              }
            }

            const workChannelId = sharedChannelId || await createWorkChannel(client, guildId, server, issueId);
            if (!workChannelId) {
              await message.reply(`❌ Failed to create work channel for ${issueId}. Check bot permissions.`);
              failCount++;
              continue;
            }

            createdChannels.push({ issueId, workChannelId });
            scheduleRebuildChannelMap(client, 2000);

            activeWorks[workChannelId] = {
              issueId, server, status: 'active', subAgentCount: 0, startedAt: Date.now(),
              agentSlug, agentDisplay, agentRole
            };

            const spawnResult = await spawnSubAgents(issueId, server, 5);
            const spawnedCount = spawnResult.spawned || 0;
            activeWorks[workChannelId].subAgentCount = spawnedCount;

            await postToProjectLog(client, server,
              `🔧 **Work Started: ${issueId}**\n` +
              `📅 Started: <t:${Math.floor(Date.now() / 1000)}:R>\n` +
              `🤖 Sub-agents: ${spawnedCount > 0 ? spawnedCount : 'pending gateway config'}\n` +
              `🔗 Work channel: <#${workChannelId}>\n` +
              `🤖 Agent: **${agentDisplay}** (${agentRole})`
            );

            const agentInfo = activeWorks[workChannelId];
            await postToIssueChannel(client, server, issueId,
              `🔧 **Work Started: ${issueId}**\n` +
              `🤖 Agent: **${agentInfo.agentDisplay}** (${agentInfo.agentRole})\n` +
              `📅 Started: <t:${Math.floor(Date.now() / 1000)}:R>\n` +
              `🤖 Sub-agents: ${spawnedCount > 0 ? spawnedCount : 'pending gateway config'}\n` +
              `🔗 Work channel: <#${workChannelId}>\n` +
              `📝 Type \`!done\` in the work channel when complete.`
            );
          } catch (err) {
            console.error(`[SETUP_MESSAGE_HANDLER] Failed for ${issueId}: ${err?.stack || err}`);
            await message.reply(`❌ Failed to process ${issueId}: ${err.message}`);
            failCount++;
            continue;
          }

          successCount++;
        }

        const logChannel = findChannelByType(server, 'log');
        const logMention = logChannel ? `<#${logChannel[0]}>` : '#project-log';

        let summary = `✅ **Work started: ${successCount} success, ${failCount} failed**\n`;
        createdChannels.forEach(({ issueId, workChannelId }) => {
          summary += `🔧 ${issueId}: <#${workChannelId}>\n`;
        });
        summary += `📝 Progress in ${logMention}\n`;
        summary += `\nType \`!done\` in work channels when complete.`;

        await message.reply(summary);
      } else if (command === 'plan') {
        const issueArg = args.find(a => a.startsWith('#') || (a.includes('-') && a.match(/^[A-Z]+-/)));
        if (issueArg) {
          const issueId = issueArg.replace('#', '').toUpperCase();
          await message.reply(
            `📋 **Planning ${issueId}**\n` +
            `🔍 Reading issue context...\n` +
            `📝 Estimated sub-agents needed: 5\n` +
            `Use \`@agent work on ${issueId}\` to begin execution.`
          );
          await postToProjectLog(client, server,
            `📋 **Planning: ${issueId}**\n` +
            `Requested by ${message.author.username}\n` +
            `Awaiting execution command.`
          );
        } else {
          await message.reply('Usage: `@agent plan #{issue-id}` (e.g., `@agent plan PROCURE-007`)');
        }
      }
      return;
    }

    // ── WORK CHANNELS (#work-xxx) ──
    if (type === 'work') {
      const workInfo = activeWorks[message.channelId];
      if (!workInfo) {
        console.log(`⚠️ [WORK] Unknown work channel: ${message.channelId}`);
        return;
      }

      const content = message.content;
      const isAgentMention = message.mentions.users.has(client.user.id);

      // ── !done / !complete / !cancel in work channels (no mention needed) ──
      if (content.toLowerCase().startsWith('!done') || content.toLowerCase().startsWith('!complete')) {
        await message.reply(`🔄 Completing work for **${workInfo.issueId}**...`);
        await completeWork(client, message.channelId, workInfo.server, workInfo.issueId);
        return;
      }

      if (content.toLowerCase().startsWith('!cancel')) {
        workInfo.status = 'cancelled';
        await message.reply(`🛑 **Cancelled ${workInfo.issueId}** — work session ended.`);
        const guildId = SERVER_MAP[workInfo.server];
        if (guildId) await archiveWorkChannel(client, guildId, message.channelId);
        delete activeWorks[message.channelId];
        return;
      }

      // Also handle @agent done/complete (role mention, not just bot user mention)
      const hasAgentRoleMention = message.mentions.roles.some(r => r.name.toLowerCase() === 'agent');
      if (isAgentMention || hasAgentRoleMention) {
        if (content.toLowerCase().includes('done') || content.toLowerCase().includes('complete')) {
          await message.reply(`🔄 Completing work for **${workInfo.issueId}**...`);
          await completeWork(client, message.channelId, workInfo.server, workInfo.issueId);
          return;
        }
      }

      if (isAgentMention) {
        const issueChannel = Object.entries(CHANNEL_MAP).find(
          ([id, info]) => info.server === workInfo.server && info.purpose === workInfo.issueId
        );
        if (issueChannel) {
          const [issueId] = issueChannel;
          const channel = client.channels.cache.get(issueId);
          if (channel) {
            await channel.send(
              `📎 **From #${name}** — Sub-agent update for **${workInfo.issueId}**\n` +
              `> ${content.substring(0, 200)}\n`
            );
          }
        }
      }

      console.log(`🔧 [WORK/${workInfo.issueId}] ${message.author.username}: ${content.substring(0, 100)}`);
      return;
    }

    // ── LOG CHANNELS (#project-log) ──
    if (type === 'log') {
      console.log(`📝 [LOG/${server}] ${message.author.username}: ${message.content.substring(0, 100)}`);
      return;
    }

    // ── OPS CHANNELS (#project-ops) ──
    if (type === 'ops') {
      const content = message.content;
      const isAgentMention = message.mentions.users.has(client.user.id);

      if (isAgentMention) {
        const cleanContent = content.replace(/<@!?\d+>/g, '').trim();
        if (cleanContent.includes('deploy') || cleanContent.includes('restart') || cleanContent.includes('status')) {
          await message.reply(
            `⚙️ **Operations Command Received**\n` +
            `This channel handles infrastructure commands.\n` +
            `For VPS operations, use: \`!deploy\`, \`!backup\`, \`!status\`\n` +
            `(Full integration pending OpenClaw gateway setup)`
          );
        }
      }
      return;
    }

    // ── ISSUE CHANNELS (with agent assignments) ──
    if (type === 'issue' && agentDisplay) {
      const isMentioned = message.mentions.users.has(client.user.id);
      if (isMentioned) {
        const controlEntry = findChannelByType(server, 'control');
        if (controlEntry) {
          const [controlId] = controlEntry;
          const channel = client.channels.cache.get(controlId);
          if (channel) {
            await channel.send(
              `📎 **Cross-reference from #${name}** (${server})\n` +
              `**${message.author.username}** mentioned @agent regarding **${purpose}**:\n` +
              `> ${message.content.substring(0, 200)}\n` +
              `[Jump to message](${message.url})`
            );
          }
        }
        await message.reply(`👋 I see your message in **#${name}**. I'll respond in **#ai-work** on **${server}**.`);
      } else {
        console.log(`👁️ [${server}/#${name}] ${message.author.username}: ${message.content.substring(0, 100)}`);
      }
      return;
    }

    // ── EPHEMERAL / UNCATEGORIZED ──
    console.log(`👁️ [${server}/#${name}] (${type}) ${message.author.username}: ${message.content.substring(0, 100)}`);
    } catch (err) {
      console.error(`[FATAL] Message handler error: ${err?.stack || err}`);
    }
  });
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  CONFIG,
  activeWorks,
  CHANNEL_MAP,
  buildChannelMap,
  scheduleRebuildChannelMap,
  findChannelByType,
  findChannelByName,
  setupMessageHandler,
  completeWork,
  postToProjectLog,
  postToIssueChannel
};