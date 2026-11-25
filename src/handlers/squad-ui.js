const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
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
const { renderSquadTable } = require('../services/squad-renderer');
const { baseEmbed, formatStrength } = require('../utils/message');

const PAGE_SIZE = 20;
const states = new Map();

function getState(userId) {
  const key = String(userId);
  if (!states.has(key)) states.set(key, { page: 1, slotKey: null });
  return states.get(key);
}

function assertOwner(interaction, ownerId, type = 'squad') {
  if (String(interaction.user.id) !== String(ownerId)) {
    throw new Error(`Panel ${type} ini hanya bisa digunakan pemiliknya. Jalankan command terkait untuk membuka panel sendiri.`);
  }
}

async function getInteractionUser(interaction) {
  const user = await require('../services/users').getUserByDiscordId(interaction.user.id);
  if (!user) throw new Error('Jalankan `/start` terlebih dahulu.');
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
      .setPlaceholder(`Formation saat ini: ${squad.formation}`)
      .addOptions(...Object.keys(FORMATIONS).map(name => ({
        label: name,
        value: name,
        description: name === '4-3-3' ? 'Wide attacking shape' : name === '4-2-3-1' ? 'Two holding midfielders' : 'Two-striker formation',
        default: name === squad.formation
      })))
  );

  const slotRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`squad:slot:${ownerId}`)
      .setPlaceholder(state.slotKey ? `Posisi dipilih: ${state.slotKey}` : '1 · Pilih posisi yang ingin diisi')
      .addOptions(...slots.map(slot => {
        const current = squad.players.find(player => player.slotKey === slot.key);
        return {
          label: `${slot.key} · ${slot.label}`,
          value: slot.key,
          description: current ? `Saat ini: ${current.player.name}` : 'Slot kosong',
          default: state.slotKey === slot.key
        };
      }))
  );

  const playerOptions = pageCards.map(card => ({
    label: `${card.publicId || 'CARD'} · ${card.player.name} · ${Math.round(card.currentOvr)} OVR`.slice(0, 100),
    // Internal UUID is only the invisible component value. Users only see the public card label.
    value: String(card.cardInstanceId),
    description: `${card.player.positions?.primary || '-'} · Lv.${card.level}/50 · ${card.rarity}`.slice(0, 100)
  }));
  if (!playerOptions.length) playerOptions.push({
    label: 'Belum ada pemain tersedia', value: 'none', description: 'Semua kartu ada di XI atau sedang dipasang di market.'
  });

  const playerRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`squad:player:${ownerId}`)
      .setPlaceholder(state.slotKey ? `2 · Pilih pemain untuk ${state.slotKey}` : '2 · Pilih pemain dari My Players')
      .setDisabled(pageCards.length === 0)
      .addOptions(...playerOptions)
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`squad:prev:${ownerId}`).setEmoji('⬅️').setLabel('Sebelumnya').setStyle(ButtonStyle.Secondary).setDisabled(state.page <= 1),
    new ButtonBuilder().setCustomId(`squad:next:${ownerId}`).setEmoji('➡️').setLabel('Berikutnya').setStyle(ButtonStyle.Primary).setDisabled(state.page >= totalPages),
    new ButtonBuilder().setCustomId(`squad:remove:${ownerId}`).setLabel('Kosongkan Posisi').setStyle(ButtonStyle.Danger).setDisabled(!state.slotKey || !squad.players.some(player => player.slotKey === state.slotKey)),
    new ButtonBuilder().setCustomId(`squad:refresh:${ownerId}`).setLabel('Refresh').setStyle(ButtonStyle.Success)
  );

  return { components: [formationRow, slotRow, playerRow, navRow], page: state.page, totalPages };
}

async function buildSquadPanel(userId, ownerDiscordId) {
  const [squad, available] = await Promise.all([
    getSquadSnapshot(Number(userId)),
    getAvailableCards(Number(userId))
  ]);
  const state = getState(ownerDiscordId);
  const built = buildComponents(ownerDiscordId, squad, available, state);
  const embed = baseEmbed(
    '⚽ CLUB SQUAD · STARTING XI',
    [
      `**Formation:** ${squad.formation} · **${squad.players.length}/11** pemain terpasang`,
      `**My Players tersedia:** ${available.length} · Halaman **${built.page}/${built.totalPages}**`,
      '',
      state.slotKey
        ? `🎯 Posisi **${state.slotKey}** dipilih. Pilih pemain pada dropdown My Players untuk memasang atau menukar posisi.`
        : 'Gunakan dropdown posisi, lalu pilih pemain yang ingin dipasang. Pemain yang diganti otomatis kembali ke My Players.'
    ].join('\n'),
    0x22894f
  );
  embed.addFields(
    { name: 'TEAM OVR', value: `**${formatStrength(squad.teamOvr)}**`, inline: true },
    { name: 'CHEMISTRY', value: `**${formatStrength(squad.teamChemistry)} / 100**`, inline: true },
    { name: 'TEAM STRENGTH', value: `**${formatStrength(squad.teamStrength)}**`, inline: true }
  );
  embed.setFooter({ text: 'Satu squad per akun · Pilih posisi → pilih kartu · UUID database tidak ditampilkan' });
  const buffer = await renderSquadTable(squad, { title: 'CLUB SQUAD', subtitle: `Starting XI · ${available.length} cards available` });
  const file = new AttachmentBuilder(buffer, { name: 'club-squad-table.png' });
  embed.setImage('attachment://club-squad-table.png');
  return { embed, file, components: built.components, squad, available, page: built.page, totalPages: built.totalPages };
}

