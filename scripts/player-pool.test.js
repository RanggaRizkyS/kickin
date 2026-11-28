const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRarityIndex, chooseWeightedPlayerId } = require('../src/utils/player-pool');

test('rarity index only contains catalog player IDs grouped by rarity', () => {
  const index = buildRarityIndex([
    { player_id: 'a', rarity: 'bronze' },
    { player_id: 'b', rarity: 'silver' },
    { player_id: 'c', rarity: 'gold' },
    { player_id: '', rarity: 'gold' },
    { player_id: 'd', rarity: 'unknown' }
  ]);
  assert.deepEqual(index, { bronze: ['a'], silver: ['b'], gold: ['c'] });
});

test('weighted player selection honours rarity weights and falls back if a rarity is empty', () => {
  const index = { bronze: ['b1', 'b2'], silver: ['s1'], gold: [] };
  assert.equal(chooseWeightedPlayerId(index, [100, 0, 0], () => 0), 'b1');
  assert.equal(chooseWeightedPlayerId(index, [0, 100, 0], () => 0), 's1');
  assert.equal(chooseWeightedPlayerId(index, [0, 0, 100], () => 0), 'b1');
});
