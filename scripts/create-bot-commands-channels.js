// ============================================================
// Create #bot-commands channel in all servers
// ============================================================
const https = require('https');

const SERVER_MAP = {
  'Openclaw-comms': '1481205775710949428',
  'VOICE-COMM': '1500106236669071534',
  'PROCURE-TEST': '1500115728769093632',
  'PROCUREMENT-BIDDING': '1500116207552954540',
  'SAFETY': '1500117103817134131',
  'ELEC-TEST': '1500117452238098554',
  'ELEC-PROJECTS': '1500129930053161010',
  'QS-TEST': '1500129675916214486',
  'CONTRACTS-QS': '1500130883154219258',
  'MEASUREMENT': '1500131294879809696',
  'LOGIS-TEST': '1500131631833288926',
  'LOGISTICS': '1500131961761566851',
  'ENGINEERING': '1500132315949699177',
  'ALL-DISCIPLINES': '1500134557649731634'
};

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN environment variable is not set.');
  console.error('   Set it with: export DISCORD_BOT_TOKEN="your-token-here"');
  process.exit(1);
}

function discordApiRequest(endpoint, method, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10${endpoint}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${token}`
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

async function createBotCommandsChannels() {
  console.log('Creating #bot-commands channels in all servers...\n');

  for (const [serverName, guildId] of Object.entries(SERVER_MAP)) {
    // First check if channel already exists
    try {
      const channels = await discordApiRequest(`/guilds/${guildId}/channels`, 'GET');
      const existing = Array.isArray(channels) ? channels.find(c => c.name === 'bot-commands') : null;
      
      if (existing) {
        console.log(`✅ ${serverName}: #bot-commands already exists (${existing.id})`);
        continue;
      }

      // Find the position for the channel (after ai-work if it exists)
      const aiWorkChannel = Array.isArray(channels) ? channels.find(c => c.name === 'ai-work') : null;
      const position = aiWorkChannel ? aiWorkChannel.position + 1 : 0;

      const result = await discordApiRequest(`/guilds/${guildId}/channels`, 'POST', {
        name: 'bot-commands',
        type: 0,
        topic: '🤖 Bot command reference — type anything here to see all available commands. Use !help for the full list.',
        position: position
      });

      if (result.id) {
        console.log(`✅ ${serverName}: Created #bot-commands (${result.id})`);
      } else {
        console.log(`❌ ${serverName}: Failed - ${result.message || JSON.stringify(result)}`);
      }
    } catch (err) {
      console.log(`❌ ${serverName}: Error - ${err.message}`);
    }

    // Rate limit: wait 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\nDone!');
}

createBotCommandsChannels().catch(console.error);