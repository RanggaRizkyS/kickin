const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder
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
const { renderMarketTable } = require('../services/market-renderer');
const { baseEmbed, successEmbed, formatCredits, formatStrength } = require('../utils/message');

const PAGE_SIZE = 10;

function clean(value, max = 24) {
  const text = String(value ?? '').replace(/[|`\n\r]/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function assertOwner(interaction, ownerDiscordId) {
  if (String(interaction.user.id) !== String(ownerDiscordId)) {
    throw new Error('Panel market ini hanya bisa digunakan oleh pemiliknya. Jalankan `/market` untuk membuka panel pribadi.');
  }
}

async function resolveUser(discordId) {
  const rows = await getPool().query(
    'SELECT id,discord_id,username,credits FROM users WHERE discord_id=? LIMIT 1',
    [String(discordId)]
  );
  if (!rows.length) throw new Error('Jalankan `/start` terlebih dahulu.');
  return rows[0];
}

function marketRowFields(entries, type, offset) {
  return entries.map((entry, index) => {
    const player = entry.player || entry;
    const listingId = type === 'system' ? entry.listingId : entry.publicListingId;
    const number = String(offset + index + 1).padStart(2, '0');
    const ovr = Math.round(Number(entry.currentOvr ?? player.overall ?? 0));
    const position = clean(player.positions?.primary || player.primary_position || '-', 8);
    const price = formatCredits(type === 'system' ? entry.marketPrice : entry.askingPrice);
    const stockOrSeller = type === 'system'
      ? `Stock tersedia: **${Number(entry.stock || 0).toLocaleString('id-ID')}**`
      : `Seller: **${clean(entry.sellerName || 'Manager', 50)}**`;
    return {
      name: `#${number} · ${clean(listingId || '—', 18)} · ${clean(player.name, 78)} · ${ovr} OVR`,
      value: `**${position}** · ${String(entry.rarity || player.rarity || 'bronze').toUpperCase()} · **${price}**\n${stockOrSeller}`,
      inline: false
    };
  });
}

function makePanelComponents({ ownerId, type, page, totalPages, entries }) {
  const components = [];
  if (entries.length) {
    const options = entries.map(entry => {
      const player = entry.player || entry;
      const listingId = type === 'system' ? entry.listingId : entry.publicListingId;
      const ovr = Number(entry.currentOvr ?? entry.overall ?? player.overall ?? 0);
      const price = Number(type === 'system' ? entry.marketPrice : entry.askingPrice);
      const position = player.positions?.primary || player.primary_position || '—';
      return {
        label: `${listingId} · ${player.name} · ${Math.round(ovr)} OVR`.slice(0, 100),
        value: String(listingId),
        description: `${position} · ${formatCredits(price)}${type === 'system' ? ` · Stock ${entry.stock}` : ` · ${entry.sellerName}`}`.slice(0, 100)
      };
    });
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`market:choose:${ownerId}:${type}:${page}`)
        .setPlaceholder('Pilih Listing ID untuk melihat detail dan membeli')
        .addOptions(options)
    ));
  }

  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`market:prev:${ownerId}:${type}:${Math.max(1, page - 1)}`)
      .setEmoji('⬅️')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`market:next:${ownerId}:${type}:${Math.min(totalPages, page + 1)}`)
      .setEmoji('➡️')
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages),
    new ButtonBuilder()
      .setCustomId(`market:switch:${ownerId}:${type}:1`)
      .setLabel(type === 'system' ? 'User Market' : 'System Market')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`market:refresh:${ownerId}:${type}:${page}`)
      .setLabel('Refresh')
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
  const title = type === 'system' ? '🏪 SYSTEM PLAYER MARKET' : '🤝 COMMUNITY PLAYER MARKET';
  const description = [
    `**${total.toLocaleString('en-US')}** listing tersedia · Halaman **${page}/${totalPages}**`,
    `Saldo: **${formatCredits(user.credits)}**`,
    type === 'system'
      ? 'Harga bergerak mengikuti stok dan permintaan global.'
      : 'Listing berasal dari pengguna lain. Listing ID berbeda dari ID kartu milik pembeli.'
  ].join('\n\n');

  const embed = baseEmbed(title, description, type === 'system' ? 0x253a52 : 0x31513f);
  embed.addFields(
    { name: 'LISTINGS / PAGE', value: '**10**', inline: true },
    { name: 'MARKET', value: type === 'system' ? '**System**' : '**User**', inline: true },
    { name: 'SELECT BY', value: '**Listing ID**', inline: true }
  );
  embed.setFooter({ text: 'Pilih Listing ID dari dropdown untuk detail dan konfirmasi pembelian. ID listing berbeda dari ID kartu.' });
  const tableBuffer = await renderMarketTable({ entries, type, page, total, balance: Number(user.credits || 0) });
  const file = new AttachmentBuilder(tableBuffer, { name: 'player-market-table.png' });
  embed.setImage('attachment://player-market-table.png');

  return {
    embed,
    file,
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
    files: panel.file ? [panel.file] : [],
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
  const position = player.positions?.primary || player.primary_position || '—';
  const details = [
    `**${player.nationality?.country || 'Unknown'}** · ${player.club?.name || 'Free Agent'}`,
    `**${player.role?.name || 'Player'}** · ${position} · ${String(rarity).toUpperCase()}`,
    '',
    `**Listing ID:** \`${type === 'system' ? item.listingId : item.publicListingId}\``,
    `**OVR:** ${formatStrength(currentOvr)}`,
    `**Price:** ${formatCredits(price)}`,
    type === 'system'
      ? `**Stock:** ${Number(item.stock).toLocaleString('en-US')} cards`
      : `**Seller:** ${item.sellerName}`,
    `**Skills:** ${(player.skills || []).map(skill => skill.name).join(' · ') || 'No special skills'}`
  ].join('\n');
  const embed = baseEmbed(`⚽ ${player.name}`, details, rarity === 'gold' ? 0xd5a63c : rarity === 'silver' ? 0x9ba9b8 : 0xa97553);
  embed.setFooter({ text: 'Konfirmasi pembelian untuk memproses transaksi secara aman.' });

  const page = Math.max(1, Number(pageText) || 1);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`market:buy:${ownerId}:${type}:${reference}:${page}`)
      .setLabel(`Buy · ${formatCredits(price)}`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('🪙'),
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

  if (['prev', 'next', 'refresh', 'switch', 'back'].includes(action)) {
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
  if (!card) throw new Error('Pembelian berhasil, tetapi kartu tidak dapat dimuat. Cek `/players`.');
  const balanceRows = await getPool().query('SELECT credits FROM users WHERE id=? LIMIT 1', [user.id]);
  const currentOvr = estimatedOverall({ level: card.level, currentStats: card.currentStats }, card.player, card.player.positions?.primary);
  const embed = successEmbed(
    'PLAYER SIGNED',
    `**${card.player.name}** berhasil masuk ke My Players.\n\n` +
    `**Card ID:** \`${card.publicId}\`\n` +
    `**OVR:** ${formatStrength(currentOvr)}\n` +
    `**Purchase:** ${formatCredits(result.price)}\n` +
    `**Remaining Balance:** ${formatCredits(balanceRows[0]?.credits || 0)}\n\n` +
    'Gunakan `/players` untuk mengelola kartu tersebut.'
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
