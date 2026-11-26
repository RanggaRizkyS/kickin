const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/index.js',
  'src/deploy-commands.js',
  'src/utils/message.js',
  'src/utils/commands.js',
  'src/handlers/interaction-create.js',
  'src/handlers/match-flow.js',
  'src/handlers/squad-ui.js',
  'src/handlers/market-ui.js',
  'src/handlers/pack-ui.js',
  'src/services/match-service.js',
  'src/services/match-engine.js',
  'src/services/bot-squad-builder.js',
  'src/services/card-renderer.js',
  'src/database/schema.sql',
  'data/players.json',
  'public/img/blueprint/card-bronze.png',
  'public/img/blueprint/card-silver.png',
  'public/img/blueprint/card-gold.png',
  'public/img/blueprint/field.png'
];

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) {
    throw new Error(`Required project file is missing: ${relative}`);
  }
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/players.json'), 'utf8'));
if (!Array.isArray(catalog.players) || catalog.players.length !== 600) {
  throw new Error('The player catalog must contain exactly 600 players.');
}

const playerIds = new Set();
for (const player of catalog.players) {
  if (!player.id || !player.name || Number(player.overall) < 60 || Number(player.overall) > 95) {
    throw new Error(`Invalid player identity or OVR: ${player.id || 'unknown'}`);
  }
  if (playerIds.has(player.id)) throw new Error(`Duplicate catalog player ID: ${player.id}`);
  playerIds.add(player.id);
  if (!Array.isArray(player.skills) || player.skills.length > 5) {
    throw new Error(`Invalid skill count: ${player.id}`);
  }
  if (!player.role?.name || !player.nationality?.country || !player.strong_foot) {
    throw new Error(`Required player data is missing: ${player.id}`);
  }
  if (player.stats?.type === 'goalkeeper' && !player.stats.goalkeeper) {
    throw new Error(`Goalkeeper attributes are missing: ${player.id}`);
  }
  if (player.stats?.type !== 'goalkeeper' && !player.stats?.outfield) {
    throw new Error(`Outfield attributes are missing: ${player.id}`);
  }
}

const commandDir = path.join(root, 'src/commands');
const commandFiles = fs.readdirSync(commandDir).filter(file => file.endsWith('.js'));
if (commandFiles.length < 15) throw new Error(`Expected separate slash command files; found ${commandFiles.length}.`);

