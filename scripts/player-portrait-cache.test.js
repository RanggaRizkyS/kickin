'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename && parent.filename.endsWith(`${path.sep}src${path.sep}services${path.sep}player-portrait-cache.js`)) {
    if (request === '../db') return { getPool: () => { throw new Error('Database should not be needed in utility tests.'); } };
    if (request === '../config') {
      return {
        cardImages: {
          gameVersion: 'FC26',
          portraitCacheDir: path.join(process.cwd(), 'storage/player-portraits'),
          sofifaReferer: 'https://sofifa.com/',
          timeoutMs: 9000,
          maxBytes: 10 * 1024 * 1024,
          portraitMissingRetryHours: 24,
          portraitFailedRetryMinutes: 30
        }
      };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

const portraits = require('../src/services/player-portrait-cache');
Module._load = originalLoad;

test('only accepts HTTPS SoFIFA player portrait URLs', () => {
  assert.equal(portraits.isAllowedSofifaPortraitUrl('https://cdn.sofifa.net/players/146/296/26_120.png'), true);
  assert.equal(portraits.isAllowedSofifaPortraitUrl('http://cdn.sofifa.net/players/146/296/26_120.png'), false);
  assert.equal(portraits.isAllowedSofifaPortraitUrl('https://evil.example/players/146/296/26_120.png'), false);
  assert.equal(portraits.isAllowedSofifaPortraitUrl('https://cdn.sofifa.net/meta/team/120.png'), false);
  assert.equal(portraits.isAllowedSofifaPortraitUrl('https://cdn.sofifa.net/players/146/296/26_120.png?x=1'), false);
});

test('sends the SoFIFA page as Referer for portrait CDN requests', () => {
  const headers = portraits.getSofifaRequestHeaders();
  assert.equal(headers.Referer, 'https://sofifa.com/');
  assert.match(headers['User-Agent'], /Mozilla/);
  assert.match(headers.Accept, /image/);
});

test('tries the sharpest available SoFIFA portrait variants first', () => {
  assert.deepEqual(
    portraits.getPortraitCandidateUrls('https://cdn.sofifa.net/players/146/296/26_120.png'),
    [
      'https://cdn.sofifa.net/players/146/296/26_480.png',
      'https://cdn.sofifa.net/players/146/296/26_360.png',
      'https://cdn.sofifa.net/players/146/296/26_240.png',
      'https://cdn.sofifa.net/players/146/296/26_120.png'
    ]
  );
  assert.deepEqual(portraits.getPortraitCandidateUrls('https://evil.example/players/146/296/26_120.png'), []);
});

test('reads PNG dimensions for cache-quality checks', () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(240, 16);
  png.writeUInt32BE(240, 20);
  assert.deepEqual(portraits.getPngDimensions(png), { width: 240, height: 240 });
  assert.equal(portraits.getPngDimensions(Buffer.from('invalid')), null);
});

test('forces old or unversioned cache rows to fetch the current quality profile', () => {
  assert.equal(portraits.isCurrentPortraitCacheProfile({ cache_path: 'fc26/hq2/146296.png' }), false);
  assert.equal(portraits.isCurrentPortraitCacheProfile({ cache_path: 'fc26/hq3/146296.png' }), true);
  assert.equal(portraits.isCurrentPortraitCacheProfile({ cache_path: null }), false);
});

test('uses safe per-player PNG cache paths', () => {
  assert.equal(portraits.relativePortraitPath({ source_player_id: '146296' }), path.join('fc26', 'hq3', '146296.png'));
  assert.throws(() => portraits.relativePortraitPath({ source_player_id: '../escape' }));
});

test('validates PNG signatures', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(portraits.isPng(png), true);
  assert.equal(portraits.isPng(Buffer.from('not an image')), false);
});
