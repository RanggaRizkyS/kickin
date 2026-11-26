const { SlashCommandBuilder } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { createFriendlyInvitation } = require('../services/match-service');
const { invitationButtons, baseEmbed } = require('../utils/message');
const { getPool } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('friendly')
    .setDescription('Challenge another manager to a friendly match.')
    .addUserOption(option => option
      .setName('opponent')
      .setDescription('The manager you want to challenge')
      .setRequired(true)),

  async execute(interaction) {
    const user = await getRegistered(interaction);
    const target = interaction.options.getUser('opponent');
    const invitation = await createFriendlyInvitation(user, target.id, interaction.channelId);
    await interaction.reply({
      embeds: [baseEmbed(
        'FRIENDLY CHALLENGE',
        `<@${interaction.user.id}> has challenged <@${target.id}>.\n\nThe invitation stays open for 10 minutes. Both line-ups will be shown before kick-off.`,
        0x3478bd
      )],
      components: [invitationButtons(invitation.invitationId)],
      allowedMentions: { users: [target.id] }
    });
    const message = await interaction.fetchReply();
    await getPool().query(
      'UPDATE match_invitations SET message_id=? WHERE invitation_id=?',
      [message.id, invitation.invitationId]
    );
  }
};
