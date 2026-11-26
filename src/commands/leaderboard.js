const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { getPool } = require('../db');
const { getSquadSnapshot } = require('../services/squad');
const { baseEmbed, formatStrength, formatNumber, truncate } = require('../utils/message');

function cleanName(value) {
  return truncate(String(value || 'Manager').replace(/[|`\r\n]/g, ' ').trim(), 40);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the leading clubs by strength or ranked points.')
    .addStringOption(option => option
      .setName('type')
      .setDescription('Choose a leaderboard')
      .setRequired(true)
      .addChoices(
        { name: 'Team Strength', value: 'strength' },
        { name: 'Ranked Points', value: 'points' }
      )),

  async execute(interaction) {
    await getRegistered(interaction);
    const type = interaction.options.getString('type');
    let fields = [];

    if (type === 'points') {
      const rows = await getPool().query(
        'SELECT username,rank_points FROM users ORDER BY rank_points DESC,updated_at ASC LIMIT 20'
      );
      fields = rows.map((row, index) => ({
        name: `${String(index + 1).padStart(2, '0')} · ${cleanName(row.username)}`,
        value: `**${formatNumber(row.rank_points, 3)} RP**`,
        inline: true
      }));
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
          if (squad.complete) ranked.push({
            username: row.username,
            strength: squad.teamStrength,
            teamOvr: squad.teamOvr,
            chemistry: squad.teamChemistry
          });
        } catch {
          // A squad that cannot be loaded is excluded from the board.
        }
      }
      ranked.sort((a, b) => b.strength - a.strength);
      fields = ranked.slice(0, 20).map((row, index) => ({
        name: `${String(index + 1).padStart(2, '0')} · ${cleanName(row.username)}`,
        value: `**${formatStrength(row.strength)} strength**\nOVR ${formatStrength(row.teamOvr)} · CHEM ${formatStrength(row.chemistry)}`,
        inline: true
      }));
    }

    const embed = baseEmbed(
      type === 'points' ? 'Ranked Points' : 'Team Strength',
      `Top ${fields.length} clubs`,
      0xc59a43
    );
    if (fields.length) embed.addFields(fields);
    else embed.setDescription('No clubs are ranked yet.');
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
