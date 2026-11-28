const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'dotenv') return { config: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};

const { normalizeEafc26Record, parsePositionRating } = require('../src/services/eafc26-normalizer');
const { basePrice, effectiveStatsTotal } = require('../src/utils/football');

const outfieldRow = {
  player_id: '123456', short_name: 'Test Forward', long_name: 'Test Forward Name', overall: '90', potential: '92', age: '25',
  player_positions: 'ST, CF', nationality_name: 'Argentina', nationality_id: '52', club_name: 'Example FC',
  club_team_id: '10', league_id: '13', league_name: 'Example League', value_eur: '80000000', preferred_foot: 'Right',
  weak_foot: '4', skill_moves: '5', pace: '90', shooting: '92', passing: '80', dribbling: '88', defending: '42', physic: '85',
  st: '91+1', cf: '90', lw: '85', attacking_finishing: '93', power_shot_power: '91', mentality_composure: '88'
};

test('EAFC26 normalizer maps identity, attributes, positions and detailed stats', () => {
  const player = normalizeEafc26Record(outfieldRow);
  assert.equal(player.id, 'EA26-123456');
  assert.equal(player.name, 'Test Forward');
  assert.equal(player.overall, 90);
  assert.equal(player.positions.primary, 'ST');
  assert.equal(player.position_ratings.ST, 91);
  assert.equal(player.club.league_id, 13);
  assert.deepEqual(player.stats.main, { PAC:90, SHO:92, PAS:80, DRI:88, DEF:42, PHY:85 });
  assert.equal(player.stats.outfield.attacking_finishing, 93);
  assert.ok(player.skills.length <= 5);
  assert.ok(player.role.name);
});

test('EAFC26 normalizer maps goalkeeper stats to the six displayed card attributes and preserves GK details', () => {
  const player = normalizeEafc26Record({
    player_id:'9988', short_name:'Test Keeper', overall:'84', potential:'86', player_positions:'GK',
    nationality_name:'Japan', club_name:'Keeper FC', league_name:'Test League',
    goalkeeping_diving:'85', goalkeeping_handling:'82', goalkeeping_kicking:'78',
    goalkeeping_reflexes:'88', goalkeeping_speed:'52', goalkeeping_positioning:'86'
  });
  assert.equal(player.stats.type, 'goalkeeper');
  assert.deepEqual(player.stats.main, { PAC:85, SHO:82, PAS:78, DRI:88, DEF:52, PHY:86 });
  assert.equal(player.stats.goalkeeper.reflexes, 88);
});

test('missing EA player IDs use deterministic hashed IDs without prefix collisions', () => {
  const a = normalizeEafc26Record({ ...outfieldRow, player_id: undefined, short_name: 'Same Prefix Player One' });
  const b = normalizeEafc26Record({ ...outfieldRow, player_id: undefined, short_name: 'Same Prefix Player Two' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.id, normalizeEafc26Record({ ...outfieldRow, player_id: undefined, short_name: 'Same Prefix Player One' }).id);
});

test('public Soccer Guru Effective Stats price curve uses six base stats and OVR', () => {
  const player = { overall:90, stats:{ main:{ PAC:50,SHO:50,PAS:50,DRI:50,DEF:50,PHY:50 } } };
  assert.equal(effectiveStatsTotal(player), 300);
  assert.equal(basePrice(player), 450000);
  player.stats.main = { PAC:85,SHO:85,PAS:85,DRI:85,DEF:85,PHY:75 };
  assert.equal(effectiveStatsTotal(player), 500);
  assert.equal(basePrice(player), 720000);
});

test('position rating parser accepts EA FC boost notation', () => {
  assert.equal(parsePositionRating('91+2'), 91);
  assert.equal(parsePositionRating('84'), 84);
  assert.equal(parsePositionRating('N/A'), null);
});


test('starter squad selection avoids giving every new manager the highest-rated catalog cards', () => {
  const { selectStarterPlayersFromCatalog } = require('../src/services/starter-selection');
  const players = [];
  const roles = [
    ['GK','goalkeeper'],['LB','outfield'],['CB','outfield'],['CB','outfield'],['RB','outfield'],
    ['CM','outfield'],['CDM','outfield'],['CM','outfield'],['LW','outfield'],['ST','outfield'],['RW','outfield']
  ];
  for (let overall = 60; overall <= 95; overall += 1) {
    for (const [position, type] of roles) {
      players.push({
        id: `${position}-${overall}-${players.length}`,
        name: `${position} ${overall}`,
        overall,
        stats: { type },
        positions: { primary: position, secondary: [] },
        position_ratings: { [position]: overall }
      });
    }
  }
  const selected = selectStarterPlayersFromCatalog(players, () => 0);
  assert.equal(selected.length, 11);
  assert.equal(new Set(selected.map(entry => entry.player.id)).size, 11);
  assert.ok(selected.every(entry => entry.player.overall <= 70),
    'starter squad should begin with modest players instead of top-rated stars');
});

test('missing positional OVRs are derived from role-relevant detailed stats', () => {
  const player = normalizeEafc26Record({
    player_id: 'wide-forward-1',
    short_name: 'Wide Forward',
    overall: '84',
    potential: '90',
    player_positions: 'ST, RW',
    nationality_name: 'Brazil',
    club_name: 'Example FC',
    league_name: 'Example League',
    pace: '94', shooting: '78', passing: '82', dribbling: '93', defending: '35', physic: '70',
    movement_acceleration: '96', movement_sprint_speed: '92', movement_agility: '94',
    skill_dribbling: '95', skill_ball_control: '94', attacking_crossing: '86',
    attacking_finishing: '78', attacking_positioning: '80', mentality_vision: '84'
  });
  assert.equal(player.position_ratings.ST, 84, 'primary position falls back to source OVR when no source position rating exists');
  assert.ok(player.position_ratings.RW >= 84, 'wide-player attributes should support a strong RW rating');
  assert.ok(player.position_ratings.CB < player.position_ratings.RW, 'a winger profile should not receive the same rating at CB');
});
