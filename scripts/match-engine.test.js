const test = require('node:test');
const assert = require('node:assert/strict');
// Keep pure match-engine tests runnable before npm install; production installs dotenv normally.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'dotenv') return { config: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};
const data = require('../data/players.json');
const { FORMATIONS } = require('../src/utils/football');
const { generateMatch } = require('../src/services/match-engine');

function makeTeam(username, offset = 0, strength = 80) {
  const slots = FORMATIONS['4-3-3'];
  const used = new Set();
  const players = slots.map((slot, index) => {
    const wantGoalkeeper = slot.label === 'GK';
    const candidates = data.players.filter(player => (player.stats.type === 'goalkeeper') === wantGoalkeeper && !used.has(player.id));
    const player = candidates[(index + offset) % candidates.length];
    used.add(player.id);
    return {
      cardInstanceId: `${username}-${player.id}`,
      playerId: player.id,
      slotKey: slot.key,
      slotPosition: slot.label,
      player,
      level: 1,
      xp: 0,
      currentOvr: Number(player.position_ratings?.[slot.label] || player.overall),
      currentStats: player.stats.main,
      chemistry: 70,
      shirtNumber: index + 1
    };
  });
  const teamOvr = players.reduce((sum, player) => sum + player.currentOvr, 0) / 11;
  return { username, formation: '4-3-3', players, teamOvr, teamChemistry: 70, teamStrength: (teamOvr + 70) / 2, isBot: false };
}

test('match engine always creates 90 minute logs', () => {
  const home = makeTeam('Home', 0, 80);
  const away = makeTeam('Away', 10, 85);
  const result = generateMatch(home, away, 123456);
  assert.equal(result.duration, 90);
  assert.equal(result.logs.length, 90);
  assert.deepEqual(result.logs.map(log => log.minute), Array.from({ length: 90 }, (_, index) => index + 1));
  assert.equal(result.logs[44].type, 'halftime');
  assert.equal(result.logs[89].type, 'fulltime');
  assert.equal(result.homeScore, result.stats.home.goals);
  assert.equal(result.awayScore, result.stats.away.goals);
});

test('same seed produces same score and log timeline', () => {
  const home = makeTeam('Home', 0, 80);
  const away = makeTeam('Away', 10, 85);
  const a = generateMatch(home, away, 998877);
  const b = generateMatch(home, away, 998877);
  assert.equal(a.homeScore, b.homeScore);
  assert.equal(a.awayScore, b.awayScore);
  assert.deepEqual(a.logs, b.logs);
});


test('adaptive bot personality changes match event tendencies without changing match length', () => {
  const home = makeTeam('Human', 0, 82);
  const possessionBot = makeTeam('CPU Possession', 10, 82);
  possessionBot.isBot = true;
  possessionBot.botPersonality = 'possession';
  const wideBot = makeTeam('CPU Wide', 10, 82);
  wideBot.isBot = true;
  wideBot.botPersonality = 'wide_play';
  const possession = generateMatch(home, possessionBot, 440011);
  const wide = generateMatch(home, wideBot, 440011);
  assert.equal(possession.logs.length, 90);
  assert.equal(wide.logs.length, 90);
  assert.notDeepEqual(possession.logs, wide.logs);
});
