const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('My Players uses 20-row Canvas table, public IDs, and arrow pagination', () => {
  const source = read('src/commands/players.js');
  assert.match(source, /const PAGE_SIZE = 20/);
  assert.match(source, /renderPlayersList/);
  assert.match(source, /players:prev/);
  assert.match(source, /players:next/);
  assert.match(source, /publicId/);
  assert.match(source, /StringSelectMenuBuilder/);
});

test('Squad and remove-player use Canvas squad table without field blueprint', () => {
  const handler = read('src/handlers/squad-ui.js');
  assert.match(handler, /renderSquadTable/);
  assert.match(handler, /POSISI/);
  assert.match(handler, /label: `\$\{player\.slotKey\} - \$\{player\.player\.name\}/);
  assert.doesNotMatch(handler, /field\.png/);
});

test('Market uses 10-row Canvas table and public listing IDs', () => {
  const handler = read('src/handlers/market-ui.js');
  assert.match(handler, /const PAGE_SIZE = 10/);
  assert.match(handler, /renderMarketTable/);
  assert.match(handler, /market:prev/);
  assert.match(handler, /market:next/);
  assert.match(handler, /market:choose/);
  assert.match(handler, /publicListingId/);
});

test('Pack reveals only one highest player card and remaining players as a text table', () => {
  const handler = read('src/handlers/pack-ui.js');
  assert.match(handler, /Confirm Purchase/);
  assert.match(handler, /quantity/);
  assert.match(handler, /pack-highest-player\.png/);
  assert.match(handler, /NO  CARD ID/);
  assert.doesNotMatch(handler, /buildPlayerOpeningEmbed|sleep\(/);
});

test('Claim cooldown derives from real claim ledger rows and MariaDB clock', () => {
  const service = read('src/services/market.js');
  const users = read('src/services/users.js');
  assert.match(service, /MAX\(ma\.created_at\)/);
  assert.match(service, /ma\.action_type='claim'/);
  assert.match(service, /UNIX_TIMESTAMP\(NOW\(3\)\)/);
  assert.match(users, /VALUES \(\?\,\?\,\?\,\?\,NULL\,NULL\)/);
});

test('Setplayer autocomplete sends the visible unique public card ID and resolves owned card copies', () => {
  const source = read('src/services/squad.js');
  assert.match(source, /const publicReference = String\(row\.public_id \|\| row\.card_instance_id\)/);
  assert.match(source, /value: publicReference/);
  assert.match(source, /UPPER\(c\.public_id\)=UPPER\(\?\)/);
  assert.match(source, /UPPER\(c\.card_instance_id\)=UPPER\(\?\)/);
});

test('Match shows one five-second pre-match preview then runs exactly 90 one-second ticks', () => {
  const flow = read('src/handlers/match-flow.js');
  const service = read('src/services/match-service.js');
  assert.match(flow, /await sleep\(5000\)/);
  assert.doesNotMatch(flow, /for \(let remaining = 4/);
  assert.match(service, /for \(let minute = 1; minute <= 90; minute \+= 1\)/);
  assert.match(service, /startedAt \+ \(minute \* 1000\)/);
  assert.match(service, /pendingPayload/);
  assert.match(service, /editWorker/);
  assert.match(service, /priorityPayloads\.length = 0/);
  assert.match(service, /priority: minute === 45/);
  assert.doesNotMatch(service, /halftimeBreakSeconds|MATCH_HALFTIME_BREAK_SECONDS/);
});

test('Claim remaining time decreases against the MariaDB clock and first claim is immediately available', () => {
  const { claimStatusFromRow } = require('../src/utils/claim-clock');
  const now = 1_800_000_000_000;
  const cooldown = 2 * 60 * 60 * 1000;
  const fresh = claimStatusFromRow({ db_now_ms: now, last_claim_at_ms: null }, cooldown, now);
  assert.equal(fresh.available, true);
  assert.equal(fresh.remainingMs, 0);

  const afterClaim = claimStatusFromRow({ db_now_ms: now, last_claim_at_ms: now }, cooldown, now);
  const oneHourLater = claimStatusFromRow({ db_now_ms: now + 60 * 60 * 1000, last_claim_at_ms: now }, cooldown, now);
  assert.equal(afterClaim.remainingMs, cooldown);
  assert.equal(oneHourLater.remainingMs, 60 * 60 * 1000);
});
