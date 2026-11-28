const crypto = require('node:crypto');
const config = require('../config');

const FORMATIONS = {
  '4-3-3': [
    { key: 'GK', label: 'GK', x: 8, y: 50 },
    { key: 'LB', label: 'LB', x: 25, y: 19 }, { key: 'LCB', label: 'CB', x: 25, y: 40 },
    { key: 'RCB', label: 'CB', x: 25, y: 60 }, { key: 'RB', label: 'RB', x: 25, y: 81 },
    { key: 'LCM', label: 'CM', x: 47, y: 29 }, { key: 'CDM', label: 'CDM', x: 47, y: 50 }, { key: 'RCM', label: 'CM', x: 47, y: 71 },
    { key: 'LW', label: 'LW', x: 75, y: 20 }, { key: 'ST', label: 'ST', x: 82, y: 50 }, { key: 'RW', label: 'RW', x: 75, y: 80 }
  ],
  '4-2-3-1': [
    { key: 'GK', label: 'GK', x: 8, y: 50 },
    { key: 'LB', label: 'LB', x: 25, y: 19 }, { key: 'LCB', label: 'CB', x: 25, y: 40 },
    { key: 'RCB', label: 'CB', x: 25, y: 60 }, { key: 'RB', label: 'RB', x: 25, y: 81 },
    { key: 'LDM', label: 'CDM', x: 43, y: 35 }, { key: 'RDM', label: 'CDM', x: 43, y: 65 },
    { key: 'LW', label: 'LW', x: 66, y: 18 }, { key: 'CAM', label: 'CAM', x: 67, y: 50 }, { key: 'RW', label: 'RW', x: 66, y: 82 },
    { key: 'ST', label: 'ST', x: 84, y: 50 }
  ],
  '4-4-2': [
    { key: 'GK', label: 'GK', x: 8, y: 50 },
    { key: 'LB', label: 'LB', x: 25, y: 19 }, { key: 'LCB', label: 'CB', x: 25, y: 40 },
    { key: 'RCB', label: 'CB', x: 25, y: 60 }, { key: 'RB', label: 'RB', x: 25, y: 81 },
    { key: 'LM', label: 'LM', x: 47, y: 18 }, { key: 'LCM', label: 'CM', x: 47, y: 39 },
    { key: 'RCM', label: 'CM', x: 47, y: 61 }, { key: 'RM', label: 'RM', x: 47, y: 82 },
    { key: 'LST', label: 'ST', x: 79, y: 37 }, { key: 'RST', label: 'ST', x: 79, y: 63 }
  ]
};

function uuid() { return crypto.randomUUID(); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v) || 0)); }
function round(v, digits = 3) { const f = 10 ** digits; return Math.round((Number(v) || 0) * f) / f; }
function safeJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function rarityFromOvr(ovr) { return Number(ovr) >= 81 ? 'gold' : Number(ovr) >= 70 ? 'silver' : 'bronze'; }
// Public Soccer Guru player-price reference. The published chart prices a card
// from OVR and the sum of its six displayed base stats (Effective Stats).
// Joko's own supply/demand multipliers are applied later by market.js.
const SOCCER_GURU_OVR_BASE = {
  70:1500,71:1800,72:2100,73:2400,74:2700,75:3000,76:4650,77:6300,78:7950,79:9600,
  80:11250,81:31250,82:51250,83:71250,84:91250,85:112500,86:180000,87:247500,88:315000,89:382500,
  90:450000,91:660000,92:870000,93:1080000,94:1290000,95:1500000,96:1800000,97:2100000,98:2400000,99:2700000
};
const SOCCER_GURU_EFFECTIVE_STAT_BANDS = [
  { max:300, multiplier:1.00 },
  { max:399, multiplier:1.20 },
  { max:449, multiplier:1.30 },
  { max:474, multiplier:1.40 },
  { max:499, multiplier:1.50 },
  { max:524, multiplier:1.60 },
  { max:549, multiplier:1.70 },
  { max:594, multiplier:1.85 },
  { max:Infinity, multiplier:1.85 }
];
function effectiveStatsTotal(player) {
  const main = player?.stats?.main || player?.main_stats || {};
  return ['PAC','SHO','PAS','DRI','DEF','PHY'].reduce((sum, key) => {
    const value = Number(main[key] ?? main[key.toLowerCase()] ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}
function basePrice(player) {
  const ovr = clamp(Math.round(Number(player?.overall || 60)), 1, 99);
  const effectiveStats = effectiveStatsTotal(player);
  const band = SOCCER_GURU_EFFECTIVE_STAT_BANDS.find(item => effectiveStats <= item.max) || SOCCER_GURU_EFFECTIVE_STAT_BANDS.at(-1);
  const publishedBase = SOCCER_GURU_OVR_BASE[ovr];
  // The public price sheet starts at OVR 70. Lower-rated EAFC players use a
  // conservative Joko fallback rather than pretending the reference publishes them.
  const base = publishedBase ?? Math.max(150, Math.round(1500 * Math.pow(0.88, Math.max(0, 70 - ovr))));
  return Math.round(base * band.multiplier);
}
function isPositionCompatible(player, position) {
  return player.positions?.primary === position || (player.positions?.secondary || []).includes(position) || Number(player.position_ratings?.[position] || 0) >= 72;
}
function estimatedOverall(card, player, position) {
  const base = Number(player.position_ratings?.[position] || player.overall || 60);
  const stats = safeJson(card.current_stats_json || card.currentStats, player.stats?.main || {});
  const keys = ['PAC','SHO','PAS','DRI','DEF','PHY'];
  const baseMain = player.stats?.main || {};
  const currentMean = keys.reduce((sum, key) => sum + Number(stats[key] ?? stats[key.toLowerCase()] ?? baseMain[key] ?? 60), 0) / keys.length;
  const baseMean = keys.reduce((sum, key) => sum + Number(baseMain[key] ?? baseMain[key.toLowerCase()] ?? 60), 0) / keys.length;
  const levelBonus = Math.floor((Number(card.level || 1) - 1) * 0.12);
  const growthBonus = Math.floor(Math.max(0, currentMean - baseMean) * 0.30);
  return clamp(Math.round(base + levelBonus + growthBonus), 40, Number(player.potential || 99));
}
function teamStrength(teamOvr, chemistry) { return round((Number(teamOvr) + Number(chemistry)) / 2, 3); }
function randomInt(min, max, rng = Math.random) { return Math.floor(rng() * (max - min + 1)) + min; }
function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
function formatCredits(value) { return `${Math.round(Number(value) || 0).toLocaleString('en-US')} CR`; }
function formatStrength(value) { return Number(value || 0).toFixed(3); }
function positionForSlot(slotKey, formation) { return (FORMATIONS[formation] || FORMATIONS['4-3-3']).find(x => x.key === slotKey)?.label || slotKey; }
function xpRequired(level) { return Math.round(config.progression.playerXpBase + Number(level) * config.progression.playerXpLevelFactor); }
function accountXpRequired(level) { return 120 + Number(level) * 95; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

module.exports = { FORMATIONS, uuid, clamp, round, safeJson, rarityFromOvr, effectiveStatsTotal, basePrice, isPositionCompatible, estimatedOverall, teamStrength, randomInt, pairKey, formatCredits, formatStrength, positionForSlot, xpRequired, accountXpRequired, sleep, SOCCER_GURU_OVR_BASE, SOCCER_GURU_EFFECTIVE_STAT_BANDS };
