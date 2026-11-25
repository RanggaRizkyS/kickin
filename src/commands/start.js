const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { findOrCreateDiscordUser, ensureStarterSquad } = require('../services/users');
const { successEmbed, formatCredits } = require('../utils/message');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Daftar dan mulai membangun klub sepak bolamu.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await findOrCreateDiscordUser(interaction.user);
    if (!user) throw new Error('Akun tidak dapat dibuat. Periksa koneksi database.');

    const starter = await ensureStarterSquad(Number(user.id));
    const credits = formatCredits(Number(user.credits));
    const embed = successEmbed(
      '⚽ Football Club siap!',
      starter.created
        ? `Akun berhasil dibuat.
Starter squad berisi 11 pemain telah disiapkan.
Saldo awal: **${credits}**.`
        : `Akunmu sudah terdaftar.
Saldo saat ini: **${credits}**.`
    );

    embed.addFields(
      { name: 'Account Level', value: `Lv. ${Number(user.account_level || 1)}`, inline: true },
      { name: 'Player Claim', value: `Setiap ${config.economy.claimCooldownHours} jam`, inline: true },
      { name: 'Starter Squad', value: starter.created ? '11 pemain diberikan' : 'Squad tersimpan', inline: true }
    );
    embed.setFooter({ text: 'Football Club • Build your dream squad' });

    await interaction.editReply({ embeds: [embed] });
  }
};
