'use strict';

const { connect, close } = require('../src/db');
const { getGameCatalog } = require('../src/services/catalog-cache');
const { getOfficialCardImage, getMappedPlayerKeys } = require('../src/services/card-image-cache');

async function runPool(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function main() {
  await connect();
  const keys = await getMappedPlayerKeys();
  if (!keys.length) {
    console.log('[CARD CACHE] No player mappings found. Add exact card image URLs to data/card-image-map.json first.');
    return;
  }

  const players = await getGameCatalog();
  const keySet = new Set(keys.map(String));
  const selected = players.filter(player => keySet.has(String(player.source_player_id)) || keySet.has(String(player.id)));
  const unmatched = keys.length - selected.length;
  let ready = 0;
  let unavailable = 0;

  console.log(`[CARD CACHE] Prefetching ${selected.length} mapped cards (2 concurrent downloads).`);
  await runPool(selected, 2, async player => {
    const image = await getOfficialCardImage(player);
    if (image) ready += 1;
    else unavailable += 1;
    const done = ready + unavailable;
    if (done % 25 === 0 || done === selected.length) {
      console.log(`[CARD CACHE] ${done}/${selected.length} processed · ${ready} cached · ${unavailable} unavailable`);
    }
  });

  console.log(`[CARD CACHE] Complete. Cached: ${ready}; unavailable: ${unavailable}; mappings not found in catalog: ${Math.max(0, unmatched)}.`);
}

main()
  .catch(error => {
    console.error('[CARD CACHE] Prefetch failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close().catch(() => {});
  });
