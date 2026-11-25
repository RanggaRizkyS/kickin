const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = [
  'src/index.js', 'src/deploy-commands.js', 'src/utils/message.js',
  'src/handlers/interaction-create.js', 'src/handlers/match-flow.js',
  'src/services/match-service.js', 'src/services/match-engine.js',
  'src/services/card-renderer.js', 'src/services/squad-renderer.js',
  'src/services/players-list-renderer.js', 'src/services/market-renderer.js',
  'src/handlers/market-ui.js', 'src/handlers/squad-ui.js', 'src/handlers/player-ui.js',
  'src/database/schema.sql', 'data/players.json',
  'public/img/blueprint/card-bronze.png', 'public/img/blueprint/card-silver.png',
  'public/img/blueprint/card-gold.png', 'public/img/blueprint/field.png'
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`File penting tidak ditemukan: ${file}`);
}
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/players.json'), 'utf8'));
if (!Array.isArray(data.players) || data.players.length !== 600) throw new Error('Dataset harus berisi tepat 600 pemain.');
for (const player of data.players) {
  if (!player.id || !player.name || player.overall < 60 || player.overall > 95) throw new Error(`Data pemain invalid: ${player.id}`);
  if (!Array.isArray(player.skills) || player.skills.length > 5) throw new Error(`Skills pemain invalid: ${player.id}`);
  if (!player.role?.name || !player.nationality?.country || !player.strong_foot) throw new Error(`Data wajib belum lengkap: ${player.id}`);
  if (player.stats?.type === 'goalkeeper' && !player.stats.goalkeeper) throw new Error(`GK stats tidak lengkap: ${player.id}`);
  if (player.stats?.type !== 'goalkeeper' && !player.stats?.outfield) throw new Error(`Outfield stats tidak lengkap: ${player.id}`);
}
const commandDir = path.join(root, 'src/commands');
const commandFiles = fs.readdirSync(commandDir).filter(file => file.endsWith('.js'));
if (commandFiles.length < 15) throw new Error(`Command terlalu sedikit: ${commandFiles.length}`);
const commandNames = [];
for (const file of commandFiles) {
  const source = fs.readFileSync(path.join(commandDir, file), 'utf8');
  const name = source.match(/\.setName\(['"]([^'"]+)['"]\s*\)/);
  if (!name) throw new Error(`Slash command tidak memiliki deklarasi nama: ${file}`);
  commandNames.push(name[1]);
  // Static validation allows check.js to run even before npm install.
  const descriptions = [...source.matchAll(/\.setDescription\(\s*(['"])(.*?)\1\s*\)/gs)].map(match => match[2]);
  if (!descriptions.length) throw new Error(`Command tidak memiliki deskripsi: ${file}`);
  for (const description of descriptions) {
    if (description.length > 100) throw new Error(`Deskripsi slash command/option >100 karakter: ${file} (${description.length})`);
  }
}
if (new Set(commandNames).size !== commandNames.length) throw new Error('Ada nama slash command yang duplikat.');
const matchService = fs.readFileSync(path.join(root, 'src/services/match-service.js'), 'utf8');
if (!matchService.includes('async function runPreparedMatchDiscord')) throw new Error('Runner pertandingan Discord tidak ditemukan.');
if (!matchService.includes('pendingPayload') || !matchService.includes('editWorker')) throw new Error('Match edit coalescing tidak ditemukan.');
const squadUi = fs.readFileSync(path.join(root, 'src/handlers/squad-ui.js'), 'utf8');
if (!squadUi.includes('renderSquadTable') || !squadUi.includes('files: [panel.file]')) throw new Error('Squad table renderer belum terhubung.');
const marketUi = fs.readFileSync(path.join(root, 'src/handlers/market-ui.js'), 'utf8');
if (!marketUi.includes('renderMarketTable')) throw new Error('Market table renderer belum terhubung.');
const claim = fs.readFileSync(path.join(root, 'src/services/market.js'), 'utf8');
if (!claim.includes('MAX(ma.created_at)') || !claim.includes("ma.action_type='claim'") || !claim.includes('UNIX_TIMESTAMP(NOW(3))')) throw new Error('Claim harus memakai ledger claim dan jam MariaDB agar cooldown bisa dihitung realtime.');
console.log(`PASS: ${data.players.length} pemain tervalidasi.`);
console.log(`PASS: ${commandFiles.length} file slash command terpisah dan nama command unik.`);
console.log('PASS: semua deskripsi command yang terbaca tidak melebihi batas 100 karakter.');
console.log('PASS: Canvas squad/market, claim clock, match runner, dan blueprint tersedia.');
