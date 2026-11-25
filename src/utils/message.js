const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { FORMATIONS, formatCredits, formatStrength } = require('./football');
const config = require('../config');

const COLORS = {
  green: 0x249653,
  red: 0xd74444,
  blue: 0x3478bd,
  gold: 0xd6aa42,
  neutral: 0x30343b,
  success: 0x2eaa67,
  danger: 0xd64b4b
};

function truncate(value, max = 90) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function baseEmbed(title, description, color = COLORS.blue) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(truncate(title, 256))
    .setDescription(truncate(description || '\u200b', 4000))
    .setTimestamp();
}

function errorEmbed(message) {
  return baseEmbed('Terjadi Kesalahan', `⚠️ ${message}`, COLORS.danger);
}

function successEmbed(title, description) {
  return baseEmbed(title, `✅ ${description}`, COLORS.success);
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function tableForTeam(team) {
  const slots = FORMATIONS[team.formation] || FORMATIONS['4-3-3'];
  const byKey = new Map((team.players || []).map(player => [player.slotKey, player]));
  const lines = ['NO  POS  PLAYER                 OVR'];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const entry = byKey.get(slot.key);
    if (!entry) {
      lines.push(`${String(index + 1).padStart(2, '0')}  ${slot.label.padEnd(3)}  ${( '(empty)' ).padEnd(22)}  --`);
      continue;
    }
    const shirt = String(entry.shirtNumber || index + 1).padStart(2, '0').slice(-2);
    const pos = String(entry.slotPosition || slot.label).padEnd(3).slice(0, 3);
    const name = truncate(entry.player?.name || 'Unknown', 21).padEnd(21);
    const ovr = String(Math.round(Number(entry.currentOvr || entry.player?.overall || 0))).padStart(2, ' ');
    lines.push(`${shirt}  ${pos}  ${name}  ${ovr}`);
  }
  return `\`\`\`text\n${lines.join('\n')}\n\`\`\``;
}

function addTeamSummary(embed, prefix, team, inline = true) {
  embed.addFields(
    { name: `${prefix} · Team OVR`, value: `**${formatStrength(team.teamOvr)}**`, inline },
    { name: `${prefix} · Chemistry`, value: `**${formatStrength(team.teamChemistry)}**`, inline },
    { name: `${prefix} · Strength`, value: `**${formatStrength(team.teamStrength)}**`, inline }
  );
}

function buildPlayerOpeningEmbed({ title = 'PLAYER REVEAL', step = 0, total = 4, caption = 'Kartu sedang diacak…' } = {}) {
  const frames = ['◐', '◓', '◑', '◒'];
  const safeTotal = Math.max(1, Number(total) || 4);
  const safeStep = Math.max(0, Math.min(safeTotal - 1, Number(step) || 0));
  const filled = Math.round(((safeStep + 1) / safeTotal) * 12);
  const bar = `${'▰'.repeat(filled)}${'▱'.repeat(12 - filled)}`;
  return baseEmbed(`${frames[safeStep % frames.length]} ${title}`, `${caption}

${bar}

**REVEALING ${safeStep + 1}/${safeTotal}**`, COLORS.gold);
}

function averageOutfieldStats(team) {
  const keys = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
  const players = (team.players || []).filter(entry => entry.slotPosition !== 'GK');
  if (!players.length) return 'No outfield players';
  return keys.map(key => {
    const total = players.reduce((sum, entry) => {
      const stats = entry.currentStats || entry.player?.stats?.main || {};
      return sum + Number(stats[key] ?? stats[key.toLowerCase()] ?? 0);
    }, 0);
    return `${key} **${Math.round(total / players.length)}**`;
  }).join(' · ');
}

function buildPreMatchEmbed({ mode, home, away, opponentType = 'human', countdownSeconds = 5 }) {
  const modeName = String(mode || 'classic').toUpperCase();
  const countdown = Math.max(0, Number(countdownSeconds) || 0);
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle('⚽ MATCH PREVIEW · SQUAD COMPARISON')
    .setDescription([
      `**${truncate(home.username, 80)}**  vs  **${truncate(away.username, 80)}**`,
      `Mode: **${modeName}**  ·  Opponent: **${opponentType === 'bot' ? `Adaptive CPU · ${away.botPersonality || 'adaptive'}` : 'Real Player'}**`,
      '',
      `**KICK-OFF IN ${countdown} SECOND${countdown === 1 ? '' : 'S'}**`,
      'Line-up sudah dikunci. Periksa OVR setiap pemain dan kekuatan total kedua squad.'
    ].join('\n'))
    .addFields(
      { name: `🟩 ${truncate(home.username, 70)} · ${home.formation}`, value: tableForTeam(home), inline: false },
      { name: `🟥 ${truncate(away.username, 70)} · ${away.formation}`, value: tableForTeam(away), inline: false },
      { name: '🟩 YOUR TEAM · AVG ATTRIBUTES', value: averageOutfieldStats(home), inline: true },
      { name: '🟥 OPPONENT · AVG ATTRIBUTES', value: averageOutfieldStats(away), inline: true }
    );
  addTeamSummary(embed, '🟩 YOUR TEAM', home, true);
  addTeamSummary(embed, '🟥 OPPONENT', away, true);
  embed.setFooter({ text: 'Match: 90 seconds · 1 second = 1 minute · Half-time is included at minute 45' });
  return embed;
}

