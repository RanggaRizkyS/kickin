const { MessageFlags } = require('discord.js');
const { requireRegisteredUser } = require('../services/users');
const { errorEmbed } = require('./message');

async function getRegistered(interaction) {
  return requireRegisteredUser(interaction.user);
}

async function replyError(interaction, error) {
  const description = error?.message || 'Terjadi kesalahan yang tidak diketahui.';
  const payload = { embeds: [errorEmbed(description)], flags: MessageFlags.Ephemeral };
  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply({ embeds: payload.embeds, components: [] }).catch(() => {});
  }
  if (interaction.replied) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

function userTag(user) {
  return user?.globalName || user?.username || 'Player';
}

function clampPage(page, total, pageSize) {
  return Math.max(1, Math.min(Math.max(1, Math.ceil(total / pageSize)), Number(page) || 1));
}

module.exports = { getRegistered, replyError, userTag, clampPage };
