const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { baseEmbed } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('See the club commands and when to use them.'),

  async execute(interaction) {
    const embed = baseEmbed('Club Desk', [
      'Your club, player cards and matchday records.',
      '',
      '**Club**  `/start` · `/profile`',
      '**Players**  `/claim` · `/pack` · `/players` · `/player`',
      '**Market**  `/market` · `/buy` · `/sell` · `/cancel-listing`',
      '**Squad**  `/squad` · `/formation` · `/setplayer` · `/removeplayer`',
      '**Matches**  `/match` · `/friendly` · `/history` · `/matchlogs`',
      '**Rankings**  `/leaderboard`',
      '**Admin**  `/admin`'
    ].join('\n'), 0x253a52);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
