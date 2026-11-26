const mariadb = require('mariadb');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { rarityFromOvr } = require('./utils/football');

let pool;

async function ensureColumn(conn, table, column, definition) {
  const rows = await conn.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (!rows.length) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function ensureUniqueIndex(conn, table, indexName, column) {
  const rows = await conn.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name=?`, [indexName]);
  if (!rows.length) {
    await conn.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${indexName}\` (\`${column}\`)`);
  }
}

function makePublicId(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

async function backfillPublicIds(conn) {
  const cards = await conn.query('SELECT card_instance_id FROM user_player_cards WHERE public_id IS NULL');
  for (const row of cards) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const result = await conn.query(
          'UPDATE user_player_cards SET public_id=? WHERE card_instance_id=? AND public_id IS NULL',
          [makePublicId('PC'), row.card_instance_id]
        );
        if (result.affectedRows) break;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY' || attempt === 7) throw error;
      }
    }
  }

  const listings = await conn.query('SELECT listing_id FROM user_market_listings WHERE public_listing_id IS NULL');
  for (const row of listings) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const result = await conn.query(
          'UPDATE user_market_listings SET public_listing_id=? WHERE listing_id=? AND public_listing_id IS NULL',
          [makePublicId('UL'), row.listing_id]
        );
        if (result.affectedRows) break;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY' || attempt === 7) throw error;
      }
    }
  }
}

async function runMigrations(conn) {
  // Millisecond timestamps avoid DATETIME/session-timezone drift in claim cooldowns.
  // Existing accounts receive one fresh claim after this migration; subsequent claims use the new clock.
  await ensureColumn(conn, 'users', 'last_claim_at_ms', 'BIGINT UNSIGNED NULL');
  // Keep sub-second precision for the database-authoritative claim clock.
  await conn.query('ALTER TABLE users MODIFY COLUMN last_claim_at DATETIME(3) NULL');
  await ensureColumn(conn, 'user_player_cards', 'public_id', 'VARCHAR(16) NULL');
  await ensureColumn(conn, 'user_market_listings', 'public_listing_id', 'VARCHAR(20) NULL');
  await backfillPublicIds(conn);
  await ensureUniqueIndex(conn, 'user_player_cards', 'uq_player_cards_public_id', 'public_id');
  await ensureUniqueIndex(conn, 'user_market_listings', 'uq_user_listing_public_id', 'public_listing_id');
}

async function connect() {
  if (pool) return pool;

  if (config.db.createDatabase) {
    let admin;
    try {
      admin = await mariadb.createConnection({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        connectTimeout: 10000
      });
      const safeName = config.db.database.replace(/[^a-zA-Z0-9_]/g, '');
      if (!safeName) throw new Error('DB_NAME is not valid.');
      await admin.query(`CREATE DATABASE IF NOT EXISTS \`${safeName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } catch (error) {
      console.warn('[DB] Database auto-creation skipped:', error.message);
      console.warn('[DB] Make sure the database exists and the MariaDB user has the required permissions.');
    } finally {
      if (admin) await admin.end().catch(() => {});
    }
  }

  pool = mariadb.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionLimit: config.db.connectionLimit,
    acquireTimeout: 10000,
    idleTimeout: 600,
    charset: 'utf8mb4',
    bigIntAsNumber: true,
    insertIdAsNumber: true
  });

  const connection = await pool.getConnection();
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
    for (const statement of schema.split(';').map(part => part.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    await runMigrations(connection);
  } finally {
    connection.release();
  }

  await seedCatalog();
  await pool.query("INSERT IGNORE INTO game_meta (meta_key,meta_value) VALUES ('season_id','1'),('season_name','Season 1')");
  // A process restart must never silently grant rewards for an interrupted live match.
  await pool.query("UPDATE matches SET status='cancelled' WHERE status='running'");
  return pool;
}

async function seedCatalog() {
  const file = path.join(__dirname, '..', 'data', 'players.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const player of parsed.players) {
      const rarity = rarityFromOvr(player.overall);
      await conn.query(
        `INSERT INTO players_catalog
        (player_id,name,primary_position,overall,potential,nationality_json,positions_json,position_ratings_json,role_json,skills_json,stats_json,club_json,raw_json,market_value_eur,rarity)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE name=VALUES(name),primary_position=VALUES(primary_position),overall=VALUES(overall),potential=VALUES(potential),
        nationality_json=VALUES(nationality_json),positions_json=VALUES(positions_json),position_ratings_json=VALUES(position_ratings_json),
        role_json=VALUES(role_json),skills_json=VALUES(skills_json),stats_json=VALUES(stats_json),club_json=VALUES(club_json),raw_json=VALUES(raw_json),
        market_value_eur=VALUES(market_value_eur),rarity=VALUES(rarity)`,
        [player.id, player.name, player.positions.primary, player.overall, player.potential,
          JSON.stringify(player.nationality), JSON.stringify(player.positions), JSON.stringify(player.position_ratings),
          JSON.stringify(player.role), JSON.stringify(player.skills), JSON.stringify(player.stats), JSON.stringify(player.club),
          JSON.stringify(player), Number(player.market_value_eur || 0), rarity]
      );
      await conn.query('INSERT IGNORE INTO market_stock (player_id,stock,base_stock) VALUES (?,?,?)',
        [player.id, config.economy.baseStock, config.economy.baseStock]);
      const systemListingId = makePublicId('SM');
      await conn.query('INSERT IGNORE INTO system_market_listings (listing_id,player_id) VALUES (?,?)',
        [systemListingId, player.id]);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  console.log(`[DB] Catalog seeded: ${parsed.players.length} fictional players.`);
}

function getPool() {
  if (!pool) throw new Error('Database is not connected.');
  return pool;
}
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
module.exports = { connect, getPool, close, seedCatalog, runMigrations, makePublicId };
