const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { buildPackPanel } = require('../handlers/pack-ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pack')
    .setDescription('Browse player packs, choose a quantity, and confirm your order.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await getRegistered(interaction);
    const panel = await buildPackPanel(interaction.user.id, 'pro', 1);
    await interaction.editReply({ embeds: [panel.embed], components: panel.components, attachments: [] });
  }
};
