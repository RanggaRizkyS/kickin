const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Events } = require('discord.js');
const config = require('./config');
const { connect, close } = require('./db');
const handleInteraction = require('./handlers/interaction-create');

async function main() {
  if (!config.discord.token || !config.discord.clientId) {
    throw new Error('DISCORD_TOKEN dan DISCORD_CLIENT_ID wajib diatur pada file .env.');
  }

  await connect();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = new Collection();
  const commandDir = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandDir).filter(file => file.endsWith('.js')).sort();
  for (const file of files) {
    const command = require(path.join(commandDir, file));
    if (!command.data?.name || typeof command.execute !== 'function') {
      console.warn(`[COMMAND] Lewati ${file}: data atau execute tidak valid.`);
      continue;
    }
    client.commands.set(command.data.name, command);
  }

  client.once(Events.ClientReady, readyClient => {
    console.log(`[DISCORD] Login sebagai ${readyClient.user.tag}`);
    console.log(`[DISCORD] ${client.commands.size} slash command dimuat.`);
  });

  client.on(Events.InteractionCreate, interaction => {
    handleInteraction(interaction, client).catch(error => console.error('[INTERACTION]', error));
  });

  const shutdown = async signal => {
    console.log(`[APP] ${signal} diterima, mematikan bot…`);
    client.destroy();
    await close().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await client.login(config.discord.token);
}

main().catch(error => {
  console.error('[FATAL]', error);
  process.exitCode = 1;
});
