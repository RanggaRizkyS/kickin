const { SlashCommandBuilder , MessageFlags } = require('discord.js');
const { loginAdmin, requireAdminSession, resetSeason } = require('../services/admin');
const { baseEmbed, successEmbed, formatNumber } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder().setName('admin').setDescription('Administrasi game (khusus admin).')
    .addSubcommand(sub => sub.setName('login').setDescription('Login ke sesi admin.')
      .addStringOption(option => option.setName('password').setDescription('Password admin dari ADMIN_PASSWORD_HASH').setRequired(true)))
    .addSubcommand(sub => sub.setName('reset-season').setDescription('Hard reset season. Aksi ini permanen.')
      .addBooleanOption(option => option.setName('confirm').setDescription('Harus true untuk menjalankan reset permanen').setRequired(true))),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === 'login') {
      const result = await loginAdmin(interaction.user.id, interaction.options.getString('password'));
      return interaction.editReply({ embeds: [successEmbed('Admin Login Success', `Sesi admin aktif selama ${result.expiresMinutes} menit.`)] });
    }
    if (sub === 'reset-season') {
      await requireAdminSession(interaction.user.id);
      if (!interaction.options.getBoolean('confirm')) throw new Error('Reset dibatalkan. Ubah confirm menjadi true jika memang ingin menghapus data season aktif.');
      const result = await resetSeason();
      return interaction.editReply({ embeds: [successEmbed('Season Reset Completed', `Season ${result.previousSeason} → ${result.currentSeason}\nUsers reset: ${formatNumber(result.usersReset)}\nStarter cards per user: ${result.starterCardsPerUser}\nFinal formations telah diarsipkan.`)] });
    }
  }
};
