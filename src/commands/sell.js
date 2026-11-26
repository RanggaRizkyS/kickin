const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { sellToSystem, createUserListing } = require('../services/market');
const { getPlayerAutocomplete } = require('../services/squad');
const { successEmbed, formatCredits } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder().setName('sell').setDescription('Sell a card to the system or list it for another manager.')
    .addStringOption(option => option.setName('type').setDescription('Choose where to sell the card').setRequired(true)
      .addChoices({ name: 'Sell to System', value: 'system' }, { name: 'List on User Market', value: 'user' }))
    .addStringOption(option => option.setName('player').setDescription('Find a card in your collection').setRequired(true).setAutocomplete(true))
    .addIntegerOption(option => option.setName('price').setDescription('Asking price for the User Market listing').setMinValue(1)),
  async autocomplete(interaction) {
    const user = await require('../services/users').getUserByDiscordId(interaction.user.id);
    if (!user) return interaction.respond([]);
    const choices = await getPlayerAutocomplete(Number(user.id), interaction.options.getFocused(), false);
    return interaction.respond(choices);
  },
  async execute(interaction) {
    const user = await getRegistered(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const type = interaction.options.getString('type');
    const cardId = interaction.options.getString('player');
    if (type === 'system') {
      const result = await sellToSystem(Number(user.id), cardId);
      await interaction.editReply({ embeds: [successEmbed('Player Sold', `**${result.player.name}** was sold to the System Market. You received **${formatCredits(result.sellPrice)}**.`)] });
    } else {
      const price = interaction.options.getInteger('price');
      if (!price) throw new Error('Enter `price` to create a User Market listing.');
      const result = await createUserListing(Number(user.id), cardId, price);
      await interaction.editReply({ embeds: [successEmbed('Listing Created', `**${result.player.name}** was listed on the User Market for **${formatCredits(result.askingPrice)}**. The listing uses a public listing reference.`)] });
    }
  }
};
