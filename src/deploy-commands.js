const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const config = require('./config');

async function main() {
  if (!config.discord.token || !config.discord.clientId) throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID before deploying commands.');
  const commandDir = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandDir).filter(file => file.endsWith('.js')).sort();
  const body = files.map(file => require(path.join(commandDir, file)).data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const route = config.discord.guildId
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
    : Routes.applicationCommands(config.discord.clientId);
  await rest.put(route, { body });
  console.log(`[DEPLOY] ${body.length} slash commands registered ${config.discord.guildId ? `for guild ${config.discord.guildId}` : 'globally'}.`);
}

main().catch(error => {
  console.error('[DEPLOY ERROR]', error);
  process.exitCode = 1;
});
