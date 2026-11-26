const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const { getPool } = require('../db');
const {
  listSystemMarket,
  getSystemMarketItem,
  getUserMarketPage,
  getUserListingById,
  buySystemPlayer,
  buyUserListing,
  getCard
} = require('../services/market');
const { estimatedOverall } = require('../utils/football');
const {
  baseEmbed,
  successEmbed,
  formatCredits,
  formatStrength,
  truncate
} = require('../utils/message');

const PAGE_SIZE = 12;

function clean(value, max = 24) {
  const text = String(value ?? '').replace(/[|`\n\r]/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function assertOwner(interaction, ownerDiscordId) {
  if (String(interaction.user.id) !== String(ownerDiscordId)) {
    throw new Error('This market panel belongs to another manager. Run /market to open your own.');
  }
}

async function resolveUser(discordId) {
  const rows = await getPool().query(
    'SELECT id,discord_id,username,credits FROM users WHERE discord_id=? LIMIT 1',
    [String(discordId)]
  );
  if (!rows.length) throw new Error('You do not have a club yet. Run /start first.');
  return rows[0];
}

function makePanelComponents({ ownerId, type, page, totalPages, entries }) {
  const components = [];
  if (entries.length) {
    const options = entries.map(entry => {
      const player = entry.player || entry;
      const listingId = type === 'system' ? entry.listingId : entry.publicListingId;
      const ovr = Number(entry.currentOvr ?? entry.overall ?? player.overall ?? 0);
      const price = Number(type === 'system' ? entry.marketPrice : entry.askingPrice);
      const position = player.positions?.primary || player.primary_position || '-';
      return {
        label: `${player.name} · ${Math.round(ovr)} OVR · ${listingId}`.slice(0, 100),
        value: String(listingId),
        description: `${position} · ${formatCredits(price)}${type === 'system' ? ` · Stock ${entry.stock}` : ` · ${entry.sellerName}`}`.slice(0, 100)
      };
    });
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`market:choose:${ownerId}:${type}:${page}`)
        .setPlaceholder('Inspect a listing')
        .addOptions(options)
    ));
  }

  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`market:prev:${ownerId}:${type}:${Math.max(1, page - 1)}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`market:next:${ownerId}:${type}:${Math.min(totalPages, page + 1)}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
    new ButtonBuilder()
      .setCustomId(`market:switch:${ownerId}:${type}:1`)
      .setLabel(type === 'system' ? 'User listings' : 'System market')
      .setStyle(ButtonStyle.Secondary)
  ));
  return components;
}

async function buildMarketPanel(userId, ownerId, type = 'system', requestedPage = 1) {
  const page = Math.max(1, Number(requestedPage) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  let entries;
  let total;

  if (type === 'user') {
    const result = await getUserMarketPage({ buyerUserId: Number(userId), limit: PAGE_SIZE, offset });
    entries = result.listings;
    total = result.total;
  } else {
    const result = await listSystemMarket({ limit: PAGE_SIZE, offset, sort: 'ovr_desc' });
    entries = result.players;
    total = result.total;
    type = 'system';
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages) return buildMarketPanel(userId, ownerId, type, totalPages);
  const user = await resolveUser(ownerId);
  const title = type === 'system' ? 'System Market' : 'Manager Listings';
  const embed = baseEmbed(
    title,
    `${total.toLocaleString('en-US')} listings · Page ${page}/${totalPages} · Balance ${formatCredits(user.credits)}`,
    type === 'system' ? 0x253a52 : 0x31513f
  );

  const fields = entries.map((entry, index) => {
    const player = entry.player || entry;
    const listingId = type === 'system' ? entry.listingId : entry.publicListingId;
    const ovr = Math.round(Number(entry.currentOvr ?? player.overall ?? 0));
    const position = player.positions?.primary || player.primary_position || '-';
    const rarity = String(entry.rarity || player.rarity || 'bronze').toUpperCase();
    const price = formatCredits(type === 'system' ? entry.marketPrice : entry.askingPrice);
    const availability = type === 'system'
      ? `${Number(entry.stock || 0)} in stock`
      : `Seller · ${truncate(entry.sellerName || 'Manager', 25)}`;
    return {
      name: `${String((page - 1) * PAGE_SIZE + index + 1).padStart(2, '0')} · ${truncate(player.name, 42)}`,
      value: `**${ovr} OVR** · ${position} · ${rarity}
${price} · ${availability}
Listing \`${listingId}\``,
      inline: true
    };
  });
  if (fields.length) embed.addFields(fields);
  else embed.setDescription('No listings are available on this page.');

  return {
    embed,
    components: makePanelComponents({ ownerId, type, page, totalPages, entries }),
    type,
    page,
    totalPages,
    total
  };
}

