const { SlashCommandBuilder , MessageFlags } = require('discord.js');
const { baseEmbed } = require('../utils/message');
module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Lihat daftar slash command game.'),
  async execute(interaction) {
    const embed = baseEmbed('⚽ FOOTBALL CLUB · COMMANDS', [
      '**Account**', '`/start` · `/profile` · `/help`',
      '**Player Collection**', '`/claim` · `/pack` · `/players` · `/player`',
      '**Market**', '`/market` · `/buy` · `/sell` · `/cancel-listing`',
      '**Squad**', '`/squad` · `/formation` · `/setplayer` · `/removeplayer`',
      '**Matches**', '`/match` · `/friendly` · `/history` · `/matchlogs`',
      '**Competition**', '`/leaderboard`',
      '**Admin**', '`/admin login` · `/admin reset-season`',
      '',
      'Gunakan `/start` terlebih dahulu untuk membuat klub dan starter squad.'
    ].join('\n'), 0x3478bd);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
