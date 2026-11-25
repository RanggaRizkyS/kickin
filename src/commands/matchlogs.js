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
const { baseEmbed } = require('../utils/message');

function buildNavigation(ownerDiscordId, matchId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`matchlogs:prev:${ownerDiscordId}:${matchId}:${Math.max(1, page - 1)}`)
      .setEmoji('⬅️')
      .setLabel('Previous 15')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`matchlogs:next:${ownerDiscordId}:${matchId}:${Math.min(totalPages, page + 1)}`)
      .setEmoji('➡️')
      .setLabel('Next 15')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages)
  );
}

async function buildLogPage(matchId, userId, ownerDiscordId, page = 1) {
  const result = await getMatchLogs(matchId, Number(userId), page);
  const mySide = Number(result.home_user_id) === Number(userId) ? 'home' : 'away';
  const lines = result.logs.map(entry => {
    const marker = entry.side === 'system'
      ? '⚪'
      : entry.side === mySide ? '🟩' : '🟥';
    return `${marker} **${String(entry.minute).padStart(2, '0')}'** ${String(entry.text || '').slice(0, 220)}`;
  });

  const embed = baseEmbed(
    `📋 MATCH LOGS · ${result.page}/${result.totalPages}`,
    `**${result.home_name}** ${result.home_score} — ${result.away_score} **${result.away_name}**\n` +
    `Mode: **${String(result.mode).toUpperCase()}** · Page **${result.page}/${result.totalPages}**\n\n` +
    (lines.join('\n') || 'Tidak ada log pada halaman ini.'),
    0x3478bd
  );
  embed.setFooter({
    text: `🟩 Tim kamu · 🟥 Lawan · ${result.total} log menit · 15 log per halaman`
  });

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
      content: 'Navigasi log ini hanya bisa digunakan oleh pemain yang membukanya.',
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferUpdate();
  const user = await getUserByDiscordId(ownerDiscordId);
  if (!user) throw new Error('Jalankan `/start` terlebih dahulu.');
  const page = Math.max(1, Number(pageText) || (action === 'next' ? 2 : 1));
  const view = await buildLogPage(matchId, Number(user.id), ownerDiscordId, page);
  return interaction.editReply({
    embeds: [view.embed],
    components: view.components,
    attachments: []
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matchlogs')
    .setDescription('Lihat semua 90 log menit pertandingan yang sudah selesai.')
    .addStringOption(option => option
      .setName('match')
      .setDescription('Cari pertandingan berdasarkan lawan atau mode')
      .setRequired(true)
      .setAutocomplete(true))
    .addIntegerOption(option => option
      .setName('page')
      .setDescription('Halaman log (15 menit per halaman)')
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
      const date = new Date(row.created_at).toLocaleDateString('id-ID');
      return {
        name: `${String(row.mode).toUpperCase()} · ${opponent} · ${ownScore}-${opponentScore} · ${date}`.slice(0, 100),
        value: row.match_id,
        description: 'Completed match · 90 minute logs'
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
