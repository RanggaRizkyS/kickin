const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Joko embeds use one restrained identity and always include timestamps', () => {
  const source = read('src/utils/message.js');
  assert.match(source, /author: 'Joko Soccer · Club Desk'/);
  assert.match(source, /voice: 'Joko is the club registrar/);
  assert.match(source, /\.setTimestamp\(\)/);
  assert.match(source, /function baseEmbed\(/);
  assert.doesNotMatch(source, /Club records · Transfers · Matchday/);
});

test('My Players renders 20 native embed fields per page and keeps public card IDs', () => {
  const source = read('src/commands/players.js');
  assert.match(source, /const PAGE_SIZE = 20/);
  assert.match(source, /function playerFields\(/);
  assert.match(source, /embed\.addFields\(playerFields\(viewRows, currentPage\)\)/);
  assert.match(source, /publicId/);
  assert.match(source, /pageButtons\('players'/);
  assert.doesNotMatch(source, /fixedWidthTable|AttachmentBuilder|code block/);
});

test('Squad and remove-player use player fields, position selectors and no refresh control', () => {
  const source = read('src/handlers/squad-ui.js');
  assert.match(source, /addSquadFields\(embed, squad\)/);
  assert.match(read('src/handlers/squad-ui.js'), /TEAM OVR[\s\S]*inline: false/);
  assert.match(read('src/utils/message.js'), /name: `\$\{shirt\} · \$\{slot.label\}`[\s\S]*inline: false/);
  assert.match(source, /buildRemovePlayerPanel/);
  assert.match(source, /removeplayer:choose/);
  assert.match(source, /squad:prev/);
  assert.match(source, /squad:next/);
  assert.doesNotMatch(source, /tableForTeam|fixedWidthTable|squad:refresh/);
});

test('Market uses twelve listing fields, compact selectors and arrow-only navigation', () => {
  const source = read('src/handlers/market-ui.js');
  assert.match(source, /const PAGE_SIZE = 12/);
  assert.match(source, /embed\.addFields\(fields\)/);
  assert.match(source, /market:choose/);
  assert.match(source, /market:prev/);
  assert.match(source, /market:next/);
  assert.match(source, /publicListingId/);
  assert.doesNotMatch(source, /fixedWidthTable|market:refresh|setLabel\('Previous'\)|setLabel\('Next'\)|setLabel\('Refresh'\)/);
});

test('Pack counter lists pack options as fields and results use one featured card plus other-pull fields', () => {
  const source = read('src/handlers/pack-ui.js');
  assert.match(source, /Order Summary/);
  assert.match(source, /packWeightText/);
  assert.match(source, /function packResultsFields/);
  assert.match(source, /pack-highest-player\.png/);
  assert.match(source, /embed\.addFields\(\.\.\.packResultsFields\(remaining\)\)/);
  assert.match(source, /interaction\.deferUpdate\(\)/);
  assert.doesNotMatch(source, /fixedWidthTable|buildPlayerOpeningEmbed|sleep\(/);
});

test('Leaderboard, history and match logs are presented as native fields', () => {
  assert.match(read('src/commands/leaderboard.js'), /embed\.addFields\(fields\)/);
  assert.match(read('src/commands/history.js'), /embed\.addFields\(rows\.map/);
  const logs = read('src/commands/matchlogs.js');
  assert.match(logs, /embed\.addFields\(fields\)/);
  assert.match(logs, /matchlogs:prev/);
  assert.match(logs, /matchlogs:next/);
  assert.doesNotMatch([read('src/commands/leaderboard.js'), read('src/commands/history.js'), logs].join('\n'), /fixedWidthTable/);
});

test('Every pagination control is an arrow without a text label; Refresh controls are absent', () => {
  const files = ['src/commands/players.js', 'src/commands/matchlogs.js', 'src/handlers/market-ui.js', 'src/handlers/squad-ui.js'];
  const source = files.map(read).join('\n');
  assert.doesNotMatch(source, /setLabel\(['"](?:Previous|Next|Refresh)['"]\)/i);
  assert.doesNotMatch(source, /:refresh:/i);
});

test('Match preview and match flow retain the 90-minute clock and five-second break', () => {
  const message = read('src/utils/message.js');
  const flow = read('src/handlers/match-flow.js');
  const service = read('src/services/match-service.js');
  assert.match(message, /function buildHalfTimeEmbed/);
  assert.match(flow, /await sleep\(5000\)/);
  assert.match(service, /for \(let minute = 1; minute <= 90; minute \+= 1\)/);
  assert.match(service, /const secondHalfOffset = minute > 45 \? 5000 : 0/);
  assert.match(service, /pendingPayload/);
  assert.match(service, /editWorker/);
});

test('Claim cooldown uses the MariaDB clock and allows a first claim immediately', () => {
  const service = read('src/services/market.js');
  const users = read('src/services/users.js');
  assert.match(service, /MAX\(ma\.created_at\)/);
  assert.match(service, /ma\.action_type='claim'/);
  assert.match(service, /UNIX_TIMESTAMP\(NOW\(3\)\)/);
  assert.match(users, /VALUES \(\?\,\?\,\?\,\?\,NULL\,NULL\)/);
});

test('All public-facing command and handler copy is English and avoids table-codeblocks', () => {
  const walk = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(relative);
    return entry.name.endsWith('.js') ? [read(relative)] : [];
  });
  const source = [...walk('src/commands'), ...walk('src/handlers')].join('\n');
  assert.doesNotMatch(source, /ditempatkan|Pemain tidak ditemukan|Kamu belum terdaftar|Silakan coba/i);
  assert.doesNotMatch(source, /fixedWidthTable|tableForTeam/);
});

test('Live match UI displays an ordered vertical event feed and a 0–90 minute clock', () => {
  const message = read('src/utils/message.js');
  const engine = read('src/services/match-engine.js');
  assert.match(message, /function eventFields\(/);
  assert.match(message, /eventFields\(match, currentMinute, 20\)/);
  assert.match(message, /eventFields\(match, 45, 20\)/);
  assert.match(message, /inline: false/);
  assert.match(message, /Minute \$\{currentMinute\} \/ 90/);
  assert.match(message, /minuteScores/);
  assert.match(engine, /minuteScores = \[scoreSnapshot\(stats, 0\)\]/);
  assert.match(engine, /if \(log\) logs\.push\(log\)/);
  assert.match(engine, /type: 'penalty_awarded'/);
  assert.match(engine, /type: 'penalty_scored'/);
});
