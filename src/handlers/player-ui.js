const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');
const { getCard, sellToSystem } = require('../services/market');
const { getSquadSnapshot, getOwnedCard, setSquadSlot } = require('../services/squad');
const { renderPlayerCard } = require('../services/card-renderer');
const { buildSquadPanel } = require('./squad-ui');
const { getPool } = require('../db');
const { baseEmbed, successEmbed, formatCredits } = require('../utils/message');
const { FORMATIONS, estimatedOverall, xpRequired } = require('../utils/football');

function assertOwner(interaction, ownerId) {
  if (String(interaction.user.id) !== String(ownerId)) {
    throw new Error('This player panel belongs to another manager.');
  }
}

async function showPlayerCard(interaction, ownerId, cardId, { update = false, page = 1 } = {}) {
  const user = await require('../services/users').getUserByDiscordId(ownerId);
  if (!user) throw new Error('Run `/start` first.');
  const card = await getCard(cardId, Number(user.id));
  if (!card) throw new Error('That player card is not in your collection.');
  const player = card.player;
  const squad = await getSquadSnapshot(Number(user.id));
  const inSquad = squad.players.find(entry => entry.cardInstanceId === cardId || entry.publicId === cardId);
  const owned = await getOwnedCard(Number(user.id), cardId);
  const currentOvr = estimatedOverall({ level: card.level, currentStats: card.currentStats }, player, player.positions?.primary);
  const buffer = await renderPlayerCard({
    player,
    rarity: card.rarity,
    currentOvr,
    position: player.positions?.primary,
    currentStats: card.currentStats
  });
  const file = new AttachmentBuilder(buffer, { name: 'selected-player.png' });
  const stats = card.currentStats || player.stats?.main || player.stats?.goalkeeper || {};
  const statLabels = player.stats?.type === 'goalkeeper'
    ? ['diving', 'handling', 'kicking', 'reflexes', 'speed', 'positioning']
    : ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
  const statText = statLabels.map(key => `${key.toUpperCase()} **${stats[key] ?? stats[key.toUpperCase()] ?? player.stats?.main?.[key] ?? player.stats?.goalkeeper?.[key] ?? 0}**`).join('  •  ');
  const cardEmbed = baseEmbed(
    `⚽ ${player.name}`,
    `${player.nationality?.country || 'Unknown'}  •  ${player.club?.name || 'Free Agent'}\n**${player.role?.name || 'Player'}**  ·  ${player.positions?.primary || '-'}  ·  ${card.rarity.toUpperCase()}`,
    card.rarity === 'gold' ? 0xd5a63c : card.rarity === 'silver' ? 0x9ba9b8 : 0xa97553
  )
    .addFields(
      { name: 'Overall', value: `**${currentOvr} OVR**  ·  Base ${player.overall}`, inline: true },
      { name: 'Development', value: `**Lv. ${card.level}/50**\n${card.xp}/${xpRequired(card.level)} XP`, inline: true },
      { name: 'Foot', value: `**${player.strong_foot || '-'}**  ·  Weak ${player.weak_foot ?? '-'}`, inline: true },
      { name: 'Attributes', value: statText || 'No attributes', inline: false },
      { name: 'Skills', value: (player.skills || []).map(item => item.name).join(' · ') || 'No special skills', inline: false },
      { name: 'Squad Status', value: inSquad ? `In Starting XI · **${inSquad.slotKey}**` : owned?.isListed ? 'Listed on User Market' : 'Available in My Players', inline: true },
      { name: 'Potential', value: `**${player.potential || player.overall}**`, inline: true }
    )
    .setImage('attachment://selected-player.png');

  const components = [];
  if (!owned?.isListed) {
    const slots = FORMATIONS[squad.formation] || FORMATIONS['4-3-3'];
    const slotOptions = slots.map(slot => {
      const occupant = squad.players.find(entry => entry.slotKey === slot.key);
      return {
        label: `${slot.key} · ${slot.label}`,
        value: slot.key,
        description: occupant ? `Replace ${occupant.player.name}` : 'Empty position'
      };
    });
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`player:place:${ownerId}:${cardId}`)
        .setPlaceholder('Place this player into your squad')
        .addOptions(...slotOptions)
    ));
  }
  const actionButtons = [];
  if (!inSquad && !owned?.isListed) {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId(`player:sell:${ownerId}:${cardId}:${page}`)
        .setLabel('Sell to System Market')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🪙')
    );
  }
  if (update) {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId(`player:back:${ownerId}:${page}`)
        .setLabel('Back to My Players')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('↩️')
    );
  }
  if (actionButtons.length) components.push(new ActionRowBuilder().addComponents(...actionButtons));

  const payload = { embeds: [cardEmbed], files: [file], components, attachments: [] };
  if (update) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function handlePlayersSelect(interaction) {
  const [, action, ownerId, pageText] = interaction.customId.split(':');
  assertOwner(interaction, ownerId);
  if (action !== 'choose') return;
  await interaction.deferUpdate();
  return showPlayerCard(interaction, ownerId, interaction.values[0], { update: true, page: Number(pageText) || 1 });
}

