const { SlashCommandBuilder , MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { getPool } = require('../db');
const { baseEmbed, formatStrength } = require('../utils/message');
const { safeJson } = require('../utils/football');

module.exports = {
  data: new SlashCommandBuilder().setName('history').setDescription('Lihat lima pertandingan terakhirmu.'),
  async execute(interaction) {
    const user = await getRegistered(interaction);
    const rows = await getPool().query(
      `SELECT match_id,mode,home_user_id,away_user_id,home_name,away_name,home_score,away_score,home_strength,away_strength,winner_user_id,status,created_at
       FROM matches WHERE home_user_id=? OR away_user_id=? ORDER BY created_at DESC LIMIT 5`, [user.id, user.id]
    );
    if (!rows.length) return interaction.reply({ embeds: [baseEmbed('📜 MATCH HISTORY', 'Kamu belum mempunyai riwayat pertandingan.', 0x3478bd)], flags: MessageFlags.Ephemeral });
    const lines = rows.map(row => {
      const home = Number(row.home_user_id) === Number(user.id);
      const ownName = home ? row.home_name : row.away_name;
      const opponent = home ? row.away_name : row.home_name;
      const ownScore = home ? row.home_score : row.away_score;
      const oppScore = home ? row.away_score : row.home_score;
      const winner = row.status !== 'completed' ? '⏳ RUNNING / CANCELLED' : Number(row.winner_user_id) === Number(user.id) ? '🟩 WIN' : row.winner_user_id == null ? '🟨 DRAW' : '🟥 LOSS';
      const date = new Date(row.created_at).toLocaleDateString('id-ID');
      return `**${String(row.mode).toUpperCase()} · ${winner}**\n${ownName} **${ownScore} — ${oppScore}** ${opponent}\n<t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R> · ${date}`;
    });
    await interaction.reply({ embeds: [baseEmbed('📜 MATCH HISTORY', `${lines.join('\n\n')}\n\nGunakan **/matchlogs** lalu pilih pertandingan dari daftar.`, 0x3478bd)], flags: MessageFlags.Ephemeral });
  }
};
