const mariadb = require('mariadb');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse: parseCsv } = require('csv-parse/sync');
const { normalizeEafc26Record } = require('./services/eafc26-normalizer');
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
  await ensureColumn(conn, 'players_catalog', 'catalog_source', "VARCHAR(24) NOT NULL DEFAULT 'legacy'");
  await ensureColumn(conn, 'players_catalog', 'source_player_id', 'VARCHAR(64) NULL');
  await ensureColumn(conn, 'players_catalog', 'age', 'TINYINT UNSIGNED NULL');
  await ensureColumn(conn, 'players_catalog', 'height_cm', 'SMALLINT UNSIGNED NULL');
  await ensureColumn(conn, 'players_catalog', 'weight_kg', 'SMALLINT UNSIGNED NULL');
  await ensureColumn(conn, 'players_catalog', 'preferred_foot', 'VARCHAR(12) NULL');
  await ensureColumn(conn, 'players_catalog', 'weak_foot', 'TINYINT UNSIGNED NULL');
  await ensureColumn(conn, 'players_catalog', 'skill_moves', 'TINYINT UNSIGNED NULL');
  await ensureColumn(conn, 'players_catalog', 'league_name', 'VARCHAR(120) NULL');
  await ensureColumn(conn, 'players_catalog', 'player_face_url', 'VARCHAR(512) NULL');
  await conn.query(`CREATE TABLE IF NOT EXISTS player_card_assets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    game_version VARCHAR(8) NOT NULL DEFAULT 'FC26',
    player_id VARCHAR(32) NOT NULL,
    ea_item_id VARCHAR(32) NULL,
    provider_card_id VARCHAR(64) NULL,
    provider VARCHAR(32) NULL,
    source_image_url VARCHAR(1000) NULL,
    cache_path VARCHAR(512) NULL,
    image_sha256 CHAR(64) NULL,
    status ENUM('ready','missing','failed') NOT NULL DEFAULT 'missing',
    last_checked_at DATETIME(3) NULL,
    last_checked_at_ms BIGINT UNSIGNED NULL,
    last_error VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_player_card_asset (game_version,player_id),
    INDEX idx_card_asset_status_checked (status,last_checked_at),
    CONSTRAINT fk_card_asset_catalog FOREIGN KEY (player_id) REFERENCES players_catalog(player_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await ensureColumn(conn, 'player_card_assets', 'last_checked_at_ms', 'BIGINT UNSIGNED NULL');
  await conn.query(`CREATE TABLE IF NOT EXISTS player_portrait_assets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    game_version VARCHAR(8) NOT NULL DEFAULT 'FC26',
    player_id VARCHAR(32) NOT NULL,
    source_player_id VARCHAR(64) NULL,
    source_image_url VARCHAR(512) NOT NULL,
    cache_path VARCHAR(512) NULL,
    image_sha256 CHAR(64) NULL,
    status ENUM('ready','missing','failed') NOT NULL DEFAULT 'missing',
    last_checked_at DATETIME(3) NULL,
    last_checked_at_ms BIGINT UNSIGNED NULL,
    last_error VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_player_portrait_asset (game_version,player_id),
    INDEX idx_portrait_asset_status_checked (status,last_checked_at),
    CONSTRAINT fk_portrait_asset_catalog FOREIGN KEY (player_id) REFERENCES players_catalog(player_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await ensureColumn(conn, 'player_portrait_assets', 'last_checked_at_ms', 'BIGINT UNSIGNED NULL');
  const catalogIndex = await conn.query("SHOW INDEX FROM `players_catalog` WHERE Key_name='uq_catalog_source_player'");
  if (!catalogIndex.length) await conn.query('ALTER TABLE `players_catalog` ADD UNIQUE INDEX `uq_catalog_source_player` (`catalog_source`,`source_player_id`)');
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

    connectionLimit: 5,
    acquireTimeout: 20000,
    initializationTimeout: 20000,
    connectTimeout: 10000,

    // 0 means no client-side socket timeout.
    socketTimeout: 0,

    // Must remain lower than the server's wait_timeout.
    idleTimeout: 600,
    minDelayValidation: 500,

    charset: 'utf8mb4',
    bigIntAsNumber: true,
    insertIdAsNumber: true,

    // Enable only while diagnosing connection issues.
    trace: process.env.DB_TRACE === 'true'
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


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableDatabaseError(error) {
    const codes = [
        'ECONNRESET',
        'EPIPE',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'ER_SOCKET_TIMEOUT'
    ];

    return (
        error?.fatal === true ||
        codes.includes(error?.code) ||
        error?.sqlState === '08S01'
    );
}

async function importCatalogBatch({
    catalogSql,
    catalogValues,
    stockValues,
    listingValues,
    batchLabel
}) {
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let conn = null;
        let discardConnection = false;
        let transactionOpen = false;

        try {
            // Acquire a fresh connection for every attempt.
            conn = await pool.getConnection();

            await conn.beginTransaction();
            transactionOpen = true;

            await conn.batch(catalogSql, catalogValues);

            await conn.batch(
                `INSERT INTO market_stock
                    (player_id, stock, base_stock)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    base_stock = VALUES(base_stock)`,
                stockValues
            );

            await conn.batch(
                `INSERT IGNORE INTO system_market_listings
                    (listing_id, player_id)
                 VALUES (?, ?)`,
                listingValues
            );

            await conn.commit();
            transactionOpen = false;

            return true;

        } catch (error) {
            if (error?.fatal === true) {
                discardConnection = true;
            }

            if (transactionOpen && conn && !discardConnection) {
                await conn.rollback().catch(() => {});
                transactionOpen = false;
            }

            if (
                !isRetryableDatabaseError(error) ||
                attempt === maxAttempts
            ) {
                error.message =
                    `Catalog batch ${batchLabel} failed: ${error.message}`;

                throw error;
            }

            console.warn(
                `[DB] Batch ${batchLabel} failed. ` +
                `Retry ${attempt}/${maxAttempts - 1}.`,
                error.code || error.message
            );

        } finally {
            if (conn) {
                if (
                    discardConnection &&
                    typeof conn.destroy === 'function'
                ) {
                    conn.destroy();
                } else {
                    await conn.release().catch(() => {});
                }
            }
        }

        // Exponential backoff.
        await sleep(500 * (2 ** (attempt - 1)));
    }

    return false;
}

async function seedCatalog() {
  const file = path.join(__dirname, '..', 'data', 'eafc26', 'players.csv');
  if (!fs.existsSync(file)) {
    throw new Error('EAFC26 player dataset is missing. Run `npm run data:download` first.');
  }

  const csvBuffer = fs.readFileSync(file);
  if (csvBuffer.length < 5 * 1024 * 1024) {
    throw new Error(`EAFC26 CSV is unexpectedly small (${csvBuffer.length} bytes). Re-run npm run data:download.`);
  }
  const csvHash = crypto.createHash('sha256').update(csvBuffer).digest('hex');
  const previous = await pool.query("SELECT meta_value FROM game_meta WHERE meta_key='eafc26_dataset_sha256' LIMIT 1");
  if (previous[0]?.meta_value === csvHash) {
    const countRows = await pool.query("SELECT COUNT(*) AS total FROM players_catalog WHERE catalog_source='eafc26'");
    if (Number(countRows[0]?.total || 0) > 10000) {
      console.log(`[DB] EAFC26 catalog already current: ${Number(countRows[0].total).toLocaleString('en-US')} players.`);
      return;
    }
  }

  const records = parseCsv(csvBuffer, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
    trim: true
  });
  if (records.length < 10000) {
    throw new Error(`EAFC26 dataset validation failed: expected 10,000+ rows, received ${records.length}.`);
  }
  const required = ['overall', 'potential', 'player_positions', 'nationality_name', 'club_name'];
  const headers = new Set(Object.keys(records[0] || {}));
  const missing = required.filter(key => !headers.has(key));
  if (missing.length) throw new Error(`EAFC26 schema mismatch. Missing columns: ${missing.join(', ')}.`);

  // Detect a duplicate source identity before a unique-key upsert could merge
  // two different rows into one catalog record.
  const stableIds = new Set();
  for (const sourceRow of records) {
    const player = normalizeEafc26Record(sourceRow);
    if (!player.id || !player.name) continue;
    if (stableIds.has(player.id)) {
      throw new Error(`EAFC26 identity collision detected for ${player.id}. Import cancelled without changing the catalog.`);
    }
    stableIds.add(player.id);
  }

  
let imported = 0;
let skipped = 0;

const batchSize = 50;

const catalogSql = `INSERT INTO players_catalog
      (
          player_id,
          catalog_source,
          source_player_id,
          name,
          primary_position,
          overall,
          potential,
          nationality_json,
          positions_json,
          position_ratings_json,
          role_json,
          skills_json,
          stats_json,
          club_json,
          raw_json,
          market_value_eur,
          rarity,
          age,
          height_cm,
          weight_kg,
          preferred_foot,
          weak_foot,
          skill_moves,
          league_name,
          player_face_url
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
          name=VALUES(name),
          primary_position=VALUES(primary_position),
          overall=VALUES(overall),
          potential=VALUES(potential),
          nationality_json=VALUES(nationality_json),
          positions_json=VALUES(positions_json),
          position_ratings_json=VALUES(position_ratings_json),
          role_json=VALUES(role_json),
          skills_json=VALUES(skills_json),
          stats_json=VALUES(stats_json),
          club_json=VALUES(club_json),
          raw_json=VALUES(raw_json),
          market_value_eur=VALUES(market_value_eur),
          rarity=VALUES(rarity),
          age=VALUES(age),
          height_cm=VALUES(height_cm),
          weight_kg=VALUES(weight_kg),
          preferred_foot=VALUES(preferred_foot),
          weak_foot=VALUES(weak_foot),
          skill_moves=VALUES(skill_moves),
          league_name=VALUES(league_name),
          player_face_url=VALUES(player_face_url)`;

  for (let offset = 0; offset < records.length; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize);

      const catalogValues = [];
      const stockValues = [];
      const listingValues = [];

      for (const sourceRow of batch) {
          const player = normalizeEafc26Record(sourceRow);

          if (
              !player.id ||
              !player.name ||
              player.overall < 1 ||
              !player.positions.primary ||
              !player.stats?.main
          ) {
              skipped++;
              continue;
          }

          const sourcePlayerId = String(
              player.source_player_id || player.id
          ).slice(0, 64);

          const rarity = rarityFromOvr(player.overall);

          catalogValues.push([
              player.id,
              'eafc26',
              sourcePlayerId,
              player.name,
              player.positions.primary,
              player.overall,
              player.potential,
              JSON.stringify(player.nationality),
              JSON.stringify(player.positions),
              JSON.stringify(player.position_ratings),
              JSON.stringify(player.role),
              JSON.stringify(player.skills),
              JSON.stringify(player.stats),
              JSON.stringify(player.club),
              JSON.stringify(player),
              Number(player.market_value_eur || 0),
              rarity,
              player.age,
              player.height_cm,
              player.weight_kg,
              player.strong_foot,
              player.weak_foot_rating,
              player.skill_moves,
              player.club?.league || null,
              player.player_face_url || null
          ]);

          const baseStock =
              player.overall >= 90 ? 2 :
              player.overall >= 85 ? 5 :
              player.overall >= 80 ? 10 :
              player.overall >= 70 ? 18 :
              config.economy.baseStock;

          stockValues.push([
              player.id,
              baseStock,
              baseStock
          ]);

          listingValues.push([
              makePublicId('SM'),
              player.id
          ]);
      }

      if (!catalogValues.length) continue;

      const batchLabel =
          `${offset + 1}-${Math.min(offset + batchSize, records.length)}`;

      console.log(`[DB] Importing players ${batchLabel}...`);

      await importCatalogBatch({
          catalogSql,
          catalogValues,
          stockValues,
          listingValues,
          batchLabel
      });

      imported += catalogValues.length;

      console.log(
          `[DB] Imported ${imported.toLocaleString('en-US')} players.`
      );
  }

  // Only mark the dataset as current after every batch succeeds.
  await pool.query(
      `INSERT INTO game_meta (meta_key, meta_value)
      VALUES
          ('eafc26_dataset_sha256', ?),
          ('active_catalog_source', 'eafc26')
      ON DUPLICATE KEY UPDATE
          meta_value = VALUES(meta_value)`,
      [csvHash, 'eafc26']
  );

  
  const countRows = await pool.query("SELECT COUNT(*) AS total FROM players_catalog WHERE catalog_source='eafc26'");
  console.log(
      `[DB] EAFC26 catalog ready: ` +
      `${Number(countRows[0]?.total || 0).toLocaleString('en-US')} players.`
  );

  

  try {
    const batchSize = 50;
    const catalogSql = `INSERT INTO players_catalog
      (player_id,catalog_source,source_player_id,name,primary_position,overall,potential,nationality_json,positions_json,position_ratings_json,role_json,skills_json,stats_json,club_json,raw_json,market_value_eur,rarity,age,height_cm,weight_kg,preferred_foot,weak_foot,skill_moves,league_name,player_face_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE name=VALUES(name),primary_position=VALUES(primary_position),overall=VALUES(overall),potential=VALUES(potential),
      nationality_json=VALUES(nationality_json),positions_json=VALUES(positions_json),position_ratings_json=VALUES(position_ratings_json),
      role_json=VALUES(role_json),skills_json=VALUES(skills_json),stats_json=VALUES(stats_json),club_json=VALUES(club_json),raw_json=VALUES(raw_json),
      market_value_eur=VALUES(market_value_eur),rarity=VALUES(rarity),age=VALUES(age),height_cm=VALUES(height_cm),weight_kg=VALUES(weight_kg),
      preferred_foot=VALUES(preferred_foot),weak_foot=VALUES(weak_foot),skill_moves=VALUES(skill_moves),league_name=VALUES(league_name),player_face_url=VALUES(player_face_url)`;

    for (let offset = 0; offset < records.length; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize);
      const catalogValues = [];
      const stockValues = [];
      const listingValues = [];
      for (const sourceRow of batch) {
        const player = normalizeEafc26Record(sourceRow);
        if (!player.id || !player.name || player.overall < 1 || !player.positions.primary || !player.stats?.main) {
          skipped += 1;
          continue;
        }
        const sourcePlayerId = String(player.source_player_id || player.id).slice(0, 64);
        const rarity = rarityFromOvr(player.overall);
        const sourceStats = player.stats;
        catalogValues.push([
          player.id,'eafc26',sourcePlayerId,player.name,player.positions.primary,player.overall,player.potential,
          JSON.stringify(player.nationality),JSON.stringify(player.positions),JSON.stringify(player.position_ratings),
          JSON.stringify(player.role),JSON.stringify(player.skills),JSON.stringify(sourceStats),JSON.stringify(player.club),JSON.stringify(player),
          Number(player.market_value_eur || 0),rarity,player.age,player.height_cm,player.weight_kg,player.strong_foot,
          player.weak_foot_rating,player.skill_moves,player.club?.league || null,player.player_face_url || null
        ]);
        const baseStock = player.overall >= 90 ? 2 : player.overall >= 85 ? 5 : player.overall >= 80 ? 10 : player.overall >= 70 ? 18 : config.economy.baseStock;
        stockValues.push([player.id,baseStock,baseStock]);
        listingValues.push([makePublicId('SM'),player.id]);
      }
      if (!catalogValues.length) continue;
      await conn.beginTransaction();
      try {
        await conn.batch(catalogSql, catalogValues);
        await conn.batch('INSERT INTO market_stock (player_id,stock,base_stock) VALUES (?,?,?) ON DUPLICATE KEY UPDATE base_stock=VALUES(base_stock)', stockValues);
        await conn.batch('INSERT IGNORE INTO system_market_listings (listing_id,player_id) VALUES (?,?)', listingValues);
        await conn.commit();
        imported += catalogValues.length;
      } catch (error) {
        await conn.rollback();
        throw error;
      }
      if (offset === 0 || (offset + batchSize) % 3000 === 0) {
        console.log(`[DB] Imported ${Math.min(offset + batchSize, records.length).toLocaleString('en-US')} / ${records.length.toLocaleString('en-US')} source rows...`);
      }
    }
    await pool.query(
      `INSERT INTO game_meta (meta_key,meta_value) VALUES ('eafc26_dataset_sha256',?),('active_catalog_source','eafc26')
       ON DUPLICATE KEY UPDATE meta_value=VALUES(meta_value)`,
      [csvHash, 'eafc26']
    );
  } finally {
    conn.release();
  }
  console.log(`[DB] EAFC26 catalog ready: ${Number(countRows[0]?.total || 0).toLocaleString('en-US')} players (${skipped} invalid source rows skipped; ${imported} rows processed this run).`);
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
