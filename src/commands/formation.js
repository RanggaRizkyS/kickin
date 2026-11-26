const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { setFormation } = require('../services/squad');
const { buildSquadPanel } = require('../handlers/squad-ui');

module.exports = {
  data: new SlashCommandBuilder().setName('formation').setDescription('Select your formation for your starting XI.')
    .addStringOption(option => option.setName('name').setDescription('Select your formation').setRequired(true)
      .addChoices({ name: '4-3-3', value: '4-3-3' }, { name: '4-2-3-1', value: '4-2-3-1' }, { name: '4-4-2', value: '4-4-2' })),
  async execute(interaction) {
    const user = await getRegistered(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const name = interaction.options.getString('name');
    const result = await setFormation(Number(user.id), name);
    const panel = await buildSquadPanel(Number(user.id), interaction.user.id);
    panel.embed.setDescription(`✅ Formation set to **${name}**. ${result.reassigned || 0} player positions were reassigned.\n\n${panel.embed.data.description || ''}`);
    await interaction.editReply({ embeds: [panel.embed], files: panel.file ? [panel.file] : [], components: panel.components });
  }
};
