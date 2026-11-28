'use strict';

const { connect, close } = require('../src/db');
const { getGameCatalog } = require('../src/services/catalog-cache');
const { getPlayerPortrait } = require('../src/services/player-portrait-cache');

function readArg(name, fallback, maximum = 500) {
  const prefix = `--${name}=`;
  const arg = process.argv.find(value => value.startsWith(prefix));
  if (!arg) return fallback;
  const value = Number(arg.slice(prefix.length));
  return Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
      await sleep(350);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const limit = readArg('limit', 100);
  const concurrency = readArg('concurrency', 2, 4);

  await connect();
  const players = await getGameCatalog();
  const selected = players
    .filter(player => player.player_face_url)
    .sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0))
    .slice(0, limit);
  let ready = 0;
  let unavailable = 0;

  console.log(`[SOFIFA] Warming portrait cache for ${selected.length} players (${concurrency} concurrent, max ${limit}).`);
  await runPool(selected, concurrency, async player => {
    const image = await getPlayerPortrait(player);
    if (image) ready += 1;
    else unavailable += 1;
    const done = ready + unavailable;
    if (done % 25 === 0 || done === selected.length) {
      console.log(`[SOFIFA] ${done}/${selected.length} processed · ${ready} cached · ${unavailable} unavailable`);
    }
  });

  console.log(`[SOFIFA] Complete. Cached: ${ready}; unavailable: ${unavailable}.`);
}

main()
  .catch(error => {
    console.error('[SOFIFA] Portrait prefetch failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close().catch(() => {});
  });
