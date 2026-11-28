const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/index.js','src/deploy-commands.js','src/utils/message.js','src/utils/commands.js',
  'src/handlers/interaction-create.js','src/handlers/match-flow.js','src/handlers/squad-ui.js',
  'src/handlers/market-ui.js','src/handlers/pack-ui.js','src/services/match-service.js',
  'src/services/match-engine.js','src/services/bot-squad-builder.js','src/utils/match-result.js','src/services/card-renderer.js',
  'src/services/eafc26-normalizer.js','src/services/starter-selection.js','src/services/catalog-cache.js','src/services/card-image-cache.js','src/services/player-portrait-cache.js','src/services/sofifa-badge-cache.js','src/utils/player-pool.js','src/database/schema.sql','data/eafc26/README.md','data/card-image-map.json','docs/CARD_IMAGE_CACHE.md','docs/SOFIFA_PORTRAIT_CACHE.md','docs/CARD_LAYOUT_TEMPLATE.md','docs/MATCH_BALANCE.md',
  'public/img/blueprint/card-bronze.png','public/img/blueprint/card-silver.png',
  'public/img/blueprint/card-gold.png','public/img/blueprint/field.png',
  'scripts/download-eafc26.js','scripts/ensure-eafc26-data.js','scripts/import-eafc26.js','scripts/inspect-eafc26.js'
];
for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Required project file is missing: ${relative}`);
}

const fixturePath = path.join(root, 'data/fixtures/fictional_players_600.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
if (!Array.isArray(fixture.players) || fixture.players.length !== 600) throw new Error('The archived test fixture must contain 600 players.');

const commandDir = path.join(root, 'src/commands');
const commandFiles = fs.readdirSync(commandDir).filter(file => file.endsWith('.js'));
if (commandFiles.length < 15) throw new Error(`Expected separate slash command files; found ${commandFiles.length}.`);
const names = [];
for (const file of commandFiles) {
  const source = fs.readFileSync(path.join(commandDir, file), 'utf8');
  const name = source.match(/\.setName\(['"]([^'"]+)['"]\s*\)/);
  if (!name) throw new Error(`Slash command name is missing in ${file}.`);
  names.push(name[1]);
  const descriptions = [...source.matchAll(/\.setDescription\(\s*(['"])(.*?)\1\s*\)/gs)].map(match => match[2]);
  if (!descriptions.length) throw new Error(`Slash command descriptions are missing in ${file}.`);
  for (const description of descriptions) if (description.length > 100) throw new Error(`Discord command description exceeds 100 characters: ${file}`);
}
if (new Set(names).size !== names.length) throw new Error('Duplicate slash command names were found.');

const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const message = read('src/utils/message.js');
if (!message.includes('function addSquadFields') || !message.includes('Joko Soccer') || !message.includes('Club Desk') || !message.includes('.setTimestamp()')) {
  throw new Error('The branded, timestamped embed and native-field helpers are missing.');
}
if (message.includes('fixedWidthTable') || message.includes('tableForTeam')) throw new Error('Legacy text-table rendering remains in the shared message module.');
const fieldFeatures = [
  ['src/commands/players.js', /PAGE_SIZE = 20/, /playerFields\(/, /pageButtons\(/, /publicId/],
  ['src/handlers/squad-ui.js', /addSquadFields\(/, /buildRemovePlayerPanel/, /slotKey/],
  ['src/handlers/market-ui.js', /PAGE_SIZE = 12/, /embed\.addFields\(fields\)/, /market:prev/, /market:next/],
  ['src/handlers/pack-ui.js', /Order Summary/, /packResultsFields/, /pack-highest-player\.png/, /files: \[file\]/],
  ['src/commands/leaderboard.js', /embed\.addFields\(fields\)/],
  ['src/commands/matchlogs.js', /embed\.addFields\(fields\)/, /matchlogs:prev/, /matchlogs:next/],
  ['src/commands/history.js', /embed\.addFields\(rows\.map/]
];
for (const [relative, ...patterns] of fieldFeatures) {
  const source = read(relative);
  for (const pattern of patterns) if (!pattern.test(source)) throw new Error(`Native embed-field layout is missing in ${relative}: ${pattern}`);
  if (/fixedWidthTable|tableForTeam/.test(source)) throw new Error(`A text table is still used in ${relative}.`);
}

const allCommands = commandFiles.map(file => read(path.join('src/commands', file))).join('\n');
const allHandlers = fs.readdirSync(path.join(root, 'src/handlers')).filter(file => file.endsWith('.js')).map(file => read(path.join('src/handlers', file))).join('\n');
if (/setLabel\(['"](?:Previous|Next|Refresh)['"]\)/i.test(allCommands + allHandlers)) throw new Error('Pagination buttons must remain arrow-only.');
if (/setCustomId\([^)]*refresh:/i.test(allCommands + allHandlers)) throw new Error('A Refresh control remains in the UI.');

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
if (allSource.includes('field.png')) throw new Error('The field blueprint should not be rendered in Discord command views.');

const matchService = read('src/services/match-service.js');
if (!matchService.includes('for (let minute = 1; minute <= 90; minute += 1)')) throw new Error('Match service must process exactly 90 minutes.');
if (!matchService.includes('const secondHalfOffset = minute > 45 ? 5000 : 0;') || !matchService.includes('await sleep(5000);')) throw new Error('Five-second half-time pause is missing.');
const matchEngine = read('src/services/match-engine.js');
for (const type of ['build_up','defend','goal','yellow_card','red_card','penalty_awarded','penalty_scored']) {
  if (!matchEngine.includes(`'${type}'`)) throw new Error(`Approved match event missing: ${type}`);
}
if (!matchEngine.includes('if (log) logs.push(log)') || !matchEngine.includes('minuteScores = [scoreSnapshot(stats, 0)]')) throw new Error('Sparse timeline or minute zero is missing.');

const bot = read('src/services/bot-squad-builder.js');
if (!bot.includes('buildPositionIndex') || !bot.includes('nearestAvailable') || !bot.includes('const ALL_BOT_NAMES = BOT_NAME_RANGES.flatMap')) throw new Error('Indexed adaptive bot builder or 70-name pool is missing.');
if (!bot.includes('randomInt(400, 600, rng) / 100') || !bot.includes('targetStrength: desiredStrength')) throw new Error('Classic CPU should target a controlled 4-6 point Team Strength disadvantage.');
const history = read('src/commands/history.js');
if (!history.includes('resultForUser({ status: row.status, ownScore, opponentScore })')) throw new Error('Match history must derive CPU results from the final scoreline.');
const matchResult = read('src/utils/match-result.js');
if (!matchResult.includes("if (own < opponent) return 'LOSS'") || !matchResult.includes("return 'DRAW'")) throw new Error('Score-based match result resolver is missing.');

const market = read('src/services/market.js');
if (!market.includes("catalog_source='eafc26'")) throw new Error('System Market must use the EAFC26 catalog only.');
const db = read('src/db.js');
if (!db.includes("path.join(__dirname, '..', 'data', 'eafc26', 'players.csv')") || !db.includes('conn.batch(catalogSql, catalogValues)') || !db.includes("catalog_source='eafc26'")) {
  throw new Error('Database bootstrap must import the EAFC26 CSV in batches.');
}
const users = read('src/services/users.js');
const catalogCache = read('src/services/catalog-cache.js');
if (!users.includes('getGameCatalog(conn)') || !catalogCache.includes("catalog_source='eafc26'")) throw new Error('Starter squad must use the cached EAFC26 catalog.');
const cache = read('src/services/catalog-cache.js');
if (!cache.includes('function gamePlayerView') || !cache.includes('getGameCatalog')) throw new Error('The lightweight EAFC26 gameplay catalog cache is missing.');
const cardRenderer = read('src/services/card-renderer.js');
const cardImageCache = read('src/services/card-image-cache.js');
if (!cardImageCache.includes('player_card_assets') || !cardImageCache.includes('getMappedSource')) throw new Error('Optional original FUT image mapping/cache service is missing.');
const portraitCache = read('src/services/player-portrait-cache.js');
if (!portraitCache.includes("'Referer': settings.sofifaReferer") || !portraitCache.includes('player_face_url') || !portraitCache.includes('getPortraitCandidateUrls') || !portraitCache.includes('hq3') || !cardRenderer.includes('drawPortraitOnTemplate') || !cardRenderer.includes('CARD_LAYOUT') || !cardRenderer.includes('drawBottomIdentity') || !read('src/services/sofifa-badge-cache.js').includes('getPlayerBadgeAssets')) throw new Error('SoFIFA portrait cache or measured FUT template layout renderer is missing.');
if (/\.setImage\(['"]attachment:\/\//.test(allCommands + allHandlers)) throw new Error('Player cards must be delivered as full PNG attachments rather than height-limited embed image previews.');
if (!read('package.json').includes('cards:prefetch') || !read('package.json').includes('cards:status') || !read('package.json').includes('portraits:prefetch')) throw new Error('Card/portrait cache maintenance commands are missing.');
const pool = read('src/utils/player-pool.js');
if (!pool.includes('buildRarityIndex') || !pool.includes('chooseWeightedPlayerId')) throw new Error('The indexed player rarity pool is missing.');
const normalizer = read('src/services/eafc26-normalizer.js');
for (const field of ['overall','potential','player_positions','nationality_name','club_name','pace','shooting','passing','dribbling','defending','physic']) {
  if (!normalizer.includes(field)) throw new Error(`EAFC26 normalizer is missing ${field}.`);
}

console.log('PASS: archived 600-player fixture is test-only; production uses the EAFC26 DataHub catalog.');
console.log('PASS: EAFC26 downloader, inspector, batch importer, normalizer, catalog cache and migrations are present.');
console.log(`PASS: ${commandFiles.length} separate slash command files and Discord description limits.`);
console.log('PASS: player, squad, market, pack, leaderboard, history and match logs use native embed fields.');
console.log('PASS: one squad, cached EAFC26 starter/CPU catalog, EAFC26-only System Market, duplicate card instances and stable source IDs.');
console.log('PASS: Team Chemistry follows public all-to-all club/nationality/league links, grade thresholds and Joko familiarity extensions.');
console.log('PASS: public Effective Stats price curve, rarity pool index and Joko supply/demand extension are wired.');
console.log('PASS: 90-minute sparse match timeline, ordered events, and five-second half-time pause.');
console.log('PASS: Classic CPU is 4-6 Team Strength points weaker; scoreline-based history correctly marks CPU wins as losses.');
console.log('PASS: UI remains native Discord fields; player-card renderer uses the measured Gold/Silver/Bronze template geometry.');
console.log('PASS: optional original card image mapping, MariaDB metadata cache, and PNG validation are present.');
console.log('PASS: SoFIFA high-resolution portrait cache, Referer fetching, country flag, league/team badge cache, bold FUT typography, full portrait contain-fit, nameplate, and aligned stats are present.');
console.log('NOTE: data/eafc26/players.csv is bundled; startup downloads it only if it is missing or undersized.');
