'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const file = path.resolve(__dirname, '..', 'data', 'eafc26', 'players.csv');
if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) process.exit(0);
console.log('[DATA] EAFC26 dataset is missing. Downloading the source file...');
const result = spawnSync(process.execPath, [path.join(__dirname, 'download-eafc26.js')], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('\nThe EAFC26 player catalog could not be downloaded. Check your internet connection, then run: npm run data:download');
  process.exit(result.status || 1);
}
