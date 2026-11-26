const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { buildMarketPanel } = require('../handlers/market-ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('market')
    .setDescription('Browse the System Market and cards listed by other managers.')
    .addStringOption(option => option
      .setName('type')
      .setDescription('Choose a market to browse')
      .setRequired(true)
      .addChoices(
        { name: 'System Market', value: 'system' },
        { name: 'User Market', value: 'user' }
      ))
    .addIntegerOption(option => option
      .setName('page')
      .setDescription('Page number')
      .setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = await getRegistered(interaction);
    const type = interaction.options.getString('type');
    const page = interaction.options.getInteger('page') || 1;
    const panel = await buildMarketPanel(Number(user.id), interaction.user.id, type, page);
    await interaction.editReply({
      embeds: [panel.embed],
      files: panel.file ? [panel.file] : [],
      components: panel.components
    });
  }
};
