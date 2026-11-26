const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { findOrCreateDiscordUser, ensureStarterSquad } = require('../services/users');
const { successEmbed, formatCredits } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Register your club and receive a starter squad.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await findOrCreateDiscordUser(interaction.user);
    if (!user) throw new Error('Your club could not be created. Check the database connection and try again.');

    const starter = await ensureStarterSquad(Number(user.id));
    const credits = formatCredits(Number(user.credits));
    const embed = successEmbed(
      starter.created ? 'Club Registered' : 'Welcome Back',
      starter.created ? 'Your club is on the books. The starting XI is ready.' : 'Your club is already on the books.'
    );
    embed.addFields(
      { name: 'Credits', value: `**${credits}**`, inline: true },
      { name: 'Account Level', value: `**Lv. ${Number(user.account_level || 1)}**`, inline: true },
      { name: 'Starter XI', value: starter.created ? '**11 players**' : '**In place**', inline: true }
    );
    await interaction.editReply({ embeds: [embed] });
  }
};
