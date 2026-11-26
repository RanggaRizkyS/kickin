const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { FORMATIONS, formatCredits, formatStrength } = require('./football');
const config = require('../config');

const BRAND = Object.freeze({
  name: 'Joko Soccer',
  author: 'Joko Soccer · Club Desk',
  footer: 'Club Desk',
  voice: 'Joko is the club registrar: concise, observant and football-literate. He reports transactions and match events without hype, filler or fake enthusiasm.',
});

const COLORS = Object.freeze({
  green: 0x278657,
  red: 0xc64c4c,
  blue: 0x35516f,
  gold: 0xc59a43,
  neutral: 0x303943,
  success: 0x278657,
  danger: 0xc64c4c
});

function truncate(value, max = 90) {
  const text = String(value ?? '').replace(/[\r\n\t]/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function baseEmbed(title, description = '', color = COLORS.blue) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: BRAND.author })
    .setTitle(truncate(title, 256))
    .setDescription(truncate(description || '\u200b', 4000))
    .setTimestamp();
}

function errorEmbed(message) {
  return baseEmbed('Could not complete', truncate(message || 'The request could not be completed.', 900), COLORS.danger);
}

function successEmbed(title, description, color = COLORS.success) {
  return baseEmbed(title, description, color);
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatPlayerName(entry) {
  return entry?.player?.name || entry?.name || 'Unknown player';
}

function addSquadFields(embed, team, { includeEmpty = true } = {}) {
  const slots = FORMATIONS[team.formation] || FORMATIONS['4-3-3'];
  const byKey = new Map((team.players || []).map(player => [player.slotKey, player]));
  const fields = slots.map((slot, index) => {
    const entry = byKey.get(slot.key);
    const shirt = String(entry?.shirtNumber || index + 1).padStart(2, '0');
    if (!entry) {
      return includeEmpty ? {
        name: `${shirt} · ${slot.label}`,
        value: 'Position vacant',
        inline: false
      } : null;
    }
    const playerName = truncate(formatPlayerName(entry), 45);
    const ovr = Math.round(Number(entry.currentOvr || entry.player?.overall || 0));
    const chemistry = Number(entry.chemistry || 0);
    const level = Number(entry.level || 1);
    return {
      name: `${shirt} · ${slot.label}`,
      value: `**${playerName}**\n${ovr} OVR · ${chemistry.toFixed(1)} CHEM · Lv.${level}`,
      inline: false
    };
  }).filter(Boolean);
  if (fields.length) embed.addFields(fields);
  return fields;
}

function teamRosterText(team) {
  const slots = FORMATIONS[team.formation] || FORMATIONS['4-3-3'];
  const byKey = new Map((team.players || []).map(player => [player.slotKey, player]));
  return slots.map((slot, index) => {
    const entry = byKey.get(slot.key);
    const shirt = String(entry?.shirtNumber || index + 1).padStart(2, '0');
    if (!entry) return `**${slot.label}** · —`;
    return `**${slot.label}** · ${truncate(formatPlayerName(entry), 32)} · ${Math.round(Number(entry.currentOvr || entry.player?.overall || 0))}`;
  }).join('\n');
}

function addTeamSummary(embed, prefix, team, inline = true) {
  embed.addFields(
    { name: `${prefix} · OVR`, value: `**${formatStrength(team.teamOvr)}**`, inline },
    { name: `${prefix} · Chemistry`, value: `**${formatStrength(team.teamChemistry)} / 100**`, inline },
    { name: `${prefix} · Strength`, value: `**${formatStrength(team.teamStrength)}**`, inline }
  );
}

function buildPlayerOpeningEmbed({ title = 'CLAIM', step = 0, total = 3, caption = 'Preparing the card.' } = {}) {
  const frames = ['◴', '◷', '◶', '◵'];
  const safeTotal = Math.max(1, Number(total) || 3);
  const safeStep = Math.max(0, Math.min(safeTotal - 1, Number(step) || 0));
  const filled = Math.round(((safeStep + 1) / safeTotal) * 10);
  const bar = `${'━'.repeat(filled)}${'─'.repeat(10 - filled)}`;
  return baseEmbed(`${title} · ${frames[safeStep % frames.length]}`, `${caption}\n\n${bar}`, COLORS.gold);
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
    return `**${key}** ${Math.round(total / players.length)}`;
  }).join('  ·  ');
}

