const {
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const { getRegistered, clampPage } = require('../utils/commands');
const { getPool } = require('../db');
const { safeJson, estimatedOverall, xpRequired } = require('../utils/football');
const { calculateMarketPrice, refreshMarketWindows } = require('../services/market');
const { baseEmbed, formatCredits } = require('../utils/message');
const { renderPlayersList } = require('../services/players-list-renderer');

const PAGE_SIZE = 20;

function clean(value, maxLength = 80) {
  const text = String(value ?? '').replace(/[|`\n\r]/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

async function buildPage(userId, page, username = 'Your Club', ownerDiscordId = String(userId)) {
  await refreshMarketWindows();
  const countRows = await getPool().query(
    'SELECT COUNT(*) AS total FROM user_player_cards WHERE user_id=?',
    [userId]
  );
  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = clampPage(page, total, PAGE_SIZE);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const rows = await getPool().query(
    `SELECT c.card_instance_id,c.public_id,c.player_id,c.level,c.xp,c.current_stats_json,c.acquired_at,
      p.name,p.overall,p.primary_position,p.rarity,p.raw_json,p.nationality_json,
      ms.stock,ms.base_stock,ms.purchases_24h,ms.sales_24h,
      ss.slot_key AS squad_slot,l.listing_id AS active_listing
     FROM user_player_cards c
     JOIN players_catalog p ON p.player_id=c.player_id
     JOIN market_stock ms ON ms.player_id=c.player_id
     LEFT JOIN squad_slots ss ON ss.card_instance_id=c.card_instance_id AND ss.user_id=c.user_id
     LEFT JOIN user_market_listings l ON l.card_instance_id=c.card_instance_id AND l.status='active'
     WHERE c.user_id=?
     ORDER BY p.overall DESC,p.name ASC,c.acquired_at ASC
     LIMIT ? OFFSET ?`,
    [userId, PAGE_SIZE, offset]
  );

  const viewRows = rows.map(row => {
    const player = safeJson(row.raw_json, {});
    const currentStats = safeJson(row.current_stats_json, player.stats?.main || player.stats?.goalkeeper || {});
    const currentOvr = estimatedOverall(
      { level: Number(row.level), currentStats }, player, player.positions?.primary
    );
    const marketPrice = calculateMarketPrice(
      player, row.stock, row.base_stock, row.purchases_24h, row.sales_24h
    );
    const sellPrice = Math.max(25, Math.round(marketPrice * 0.72));
    const required = xpRequired(Number(row.level));
    return {
      cardInstanceId: row.card_instance_id,
      publicId: row.public_id || row.card_instance_id,
      playerId: row.player_id,
      name: row.name,
      overall: Number(row.overall),
      currentOvr,
      primaryPosition: row.primary_position,
      nationality: safeJson(row.nationality_json, player.nationality || {}).country || 'Unknown',
      rarity: row.rarity,
      skills: (player.skills || []).map(item => item.name).filter(Boolean),
      level: Number(row.level),
      xp: Number(row.xp),
      requiredXp: required,
      xpProgress: required > 0 ? Math.min(1, Number(row.xp) / required) : 0,
      sellPrice,
      sellPriceText: formatCredits(sellPrice),
      statusCode: row.squad_slot ? 'IN XI' : row.active_listing ? 'LISTED' : 'AVAILABLE',
      player
    };
  });

  const embed = baseEmbed(
    '👥 MY PLAYERS · COLLECTION',
    total
      ? `**${clean(username, 64)}** · **${total}** player cards\nPage **${currentPage}/${totalPages}** · 20 cards per page. Use the dropdown to open a player. `
      : `**${clean(username, 64)}**\n\nKoleksimu masih kosong. Gunakan \`/claim\`, \`/pack\`, atau \`/market\` untuk mendapatkan pemain.`,
    0x202b3a
  );
  embed.addFields(
    { name: 'PLAYER CARDS', value: `**${total}**`, inline: true },
    { name: 'PAGE', value: `**${currentPage}/${totalPages}**`, inline: true },
    { name: 'ROWS / PAGE', value: '**20**', inline: true }
  );
  embed.setFooter({ text: 'Public Card ID ditampilkan pada tabel. Internal database UUID tidak ditampilkan.' });
  const tableBuffer = await renderPlayersList({
    rows: viewRows,
    page: currentPage,
    total,
    username
  });
  const file = new AttachmentBuilder(tableBuffer, { name: 'my-players-table.png' });
  embed.setImage('attachment://my-players-table.png');

  const components = [];
  if (viewRows.length) {
    const options = viewRows.map(row => ({
      label: `${row.publicId} · ${row.name} · ${Math.round(row.currentOvr)} OVR`.slice(0, 100),
      value: String(row.publicId),
      description: `${row.primaryPosition} · Lv.${row.level}/50 · ${row.statusCode} · ${row.skills.slice(0, 2).join(', ') || row.rarity}`.slice(0, 100)
    }));
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`players:choose:${ownerDiscordId}:${currentPage}`)
        .setPlaceholder('Pilih kartu untuk melihat detail, pasang, atau jual')
        .addOptions(...options)
    ));
  }

  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`players:prev:${ownerDiscordId}:${Math.max(1, currentPage - 1)}`)
      .setEmoji('⬅️')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`players:next:${ownerDiscordId}:${Math.min(totalPages, currentPage + 1)}`)
      .setEmoji('➡️')
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage >= totalPages)
  ));

  return { embed, file, components, page: currentPage, totalPages, total, rows: viewRows };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('players')
    .setDescription('Lihat koleksi pemain dalam tabel, 20 kartu per halaman.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = await getRegistered(interaction);
    const result = await buildPage(
      Number(user.id),
      1,
      interaction.user.globalName || interaction.user.username,
      interaction.user.id
    );
    await interaction.editReply({
      embeds: [result.embed],
      files: result.file ? [result.file] : [],
      components: result.components,
      attachments: []
    });
  },

  buildPage
};
