const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags
} = require('discord.js');
const { FORMATIONS } = require('../utils/football');
const {
  getSquadSnapshot,
  getAvailableCards,
  setSquadSlot,
  removeSquadSlot,
  setFormation
} = require('../services/squad');
const { baseEmbed, formatStrength, addSquadFields } = require('../utils/message');

const PAGE_SIZE = 20;
const states = new Map();

function getState(userId) {
  const key = String(userId);
  if (!states.has(key)) states.set(key, { page: 1, slotKey: null });
  return states.get(key);
}

function assertOwner(interaction, ownerId, type = 'squad') {
  if (String(interaction.user.id) !== String(ownerId)) {
    throw new Error(`This ${type} panel belongs to another manager. Run /${type === 'remove-player' ? 'removeplayer' : 'squad'} to open your own panel.`);
  }
}

async function getInteractionUser(interaction) {
  const user = await require('../services/users').getUserByDiscordId(interaction.user.id);
  if (!user) throw new Error('You do not have a club yet. Run /start first.');
  return user;
}

function buildComponents(ownerId, squad, available, state) {
  const slots = FORMATIONS[squad.formation] || FORMATIONS['4-3-3'];
  const totalPages = Math.max(1, Math.ceil(available.length / PAGE_SIZE));
  state.page = Math.max(1, Math.min(totalPages, Number(state.page) || 1));
  const pageCards = available.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  const formationRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`squad:formation:${ownerId}`)
      .setPlaceholder(`Formation · ${squad.formation}`)
      .addOptions(...Object.keys(FORMATIONS).map(name => ({
        label: name,
        value: name,
        description: name === '4-3-3' ? 'Three forwards and a balanced midfield' : name === '4-2-3-1' ? 'Two holding midfielders' : 'Two central forwards',
        default: name === squad.formation
      })))
  );

  const slotRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`squad:slot:${ownerId}`)
      .setPlaceholder(state.slotKey ? `Selected position · ${state.slotKey}` : '1 · Choose a position')
      .addOptions(...slots.map(slot => {
        const current = squad.players.find(player => player.slotKey === slot.key);
        return {
          label: `${slot.key} · ${slot.label}`,
          value: slot.key,
          description: current ? `Current player · ${current.player.name}` : 'Empty position',
          default: state.slotKey === slot.key
        };
      }))
  );

  const playerOptions = pageCards.map(card => ({
    label: `${card.publicId || 'CARD'} · ${card.player.name} · ${Math.round(card.currentOvr)} OVR`.slice(0, 100),
    // The component value is internal. The manager only sees the short public Card ID.
    value: String(card.cardInstanceId),
    description: `${card.player.positions?.primary || '-'} · Lv.${card.level}/50 · ${card.rarity}`.slice(0, 100)
  }));
  if (!playerOptions.length) {
    playerOptions.push({
      label: 'No available cards',
      value: 'none',
      description: 'Cards in your XI or active listings are not available here.'
    });
  }

  const playerRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`squad:player:${ownerId}`)
      .setPlaceholder(state.slotKey ? `2 · Choose a card for ${state.slotKey}` : '2 · Choose a card from My Players')
      .setDisabled(pageCards.length === 0)
      .addOptions(...playerOptions)
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`squad:prev:${ownerId}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.page <= 1),
    new ButtonBuilder()
      .setCustomId(`squad:next:${ownerId}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.page >= totalPages),
    new ButtonBuilder()
      .setCustomId(`squad:remove:${ownerId}`)
      .setLabel('Clear slot')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!state.slotKey || !squad.players.some(player => player.slotKey === state.slotKey))
  );

  return { components: [formationRow, slotRow, playerRow, navRow], page: state.page, totalPages };
}

function addSquadSummary(embed, squad) {
  embed.addFields(
    { name: 'TEAM OVR', value: `**${formatStrength(squad.teamOvr)}**`, inline: false },
    { name: 'CHEMISTRY', value: `**${formatStrength(squad.teamChemistry)} / 100**`, inline: false },
    { name: 'TEAM STRENGTH', value: `**${formatStrength(squad.teamStrength)}**`, inline: false }
  );
}

async function buildSquadPanel(userId, ownerDiscordId) {
  const [squad, available] = await Promise.all([
    getSquadSnapshot(Number(userId)),
    getAvailableCards(Number(userId))
  ]);
  const state = getState(ownerDiscordId);
  const built = buildComponents(ownerDiscordId, squad, available, state);
  const embed = baseEmbed(
    'Club Squad',
    `${squad.formation} · ${squad.players.length}/11 starters · ${available.length} available cards · Page ${built.page}/${built.totalPages}`,
    0x263e35
  );
  addSquadSummary(embed, squad);
  addSquadFields(embed, squad);
  if (state.slotKey) embed.setDescription(`${squad.formation} · ${squad.players.length}/11 starters · Selected: **${state.slotKey}** · Page ${built.page}/${built.totalPages}`);
  return { embed, components: built.components, squad, available, page: built.page, totalPages: built.totalPages };
}