async function handlePlayerSelect(interaction) {
  const [, action, ownerId, cardId] = interaction.customId.split(':');
  assertOwner(interaction, ownerId);
  if (action !== 'place') return;
  await interaction.deferUpdate();
  const user = await require('../services/users').getUserByDiscordId(ownerId);
  if (!user) throw new Error('Run `/start` first.');
  const slot = interaction.values[0];
  const result = await setSquadSlot(Number(user.id), slot, cardId);
  const panel = await buildSquadPanel(Number(user.id), ownerId);
  panel.embed.setDescription(`**${result.player}** assigned to **${slot}**.`);
  return interaction.editReply({ embeds: [panel.embed], files: panel.file ? [panel.file] : [], attachments: [], components: panel.components });
}

async function handlePlayerButton(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];
  const cardId = parts[3];
  const page = Math.max(1, Number(parts[4]) || 1);
  assertOwner(interaction, ownerId);
  await interaction.deferUpdate();

  if (action === 'back') {
    const user = await require('../services/users').getUserByDiscordId(ownerId);
    if (!user) throw new Error('Run `/start` first.');
    const playersCommand = require('../commands/players');
    const page = Math.max(1, Number(cardId) || 1);
    const result = await playersCommand.buildPage(
      Number(user.id),
      page,
      interaction.user.globalName || interaction.user.username,
      ownerId
    );
    return interaction.editReply({
      embeds: [result.embed],
      files: result.file ? [result.file] : [],
      components: result.components,
      attachments: []
    });
  }

  const user = await require('../services/users').getUserByDiscordId(ownerId);
  if (!user) throw new Error('Run `/start` first.');

  if (action === 'sell') {
    const card = await getCard(cardId, Number(user.id));
    if (!card) throw new Error('Player card not found.');
    const embed = baseEmbed(
      '⚠️ CONFIRM PLAYER SALE',
      `You are about to sell **${card.player.name}** (${card.player.overall} OVR) to the System Market.\n\nThis sale cannot be reversed after confirmation.`,
      0xc94c4c
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`player:sell-yes:${ownerId}:${cardId}:${page}`).setLabel('Confirm Sale').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`player:sell-no:${ownerId}:${cardId}:${page}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    return interaction.editReply({ embeds: [embed], components: [row], attachments: [] });
  }

  if (action === 'sell-no') {
    const back = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`player:back:${ownerId}:${page}`).setLabel('Back to My Players').setStyle(ButtonStyle.Secondary)
    );
    return interaction.editReply({ embeds: [successEmbed('Sale Cancelled', 'The card remains in My Players.')], components: [back], attachments: [] });
  }

  if (action === 'sell-yes') {
    const result = await sellToSystem(Number(user.id), cardId);
    const back = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`player:back:${ownerId}:${page}`).setLabel('Back to My Players').setStyle(ButtonStyle.Secondary)
    );
    return interaction.editReply({
      embeds: [successEmbed('Player Sold', `**${result.player.name}** was sold. You received **${formatCredits(result.sellPrice)}**.`)],
      components: [back],
      attachments: []
    });
  }
}

module.exports = { showPlayerCard, handlePlayersSelect, handlePlayerSelect, handlePlayerButton };
