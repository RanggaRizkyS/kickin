const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { getPool } = require('../db');
const { baseEmbed, truncate } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Review your five most recent matches.'),

  async execute(interaction) {
    const user = await getRegistered(interaction);
    const rows = await getPool().query(
      `SELECT match_id,mode,home_user_id,away_user_id,home_name,away_name,home_score,away_score,winner_user_id,status,created_at
       FROM matches WHERE home_user_id=? OR away_user_id=? ORDER BY created_at DESC LIMIT 5`,
      [user.id, user.id]
    );

    const embed = baseEmbed('Match History', rows.length ? 'Your five most recent results.' : 'No completed matches yet.', 0x35516f);
    if (rows.length) {
      embed.addFields(rows.map(row => {
        const isHome = Number(row.home_user_id) === Number(user.id);
        const opponent = isHome ? row.away_name : row.home_name;
        const ownScore = isHome ? row.home_score : row.away_score;
        const opponentScore = isHome ? row.away_score : row.home_score;
        const result = row.status !== 'completed'
          ? 'VOID'
          : Number(row.winner_user_id) === Number(user.id) ? 'WIN' : row.winner_user_id == null ? 'DRAW' : 'LOSS';
        const colorMark = result === 'WIN' ? '🟩' : result === 'LOSS' ? '🟥' : '▫️';
        const date = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return {
          name: `${colorMark} ${String(row.mode).toUpperCase()} · ${result}`,
          value: `vs **${truncate(opponent, 42)}**\n**${ownScore} — ${opponentScore}** · ${date}`,
          inline: true
        };
      }));
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
