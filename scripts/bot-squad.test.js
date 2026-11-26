const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'dotenv') return { config: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};

const catalog = require('../data/players.json').players;
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

test('Classic bot squad uses varied player ratings and stays within two Team Strength points', () => {
  const rng = seeded(345678);
  const target = { teamStrength: 72.4, teamOvr: 78.2, teamChemistry: 66.6 };
  const bot = buildBotSquadFromCatalog(target, catalog, { rng, attempts: 180 });

  assert.equal(bot.players.length, 11);
  assert.equal(new Set(bot.players.map(player => player.playerId)).size, 11);
  assert.ok(Math.abs(bot.teamStrength - target.teamStrength) <= 2);
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
