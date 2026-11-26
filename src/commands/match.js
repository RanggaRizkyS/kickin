const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { prepareQuickMatch } = require('../services/match-service');
const { buildPreMatchEmbed, errorEmbed } = require('../utils/message');
const { startMatchAfterPreview } = require('../handlers/match-flow');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('Find an opponent and review both line-ups before kick-off.')
    .addStringOption(option => option
      .setName('mode')
      .setDescription('Choose the match mode')
      .setRequired(true)
      .addChoices(
        { name: 'Ranked · managers only', value: 'ranked' },
        { name: 'Classic · managers or CPU', value: 'classic' }
      )),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const user = await getRegistered(interaction);
      const mode = interaction.options.getString('mode');
      const matchData = await prepareQuickMatch(user, mode);
      const opponentType = matchData.opponentType || (matchData.away?.isBot ? 'bot' : 'human');
      const data = { ...matchData, opponentType };
      const message = await interaction.editReply({
        embeds: [buildPreMatchEmbed({ ...data, countdownSeconds: 5 })],
        components: []
      });
      await startMatchAfterPreview(message, data);
    } catch (error) {
      await interaction.editReply({ embeds: [errorEmbed(error.message)], components: [] }).catch(() => {});
    }
  }
};
