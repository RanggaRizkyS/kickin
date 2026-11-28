'use strict';

const { connect, getPool, close } = require('../src/db');

async function main() {
  await connect();
  const rows = await getPool().query(
    `SELECT game_version, status, COUNT(*) AS total
     FROM player_card_assets
     GROUP BY game_version, status
     ORDER BY game_version, status`
  );
  if (!rows.length) {
    console.log('[CARD CACHE] No cached card assets yet.');
    return;
  }
  console.table(rows.map(row => ({
    game_version: row.game_version,
    status: row.status,
    total: Number(row.total)
  })));
}

main()
  .catch(error => {
    console.error('[CARD CACHE] Status check failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close().catch(() => {});
  });