function buildKickoffEmbed({ homeName, awayName, mode, stage = 0 }) {
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle('🏟️ KICK-OFF')
    .setDescription([
      `**${truncate(homeName, 70)}**  **0 — 0**  **${truncate(awayName, 70)}**`,
      '',
      'The referee blows the whistle. The match is underway!',
      '',
      '▰▰▰▰▰▰▱▱▱▱'
    ].join('\n'))
    .addFields(
      { name: 'Competition', value: String(mode || 'classic').toUpperCase(), inline: true },
      { name: 'Duration', value: '90 minutes', inline: true },
      { name: 'Clock', value: '1 minute = 1 second', inline: true }
    )
    .setFooter({ text: 'Line-ups locked • Match simulation started' });
}

function markerForSide(side) {
  if (side === 'system') return '⚪';
  return side === 'home' ? '🟩' : '🟥';
}

function scoreAtMinute(match, minute) {
  const entry = match.sim.logs[Math.max(0, Math.min(89, minute - 1))];
  return entry?.score || { home: 0, away: 0 };
}

function buildLiveMatchEmbed(match, minute) {
  const score = scoreAtMinute(match, minute);
  const visibleLines = Math.max(5, Math.min(10, Number(config.match.visibleLogLines) || 5));
  const first = Math.max(0, minute - visibleLines);
  const lines = match.sim.logs.slice(first, minute).map(entry =>
    `${markerForSide(entry.side)} **${String(entry.minute).padStart(2, '0')}'** ${truncate(entry.text, 180)}`
  );
  const filled = Math.floor((minute / 90) * 18);
  const bar = `${'🟩'.repeat(filled)}${'⬛'.repeat(18 - filled)}`;
  return new EmbedBuilder()
    .setColor(COLORS.green)
    .setTitle(`⚽ ${String(match.mode).toUpperCase()} · LIVE MATCH`)
    .setDescription([
      `**${truncate(match.homeName, 70)}**  **${score.home} — ${score.away}**  **${truncate(match.awayName, 70)}**`,
      '',
      `${bar}`,
      `**MINUTE ${String(minute).padStart(2, '0')} / 90**`,
      `**RECENT MATCH LOGS · ${Math.max(1, minute - (visibleLines - 1))}'–${minute}'**`,
      '',
      lines.length ? lines.join('\n') : '⚪ Kick-off segera dimulai…'
    ].join('\n'))
    .addFields(
      { name: 'TEAM OVR', value: `${formatStrength(match.home.teamOvr)}  |  ${formatStrength(match.away.teamOvr)}`, inline: true },
      { name: 'CHEMISTRY', value: `${formatStrength(match.home.teamChemistry)}  |  ${formatStrength(match.away.teamChemistry)}`, inline: true },
      { name: 'STRENGTH', value: `${formatStrength(match.home.teamStrength)}  |  ${formatStrength(match.away.teamStrength)}`, inline: true }
    )
    .setFooter({ text: '🟩 Tim kamu • 🟥 Lawan • 1 log diperbarui setiap detik • 90 menit total' });
}

function buildHalfTimeEmbed(match) {
  const score = scoreAtMinute(match, 45);
  const recent = match.sim.logs.slice(39, 45).map(entry =>
    `${markerForSide(entry.side)} **${String(entry.minute).padStart(2, '0')}'** ${truncate(entry.text, 125)}`
  );
  const bar = '🟩'.repeat(9) + '⬛'.repeat(9);
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle('⏸️ HALF-TIME · 45\'')
    .setDescription([
      `**${truncate(match.homeName, 65)}**  **${score.home} — ${score.away}**  **${truncate(match.awayName, 65)}**`,
      '',
      'Half-time: babak pertama selesai. Babak kedua dimulai pada detik berikutnya.',
      `**${bar}**`,
      '**Second half starts automatically on the next match tick.**',
      '',
      '**FIRST-HALF HIGHLIGHTS**',
      recent.join('\n') || 'No major events.'
    ].join('\n'))
    .addFields(
      { name: 'HALF-TIME SCORE', value: `**${score.home} — ${score.away}**`, inline: true },
      { name: 'MATCH CLOCK', value: '**45 / 90**', inline: true }
    )
    .setFooter({ text: 'Half-time memakai tick menit ke-45; tidak ada jeda tambahan di luar 90 detik.' });
}

