const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'dotenv') return { config: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};

const catalog = require('../data/fixtures/fictional_players_600.json').players;
const { FORMATIONS } = require('../src/utils/football');
const { generateMatch } = require('../src/services/match-engine');
const {
  BOT_NAME_RANGES,
  ALL_BOT_NAMES,
  botManagerNameForStrength,
  buildBotSquadFromCatalog
} = require('../src/services/bot-squad-builder');

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test('bot manager name pool contains 70 unique names across five power ranges', () => {
  assert.equal(ALL_BOT_NAMES.length, 70);
  assert.equal(new Set(ALL_BOT_NAMES).size, 70);
  assert.equal(BOT_NAME_RANGES.length, 5);
  assert.equal(botManagerNameForStrength(50, () => 0.5).power, 1000);
  assert.equal(botManagerNameForStrength(50, () => 0.5).range, '800-1199');
});

test('Classic CPU squad stays 4-6 Team Strength points below the user', () => {
  const rng = seeded(345678);
  const target = { teamStrength: 72.4, teamOvr: 78.2, teamChemistry: 66.6 };
  const bot = buildBotSquadFromCatalog(target, catalog, { rng, attempts: 180 });

  assert.equal(bot.players.length, 11);
  assert.equal(new Set(bot.players.map(player => player.playerId)).size, 11);
  const strengthGap = target.teamStrength - bot.teamStrength;
  assert.ok(strengthGap >= 3.5 && strengthGap <= 6.5,
    `CPU should be clearly but moderately weaker, got ${strengthGap.toFixed(2)} points`);
  assert.ok(Math.abs(bot.teamStrength - bot.targetStrength) <= 1.0,
    'generated CPU Team Strength should match its intended target');
  assert.ok(Math.max(...bot.players.map(player => player.currentOvr)) >= 88,
    'a balanced bot squad should be allowed to contain a high-rated player');
  assert.ok(Math.max(...bot.players.map(player => player.currentOvr)) - Math.min(...bot.players.map(player => player.currentOvr)) >= 10,
    'bot player ratings should not all be nearly identical');
});

test('bot name range follows the player power band', () => {
  const low = botManagerNameForStrength(12, () => 0.1);
  const middle = botManagerNameForStrength(50, () => 0.1);
  const high = botManagerNameForStrength(90, () => 0.1);
  assert.equal(low.range, '0-399');
  assert.equal(middle.range, '800-1199');
  assert.equal(high.range, '1600-2000');
});

test('a stronger user squad has a statistical edge over Classic CPU across many matches', () => {
  const used = new Set();
  const players = FORMATIONS['4-3-3'].map((slot, index) => {
    const isGoalkeeper = slot.label === 'GK';
    const candidates = catalog.filter(player =>
      (player.stats.type === 'goalkeeper') === isGoalkeeper && !used.has(player.id)
    );
    const player = candidates[(index * 7) % candidates.length];
    used.add(player.id);
    return {
      cardInstanceId: `USER-${player.id}`,
      playerId: player.id,
      slotKey: slot.key,
      slotPosition: slot.label,
      player,
      currentOvr: Number(player.position_ratings?.[slot.label] || player.overall),
      currentStats: isGoalkeeper ? player.stats.goalkeeper : player.stats.main,
      chemistry: 85,
      teamChemistryMultiplier: 1,
      shirtNumber: index + 1
    };
  });
  const teamOvr = players.reduce((sum, player) => sum + player.currentOvr, 0) / 11;
  const userTeam = {
    username: 'User Test',
    formation: '4-3-3',
    players,
    teamOvr,
    teamChemistry: 85,
    teamStrength: (teamOvr + 85) / 2,
    isBot: false
  };

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let strengthGapTotal = 0;
  const botSquads = 40;
  const matchesPerBot = 20;

  for (let botIndex = 1; botIndex <= botSquads; botIndex += 1) {
    const bot = buildBotSquadFromCatalog(userTeam, catalog, {
      rng: seeded(91000 + botIndex * 313),
      attempts: 120
    });
    bot.isBot = true;
    strengthGapTotal += userTeam.teamStrength - bot.teamStrength;

    for (let matchIndex = 1; matchIndex <= matchesPerBot; matchIndex += 1) {
      const result = generateMatch(userTeam, bot, botIndex * 100000 + matchIndex * 7919);
      if (result.winner === 'home') wins += 1;
      else if (result.winner === 'away') losses += 1;
      else draws += 1;
    }
  }

  const total = botSquads * matchesPerBot;
  const winRate = wins / total;
  const lossRate = losses / total;
  const averageGap = strengthGapTotal / botSquads;

  assert.ok(averageGap >= 3.5 && averageGap <= 6.5,
    `average CPU Team Strength gap should be 4-6 points, got ${averageGap.toFixed(2)}`);
  assert.ok(winRate > 0.45,
    `stronger user team should win more often than not, got ${(winRate * 100).toFixed(1)}%`);
  assert.ok(lossRate < 0.33,
    `CPU should not beat the stronger user team too frequently, got ${(lossRate * 100).toFixed(1)}%`);
  assert.equal(wins + draws + losses, total);
});