async function sendSquadPanel(interaction, userId) {
  const panel = await buildSquadPanel(userId, interaction.user.id);
  return interaction.reply({ embeds: [panel.embed], components: panel.components, flags: MessageFlags.Ephemeral });
}

async function updateSquadPanel(interaction, userId, { notice = null } = {}) {
  const panel = await buildSquadPanel(userId, interaction.user.id);
  if (notice) panel.embed.setDescription(`${notice}\n\n${panel.embed.data.description || ''}`);
  return interaction.editReply({ embeds: [panel.embed], components: panel.components, attachments: [] });
}

async function handleSquadSelect(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');
  assertOwner(interaction, ownerId);
  await interaction.deferUpdate();
  const user = await getInteractionUser(interaction);
  const state = getState(ownerId);

  if (action === 'formation') {
    const formation = interaction.values[0];
    await setFormation(Number(user.id), formation);
    state.slotKey = null;
    state.page = 1;
    return updateSquadPanel(interaction, user.id, { notice: `Formation changed to **${formation}**.` });
  }

  if (action === 'slot') {
    state.slotKey = interaction.values[0];
    return updateSquadPanel(interaction, user.id, { notice: `**${state.slotKey}** selected. Choose a player below.` });
  }

  if (action === 'player') {
    const cardReference = interaction.values[0];
    if (cardReference === 'none') throw new Error('There are no available cards in My Players.');
    if (!state.slotKey) throw new Error('Choose a position before selecting a player.');
    const selectedSlot = state.slotKey;
    const result = await setSquadSlot(Number(user.id), selectedSlot, cardReference);
    state.slotKey = null;
    return updateSquadPanel(interaction, user.id, {
      notice: `**${result.player}** is now assigned to **${selectedSlot}**. Any replaced player has returned to My Players.`
    });
  }
}

async function handleSquadButton(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');
  assertOwner(interaction, ownerId);
  await interaction.deferUpdate();
  const user = await getInteractionUser(interaction);
  const state = getState(ownerId);
  if (action === 'prev') state.page = Math.max(1, state.page - 1);
  else if (action === 'next') state.page += 1;
  else if (action === 'remove') {
    if (!state.slotKey) throw new Error('Choose the position you want to clear first.');
    const slot = state.slotKey;
    await removeSquadSlot(Number(user.id), slot);
    state.slotKey = null;
    return updateSquadPanel(interaction, user.id, { notice: `The player in **${slot}** has returned to My Players.` });
  }
  return updateSquadPanel(interaction, user.id);
}

async function buildRemovePlayerPanel(userId, ownerDiscordId) {
  const squad = await getSquadSnapshot(Number(userId));
  const embed = baseEmbed(
    'Remove Player',
    `${squad.formation} · ${squad.players.length}/11 starters`,
    0x593b3b
  );
  addSquadSummary(embed, squad);
  addSquadFields(embed, squad);
  const occupied = squad.players.map(player => ({
    label: `${player.slotKey} · ${player.player.name}`.slice(0, 100),
    value: player.slotKey,
    description: `${Math.round(player.currentOvr)} OVR · ${player.slotPosition}`.slice(0, 100)
  }));
  const components = occupied.length
    ? [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`removeplayer:choose:${ownerDiscordId}`)
        .setPlaceholder('Choose a player to remove')
        .addOptions(...occupied)
    )]
    : [];
  return { embed, components, squad };
}

async function handleRemovePlayerSelect(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');
  assertOwner(interaction, ownerId, 'remove-player');
  if (action !== 'choose') return;
  await interaction.deferUpdate();
  const user = await getInteractionUser(interaction);
  const slot = interaction.values[0];
  const before = await getSquadSnapshot(Number(user.id));
  const occupant = before.players.find(player => player.slotKey === slot);
  if (!occupant) throw new Error('That position is already empty. Run /removeplayer again to load the current squad.');
  await removeSquadSlot(Number(user.id), slot);
  const panel = await buildRemovePlayerPanel(Number(user.id), ownerId);
  panel.embed.setDescription(`**${occupant.player.name}** was removed from **${slot}**.`);
  return interaction.editReply({ embeds: [panel.embed], components: panel.components, attachments: [] });
}

module.exports = {
  buildSquadPanel,
  sendSquadPanel,
  updateSquadPanel,
  handleSquadSelect,
  handleSquadButton,
  buildRemovePlayerPanel,
  handleRemovePlayerSelect
};
