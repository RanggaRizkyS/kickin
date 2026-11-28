'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(ROOT, 'data', 'eafc26');
const TARGET = path.join(TARGET_DIR, 'players.csv');
const TEMP = `${TARGET}.download`;
const URL = 'https://raw.githubusercontent.com/ismailoksuz/EAFC26-DataHub/main/data/players.csv';

async function main() {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  if (fs.existsSync(TARGET) && fs.statSync(TARGET).size > 5 * 1024 * 1024) {
    console.log(`[DATA] Dataset already exists (${fs.statSync(TARGET).size.toLocaleString('en-US')} bytes).`);
    return;
  }

  console.log('[DATA] Downloading the EAFC26 DataHub source CSV (about 10.5 MB)...');
  const response = await fetch(URL, {
    redirect: 'follow',
    headers: { 'user-agent': 'Joko-Soccer-Data-Importer/2.9.0' },
    signal: AbortSignal.timeout(180000)
  });
  if (!response.ok) throw new Error(`Dataset download failed: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) throw new Error('GitHub returned HTML instead of the CSV dataset.');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 5 * 1024 * 1024) throw new Error(`Dataset is unexpectedly small (${buffer.length} bytes).`);
  const header = buffer.subarray(0, 20000).toString('utf8').split(/\r?\n/, 1)[0];
  const headerColumns = new Set(header.replace(/^\uFEFF/, '').split(',').map(value => value.trim().toLowerCase().replace(/^"|"$/g, '')));
  for (const required of ['player_id', 'short_name', 'overall', 'potential', 'player_positions', 'nationality_name', 'club_name']) {
    if (!headerColumns.has(required)) throw new Error(`Unexpected EAFC26 CSV schema: missing column ${required}.`);
  }

  fs.writeFileSync(TEMP, buffer);
  fs.renameSync(TEMP, TARGET);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  fs.writeFileSync(path.join(TARGET_DIR, 'dataset-manifest.json'), JSON.stringify({
    source: 'ismailoksuz/EAFC26-DataHub',
    sourceUrl: URL,
    downloadedAt: new Date().toISOString(),
    bytes: buffer.length,
    sha256,
    status: 'downloaded; database import runs at startup or via npm run data:import'
  }, null, 2));
  console.log(`[DATA] Saved ${buffer.length.toLocaleString('en-US')} bytes to data/eafc26/players.csv`);
  console.log(`[DATA] SHA-256: ${sha256}`);
}

main().catch(error => {
  try { fs.unlinkSync(TEMP); } catch {}
  console.error('[DATA DOWNLOAD ERROR]', error.message);
  console.error('Download the upstream data/players.csv file and place it at data/eafc26/players.csv.');
  process.exitCode = 1;
});
