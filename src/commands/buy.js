const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const {
  buySystemPlayer,
  buyUserListing,
  listSystemMarket,
  listUserListings,
  getSystemMarketItem,
  getCard
} = require('../services/market');
const { successEmbed, formatCredits, formatStrength } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Beli pemain dari System Market atau User Market.')
    .addStringOption(option => option
      .setName('type')
      .setDescription('Sumber market')
      .setRequired(true)
      .addChoices(
        { name: 'System Market', value: 'system' },
        { name: 'User Market Listing', value: 'user' }
      ))
    .addStringOption(option => option
      .setName('target')
      .setDescription('Cari dan pilih listing pemain')
      .setRequired(true)
      .setAutocomplete(true)),

  async autocomplete(interaction) {
    const type = interaction.options.getString('type');
    const focused = interaction.options.getFocused();
    if (!type) return interaction.respond([]);

    if (type === 'system') {
      const result = await listSystemMarket({ search: focused, limit: 25, sort: 'ovr_desc' });
      return interaction.respond(result.players.slice(0, 25).map(player => ({
        name: `${player.listingId} · ${player.name} · ${player.overall} OVR · ${formatCredits(player.marketPrice)}`.slice(0, 100),
        value: player.listingId,
        description: `${player.positions?.primary || '-'} · Stock ${player.stock}`.slice(0, 100)
      })));
    }

    const listings = await listUserListings({ search: focused, limit: 25, offset: 0 });
    return interaction.respond(listings.slice(0, 25).map(listing => ({
      name: `${listing.publicListingId} · ${listing.player.name} · ${Math.round(listing.currentOvr)} OVR`.slice(0, 100),
      value: listing.publicListingId,
      description: `${listing.player.positions?.primary || '-'} · ${formatCredits(listing.askingPrice)} · Seller: ${listing.sellerName}`.slice(0, 100)
    })));
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = await getRegistered(interaction);
    const type = interaction.options.getString('type');
    const target = interaction.options.getString('target').trim();

    let result;
    if (type === 'system') {
      const listing = await getSystemMarketItem(target);
      result = await buySystemPlayer(Number(user.id), listing.id);
    } else {
      result = await buyUserListing(Number(user.id), target);
    }

    const card = await getCard(result.cardInstanceId, Number(user.id));
    const balanceRows = await require('../db').getPool().query(
      'SELECT credits FROM users WHERE id=? LIMIT 1', [user.id]
    );
    await interaction.editReply({
      embeds: [successEmbed(
        'PURCHASE SUCCESSFUL',
        `**${typeof result.player === 'string' ? result.player : result.player.name}** berhasil ditambahkan ke My Players.\n\n` +
        `**Card ID:** \`${card?.publicId || 'PC-PENDING'}\`\n` +
        `**Price:** ${formatCredits(result.price ?? result.askingPrice)}\n` +
        `**Remaining Balance:** ${formatCredits(balanceRows[0]?.credits || 0)}\n` +
        `**OVR:** ${formatStrength(card?.player?.overall || 0)}`
      )]
    });
  }
};
