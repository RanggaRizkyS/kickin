const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');
const config = require('../config');
const { getUserByDiscordId } = require('../services/users');
const { openPack, getCard } = require('../services/market');
const { renderPlayerCard } = require('../services/card-renderer');
const { baseEmbed, successEmbed, errorEmbed, formatCredits } = require('../utils/message');
const { rarityFromOvr } = require('../utils/football');

const pendingPackPurchases = new Set();

function assertOwner(interaction, ownerId) {
  if (String(interaction.user.id) !== String(ownerId)) {
    throw new Error('Menu pack ini hanya bisa digunakan oleh pembukanya. Jalankan `/pack` untuk membuka menu sendiri.');
  }
}

function normalizePackType(value) {
  return Object.prototype.hasOwnProperty.call(config.economy.packs, value) ? value : 'pro';
}

function maxPackQuantity() {
  // Discord select menus allow at most 25 options.
  return Math.max(1, Math.min(25, Number(config.economy.packMaxQuantity) || 5));
}

function normalizeQuantity(value) {
  return Math.max(1, Math.min(maxPackQuantity(), Number(value) || 1));
}

function packComponents(ownerId, packType, quantity) {
  const packChoices = Object.entries(config.economy.packs).map(([key, pack]) => ({
    label: `${pack.name} · ${formatCredits(pack.price)}`.slice(0, 100),
    value: key,
    description: `${pack.players} pemain per pack`.slice(0, 100),
    default: key === packType
  }));
  const typeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pack:type:${ownerId}:${quantity}`)
      .setPlaceholder('Pilih jenis pack')
      .addOptions(packChoices)
  );

  const maxQty = maxPackQuantity();
  const quantityChoices = Array.from({ length: maxQty }, (_, index) => {
    const value = index + 1;
    return { label: `${value} Pack${value > 1 ? 's' : ''}`, value: String(value), default: value === quantity };
  });
  const quantityRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pack:quantity:${ownerId}:${packType}`)
      .setPlaceholder('Pilih jumlah pack')
      .addOptions(quantityChoices)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pack:confirm:${ownerId}:${packType}:${quantity}`)
      .setLabel('Confirm Purchase')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pack:cancel:${ownerId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
  return [typeRow, quantityRow, actionRow];
}

async function buildPackPanel(ownerId, requestedType = 'pro', requestedQuantity = 1, notice = null) {
  const packType = normalizePackType(requestedType);
  const quantity = normalizeQuantity(requestedQuantity);
  const user = await getUserByDiscordId(ownerId);
  if (!user) throw new Error('Jalankan `/start` terlebih dahulu.');
  const pack = config.economy.packs[packType];
  const totalPrice = Number(pack.price) * quantity;
  const totalPlayers = Number(pack.players) * quantity;

  const priceList = Object.entries(config.economy.packs).map(([key, entry]) =>
    `**${entry.name}** · ${formatCredits(entry.price)} · ${entry.players} pemain`
  ).join('\n');

  const lines = [
    '**DAFTAR PACK**',
    priceList,
    '',
    `**Pilihan:** ${pack.name}`,
    `**Quantity:** ${quantity}`,
    `**Total pemain:** ${totalPlayers}`,
    `**Total harga:** ${formatCredits(totalPrice)}`,
    `**Saldo saat ini:** ${formatCredits(user.credits)}`,
    ''
  ];
  if (notice) lines.unshift(`⚠️ ${notice}`, '');
  lines.push(Number(user.credits) >= totalPrice
    ? 'Saldo mencukupi. Tekan **Confirm Purchase** untuk membeli dan langsung membuka pack.'
    : `Saldo belum mencukupi. Kamu kekurangan **${formatCredits(totalPrice - Number(user.credits))}**.`);

  const embed = baseEmbed('🎁 PLAYER PACK STORE', lines.join('\n'), 0xd6aa42);
  embed.setFooter({ text: `Maksimal ${maxPackQuantity()} pack per transaksi · Hasil langsung ditampilkan setelah konfirmasi` });
  return { embed, components: packComponents(ownerId, packType, quantity), packType, quantity, totalPrice };
}

async function handlePackSelect(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];
  assertOwner(interaction, ownerId);
  let packType = 'pro';
  let quantity = 1;
  if (action === 'type') {
    quantity = normalizeQuantity(parts[3]);
    packType = normalizePackType(interaction.values[0]);
  } else if (action === 'quantity') {
    packType = normalizePackType(parts[3]);
    quantity = normalizeQuantity(interaction.values[0]);
  } else {
    return;
  }
  try {
    await interaction.deferUpdate();
    const panel = await buildPackPanel(ownerId, packType, quantity);
    return await interaction.editReply({ embeds: [panel.embed], components: panel.components, attachments: [] });
  } catch (error) {
    const payload = { embeds: [errorEmbed(error.message || 'Tidak dapat memuat pack store.')], components: [], attachments: [] };
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

function packResultsFields(entries) {
  if (!entries.length) return [];
  const rows = entries.map((entry, index) => {
    const player = entry.player || {};
    const id = String(entry.publicId || '—').slice(0, 12).padEnd(12);
    const name = String(player.name || 'Unknown').replace(/[|`\n\r]/g, ' ').slice(0, 22).padEnd(22);
    const ovr = String(Math.round(Number(player.overall || 0))).padStart(2);
    const pos = String(player.positions?.primary || '-').slice(0, 3).padEnd(3);
    const tier = String(rarityFromOvr(player.overall)).toUpperCase();
    return `${String(index + 2).padStart(2, '0')}  ${id}  ${name}  ${ovr}  ${pos}  ${tier}`;
  });

  // Split long packs into valid Discord embed fields instead of truncating
  // entries silently. One card image is reserved for the highest-OVR pull.
  const chunks = [];
  for (let index = 0; index < rows.length; index += 10) {
    chunks.push(rows.slice(index, index + 10));
  }
  return chunks.map((chunk, index) => {
    const table = ['NO  CARD ID       PLAYER                  OVR POS TIER', ...chunk].join('\n');
    return {
      name: `OTHER PLAYERS · ${index + 1}/${chunks.length}`,
      value: `\`\`\`text\n${table}\n\`\`\``,
      inline: false
    };
  });
}