async function sendSquadPanel(interaction, userId) {
  const panel = await buildSquadPanel(userId, interaction.user.id);
  return interaction.reply({ embeds: [panel.embed], files: [panel.file], components: panel.components, flags: MessageFlags.Ephemeral });
}

async function updateSquadPanel(interaction, userId, { notice = null } = {}) {
  const panel = await buildSquadPanel(userId, interaction.user.id);
  if (notice) panel.embed.setDescription(`${notice}\n\n${panel.embed.data.description || ''}`);
  return interaction.editReply({ embeds: [panel.embed], files: [panel.file], components: panel.components, attachments: [] });
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
    return updateSquadPanel(interaction, user.id, { notice: `✅ Formation diperbarui menjadi **${formation}**.` });
  }

  if (action === 'slot') {
    state.slotKey = interaction.values[0];
    return updateSquadPanel(interaction, user.id, { notice: `🎯 Posisi **${state.slotKey}** dipilih. Pilih pemain dari dropdown.` });
  }

  if (action === 'player') {
    const cardReference = interaction.values[0];
    if (cardReference === 'none') throw new Error('Tidak ada pemain tersedia di My Players.');
    if (!state.slotKey) throw new Error('Pilih posisi terlebih dahulu.');
    const selectedSlot = state.slotKey;
    const result = await setSquadSlot(Number(user.id), selectedSlot, cardReference);
    state.slotKey = null;
    return updateSquadPanel(interaction, user.id, {
      notice: `✅ **${result.player}** berhasil dipasang di **${selectedSlot}**. Pemain yang tergeser kembali ke My Players.`
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
    if (!state.slotKey) throw new Error('Pilih posisi yang ingin dikosongkan terlebih dahulu.');
    const slot = state.slotKey;
    await removeSquadSlot(Number(user.id), slot);
    state.slotKey = null;
    return updateSquadPanel(interaction, user.id, { notice: `✅ Pemain dari posisi **${slot}** dikembalikan ke My Players.` });
  }
  return updateSquadPanel(interaction, user.id);
}

async function buildRemovePlayerPanel(userId, ownerDiscordId) {
  const squad = await getSquadSnapshot(Number(userId));
  const embed = baseEmbed(
    '↩️ REMOVE PLAYER · SQUAD',
    `**Formation:** ${squad.formation} · **${squad.players.length}/11** pemain terpasang\nPilih opsi dengan format **POSISI - NAMA** untuk mengembalikan pemain ke My Players.`,
    0xc65c5c
  );
  embed.addFields(
    { name: 'TEAM OVR', value: `**${formatStrength(squad.teamOvr)}**`, inline: true },
    { name: 'CHEMISTRY', value: `**${formatStrength(squad.teamChemistry)} / 100**`, inline: true },
    { name: 'TEAM STRENGTH', value: `**${formatStrength(squad.teamStrength)}**`, inline: true }
  );
  const buffer = await renderSquadTable(squad, { title: 'REMOVE PLAYER', subtitle: 'Select a position to remove its player' });
  const file = new AttachmentBuilder(buffer, { name: 'remove-player-squad-table.png' });
  embed.setImage('attachment://remove-player-squad-table.png');
  const occupied = squad.players.map(player => ({
    label: `${player.slotKey} - ${player.player.name}`.slice(0, 100),
    value: player.slotKey,
    description: `${Math.round(player.currentOvr)} OVR · ${player.slotPosition}`.slice(0, 100)
  }));
  const components = occupied.length
    ? [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`removeplayer:choose:${ownerDiscordId}`)
        .setPlaceholder('Pilih posisi - nama pemain yang akan ditarik')
        .addOptions(...occupied)
    )]
    : [];
  return { embed, file, components, squad };
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
  if (!occupant) throw new Error('Pemain pada posisi tersebut sudah tidak tersedia. Refresh `/removeplayer`.');
  await removeSquadSlot(Number(user.id), slot);
  const panel = await buildRemovePlayerPanel(Number(user.id), ownerId);
  panel.embed.setDescription(`✅ **${occupant.player.name}** dari posisi **${slot}** dikembalikan ke My Players.\n\n${panel.embed.data.description || ''}`);
  return interaction.editReply({ embeds: [panel.embed], files: [panel.file], components: panel.components, attachments: [] });
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