function buildMatchResultEmbed(match) {
  const winnerLabel = match.winner === 'draw'
    ? 'MATCH DRAWN'
    : match.winner === 'home' ? `${truncate(match.homeName, 70)} MENANG` : `${truncate(match.awayName, 70)} MENANG`;
  const color = match.winner === 'draw' ? COLORS.gold : COLORS.success;
  const goals = (match.logs || []).filter(log => ['goal', 'penalty_goal'].includes(log.type));
  const goalText = goals.length
    ? goals.map(log => `${markerForSide(log.side)} **${log.minute}'** ${truncate(log.actor || 'Unknown', 60)}${log.assist ? ` · Assist: ${truncate(log.assist, 50)}` : ''}`).join('\n')
    : 'Tidak ada gol dalam pertandingan ini.';
  const stats = match.stats || {};
  const stat = (side, key) => Number(stats[side]?.[key] || 0);
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🏁 FULL TIME · ${String(match.mode).toUpperCase()}`)
    .setDescription(`**${truncate(match.homeName, 70)}**  **${match.homeScore} — ${match.awayScore}**  **${truncate(match.awayName, 70)}**\n**${winnerLabel}**\n\n**GOAL SCORERS**\n${goalText}`)
    .addFields(
      { name: 'Possession', value: `${stat('home', 'possession')}% — ${stat('away', 'possession')}%`, inline: true },
      { name: 'Shots / On Target', value: `${stat('home', 'shots')}/${stat('home', 'shotsOnTarget')} — ${stat('away', 'shots')}/${stat('away', 'shotsOnTarget')}`, inline: true },
      { name: 'Pass Accuracy', value: `${stat('home', 'passAccuracy')}% — ${stat('away', 'passAccuracy')}%`, inline: true },
      { name: 'Team OVR', value: `${formatStrength(match.homeTeamOvr ?? match.homeStrength)} — ${formatStrength(match.awayTeamOvr ?? match.awayStrength)}`, inline: true },
      { name: 'Team Chemistry', value: `${formatStrength(match.homeChemistry || 0)} — ${formatStrength(match.awayChemistry || 0)}`, inline: true },
      { name: 'Team Strength', value: `${formatStrength(match.homeStrength)} — ${formatStrength(match.awayStrength)}`, inline: true }
    );

  const rewards = match.rewards || {};
  for (const [side, label] of [['home', `🟩 ${truncate(match.homeName, 70)}`], ['away', `🟥 ${truncate(match.awayName, 70)}`]]) {
    const reward = rewards[side];
    if (!reward) continue;
    const rank = match.mode === 'ranked' ? `\n${reward.rankDelta >= 0 ? '+' : ''}${Number(reward.rankDelta).toFixed(3)} RP` : '';
    embed.addFields({
      name: `${label} · Rewards`,
      value: `+${formatNumber(reward.credits)} CR\n+${formatNumber(reward.accountXp?.gained)} Account XP${rank}`,
      inline: true
    });
  }

  for (const [side, label] of [['home', '🟩 Home Player Development'], ['away', '🟥 Away Player Development']]) {
    const entries = rewards[side]?.playerXp || [];
    const levelUps = entries.filter(item => item.newLevel > item.oldLevel);
    if (levelUps.length) {
      embed.addFields({
        name: label,
        value: levelUps.slice(0, 8).map(item => `${truncate(item.name, 35)}: Lv.${item.oldLevel} → Lv.${item.newLevel}`).join('\n'),
        inline: false
      });
    }
  }
  embed.setFooter({ text: 'Gunakan /matchlogs untuk melihat seluruh 90 log pertandingan' });
  return embed;
}

function kickoffButtons(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`match:kickoff:${token}`).setLabel('Kick Off').setStyle(ButtonStyle.Success).setEmoji('⚽'),
    new ButtonBuilder().setCustomId(`match:cancel:${token}`).setLabel('Cancel Match').setStyle(ButtonStyle.Secondary)
  );
}

function invitationButtons(invitationId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`friendly:accept:${invitationId}`).setLabel('Accept Challenge').setStyle(ButtonStyle.Success).setEmoji('⚽'),
    new ButtonBuilder().setCustomId(`friendly:decline:${invitationId}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
  );
}

function pageButtons(prefix, ownerId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:prev:${ownerId}:${Math.max(1, page - 1)}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`${prefix}:next:${ownerId}:${Math.min(totalPages, page + 1)}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages)
  );
}

module.exports = {
  COLORS,
  truncate,
  baseEmbed,
  errorEmbed,
  successEmbed,
  formatNumber,
  formatCredits,
  formatStrength,
  tableForTeam,
  buildPlayerOpeningEmbed,
  buildPreMatchEmbed,
  buildKickoffEmbed,
  buildLiveMatchEmbed,
  buildHalfTimeEmbed,
  buildMatchResultEmbed,
  kickoffButtons,
  invitationButtons,
  pageButtons
};
