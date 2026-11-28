'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename && parent.filename.endsWith(`${path.sep}src${path.sep}services${path.sep}sofifa-badge-cache.js`)) {
    if (request === '../config') return { cardImages: { gameVersion: 'FC26', portraitCacheDir: path.join(process.cwd(), 'storage/player-portraits'), timeoutMs: 9000 } };
    if (request === './player-portrait-cache') return {
      getSofifaRequestHeaders: () => ({ Referer: 'https://sofifa.com/' }),
      isPng: buffer => Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const badges = require('../src/services/sofifa-badge-cache');
Module._load = originalLoad;

test('builds only supported SoFIFA team and league badge URLs', () => {
  assert.equal(badges.buildSofifaBadgeUrl('team', 110738), 'https://cdn.sofifa.net/meta/team/110738/120.png');
  assert.equal(badges.buildSofifaBadgeUrl('league', '13'), 'https://cdn.sofifa.net/meta/league/13/120.png');
  assert.equal(badges.buildSofifaBadgeUrl('team', '../escape'), null);
  assert.equal(badges.buildSofifaBadgeUrl('other', 13), null);
});

test('resolves badge identifiers from normalized player fields or raw EAFC data', () => {
  assert.deepEqual(
    badges.getPlayerBadgeIds({ club: { id: '110738', league_id: 13 } }),
    { team: '110738', league: '13' }
  );
  assert.deepEqual(
    badges.getPlayerBadgeIds({ source_raw: { club_team_id: 112658, league_id: 16 } }),
    { team: '112658', league: '16' }
  );
  assert.deepEqual(badges.getPlayerBadgeIds({ club: { id: 'Free Agent' } }), { team: null, league: null });
});
