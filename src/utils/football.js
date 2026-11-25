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
function basePrice(player) {
  const ovr = Number(player.overall || 60);
  const mv = Number(player.market_value_eur || 0);
  return Math.round(350 + Math.pow(Math.max(0, ovr - 60), 2) * 22 + (mv > 0 ? Math.log10(mv + 1) * 90 : 0));
}
function isPositionCompatible(player, position) {
  return player.positions?.primary === position || (player.positions?.secondary || []).includes(position) || Number(player.position_ratings?.[position] || 0) >= 72;
}
function estimatedOverall(card, player, position) {
  const base = Number(player.position_ratings?.[position] || player.overall || 60);
  const stats = safeJson(card.current_stats_json || card.currentStats, player.stats?.main || {});
  const values = Object.values(stats).filter(v => Number.isFinite(Number(v))).map(Number);
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 70;
  const levelBonus = Math.floor((Number(card.level || 1) - 1) * 0.18);
  const growthBonus = Math.floor(Math.max(0, mean - 70) * 0.08);
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

module.exports = { FORMATIONS, uuid, clamp, round, safeJson, rarityFromOvr, basePrice, isPositionCompatible, estimatedOverall, teamStrength, randomInt, pairKey, formatCredits, formatStrength, positionForSlot, xpRequired, accountXpRequired, sleep };