async function editWithPanel(interaction, userId, ownerId, type, page) {
  const panel = await buildMarketPanel(userId, ownerId, type, page);
  return interaction.editReply({
    embeds: [panel.embed],
    components: panel.components,
    attachments: []
  });
}

async function handleMarketSelect(interaction) {
  const [, action, ownerId, type, pageText] = interaction.customId.split(':');
  assertOwner(interaction, ownerId);
  if (action !== 'choose') return;
  await interaction.deferUpdate();

  const reference = interaction.values[0];
  const item = type === 'system'
    ? await getSystemMarketItem(reference)
    : await getUserListingById(reference);
  const player = item.player;
  const price = type === 'system' ? item.marketPrice : item.askingPrice;
  const currentOvr = Number(item.currentOvr || player.overall);
  const rarity = item.rarity || player.rarity;
  const position = player.positions?.primary || player.primary_position || '-';
  const embed = baseEmbed(
    player.name,
    `${position} · ${String(rarity).toUpperCase()} · ${clean(player.nationality?.country || 'Unknown', 36)}`,
    rarity === 'gold' ? 0xd5a63c : rarity === 'silver' ? 0x9ba9b8 : 0xa97553
  ).addFields(
    { name: 'Overall', value: `**${formatStrength(currentOvr)} OVR**`, inline: true },
    { name: 'Price', value: `**${formatCredits(price)}**`, inline: true },
    { name: type === 'system' ? 'Stock' : 'Seller', value: type === 'system' ? `**${Number(item.stock).toLocaleString('en-US')}**` : truncate(item.sellerName || 'Manager', 60), inline: true },
    { name: 'Club', value: truncate(player.club?.name || 'Free Agent', 80), inline: true },
    { name: 'Role', value: truncate(player.role?.name || '—', 80), inline: true },
    { name: 'Skills', value: truncate((player.skills || []).map(skill => skill.name).join(' · ') || '—', 900), inline: false },
    { name: 'Listing', value: `\`${type === 'system' ? item.listingId : item.publicListingId}\``, inline: false }
  );

  const page = Math.max(1, Number(pageText) || 1);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`market:buy:${ownerId}:${type}:${reference}:${page}`)
      .setLabel(`Buy · ${formatCredits(price)}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`market:back:${ownerId}:${type}:${page}`)
      .setLabel('Back to Market')
      .setStyle(ButtonStyle.Secondary)
  );
  return interaction.editReply({ embeds: [embed], components: [row], attachments: [] });
}

async function handleMarketButton(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];
  const type = parts[3];
  assertOwner(interaction, ownerId);
  await interaction.deferUpdate();
  const user = await resolveUser(ownerId);

  if (['prev', 'next', 'switch', 'back'].includes(action)) {
    const pageValue = Number(parts[4]) || 1;
    const nextType = action === 'switch' ? (type === 'system' ? 'user' : 'system') : type;
    const page = action === 'switch' ? 1 : Math.max(1, pageValue);
    return editWithPanel(interaction, Number(user.id), ownerId, nextType, page);
  }

  if (action !== 'buy') return;
  const reference = parts[4];
  const page = Math.max(1, Number(parts[5]) || 1);
  let result;
  if (type === 'system') {
    const listing = await getSystemMarketItem(reference);
    result = await buySystemPlayer(Number(user.id), listing.id);
  } else {
    result = await buyUserListing(Number(user.id), reference);
  }

  const card = await getCard(result.cardInstanceId, Number(user.id));
  if (!card) throw new Error('The purchase went through, but the new card could not be loaded. Check /players.');
  const balanceRows = await getPool().query('SELECT credits FROM users WHERE id=? LIMIT 1', [user.id]);
  const currentOvr = estimatedOverall({ level: card.level, currentStats: card.currentStats }, card.player, card.player.positions?.primary);
  const embed = successEmbed(
    'Transfer Complete',
    `**${card.player.name}** has been added to your collection.`
  ).addFields(
    { name: 'Overall', value: `**${formatStrength(currentOvr)} OVR**`, inline: true },
    { name: 'Paid', value: `**${formatCredits(result.price)}**`, inline: true },
    { name: 'Balance', value: `**${formatCredits(balanceRows[0]?.credits || 0)}**`, inline: true },
    { name: 'Card ID', value: `\`${card.publicId}\``, inline: false }
  );
  const back = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`market:back:${ownerId}:${type}:${page}`)
      .setLabel('Back to Market')
      .setStyle(ButtonStyle.Secondary)
  );
  return interaction.editReply({ embeds: [embed], components: [back], attachments: [] });
}

module.exports = { buildMarketPanel, handleMarketSelect, handleMarketButton };
