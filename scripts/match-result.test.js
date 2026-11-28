const test = require('node:test');
const assert = require('node:assert/strict');
const { resultForUser } = require('../src/utils/match-result');

test('match history marks a CPU 0-3 result as a loss even though CPU has no user ID', () => {
  assert.equal(resultForUser({ status: 'completed', ownScore: 0, opponentScore: 3 }), 'LOSS');
});

test('match history marks user wins and draws from the scoreline', () => {
  assert.equal(resultForUser({ status: 'completed', ownScore: 3, opponentScore: 0 }), 'WIN');
  assert.equal(resultForUser({ status: 'completed', ownScore: 2, opponentScore: 2 }), 'DRAW');
});

test('unfinished and invalid-score matches are not shown as draws', () => {
  assert.equal(resultForUser({ status: 'running', ownScore: 0, opponentScore: 0 }), 'VOID');
  assert.equal(resultForUser({ status: 'completed', ownScore: null, opponentScore: 2 }), 'VOID');
});
