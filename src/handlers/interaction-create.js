const { MessageFlags } = require('discord.js');
const { replyError } = require('../utils/commands');
const { handleMatchButton, handleFriendlyButton } = require('./match-flow');
const { handleSquadButton, handleSquadSelect } = require('./squad-ui');
const { handlePlayersSelect, handlePlayerSelect, handlePlayerButton } = require('./player-ui');
const { handleMarketSelect, handleMarketButton } = require('./market-ui');
const { handleRemovePlayerSelect } = require('./squad-ui');
const { handlePackSelect, handlePackButton } = require('./pack-ui');
const playersCommand = require('../commands/players');
const matchlogsCommand = require('../commands/matchlogs');

async function ensureOwner(interaction, ownerId) {
  if (String(interaction.user.id) !== String(ownerId)) {
    await interaction.reply({
      content: 'Panel ini hanya bisa digunakan oleh pemiliknya. Jalankan command terkait untuk membuka panel milikmu.',
      flags: MessageFlags.Ephemeral
    });
    return false;
  }
  return true;
}

module.exports = async function handleInteraction(interaction, client) {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (typeof command?.autocomplete !== 'function') return interaction.respond([]).catch(() => {});
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`[AUTOCOMPLETE /${interaction.commandName}]`, error);
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(`[COMMAND /${interaction.commandName}]`, error);
      await replyError(interaction, error);
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    try {
      const id = interaction.customId;
      if (id.startsWith('squad:')) return await handleSquadSelect(interaction);
      if (id.startsWith('players:choose:')) return await handlePlayersSelect(interaction);
      if (id.startsWith('player:place:')) return await handlePlayerSelect(interaction);
      if (id.startsWith('market:choose:')) return await handleMarketSelect(interaction);
      if (id.startsWith('removeplayer:')) return await handleRemovePlayerSelect(interaction);
      if (id.startsWith('pack:type:') || id.startsWith('pack:quantity:')) return await handlePackSelect(interaction);
    } catch (error) {
      console.error('[SELECT MENU]', error);
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({ content: `⚠️ ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return interaction.reply({ content: `⚠️ ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  if (interaction.isButton()) {
    try {
      const id = interaction.customId;
      if (id.startsWith('match:')) return await handleMatchButton(interaction);
      if (id.startsWith('friendly:')) return await handleFriendlyButton(interaction);

      if (id.startsWith('squad:')) return await handleSquadButton(interaction);
      if (id.startsWith('player:')) return await handlePlayerButton(interaction);
      if (id.startsWith('market:')) return await handleMarketButton(interaction);
      if (id.startsWith('pack:')) return await handlePackButton(interaction);
      if (id.startsWith('matchlogs:')) return await matchlogsCommand.handleMatchLogsButton(interaction);

      if (id.startsWith('players:')) {
        const [, action, ownerId, pageText] = id.split(':');
        if (!await ensureOwner(interaction, ownerId)) return;
        await interaction.deferUpdate();
        const page = Math.max(1, Number(pageText) || 1);
        const user = await require('../services/users').getUserByDiscordId(interaction.user.id);
        if (!user) return interaction.editReply({ content: 'Jalankan `/start` terlebih dahulu.', components: [] });
        const result = await playersCommand.buildPage(
          Number(user.id),
          page,
          interaction.user.globalName || interaction.user.username,
          interaction.user.id
        );
        return interaction.editReply({
          embeds: [result.embed],
          files: result.file ? [result.file] : [],
          attachments: [],
          components: result.components
        });
      }
    } catch (error) {
      console.error('[BUTTON]', error);
      if (interaction.deferred || interaction.replied) return interaction.followUp({ content: `⚠️ ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return interaction.reply({ content: `⚠️ ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
};