async function handlePackButton(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];
  assertOwner(interaction, ownerId);

  if (action === 'cancel') {
    return interaction.update({
      embeds: [baseEmbed('PACK PURCHASE CANCELLED', 'Tidak ada Credits yang dipotong dan tidak ada pemain yang diberikan.', 0x747b84)],
      components: [],
      attachments: []
    });
  }

  if (action !== 'confirm') return;
  const packType = normalizePackType(parts[3]);
  const quantity = normalizeQuantity(parts[4]);
  const purchaseLock = `${ownerId}:${interaction.message?.id || interaction.id}`;
  if (pendingPackPurchases.has(purchaseLock)) {
    return interaction.reply({
      content: 'Pembelian pack ini sedang diproses. Tunggu hasilnya sebelum menekan konfirmasi lagi.',
      flags: MessageFlags.Ephemeral
    });
  }
  pendingPackPurchases.add(purchaseLock);

  try {
    await interaction.deferUpdate();
    const user = await getUserByDiscordId(ownerId);
    if (!user) throw new Error('Akun tidak ditemukan. Jalankan `/start` terlebih dahulu.');

    // The purchase transaction checks the live MariaDB balance and rolls back
    // completely when the balance is insufficient.
    const result = await openPack(Number(user.id), packType, quantity);
    const enriched = await Promise.all(result.players.map(async entry => {
      const card = await getCard(entry.cardInstanceId, Number(user.id));
      return {
        ...entry,
        publicId: card?.publicId || 'PC-PENDING',
        currentStats: card?.currentStats || entry.player.stats?.main || entry.player.stats?.goalkeeper || {}
      };
    }));
    enriched.sort((a, b) => Number(b.player.overall) - Number(a.player.overall));
    if (!enriched.length) throw new Error('Pack tidak menghasilkan kartu. Transaksi dibatalkan oleh sistem.');

    const featured = enriched[0];
    const remaining = enriched.slice(1);
    const rarity = rarityFromOvr(featured.player.overall);
    const image = await renderPlayerCard({
      player: featured.player,
      rarity,
      currentOvr: featured.player.overall,
      currentStats: featured.currentStats
    });
    const file = new AttachmentBuilder(image, { name: 'pack-highest-player.png' });

    const description = [
      `**${result.packName}** · ${result.quantity} pack`,
      `Total kartu: **${enriched.length}**`,
      `Total harga: **${formatCredits(result.totalPrice)}**`,
      `Sisa saldo: **${formatCredits(result.balanceAfter)}**`,
      '',
      `**TOP PLAYER · ${featured.player.name} · ${featured.player.overall} OVR**`,
      `Card ID: \`${featured.publicId}\``,
      '',
      remaining.length ? '**PEMAIN LAINNYA**' : '**Tidak ada kartu tambahan**'
    ].join('\n');

    const embed = successEmbed('🎉 PACK OPENED!', description, 0xd6aa42)
      .setImage('attachment://pack-highest-player.png')
      .setFooter({ text: 'Hanya pemain dengan OVR tertinggi memakai gambar kartu. Pemain lain ditampilkan sebagai tabel.' });
    if (remaining.length) embed.addFields(...packResultsFields(remaining));

    // Edit the deferred interaction reply, not interaction.message. This avoids
    // stale-message fetch/abort races and replaces any previous attachment.
    return interaction.editReply({
      embeds: [embed],
      files: [file],
      attachments: [],
      components: []
    });
  } catch (error) {
    const panel = await buildPackPanel(ownerId, packType, quantity, error.message || 'Pembelian gagal.').catch(() => null);
    const payload = panel
      ? { embeds: [panel.embed], components: panel.components, attachments: [] }
      : { embeds: [errorEmbed(error.message || 'Pack gagal dibuka.')], components: [], attachments: [] };
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
  } finally {
    pendingPackPurchases.delete(purchaseLock);
  }
}

module.exports = { buildPackPanel, handlePackSelect, handlePackButton, packResultsFields };
