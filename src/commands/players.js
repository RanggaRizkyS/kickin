const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const { getRegistered, clampPage } = require('../utils/commands');
const { getPool } = require('../db');
const { safeJson, estimatedOverall, xpRequired } = require('../utils/football');
const { calculateMarketPrice, refreshMarketWindows } = require('../services/market');
const { baseEmbed, formatCredits, pageButtons, truncate } = require('../utils/message');

const PAGE_SIZE = 20;

function statusLabel(row) {
  if (row.statusCode === 'IN XI') return 'In starting XI';
  if (row.statusCode === 'LISTED') return 'Listed on market';
  return 'Available';
}

function playerFields(rows, page) {
  return rows.map((row, index) => {
    const number = String((page - 1) * PAGE_SIZE + index + 1).padStart(2, '0');
    const skill = row.skills[0] || 'No signature skill';
    return {
      name: `${number} · ${truncate(row.name, 48)} · ${Math.round(row.currentOvr)} OVR`,
      value: `**${row.primaryPosition}** · ${String(row.rarity).toUpperCase()}\n` +
        `Card ID: \`${row.publicId}\` · Lv.${row.level}/50 · ${statusLabel(row)}\n` +
        `${truncate(skill, 56)} · Sell ${row.sellPriceText}`,
      inline: true
    };
  });
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
      publicId: row.public_id || 'PC-PENDING',
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
    'My Players',
    total
      ? `**${truncate(username, 48)}** · ${total.toLocaleString('en-US')} cards\nPage **${currentPage} / ${totalPages}** · ${PAGE_SIZE} per page`
      : 'Your collection is empty. Start with `/claim` or browse `/market`.',
    0x27394d
  );

  if (viewRows.length) embed.addFields(playerFields(viewRows, currentPage));

  const components = [];
  if (viewRows.length) {
    const options = viewRows.map(row => ({
      label: `${row.publicId} · ${row.name} · ${Math.round(row.currentOvr)} OVR`.slice(0, 100),
      value: String(row.publicId),
      description: `${row.primaryPosition} · Lv.${row.level}/50 · ${statusLabel(row)}`.slice(0, 100)
    }));
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`players:choose:${ownerDiscordId}:${currentPage}`)
        .setPlaceholder('Open a player card')
        .addOptions(...options)
    ));
  }

  components.push(pageButtons('players', ownerDiscordId, currentPage, totalPages));

  return { embed, components, page: currentPage, totalPages, total, rows: viewRows };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('players')
    .setDescription('Browse your collection of player cards.'),

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
      components: result.components
    });
  },

  buildPage
};
