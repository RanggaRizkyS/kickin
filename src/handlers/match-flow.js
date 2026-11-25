const { MessageFlags } = require('discord.js');
const { buildPreMatchEmbed, kickoffButtons, invitationButtons, errorEmbed } = require('../utils/message');
const {
  runPreparedMatchDiscord,
  acceptFriendlyInvitation,
  declineFriendlyInvitation
} = require('../services/match-service');
const { getUserById } = require('../services/users');
const { getSquadSnapshot } = require('../services/squad');
const { sleep } = require('../utils/football');
const crypto = require('node:crypto');

const pendingFlows = new Map();
const FLOW_TTL_MS = 3 * 60 * 1000;

function addPendingFlow(data) {
  const token = crypto.randomBytes(6).toString('hex');
  const expiresAt = Date.now() + FLOW_TTL_MS;
  const timer = setTimeout(() => pendingFlows.delete(token), FLOW_TTL_MS);
  timer.unref?.();
  pendingFlows.set(token, { ...data, expiresAt, timer });
  return token;
}

async function startMatchAfterPreview(message, data) {
  // The caller has already sent the squad comparison embed. Keep it visible
  // for exactly five seconds without issuing repeated REST edits; those edits
  // used to stretch the pre-match phase and could trigger Discord aborts.
  await sleep(5000);

  return runPreparedMatchDiscord({
    message,
    mode: data.mode,
    home: data.home,
    away: data.away,
    homeUserId: data.homeUserId,
    awayUserId: data.awayUserId,
    homeName: data.homeName,
    awayName: data.awayName
  });
}

async function sendMatchPreview(interaction, data, { ephemeral = false, opponentType = 'human' } = {}) {
  const response = await interaction.reply({
    embeds: [buildPreMatchEmbed({ ...data, opponentType, countdownSeconds: 5 })],
    components: [],
    ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {})
  });
  const message = response?.id ? response : await interaction.fetchReply();
  return startMatchAfterPreview(message, { ...data, opponentType });
}

// Retained to make old preview messages harmless during a bot update.
async function handleMatchButton(interaction) {
  const [, action, token] = interaction.customId.split(':');
  const flow = pendingFlows.get(token);
  if (!flow || flow.expiresAt < Date.now()) {
    pendingFlows.delete(token);
    return interaction.reply({ content: 'Preview pertandingan sudah kedaluwarsa. Jalankan command pertandingan lagi.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'cancel') {
    clearTimeout(flow.timer);
    pendingFlows.delete(token);
    return interaction.update({ embeds: [errorEmbed('Pertandingan dibatalkan sebelum kick-off.')], components: [] });
  }
  if (action === 'kickoff') {
    clearTimeout(flow.timer);
    pendingFlows.delete(token);
    await interaction.deferUpdate();
    try {
      await startMatchAfterPreview(interaction.message, flow);
    } catch (error) {
      await interaction.message.edit({ embeds: [errorEmbed(error.message)], components: [] }).catch(() => {});
    }
  }
}

async function handleFriendlyButton(interaction) {
  const [, action, invitationId] = interaction.customId.split(':');
  await interaction.deferUpdate();
  if (action === 'decline') {
    await declineFriendlyInvitation(invitationId, interaction.user.id);
    return interaction.editReply({ embeds: [errorEmbed('Undangan pertandingan ditolak.')], components: [] });
  }
  if (action !== 'accept') return;

  const accepted = await acceptFriendlyInvitation(invitationId, interaction.user.id);
  const [homeUser, awayUser] = await Promise.all([
    getUserById(accepted.fromId),
    getUserById(accepted.toId)
  ]);
  if (!homeUser || !awayUser) throw new Error('Data salah satu pengguna tidak ditemukan.');
  const [home, away] = await Promise.all([
    getSquadSnapshot(Number(homeUser.id)),
    getSquadSnapshot(Number(awayUser.id))
  ]);
  if (!home.complete || !away.complete) throw new Error('Salah satu squad belum lengkap. Lengkapi 11 pemain sebelum Friendly.');

  const data = {
    mode: 'friendly',
    home,
    away,
    homeUserId: Number(homeUser.id),
    awayUserId: Number(awayUser.id),
    homeName: homeUser.username,
    awayName: awayUser.username,
    opponentType: 'human'
  };
  await interaction.editReply({
    embeds: [buildPreMatchEmbed({ ...data, countdownSeconds: 5 })],
    components: []
  });
  await startMatchAfterPreview(interaction.message, data);
}

module.exports = {
  addPendingFlow,
  sendMatchPreview,
  startMatchAfterPreview,
  handleMatchButton,
  handleFriendlyButton,
  pendingFlows
};
