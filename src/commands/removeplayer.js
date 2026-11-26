const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { buildRemovePlayerPanel } = require('../handlers/squad-ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeplayer')
    .setDescription('Choose a player in your squad to return to My Players.'),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = await getRegistered(interaction);
    const panel = await buildRemovePlayerPanel(Number(user.id), interaction.user.id);
    await interaction.editReply({ embeds: [panel.embed], files: panel.file ? [panel.file] : [], components: panel.components, attachments: [] });
  }
};