function buildPreMatchEmbed({ mode, home, away, opponentType = 'human', countdownSeconds = 5 }) {
  const modeName = String(mode || 'classic').toUpperCase();
  const countdown = Math.max(0, Number(countdownSeconds) || 0);
  const embed = baseEmbed(
    `${modeName} · Match Preview`,
    `**${truncate(home.username, 64)}**  vs  **${truncate(away.username, 64)}**\n` +
    `${opponentType === 'bot' ? `CPU · ${truncate(away.botPersonality || 'adaptive', 24)}` : 'Manager match'}  ·  Kick-off in **${countdown}s**`,
    COLORS.gold
  );
  embed.addFields(
    {
      name: `🟩 ${truncate(home.username, 55)} · ${home.formation}`,
      value: `${teamRosterText(home)}\n\nOVR **${formatStrength(home.teamOvr)}** · CHEM **${formatStrength(home.teamChemistry)}** · STRENGTH **${formatStrength(home.teamStrength)}**`,
      inline: false
    },
    {
      name: `🟥 ${truncate(away.username, 55)} · ${away.formation}`,
      value: `${teamRosterText(away)}\n\nOVR **${formatStrength(away.teamOvr)}** · CHEM **${formatStrength(away.teamChemistry)}** · STRENGTH **${formatStrength(away.teamStrength)}**`,
      inline: false
    },
    { name: 'Your squad · Outfield', value: averageOutfieldStats(home), inline: false },
    { name: 'Opponent · Outfield', value: averageOutfieldStats(away), inline: false }
  );
  return embed;
}

function buildKickoffEmbed({ homeName, awayName, mode }) {
  return baseEmbed(
    `${String(mode || 'classic').toUpperCase()} · Kick-off`,
    `**${truncate(homeName, 58)}**  **0 — 0**  **${truncate(awayName, 58)}**\n**Minute 0 / 90**`,
    COLORS.gold
  ).addFields(
    { name: 'Match clock', value: '00:00', inline: true },
    { name: 'Duration', value: '90 minutes', inline: true }
  );
}

function markerForSide(side) {
  return side === 'home' ? '🟩' : '🟥';
}

function scoreAtMinute(match, minute) {
  const safeMinute = Math.max(0, Math.min(90, Number(minute) || 0));
  const snapshot = match.sim.minuteScores?.[safeMinute];
  if (snapshot) return { home: snapshot.home, away: snapshot.away };

  const previous = (match.sim.logs || []).filter(entry => entry.minute <= safeMinute).at(-1);
  return previous?.score || { home: 0, away: 0 };
}

function eventTitle(type) {
  const titles = {
    build_up: 'Build-up',
    defend: 'Defensive stop',
    goal: 'Goal',
    yellow_card: 'Yellow card',
    red_card: 'Red card',
    penalty_awarded: 'Penalty awarded',
    penalty_scored: 'Penalty scored'
  };
  return titles[type] || 'Match event';
}

function eventFields(match, minute, limit = 20) {
  return (match.sim.logs || [])
    .filter(entry => entry.minute <= minute)
    .slice(-limit)
    .map(entry => ({
      name: `${markerForSide(entry.side)} ${String(entry.minute).padStart(2, '0')}' · ${eventTitle(entry.type)}`,
      value: truncate(entry.text, 240),
      inline: false
    }));
}

function buildLiveMatchEmbed(match, minute) {
  const currentMinute = Math.max(0, Math.min(90, Number(minute) || 0));
  const score = scoreAtMinute(match, currentMinute);
  const filled = Math.floor((currentMinute / 90) * 18);
  const progress = `${'▰'.repeat(filled)}${'▱'.repeat(18 - filled)}`;
  const embed = baseEmbed(
    `${String(match.mode).toUpperCase()} · Live`,
    `**${truncate(match.homeName, 54)}**  **${score.home} — ${score.away}**  **${truncate(match.awayName, 54)}**\n${progress}\n**Minute ${currentMinute} / 90**`,
    COLORS.green
  );
  const fields = eventFields(match, currentMinute, 20);
  if (fields.length) embed.addFields(fields);
  return embed;
}

function buildHalfTimeEmbed(match, secondsRemaining = 5) {
  const score = scoreAtMinute(match, 45);
  const seconds = Math.max(0, Number(secondsRemaining) || 0);
  const embed = baseEmbed(
    "Half-time · 45'",
    `**${truncate(match.homeName, 54)}**  **${score.home} — ${score.away}**  **${truncate(match.awayName, 54)}**\n**Half-time · Second half in ${seconds}s**`,
    COLORS.gold
  );
  const fields = eventFields(match, 45, 20);
  if (fields.length) embed.addFields(fields);
  return embed;
}

