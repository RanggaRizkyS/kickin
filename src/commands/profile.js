const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getPool } = require('../db');
const { getSquadSnapshot } = require('../services/squad');
const { baseEmbed, formatCredits, formatNumber, formatStrength } = require('../utils/message');
const { accountXpRequired } = require('../utils/football');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription("View your club profile or another manager's record.")
    .addUserOption(option => option
      .setName('user')
      .setDescription('Optional manager to look up')
      .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const selectedUser = interaction.options.getUser('user') || interaction.user;
    const rows = await getPool().query(
      'SELECT * FROM users WHERE discord_id=? LIMIT 1',
      [String(selectedUser.id)]
    );
    if (!rows.length) {
      return interaction.editReply({
        embeds: [baseEmbed(
          'Club Not Found',
          `<@${selectedUser.id}> has not registered a club yet. They can get started with \/start.`,
          0xd64b4b
        )]
      });
    }

    const user = rows[0];
    const [cardRows, matchRows] = await Promise.all([
      getPool().query(
        'SELECT COUNT(*) AS total FROM user_player_cards WHERE user_id=?',
        [user.id]
      ),
      getPool().query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN (home_user_id=? AND home_score>away_score) OR (away_user_id=? AND away_score>home_score) THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN (home_user_id=? AND home_score<away_score) OR (away_user_id=? AND away_score<home_score) THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN home_score=away_score THEN 1 ELSE 0 END) AS draws
         FROM matches
         WHERE status='completed' AND (home_user_id=? OR away_user_id=?)`,
        [user.id, user.id, user.id, user.id, user.id, user.id]
      )
    ]);

    let squad = null;
    try {
      squad = await getSquadSnapshot(Number(user.id));
    } catch {
      // A registered manager can still have an incomplete squad.
    }

    const totalMatches = Number(matchRows[0]?.total || 0);
    const wins = Number(matchRows[0]?.wins || 0);
    const losses = Number(matchRows[0]?.losses || 0);
    const draws = Number(matchRows[0]?.draws || 0);
    const winRate = totalMatches ? (wins / totalMatches) * 100 : 0;
    const required = accountXpRequired(Number(user.account_level));
    const hasCompleteSquad = !!squad?.complete;
    const avatar = selectedUser.displayAvatarURL?.({ extension: 'png', size: 256 }) || user.avatar_url;

    const embed = baseEmbed(
      `${user.username}'s Club Profile`,
      `Manager: <@${selectedUser.id}>\n${hasCompleteSquad ? 'The starting XI is ready for selection.' : 'The starting XI still needs attention.'}`,
      0x3478bd
    );
    if (avatar) embed.setThumbnail(avatar);

    embed.addFields(
      { name: 'Credits', value: `**${formatCredits(user.credits)}**`, inline: true },
      { name: 'Account Level', value: `**Lv. ${formatNumber(user.account_level)}**`, inline: true },
      { name: 'Rank Points', value: `**${formatNumber(user.rank_points, 3)}**`, inline: true },
      { name: 'Account XP', value: `**${formatNumber(user.account_xp)} / ${formatNumber(required)}**`, inline: true },
      { name: 'Player Cards', value: `**${Number(cardRows[0]?.total || 0)}**`, inline: true },
      { name: 'Matches', value: `**${totalMatches}**`, inline: true },
      { name: 'Wins', value: `**${wins}**`, inline: true },
      { name: 'Draws', value: `**${draws}**`, inline: true },
      { name: 'Losses', value: `**${losses}**`, inline: true },
      { name: 'Win Rate', value: `**${winRate.toFixed(1)}%**`, inline: true }
    );

    if (squad) {
      embed.addFields(
        { name: 'Active Formation', value: `**${squad.formation}** · ${squad.players.length}/11`, inline: true },
        { name: 'Team OVR', value: `**${formatStrength(squad.teamOvr)}**`, inline: true },
        { name: 'Chemistry', value: `**${formatStrength(squad.teamChemistry)} / 100**`, inline: true },
        { name: 'Team Strength', value: `**${formatStrength(squad.teamStrength)}**`, inline: true }
      );
    } else {
      embed.addFields({ name: 'Active Squad', value: 'Not available yet. Run `/start` to create one.', inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
