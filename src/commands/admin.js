const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { loginAdmin, requireAdminSession, resetSeason } = require('../services/admin');
const { successEmbed, formatNumber } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Manage restricted club operations.')
    .addSubcommand(sub => sub
      .setName('login')
      .setDescription('Open an administrator session.')
      .addStringOption(option => option
        .setName('password')
        .setDescription('Password configured by the server owner')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('reset-season')
      .setDescription('Permanently reset the active season.')
      .addBooleanOption(option => option
        .setName('confirm')
        .setDescription('Must be true to run the permanent reset')
        .setRequired(true))),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === 'login') {
      const result = await loginAdmin(interaction.user.id, interaction.options.getString('password'));
      return interaction.editReply({ embeds: [successEmbed('Administrator Session Open', `Session active for ${result.expiresMinutes} minutes.`)] });
    }
    if (sub === 'reset-season') {
      await requireAdminSession(interaction.user.id);
      if (!interaction.options.getBoolean('confirm')) {
        throw new Error('Reset cancelled. Set confirm to true only when you intend to erase the active season.');
      }
      const result = await resetSeason();
      return interaction.editReply({ embeds: [successEmbed(
        'Season Reset Complete',
        `Season ${result.previousSeason} → ${result.currentSeason}\nManagers reset: ${formatNumber(result.usersReset)}\nStarter cards per manager: ${result.starterCardsPerUser}\nFinal formations have been archived.`
      )] });
    }
  }
};
