const { SlashCommandBuilder , MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { getPool } = require('../db');
const { getSquadSnapshot } = require('../services/squad');
const { baseEmbed, formatStrength, formatNumber } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Lihat peringkat Team Strength atau Ranked Points.')
    .addStringOption(option => option.setName('type').setDescription('Jenis leaderboard').setRequired(true)
      .addChoices({ name: 'Team Strength', value: 'strength' }, { name: 'Ranked Points', value: 'points' })),
  async execute(interaction) {
    await getRegistered(interaction);
    const type = interaction.options.getString('type');
    let lines = [];
    if (type === 'points') {
      const rows = await getPool().query('SELECT username,rank_points FROM users ORDER BY rank_points DESC,updated_at ASC LIMIT 20');
      lines = rows.map((row, index) => `**${index + 1}. ${row.username}** — ${formatNumber(row.rank_points, 3)} RP`);
    } else {
      const rows = await getPool().query(
        `SELECT u.id,u.username FROM users u
         WHERE (SELECT COUNT(*) FROM squad_slots ss WHERE ss.user_id=u.id)=11
         ORDER BY u.updated_at DESC LIMIT 100`
      );
      const ranked = [];
      for (const row of rows) {
        try {
          const squad = await getSquadSnapshot(Number(row.id));
          if (squad.complete) ranked.push({ username: row.username, strength: squad.teamStrength, teamOvr: squad.teamOvr, chemistry: squad.teamChemistry });
        } catch { /* Skip incomplete squads. */ }
      }
      ranked.sort((a, b) => b.strength - a.strength);
      lines = ranked.slice(0, 20).map((row, index) => `**${index + 1}. ${row.username}** — **${formatStrength(row.strength)}**\nTeam OVR ${formatStrength(row.teamOvr)} · Chemistry ${formatStrength(row.chemistry)}`);
    }
    const embed = baseEmbed(type === 'points' ? '🏆 RANKED POINTS LEADERBOARD' : '⚽ TEAM STRENGTH LEADERBOARD', lines.length ? lines.join('\n\n') : 'Belum ada data leaderboard.', 0xd6aa42);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
