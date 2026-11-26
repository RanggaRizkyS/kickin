const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { buildSquadPanel } = require('../handlers/squad-ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('squad')
    .setDescription('View your starting XI and manage its positions.'),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = await getRegistered(interaction);
    const panel = await buildSquadPanel(Number(user.id), interaction.user.id);
    await interaction.editReply({
      embeds: [panel.embed],
      files: panel.file ? [panel.file] : [],
      components: panel.components,
      attachments: []
    });
  }
};
