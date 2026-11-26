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
const { baseEmbed, successEmbed, errorEmbed, formatCredits, truncate } = require('../utils/message');
const { rarityFromOvr } = require('../utils/football');

const pendingPackPurchases = new Set();

function assertOwner(interaction, ownerId) {
  if (String(interaction.user.id) !== String(ownerId)) {
    throw new Error('This order belongs to another manager. Open your own pack counter with /pack.');
  }
}

function normalizePackType(value) {
  return Object.prototype.hasOwnProperty.call(config.economy.packs, value) ? value : 'pro';
}

function maxPackQuantity() {
  return Math.max(1, Math.min(25, Number(config.economy.packMaxQuantity) || 5));
}

function normalizeQuantity(value) {
  return Math.max(1, Math.min(maxPackQuantity(), Number(value) || 1));
}

function packWeightText(weights = []) {
  const [bronze = 0, silver = 0, gold = 0] = weights.map(Number);
  return `Bronze ${bronze}% · Silver ${silver}% · Gold ${gold}%`;
}

function packComponents(ownerId, packType, quantity) {
  const packChoices = Object.entries(config.economy.packs).map(([key, pack]) => ({
    label: `${pack.name} · ${formatCredits(pack.price)}`.slice(0, 100),
    value: key,
    description: `${pack.players} player cards · ${packWeightText(pack.weights)}`.slice(0, 100),
    default: key === packType
  }));
  const typeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pack:type:${ownerId}:${quantity}`)
      .setPlaceholder('Select a pack')
      .addOptions(packChoices)
  );

  const quantityChoices = Array.from({ length: maxPackQuantity() }, (_, index) => {
    const value = index + 1;
    return {
      label: `${value} ${value === 1 ? 'pack' : 'packs'}`,
      value: String(value),
      default: value === quantity
    };
  });
  const quantityRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pack:quantity:${ownerId}:${packType}`)
      .setPlaceholder('Select quantity')
      .addOptions(quantityChoices)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pack:confirm:${ownerId}:${packType}:${quantity}`)
      .setLabel('Open pack')
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
  if (!user) throw new Error('Your club is not registered. Run /start first.');

  const selected = config.economy.packs[packType];
  const totalPrice = Number(selected.price) * quantity;
  const totalCards = Number(selected.players) * quantity;
  const balance = Number(user.credits || 0);
  const shortfall = Math.max(0, totalPrice - balance);
  const embed = baseEmbed(
    'Pack Counter',
    'Choose a pack and quantity. The order is charged only after confirmation.',
    0x3b3544
  );

  embed.addFields(Object.entries(config.economy.packs).map(([key, pack]) => ({
    name: `${key === packType ? '● ' : ''}${pack.name}`,
    value: `**${formatCredits(pack.price)}** · ${Number(pack.players)} cards\n${packWeightText(pack.weights)}`,
    inline: true
  })));

  embed.addFields({
    name: 'Order Summary',
    value: `**${selected.name}** × ${quantity}\n${totalCards} player cards · **${formatCredits(totalPrice)}**\nBalance ${formatCredits(balance)}${shortfall ? ` · Short ${formatCredits(shortfall)}` : ''}`,
    inline: false
  });

  if (notice) {
    embed.addFields({ name: 'Order Status', value: truncate(notice, 900), inline: false });
  } else if (shortfall) {
    embed.addFields({ name: 'Order Status', value: `You need **${formatCredits(shortfall)}** more to place this order.`, inline: false });
  }

  return {
    embed,
    components: packComponents(ownerId, packType, quantity),
    packType,
    quantity,
    totalPrice,
    totalCards,
    balance,
    affordable: shortfall === 0
  };
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

  await interaction.deferUpdate();
  const panel = await buildPackPanel(ownerId, packType, quantity);
  return interaction.editReply({ embeds: [panel.embed], components: panel.components, attachments: [] });
}

function packResultsFields(entries) {
  if (!entries.length) return [];
  if (entries.length <= 18) {
    return entries.map((entry, index) => {
      const player = entry.player || {};
      return {
        name: `${String(index + 2).padStart(2, '0')} · ${truncate(player.name || 'Unknown player', 42)}`,
        value: `**${Math.round(Number(player.overall || 0))} OVR** · ${player.positions?.primary || '-'} · ${rarityFromOvr(player.overall).toUpperCase()}\nCard ID · \`${entry.publicId || '—'}\``,
        inline: true
      };
    });
  }

  const fields = [];
  for (let start = 0; start < entries.length; start += 5) {
    const chunk = entries.slice(start, start + 5);
    fields.push({
      name: `Other pulls · ${start + 1}–${start + chunk.length}`,
      value: chunk.map(entry => {
        const player = entry.player || {};
        return `**${truncate(player.name || 'Unknown player', 42)}** · ${Math.round(Number(player.overall || 0))} OVR · ${player.positions?.primary || '-'} · ${entry.publicId || '—'}`;
      }).join('\n'),
      inline: false
    });
  }
  return fields;
}

async function handlePackButton(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];
  assertOwner(interaction, ownerId);

  if (action === 'cancel') {
    return interaction.update({
      embeds: [baseEmbed('Order Cancelled', 'No Credits were charged.', 0x747b84)],
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
      content: 'This order is already being processed.',
      flags: MessageFlags.Ephemeral
    });
  }
  pendingPackPurchases.add(purchaseLock);

  try {
    await interaction.deferUpdate();
    const user = await getUserByDiscordId(ownerId);
    if (!user) throw new Error('Your club was not found. Run /start first.');

    const pack = config.economy.packs[packType];
    const totalPrice = Number(pack.price) * quantity;
    if (Number(user.credits) < totalPrice) {
      const shortage = totalPrice - Number(user.credits);
      const panel = await buildPackPanel(ownerId, packType, quantity,
        `Order not placed. Your balance is short by ${formatCredits(shortage)}.`);
      return interaction.editReply({ embeds: [panel.embed], components: panel.components, attachments: [] });
    }

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
    if (!enriched.length) throw new Error('No cards were returned. The transaction was not completed.');

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

    const embed = successEmbed(
      'Pack Opened',
      `${result.packName} × ${result.quantity} · ${enriched.length} cards\n` +
      `Spent ${formatCredits(result.totalPrice)} · Balance ${formatCredits(result.balanceAfter)}`,
      0xc59a43
    )
      .addFields({
        name: `Top pull · ${truncate(featured.player.name, 48)}`,
        value: `**${Math.round(Number(featured.player.overall))} OVR** · ${featured.player.positions?.primary || '-'} · ${rarity.toUpperCase()}\nCard ID · \`${featured.publicId}\``,
        inline: true
      })
      .setImage('attachment://pack-highest-player.png');

    if (remaining.length) embed.addFields(...packResultsFields(remaining));
    return interaction.editReply({ embeds: [embed], files: [file], attachments: [], components: [] });
  } catch (error) {
    const panel = await buildPackPanel(ownerId, packType, quantity, error.message || 'The order could not be completed.').catch(() => null);
    const payload = panel
      ? { embeds: [panel.embed], components: panel.components, attachments: [] }
      : { embeds: [errorEmbed(error.message || 'The pack could not be opened.')], components: [], attachments: [] };
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
  } finally {
    pendingPackPurchases.delete(purchaseLock);
  }
}

module.exports = { buildPackPanel, handlePackSelect, handlePackButton, packResultsFields };
