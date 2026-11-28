'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename && parent.filename.endsWith(`${path.sep}src${path.sep}services${path.sep}catalog-cache.js`)) {
    if (request === '../db') return { getPool: () => { throw new Error('DB should not be queried in this test.'); } };
    if (request === '../utils/football') return { safeJson: value => typeof value === 'string' ? JSON.parse(value) : value };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { gamePlayerView } = require('../src/services/catalog-cache');
Module._load = originalLoad;

test('lightweight gameplay player view preserves club and league IDs for SoFIFA badge lookup', () => {
  const player = gamePlayerView(JSON.stringify({
    id: 'EA26-10',
    name: 'Test Player',
    stats: { main: { PAC: 80, SHO: 70, PAS: 75, DRI: 80, DEF: 40, PHY: 70 } },
    club: { id: '110738', name: 'Example FC', league: 'Premier League' },
    source_raw: { league_id: 13 }
  }));
  assert.equal(player.club.id, '110738');
  assert.equal(player.club.league_id, 13);
});
