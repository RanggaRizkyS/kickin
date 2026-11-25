const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { sellToSystem, createUserListing } = require('../services/market');
const { getPlayerAutocomplete } = require('../services/squad');
const { successEmbed, formatCredits } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder().setName('sell').setDescription('Sell a card or list it on the User Market.')
    .addStringOption(option => option.setName('type').setDescription('How to sell the card').setRequired(true)
      .addChoices({ name: 'Sell to System', value: 'system' }, { name: 'List on User Market', value: 'user' }))
    .addStringOption(option => option.setName('player').setDescription('Search and select a card you own').setRequired(true).setAutocomplete(true))
    .addIntegerOption(option => option.setName('price').setDescription('User Market asking price').setMinValue(1)),
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
      await interaction.editReply({ embeds: [successEmbed('Player Sold', `**${result.player.name}** berhasil dijual ke System Market. Kamu menerima **${formatCredits(result.sellPrice)}**.`)] });
    } else {
      const price = interaction.options.getInteger('price');
      if (!price) throw new Error('Masukkan `price` untuk memasang listing User Market.');
      const result = await createUserListing(Number(user.id), cardId, price);
      await interaction.editReply({ embeds: [successEmbed('Listing Created', `**${result.player.name}** dipasang di User Market dengan harga **${formatCredits(result.askingPrice)}**. Listing tidak ditampilkan dengan ID internal.`)] });
    }
  }
};