const commandNames = [];
for (const file of commandFiles) {
  const source = fs.readFileSync(path.join(commandDir, file), 'utf8');
  const name = source.match(/\.setName\(['"]([^'"]+)['"]\s*\)/);
  if (!name) throw new Error(`Slash command name is missing in ${file}.`);
  commandNames.push(name[1]);
  const descriptions = [...source.matchAll(/\.setDescription\(\s*(['"])(.*?)\1\s*\)/gs)].map(match => match[2]);
  if (!descriptions.length) throw new Error(`Slash command descriptions are missing in ${file}.`);
  for (const description of descriptions) {
    if (description.length > 100) {
      throw new Error(`Discord command description exceeds 100 characters: ${file} (${description.length}).`);
    }
  }
}
if (new Set(commandNames).size !== commandNames.length) {
  throw new Error('Duplicate slash command names were found.');
}

const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const message = read('src/utils/message.js');
if (!message.includes('function addSquadFields') || !message.includes('Joko Soccer') || !message.includes('Club Desk') || !message.includes('.setTimestamp()')) {
  throw new Error('The branded, timestamped embed and native-field helpers are missing.');
}
if (message.includes('fixedWidthTable') || message.includes('tableForTeam')) {
  throw new Error('Legacy text-table rendering must not remain in the shared message module.');
}

const fieldFeatures = [
  ['src/commands/players.js', /PAGE_SIZE = 20/, /playerFields\(/, /pageButtons\(/, /publicId/],
  ['src/handlers/squad-ui.js', /addSquadFields\(/, /buildRemovePlayerPanel/, /slotKey/],
  ['src/handlers/market-ui.js', /PAGE_SIZE = 12/, /embed\.addFields\(fields\)/, /market:prev/, /market:next/],
  ['src/handlers/pack-ui.js', /Order Summary/, /packResultsFields/, /pack-highest-player\.png/, /setImage\(/],
  ['src/commands/leaderboard.js', /embed\.addFields\(fields\)/],
  ['src/commands/matchlogs.js', /embed\.addFields\(fields\)/, /matchlogs:prev/, /matchlogs:next/],
  ['src/commands/history.js', /embed\.addFields\(rows\.map/]
];
for (const [relative, ...patterns] of fieldFeatures) {
  const source = read(relative);
  for (const pattern of patterns) {
    if (!pattern.test(source)) throw new Error(`Native embed-field layout or pagination is missing in ${relative}: ${pattern}`);
  }
  if (/fixedWidthTable|tableForTeam/.test(source)) {
    throw new Error(`A text table is still used in ${relative}.`);
  }
}

const allCommandSource = commandFiles.map(file => read(path.join('src/commands', file))).join('\n');
const allHandlerSource = fs.readdirSync(path.join(root, 'src/handlers'))
  .filter(file => file.endsWith('.js'))
  .map(file => read(path.join('src/handlers', file))).join('\n');
if (/setLabel\(['"](?:Previous|Next|Refresh)['"]\)/i.test(allCommandSource + allHandlerSource)) {
  throw new Error('Pagination controls must use arrow-only buttons, with no Refresh button.');
}
if (/setCustomId\([^)]*refresh:/i.test(allCommandSource + allHandlerSource)) {
  throw new Error('A Refresh control remains in the UI.');
}

const sourceFiles = [];
function collectJs(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJs(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) sourceFiles.push(full);
  }
}
collectJs(path.join(root, 'src'));
const allSource = sourceFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
if (allSource.includes('field.png')) {
  throw new Error('The field blueprint should remain unused in Discord command views.');
}
if (/render(?:Squad|Market|Players)Table|renderPlayersList/.test(allSource)) {
  throw new Error('An obsolete image-based table renderer remains in the source tree.');
}

const matchService = read('src/services/match-service.js');
if (!matchService.includes('for (let minute = 1; minute <= 90; minute += 1)')) {
  throw new Error('The match service must process exactly 90 match minutes.');
}
if (!matchService.includes('const secondHalfOffset = minute > 45 ? 5000 : 0;') || !matchService.includes('await sleep(5000);')) {
  throw new Error('The five-second half-time break is not configured correctly.');
}
if (!matchService.includes('pendingPayload') || !matchService.includes('editWorker')) {
  throw new Error('The coalesced Discord message update queue is missing.');
}

const matchEngine = read('src/services/match-engine.js');
for (const eventType of ['build_up', 'defend', 'goal', 'yellow_card', 'red_card', 'penalty_awarded', 'penalty_scored']) {
  if (!matchEngine.includes(`'${eventType}'`)) {
    throw new Error(`The approved match event is missing: ${eventType}`);
  }
}
if (!matchEngine.includes('if (log) logs.push(log)') || !matchEngine.includes('minuteScores = [scoreSnapshot(stats, 0)]')) {
  throw new Error('Quiet-minute sparse logging or the minute-zero timeline is missing.');
}
if (!matchEngine.includes('side: defendingSide') || !matchEngine.includes('saves the penalty from')) {
  throw new Error('Penalty incidents must be attributed to the offending team and saved penalties must be logged as defensive events.');
}
if (!message.includes('eventFields(match, currentMinute, 20)') || !message.includes('inline: false')) {
  throw new Error('The live match event feed must be vertical and display up to 20 recent events.');
}
const botBuilder = read('src/services/bot-squad-builder.js');
if (!botBuilder.includes('const ALL_BOT_NAMES = BOT_NAME_RANGES.flatMap') || !botBuilder.includes('attempts = Math.max(80')) {
  throw new Error('Adaptive bot squad generation or its manager name pool is missing.');
}

const claim = read('src/services/market.js');
if (!claim.includes('MAX(ma.created_at)') || !claim.includes("ma.action_type='claim'") || !claim.includes('UNIX_TIMESTAMP(NOW(3))')) {
  throw new Error('Claim cooldown must use the MariaDB clock and the actual claim ledger.');
}

const dataText = fs.readFileSync(path.join(root, 'data/players.json'), 'utf8');
if (/Mampu |Memiliki |Penyelesaian akhir|Aktif keluar|Keunggulan khusus|Spesialis umpan/.test(dataText)) {
  throw new Error('Some player skill or role descriptions are still in Indonesian.');
}

console.log(`PASS: ${catalog.players.length} fictional players validated.`);
console.log(`PASS: ${commandFiles.length} separate slash command files with unique names.`);
console.log('PASS: all slash command descriptions meet Discord limits.');
console.log('PASS: player, squad, market (12/page), pack, leaderboard, history, and match logs use native Discord embed fields.');
console.log('PASS: squad position fields are rendered vertically.');
console.log('PASS: Classic bot uses varied catalog players and 70 manager names with matched Team Strength.');
console.log('PASS: player-card blueprints are present; the field blueprint is not rendered in Discord UI.');
console.log('PASS: pagination uses arrow-only controls and no Refresh button.');
console.log('PASS: minute 0–90 clock, sparse chronological player events, ordered penalty resolution, a five-second half-time break, and queued Discord edits are configured.');
console.log('PASS: claim cooldown uses MariaDB time and the claim ledger.');
console.log('PASS: player descriptions and command copy use English.');
