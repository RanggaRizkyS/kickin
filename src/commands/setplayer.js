const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { setSquadSlot, getPlayerAutocomplete } = require('../services/squad');
const { buildSquadPanel } = require('../handlers/squad-ui');
const slots = ['GK','LB','LCB','RCB','RB','LCM','CDM','RCM','LW','ST','RW','LDM','RDM','CAM','LM','RM','LST','RST'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setplayer')
    .setDescription('Place or replace a player in your starting XI.')
    .addStringOption(option => option.setName('slot').setDescription('Position to fill').setRequired(true)
      .addChoices(...slots.map(value => ({ name: value, value }))))
    .addStringOption(option => option.setName('player').setDescription('Search and select a player you own').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) {
    const user = await require('../services/users').getUserByDiscordId(interaction.user.id);
    if (!user) return interaction.respond([]);
    const focused = interaction.options.getFocused();
    const choices = await getPlayerAutocomplete(Number(user.id), focused, true);
    return interaction.respond(choices);
  },
  async execute(interaction) {
    const user = await getRegistered(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const slot = interaction.options.getString('slot');
    const cardId = interaction.options.getString('player');
    const result = await setSquadSlot(Number(user.id), slot, cardId);
    const panel = await buildSquadPanel(Number(user.id), interaction.user.id);
    panel.embed.setDescription(`✅ **${result.player || 'Player'}** placed in **${slot}**.\n\n${panel.embed.data.description || ''}`);
    await interaction.editReply({ embeds: [panel.embed], files: panel.file ? [panel.file] : [], components: panel.components });
  }
};
