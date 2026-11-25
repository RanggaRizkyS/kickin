const { SlashCommandBuilder, AttachmentBuilder , MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { claimPlayer } = require('../services/market');
const { renderPlayerCard } = require('../services/card-renderer');
const { successEmbed, buildPlayerOpeningEmbed } = require('../utils/message');
const { rarityFromOvr, sleep } = require('../utils/football');

module.exports = {
  data: new SlashCommandBuilder().setName('claim').setDescription('Klaim satu pemain gratis setiap dua jam.'),
  async execute(interaction) {
    const user = await getRegistered(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await claimPlayer(Number(user.id));
    for (let index = 0; index < 4; index += 1) {
      await interaction.editReply({ embeds: [buildPlayerOpeningEmbed({ title: 'PLAYER CLAIM', step: index, total: 4, caption: 'Kartu pemain sedang diacak…' })] });
      await sleep(550);
    }
    const rarity = rarityFromOvr(result.player.overall);
    const image = await renderPlayerCard({ player: result.player, rarity, currentOvr: result.player.overall });
    const file = new AttachmentBuilder(image, { name: 'claimed-player.png' });
    const embed = successEmbed('Player Claimed!', `Kamu mendapatkan **${result.player.name}**! Kartu telah ditambahkan ke My Players.`)
      .addFields(
        { name: 'OVR', value: `**${result.player.overall}**`, inline: true },
        { name: 'Position', value: `**${result.player.positions?.primary || '-'}**`, inline: true },
        { name: 'Rarity', value: `**${rarity.toUpperCase()}**`, inline: true },
        { name: 'Gold Pity', value: `${result.pity}/${result.pityGuarantee}`, inline: true }
      )
      .setImage('attachment://claimed-player.png')
      .setFooter({ text: 'Player added to My Players' });
    await interaction.editReply({ embeds: [embed], files: [file] });
  }
};
