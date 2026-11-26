const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { getUserByDiscordId } = require('../services/users');
const { getPool } = require('../db');
const { getMatchLogs } = require('../services/match-service');
const { baseEmbed, truncate } = require('../utils/message');

const PAGE_SIZE = 15;

function buildNavigation(ownerDiscordId, matchId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`matchlogs:prev:${ownerDiscordId}:${matchId}:${Math.max(1, page - 1)}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`matchlogs:next:${ownerDiscordId}:${matchId}:${Math.min(totalPages, page + 1)}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages)
  );
}

async function buildLogPage(matchId, userId, ownerDiscordId, page = 1) {
  const result = await getMatchLogs(matchId, Number(userId), page);
  const mySide = Number(result.home_user_id) === Number(userId) ? 'home' : 'away';
  const fields = result.logs.map(entry => {
    const side = entry.side === 'system' ? 'MATCH' : entry.side === mySide ? 'YOUR TEAM' : 'OPPONENT';
    const marker = entry.side === 'system' ? '▫️' : entry.side === mySide ? '🟩' : '🟥';
    return {
      name: `${marker} ${String(entry.minute).padStart(2, '0')}' · ${side}`,
      value: truncate(String(entry.text || 'Match event'), 900),
      inline: false
    };
  });

  const embed = baseEmbed(
    `Match Log · ${result.page}/${result.totalPages}`,
    `**${result.home_name}** ${result.home_score} — ${result.away_score} **${result.away_name}**
${String(result.mode).toUpperCase()} · ${result.total} events`,
    0x35516f
  );
  if (fields.length) embed.addFields(fields);
  else embed.setDescription(`${embed.data.description || ''}\nNo events on this page.`);

  return {
    embed,
    components: [buildNavigation(ownerDiscordId, matchId, result.page, result.totalPages)],
    result
  };
}

async function handleMatchLogsButton(interaction) {
  const [, action, ownerDiscordId, matchId, pageText] = interaction.customId.split(':');
  if (String(interaction.user.id) !== String(ownerDiscordId)) {
    return interaction.reply({
      content: 'These match logs belong to another manager.',
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferUpdate();
  const user = await getUserByDiscordId(ownerDiscordId);
  if (!user) throw new Error('You do not have a club yet. Run `/start` first.');
  const page = Math.max(1, Number(pageText) || (action === 'next' ? 2 : 1));
  const view = await buildLogPage(matchId, Number(user.id), ownerDiscordId, page);
  return interaction.editReply({ embeds: [view.embed], components: view.components, attachments: [] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matchlogs')
    .setDescription('Read the minute-by-minute log from a completed match.')
    .addStringOption(option => option
      .setName('match')
      .setDescription('Search your completed matches by opponent or mode')
      .setRequired(true)
      .setAutocomplete(true))
    .addIntegerOption(option => option
      .setName('page')
      .setDescription('Log page (15 match minutes per page)')
      .setMinValue(1)),

  async autocomplete(interaction) {
    const user = await getUserByDiscordId(interaction.user.id);
    if (!user) return interaction.respond([]);
    const focused = String(interaction.options.getFocused() || '').slice(0, 50);
    const like = `%${focused}%`;
    const rows = await getPool().query(
      `SELECT match_id,mode,home_name,away_name,home_score,away_score,created_at,home_user_id
       FROM matches
       WHERE status='completed' AND (home_user_id=? OR away_user_id=?)
         AND (home_name LIKE ? OR away_name LIKE ? OR mode LIKE ?)
       ORDER BY created_at DESC LIMIT 25`,
      [Number(user.id), Number(user.id), like, like, like]
    );
    return interaction.respond(rows.map(row => {
      const isHome = Number(row.home_user_id) === Number(user.id);
      const opponent = isHome ? row.away_name : row.home_name;
      const ownScore = isHome ? row.home_score : row.away_score;
      const opponentScore = isHome ? row.away_score : row.home_score;
      const date = new Date(row.created_at).toLocaleDateString('en-US');
      return {
        name: `${String(row.mode).toUpperCase()} · ${opponent} · ${ownScore}-${opponentScore} · ${date}`.slice(0, 100),
        value: row.match_id,
        description: 'Completed · 90-minute match log'
      };
    }));
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = await getRegistered(interaction);
    const matchId = interaction.options.getString('match');
    const page = interaction.options.getInteger('page') || 1;
    const view = await buildLogPage(matchId, Number(user.id), interaction.user.id, page);
    await interaction.editReply({ embeds: [view.embed], components: view.components });
  },

  handleMatchLogsButton,
  buildLogPage
};
