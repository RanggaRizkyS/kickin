const test = require('node:test');
const assert = require('node:assert/strict');
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
    const goalkeeper = slot.label === 'GK';
    const candidates = data.players.filter(player =>
      (player.stats.type === 'goalkeeper') === goalkeeper && !used.has(player.id)
    );
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
  return {
    username,
    formation: '4-3-3',
    players,
    teamOvr,
    teamChemistry: 70,
    teamStrength: (teamOvr + 70) / 2,
    isBot: false
  };
}

const ALLOWED_EVENTS = new Set([
  'build_up',
  'defend',
  'goal',
  'yellow_card',
  'red_card',
  'penalty_awarded',
  'penalty_scored'
]);

test('match clock covers minute 0 through 90 while event logs remain sparse', () => {
  const home = makeTeam('Home', 0, 80);
  const away = makeTeam('Away', 10, 85);
  const result = generateMatch(home, away, 123456);

  assert.equal(result.duration, 90);
  assert.equal(result.minuteScores.length, 91);
  assert.deepEqual(
    result.minuteScores.map(snapshot => snapshot.minute),
    Array.from({ length: 91 }, (_, minute) => minute)
  );
  assert.equal(result.timeline.length, 91);
  assert.equal(result.timeline[0].minute, 0);
  assert.ok(result.logs.length > 0);
  assert.ok(result.logs.length < 90, 'quiet minutes must not create visible events');
  assert.ok(result.logs.every(log => ALLOWED_EVENTS.has(log.type)));
  assert.ok(result.logs.every((log, index, list) => index === 0 || list[index - 1].minute < log.minute));
  const knownNames = new Set([...home.players, ...away.players].map(player => player.player.name));
  assert.ok(result.logs.every(log => log.actor && knownNames.has(log.actor)),
    'every visible event must name an actual player, never a generic user/team placeholder');
  assert.ok(result.timeline.some(entry => entry.event === null),
    'some minutes should remain quiet and must not create placeholder events');
  assert.equal(result.homeScore, result.stats.home.goals);
  assert.equal(result.awayScore, result.stats.away.goals);
  assert.equal(result.minuteScores[90].home, result.homeScore);
  assert.equal(result.minuteScores[90].away, result.awayScore);
});

test('same seed produces the same sparse event sequence and score timeline', () => {
  const home = makeTeam('Home', 0, 80);
  const away = makeTeam('Away', 10, 85);
  const a = generateMatch(home, away, 998877);
  const b = generateMatch(home, away, 998877);
  assert.equal(a.homeScore, b.homeScore);
  assert.equal(a.awayScore, b.awayScore);
  assert.deepEqual(a.logs, b.logs);
  assert.deepEqual(a.minuteScores, b.minuteScores);
});

test('a penalty is resolved on the next minute before any unrelated event can occur', () => {
  const home = makeTeam('Home', 0, 80);
  const away = makeTeam('Away', 10, 85);
  const result = generateMatch(home, away, 440011);
  for (let index = 0; index < result.logs.length; index += 1) {
    const event = result.logs[index];
    if (event.type !== 'penalty_awarded') continue;
    const next = result.logs[index + 1];
    assert.ok(next, 'an awarded penalty must be resolved');
    assert.equal(next.minute, event.minute + 1,
      'the next visible event must resolve the penalty on the following minute');
    assert.ok(['penalty_scored', 'defend'].includes(next.type),
      'a penalty must be scored or saved before any unrelated event can occur');
    if (next.type === 'penalty_scored') {
      assert.notEqual(next.side, event.side,
        'a scored penalty belongs to the attacking team, not the team that conceded it');
    } else {
      assert.equal(next.side, event.side,
        'a saved penalty belongs to the defending team that committed the foul');
    }
    assert.match(event.text, /brings down .* in the penalty area\. Penalty awarded to/);
  }
});


test('a saved penalty is recorded as a goalkeeper defensive action on the next minute', () => {
  const home = makeTeam('Home', 0, 80);
  const away = makeTeam('Away', 10, 85);
  const result = generateMatch(home, away, 4);
  const awardIndex = result.logs.findIndex(event => event.type === 'penalty_awarded');
  assert.notEqual(awardIndex, -1, 'the deterministic fixture should include a penalty award');
  const award = result.logs[awardIndex];
  const resolution = result.logs[awardIndex + 1];
  assert.equal(resolution.minute, award.minute + 1);
  assert.equal(resolution.type, 'defend');
  assert.equal(resolution.side, award.side);
  const defendingTeam = award.side === 'home' ? home : away;
  const goalkeeper = defendingTeam.players.find(player => player.slotPosition === 'GK');
  assert.equal(resolution.actor, goalkeeper.player.name);
  assert.match(resolution.text, /saves the penalty from/);
});

test('adaptive bot personalities produce different football event sequences', () => {
  const home = makeTeam('Human', 0, 82);
  const possessionBot = makeTeam('CPU Possession', 10, 82);
  possessionBot.isBot = true;
  possessionBot.botPersonality = 'possession';
  const wideBot = makeTeam('CPU Wide', 10, 82);
  wideBot.isBot = true;
  wideBot.botPersonality = 'wide_play';
  const possession = generateMatch(home, possessionBot, 440011);
  const wide = generateMatch(home, wideBot, 440011);
  assert.equal(possession.minuteScores.length, 91);
  assert.equal(wide.minuteScores.length, 91);
  assert.notDeepEqual(possession.logs, wide.logs);
});
