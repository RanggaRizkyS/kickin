const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRegistered } = require('../utils/commands');
const { prepareQuickMatch } = require('../services/match-service');
const { buildPreMatchEmbed, errorEmbed } = require('../utils/message');
const { startMatchAfterPreview } = require('../handlers/match-flow');


module.exports = {
    data: new SlashCommandBuilder()
        .setName('match')
        .setDescription(
            'Cari lawan dan mulai pertandingan sepak bola.'
        )
        .addStringOption(option =>
            option
                .setName('mode')
                .setDescription('Pilih mode pertandingan')
                .setRequired(true)
                .addChoices(
                    {
                        name: 'Ranked',
                        value: 'ranked'
                    },
                    {
                        name: 'Classic',
                        value: 'classic'
                    }
                )
        ),

    async execute(interaction) {
        // IMPORTANT:
        // Match message harus PUBLIC, bukan ephemeral.
        await interaction.deferReply();

        try {
            const user = await getRegistered(interaction);

            const mode = interaction.options.getString('mode');

            const matchData = await prepareQuickMatch(
                user,
                mode
            );

            const opponentType = matchData.opponentType ||
                (matchData.away?.isBot ? 'bot' : 'human');

            const data = {
                ...matchData,
                opponentType
            };

            // Buat pesan pertandingan publik.
            const message = await interaction.editReply({
                embeds: [
                    buildPreMatchEmbed({
                        ...data,
                        countdownSeconds: 5
                    })
                ],
                components: []
            });

            // Mulai pertandingan menggunakan pesan publik.
            await startMatchAfterPreview(message, data);

        } catch (error) {
            console.error('[MATCH COMMAND ERROR]', error);

            await interaction.editReply({
                embeds: [
                    errorEmbed(
                        error.message ||
                        'Terjadi kesalahan saat memulai pertandingan.'
                    )
                ],
                components: []
            }).catch(editError => {
                console.error(
                    '[MATCH ERROR RESPONSE]',
                    editError
                );
            });
        }
    }
};
