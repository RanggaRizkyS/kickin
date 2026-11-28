'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');
const { normalizeEafc26Record } = require('../src/services/eafc26-normalizer');

const file = path.resolve(__dirname, '..', 'data', 'eafc26', 'players.csv');
if (!fs.existsSync(file)) {
  console.error('Dataset not found. Run `npm run data:download` first.');
  process.exit(1);
}

const csv = fs.readFileSync(file);
const records = parse(csv, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_quotes: true });
const headers = Object.keys(records[0] || {});
const sample = records.slice(0, 5).map(normalizeEafc26Record);
const validIds = new Set(records.map(row => normalizeEafc26Record(row).id));
const duplicates = records.length - validIds.size;

console.log(`File: ${file}`);
console.log(`Bytes: ${csv.length.toLocaleString('en-US')}`);
console.log(`Rows: ${records.length.toLocaleString('en-US')}`);
console.log(`Columns: ${headers.length}`);
console.log(`Deterministic IDs: ${validIds.size.toLocaleString('en-US')}`);
console.log(`ID collisions: ${duplicates}`);
console.log('First normalized players:');
for (const player of sample) {
  console.log(`- ${player.id} | ${player.name} | ${player.overall} OVR | ${player.positions.primary} | ${player.nationality.country} | ${player.club.name}`);
}
if (records.length < 10000 || duplicates > 0 || sample.some(player => !player.name || !player.stats.main)) {
  console.error('Dataset inspection failed. Do not import this file.');
  process.exit(1);
}
console.log('EAFC26 dataset inspection passed.');
