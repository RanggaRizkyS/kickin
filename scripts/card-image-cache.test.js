'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const mapPath = path.join(os.tmpdir(), `fut-card-map-${process.pid}.json`);
fs.writeFileSync(mapPath, JSON.stringify({
  '252371': {
    gameVersion: 'FC26',
    eaItemId: '900123',
    providerCardId: 'catalogue-77',
    imageUrl: 'https://cdn.example.com/cards/900123.png'
  },
  '239053': {
    gameVersion: 'FC27',
    eaItemId: '900124',
    imageUrl: 'https://cdn.example.com/cards/900124.png'
  }
}));

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename && parent.filename.endsWith(`${path.sep}src${path.sep}services${path.sep}card-image-cache.js`)) {
    if (request === '../db') return { getPool: () => { throw new Error('Database should not be needed in utility tests.'); } };
    if (request === '../config') {
      return {
        cardImages: {
          gameVersion: 'FC26',
          mapPath,
          cacheDir: path.join(os.tmpdir(), 'fut-card-cache-tests'),
          urlTemplate: '',
          timeoutMs: 1000,
          maxBytes: 1024 * 1024,
          missingRetryHours: 24,
          failedRetryMinutes: 15,
          allowedHosts: ['example.com'],
          apiKey: '',
          apiKeyHosts: [],
          apiKeyHeader: 'X-API-Key',
          apiKeyPrefix: ''
        }
      };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

const cache = require('../src/services/card-image-cache');
Module._load = originalLoad;

test('validates PNG file signature', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal(cache.isPng(png), true);
  assert.equal(cache.isPng(Buffer.from('not an image')), false);
});

test('allows only HTTPS images from configured hosts', () => {
  assert.equal(cache.isAllowedImageUrl('https://cdn.example.com/card.png'), true);
  assert.equal(cache.isAllowedImageUrl('http://cdn.example.com/card.png'), false);
  assert.equal(cache.isAllowedImageUrl('https://evil.test/card.png'), false);
  assert.equal(cache.isAllowedImageUrl('https://localhost/card.png'), false);
});

test('expands card URL templates with encoded values', () => {
  const result = cache.expandUrlTemplate('https://cdn.example.com/{gameVersion}/{eaItemId}/{name}.png', {
    gameVersion: 'FC26', eaItemId: '123', name: 'Kylian Mbappé'
  });
  assert.equal(result, 'https://cdn.example.com/FC26/123/Kylian%20Mbapp%C3%A9.png');
});

test('resolves only mappings matching the configured game version', async () => {
  cache.clearCardImageMappingCache();
  const player = { id: '252371', source_player_id: '252371', name: 'Mapped Player', player_face_url: 'https://cdn.sofifa.net/portrait.png' };
  const source = await cache.getMappedSource(player);
  assert.equal(source.eaItemId, '900123');
  assert.equal(source.providerCardId, 'catalogue-77');
  assert.equal(source.imageUrl, 'https://cdn.example.com/cards/900123.png');

  const wrongVersion = await cache.getMappedSource({ id: '239053', source_player_id: '239053', name: 'Other Version' });
  assert.equal(wrongVersion, null);
  const noMapping = await cache.getMappedSource({ id: 'no-image', name: 'No Mapping', player_face_url: 'https://cdn.sofifa.net/players/portrait.png' });
  assert.equal(noMapping, null);
});

test.after(() => {
  try { fs.unlinkSync(mapPath); } catch {}
});
