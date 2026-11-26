const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { claimPlayer, getClaimStatus, getCard } = require('../services/market');
const { renderPlayerCard } = require('../services/card-renderer');
const { successEmbed, errorEmbed, buildPlayerOpeningEmbed, formatNumber } = require('../utils/message');
const { rarityFromOvr, sleep } = require('../utils/football');

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim one player. Available once every two hours.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = await getRegistered(interaction);
    const status = await getClaimStatus(Number(user.id));

    if (!status.available) {
      const timestamp = Math.floor(status.nextClaimAtMs / 1000);
      const embed = errorEmbed(
        `Your next claim is ready in **${formatRemaining(status.remainingMs)}**.\n` +
        `Available <t:${timestamp}:R>.`
      );
      return interaction.editReply({ embeds: [embed], components: [] });
    }

    let result;
    try {
      result = await claimPlayer(Number(user.id));
    } catch (error) {
      if (error.code === 'CLAIM_COOLDOWN') {
        const timestamp = Math.floor(Number(error.nextClaimAtMs || (Date.now() + error.remainingMs)) / 1000);
        return interaction.editReply({
          embeds: [errorEmbed(`Your next claim is ready in **${formatRemaining(error.remainingMs)}**.\nAvailable <t:${timestamp}:R>.`)],
          components: []
        });
      }
      throw error;
    }

    // The short reveal belongs only to the free claim flow. Pack openings go straight to results.
    for (let index = 0; index < 3; index += 1) {
      await interaction.editReply({
        embeds: [buildPlayerOpeningEmbed({
          title: 'PLAYER CLAIM',
          step: index,
          total: 3,
          caption: 'Preparing the card.'
        })]
      });
      await sleep(350);
    }

    const card = await getCard(result.cardInstanceId, Number(user.id));
    const rarity = rarityFromOvr(result.player.overall);
    const image = await renderPlayerCard({
      player: result.player,
      rarity,
      currentOvr: result.player.overall,
      currentStats: card?.currentStats
    });
    const file = new AttachmentBuilder(image, { name: 'claimed-player.png' });
    const nextClaim = Math.floor(result.nextClaimAtMs / 1000);

    const embed = successEmbed(
      'Claim Complete',
      `**${result.player.name}** has joined your collection.\nNext claim <t:${nextClaim}:R>.`
    )
      .addFields(
        { name: 'OVR', value: `**${result.player.overall}**`, inline: true },
        { name: 'Position', value: `**${result.player.positions?.primary || '-'}**`, inline: true },
        { name: 'Rarity', value: `**${rarity.toUpperCase()}**`, inline: true },
        { name: 'Gold pity', value: `**${formatNumber(result.pity)} / ${formatNumber(result.pityGuarantee)}**`, inline: true }
      )
      .setImage('attachment://claimed-player.png');

    await interaction.editReply({ embeds: [embed], files: [file], components: [] });
  }
};
