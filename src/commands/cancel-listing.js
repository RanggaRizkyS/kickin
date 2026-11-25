const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { getPool } = require('../db');
const { cancelUserListing } = require('../services/market');
const { successEmbed } = require('../utils/message');

module.exports = {
  data: new SlashCommandBuilder().setName('cancel-listing').setDescription('Remove one of your active User Market listings.')
    .addStringOption(option => option.setName('listing').setDescription('Search and select your listing').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) {
    const user = await require('../services/users').getUserByDiscordId(interaction.user.id);
    if (!user) return interaction.respond([]);
    const focused = interaction.options.getFocused();
    const rows = await getPool().query(
      `SELECT l.listing_id,l.public_listing_id,l.asking_price,p.name,p.overall,p.primary_position
       FROM user_market_listings l
       JOIN user_player_cards c ON c.card_instance_id=l.card_instance_id
       JOIN players_catalog p ON p.player_id=c.player_id
       WHERE l.seller_user_id=? AND l.status='active' AND p.name LIKE ?
       ORDER BY l.created_at DESC LIMIT 25`,
      [Number(user.id), `%${String(focused).slice(0, 40)}%`]
    );
    return interaction.respond(rows.map(row => ({
      name: `${row.public_listing_id} · ${row.name} · ${row.overall} OVR`.slice(0, 100),
      value: row.public_listing_id,
      description: `${row.primary_position} · Your active listing`
    })));
  },
  async execute(interaction) {
    const user = await getRegistered(interaction);
    const listingId = interaction.options.getString('listing');
    await cancelUserListing(Number(user.id), listingId);
    await interaction.reply({
      embeds: [successEmbed('Listing Cancelled', 'Listing berhasil ditarik. Kartu kembali tersedia di My Players.')],
      flags: MessageFlags.Ephemeral
    });
  }
};