function buildMatchResultEmbed(match) {
  const winnerLabel = match.winner === 'draw'
    ? 'Draw'
    : match.winner === 'home' ? `${truncate(match.homeName, 64)} won` : `${truncate(match.awayName, 64)} won`;
  const color = match.winner === 'draw' ? COLORS.gold : COLORS.success;
  const goals = (match.logs || []).filter(log => ['goal', 'penalty_scored'].includes(log.type));
  const goalFields = goals.length
    ? goals.slice(0, 10).map(log => ({
      name: `${markerForSide(log.side)} ${log.minute}' · ${truncate(log.actor || 'Unknown', 42)}`,
      value: log.assist ? `Assist · ${truncate(log.assist, 55)}` : 'Unassisted',
      inline: true
    }))
    : [{ name: 'Goals', value: 'No goals', inline: false }];
  const stats = match.stats || {};
  const stat = (side, key) => Number(stats[side]?.[key] || 0);
  const embed = baseEmbed(
    `Full-time · ${String(match.mode).toUpperCase()}`,
    `**${truncate(match.homeName, 64)}**  **${match.homeScore} — ${match.awayScore}**  **${truncate(match.awayName, 64)}**\n${winnerLabel}`,
    color
  );
  embed.addFields(
    { name: 'Possession', value: `${stat('home', 'possession')}%  ·  ${stat('away', 'possession')}%`, inline: true },
    { name: 'Shots / on target', value: `${stat('home', 'shots')}/${stat('home', 'shotsOnTarget')}  ·  ${stat('away', 'shots')}/${stat('away', 'shotsOnTarget')}`, inline: true },
    { name: 'Pass accuracy', value: `${stat('home', 'passAccuracy')}%  ·  ${stat('away', 'passAccuracy')}%`, inline: true },
    { name: 'Team OVR', value: `${formatStrength(match.homeTeamOvr ?? match.homeStrength)}  ·  ${formatStrength(match.awayTeamOvr ?? match.awayStrength)}`, inline: true },
    { name: 'Chemistry', value: `${formatStrength(match.homeChemistry || 0)}  ·  ${formatStrength(match.awayChemistry || 0)}`, inline: true },
    { name: 'Team Strength', value: `${formatStrength(match.homeStrength)}  ·  ${formatStrength(match.awayStrength)}`, inline: true },
    ...goalFields
  );
  const rewards = match.rewards || {};
  for (const [side, label] of [['home', `🟩 ${truncate(match.homeName, 45)}`], ['away', `🟥 ${truncate(match.awayName, 45)}`]]) {
    const reward = rewards[side];
    if (!reward) continue;
    const rank = match.mode === 'ranked' ? `\n${reward.rankDelta >= 0 ? '+' : ''}${Number(reward.rankDelta).toFixed(3)} RP` : '';
    embed.addFields({
      name: `${label} · Reward`,
      value: `+${formatNumber(reward.credits)} CR · +${formatNumber(reward.accountXp?.gained)} XP${rank}`,
      inline: true
    });
  }
  for (const [side, label] of [['home', 'Your player development'], ['away', 'Opponent development']]) {
    const levelUps = (rewards[side]?.playerXp || []).filter(item => item.newLevel > item.oldLevel);
    if (levelUps.length) {
      embed.addFields({
        name: label,
        value: levelUps.slice(0, 6).map(item => `${truncate(item.name, 28)} · Lv.${item.oldLevel} → ${item.newLevel}`).join('\n'),
        inline: false
      });
    }
  }
  return embed;
}

function kickoffButtons(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`match:kickoff:${token}`).setLabel('Kick off').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`match:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
}

function invitationButtons(invitationId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`friendly:accept:${invitationId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`friendly:decline:${invitationId}`).setLabel('Decline').setStyle(ButtonStyle.Secondary)
  );
}

function pageButtons(prefix, ownerId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}:prev:${ownerId}:${Math.max(1, page - 1)}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`${prefix}:next:${ownerId}:${Math.min(totalPages, page + 1)}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );
}

module.exports = {
  BRAND,
  COLORS,
  truncate,
  baseEmbed,
  errorEmbed,
  successEmbed,
  formatNumber,
  formatCredits,
  formatStrength,
  addSquadFields,
  teamRosterText,
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
