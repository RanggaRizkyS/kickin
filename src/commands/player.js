const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { getCard } = require('../services/market');
const { getPlayerAutocomplete } = require('../services/squad');
const { renderPlayerCard } = require('../services/card-renderer');
const { baseEmbed } = require('../utils/message');
const { xpRequired, estimatedOverall } = require('../utils/football');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Open a player card and view its attributes and development.')
    .addStringOption(option => option.setName('player').setDescription('Search for a card in your collection').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) {
    const user = await require('../services/users').getUserByDiscordId(interaction.user.id);
    if (!user) return interaction.respond([]);
    const choices = await getPlayerAutocomplete(Number(user.id), interaction.options.getFocused(), true);
    return interaction.respond(choices);
  },
  async execute(interaction) {
    const user = await getRegistered(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const card = await getCard(interaction.options.getString('player'), Number(user.id));
    if (!card) throw new Error('Player card tidak ditemukan di koleksimu.');
    const player = card.player;
    const currentOvr = estimatedOverall({ level: card.level, currentStats: card.currentStats }, player, player.positions?.primary);
    const buffer = await renderPlayerCard({ player, rarity: card.rarity, currentOvr, position: player.positions?.primary, currentStats: card.currentStats });
    const file = new AttachmentBuilder(buffer, { name: 'player-card.png' });
    const stats = card.currentStats || player.stats?.main || player.stats?.goalkeeper || {};
    const keys = player.stats?.type === 'goalkeeper'
      ? ['diving', 'handling', 'kicking', 'reflexes', 'speed', 'positioning']
      : ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
    const statsText = keys.map(key => `${key.toUpperCase()}: **${stats[key] ?? stats[key.toUpperCase()] ?? 0}**`).join(' · ');
    const embed = baseEmbed(player.name, `${player.nationality?.country || 'Unknown'} · ${player.club?.name || 'Free Agent'}\n**${player.role?.name || 'Player'}**`, 0x30343b)
      .addFields(
        { name: 'Position / OVR', value: `**${player.positions?.primary || '-'} · ${currentOvr}** (Base ${player.overall})`, inline: true },
        { name: 'Development', value: `**Lv. ${card.level}/50** · ${card.xp}/${xpRequired(card.level)} XP`, inline: true },
        { name: 'Strong Foot', value: `**${player.strong_foot || '-'}**`, inline: true },
        { name: 'Skills', value: (player.skills || []).map(item => item.name).join(', ') || 'None' },
        { name: 'Attributes', value: statsText || 'No stats' }
      )
      .setImage('attachment://player-card.png')
      .setFooter({ text: `Potential ${player.potential} · Player development increases through match performance` });
    await interaction.editReply({ embeds: [embed], files: [file] });
  }
};
