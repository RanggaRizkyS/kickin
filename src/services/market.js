const { getPool, makePublicId } = require('../db');
const config = require('../config');
const { claimElapsedMs, claimStatusFromRow: buildClaimStatus } = require('../utils/claim-clock');
const { safeJson, basePrice, clamp, uuid, estimatedOverall, rarityFromOvr } = require('../utils/football');
const { addCredits } = require('./economy');
const { createPlayerCard } = require('./users');

function calculateMarketPrice(player, stock, baseStock, buys24h, sales24h) {
  const base = basePrice(player);
  const stockFactor = clamp(0.70 + ((Number(baseStock) - Number(stock)) / Math.max(1, Number(baseStock))) * 1.70,
    config.economy.minPriceFactor, config.economy.maxPriceFactor);
  const demandRatio = (Number(buys24h) + 1) / (Number(sales24h) + 1);
  const demandFactor = clamp(0.88 + Math.log2(Math.max(0.25, demandRatio)) * 0.12, 0.70, 1.60);
  return Math.max(50, Math.round(base * stockFactor * demandFactor));
}

async function refreshMarketWindows(conn = getPool()) {
  await conn.query(`UPDATE market_stock SET
    purchases_24h=(SELECT COALESCE(SUM(quantity),0) FROM market_activity WHERE market_activity.player_id=market_stock.player_id AND action_type IN ('system_buy','user_trade','pack','claim') AND created_at>=NOW()-INTERVAL 24 HOUR),
    sales_24h=(SELECT COALESCE(SUM(quantity),0) FROM market_activity WHERE market_activity.player_id=market_stock.player_id AND action_type IN ('system_sell','user_trade') AND created_at>=NOW()-INTERVAL 24 HOUR)`);
}

async function refreshPlayerWindow(conn, playerId) {
  const rows = await conn.query(
    `SELECT
       (SELECT COALESCE(SUM(quantity),0) FROM market_activity WHERE player_id=? AND action_type IN ('system_buy','user_trade','pack','claim') AND created_at>=NOW()-INTERVAL 24 HOUR) AS purchases,
       (SELECT COALESCE(SUM(quantity),0) FROM market_activity WHERE player_id=? AND action_type IN ('system_sell','user_trade') AND created_at>=NOW()-INTERVAL 24 HOUR) AS sales`,
    [playerId, playerId]
  );
  await conn.query('UPDATE market_stock SET purchases_24h=?,sales_24h=? WHERE player_id=?',
    [Number(rows[0]?.purchases || 0), Number(rows[0]?.sales || 0), playerId]);
}

async function listSystemMarket({ search = '', position = '', rarity = '', sort = 'ovr_desc', limit = 10, offset = 0 } = {}) {
  const pool = getPool();
  await refreshMarketWindows(pool);
  const clauses = ['1=1'];
  const params = [];
  if (search) { clauses.push('p.name LIKE ?'); params.push(`%${String(search).slice(0, 60)}%`); }
  if (position) { clauses.push('p.primary_position=?'); params.push(String(position).toUpperCase()); }
  if (['bronze', 'silver', 'gold'].includes(rarity)) { clauses.push('p.rarity=?'); params.push(rarity); }
  const rows = await pool.query(
    `SELECT sml.listing_id,p.player_id,p.raw_json,p.rarity,p.overall,s.stock,s.base_stock,s.purchases_24h,s.sales_24h
     FROM players_catalog p
     JOIN system_market_listings sml ON sml.player_id=p.player_id
     JOIN market_stock s ON s.player_id=p.player_id
     WHERE ${clauses.join(' AND ')} AND s.stock > 0`,
    params
  );
  const players = rows.map(row => {
    const player = safeJson(row.raw_json, {});
    return {
      ...player,
      id: row.player_id,
      listingId: row.listing_id,
      rarity: row.rarity,
      marketPrice: calculateMarketPrice(player, row.stock, row.base_stock, row.purchases_24h, row.sales_24h),
      stock: Number(row.stock)
    };
  });
  if (sort === 'price_asc') players.sort((a, b) => a.marketPrice - b.marketPrice);
  else if (sort === 'price_desc') players.sort((a, b) => b.marketPrice - a.marketPrice);
  else if (sort === 'ovr_asc') players.sort((a, b) => a.overall - b.overall);
  else if (sort === 'name') players.sort((a, b) => a.name.localeCompare(b.name));
  else players.sort((a, b) => b.overall - a.overall);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 10));
  return { players: players.slice(safeOffset, safeOffset + safeLimit), total: players.length, limit: safeLimit, offset: safeOffset };
}

async function buySystemPlayer(userId, playerId) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await refreshPlayerWindow(conn, playerId);
    const rows = await conn.query(
      `SELECT p.*,s.stock,s.base_stock,s.purchases_24h,s.sales_24h FROM players_catalog p
       JOIN market_stock s ON s.player_id=p.player_id WHERE p.player_id=? FOR UPDATE`, [playerId]
    );
    if (!rows.length) throw new Error('Pemain tidak ditemukan di System Market.');
    const row = rows[0];
    if (Number(row.stock) <= 0) throw new Error('Stok System Market habis.');
    const player = safeJson(row.raw_json, {});
    const price = calculateMarketPrice(player, row.stock, row.base_stock, row.purchases_24h, row.sales_24h);
    await addCredits(conn, userId, -price, 'system_player_purchase', playerId);
    await conn.query('UPDATE market_stock SET stock=stock-1,purchases_24h=purchases_24h+1 WHERE player_id=?', [playerId]);
    const season = await conn.query("SELECT meta_value FROM game_meta WHERE meta_key='season_id' LIMIT 1");
    const cardInstanceId = await createPlayerCard(conn, userId, player, 'system_market', Number(season[0]?.meta_value || 1));
    await conn.query('INSERT INTO market_activity (player_id,user_id,action_type,quantity,price) VALUES (?,?,?,?,?)',
      [playerId, userId, 'system_buy', 1, price]);
    await conn.commit();
    return { cardInstanceId, player, price };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function sellToSystem(userId, cardReference) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const ownedRows = await conn.query(
      'SELECT card_instance_id,player_id FROM user_player_cards WHERE user_id=? AND (card_instance_id=? OR public_id=?) LIMIT 1 FOR UPDATE',
      [userId, cardReference, cardReference]
    );
    if (!ownedRows.length) throw new Error('Kartu pemain tidak ditemukan di koleksimu. Gunakan ID kartu dari `/players`.');
    const cardId = ownedRows[0].card_instance_id;
    const playerId = ownedRows[0].player_id;
    await refreshPlayerWindow(conn, playerId);
    const rows = await conn.query(
      `SELECT c.*,p.raw_json,p.player_id,p.overall,p.rarity,s.stock,s.base_stock,s.purchases_24h,s.sales_24h
       FROM user_player_cards c JOIN players_catalog p ON p.player_id=c.player_id
       JOIN market_stock s ON s.player_id=p.player_id WHERE c.card_instance_id=? AND c.user_id=? FOR UPDATE`, [cardId, userId]
    );
    if (!rows.length) throw new Error('Kartu pemain tidak ditemukan.');
    const row = rows[0];
    const inSquad = await conn.query('SELECT slot_key FROM squad_slots WHERE card_instance_id=? AND user_id=? LIMIT 1', [cardId, userId]);
    if (inSquad.length) throw new Error('Keluarkan pemain dari squad sebelum menjualnya.');
    const listed = await conn.query("SELECT listing_id FROM user_market_listings WHERE card_instance_id=? AND status='active' LIMIT 1", [cardId]);
    if (listed.length) throw new Error('Kartu sedang dipasang di User Market.');
    const player = safeJson(row.raw_json, {});
    const current = calculateMarketPrice(player, row.stock, row.base_stock, row.purchases_24h, row.sales_24h);
    const sellPrice = Math.max(25, Math.round(current * 0.72));
    await addCredits(conn, userId, sellPrice, 'system_player_sell', cardId);
    await conn.query('DELETE FROM user_player_cards WHERE card_instance_id=? AND user_id=?', [cardId, userId]);
    await conn.query('UPDATE market_stock SET stock=LEAST(base_stock*3,stock+1),sales_24h=sales_24h+1 WHERE player_id=?', [row.player_id]);
    await conn.query('INSERT INTO market_activity (player_id,user_id,action_type,quantity,price) VALUES (?,?,?,?,?)',
      [row.player_id, userId, 'system_sell', 1, sellPrice]);
    await conn.commit();
    return { player, sellPrice };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function createUserListing(userId, cardReference, askingPrice) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const cardRows = await conn.query(
      'SELECT card_instance_id,player_id FROM user_player_cards WHERE user_id=? AND (card_instance_id=? OR public_id=?) LIMIT 1 FOR UPDATE',
      [userId, cardReference, cardReference]
    );
    if (!cardRows.length) throw new Error('Kartu pemain tidak ditemukan di koleksimu.');
    const cardId = cardRows[0].card_instance_id;
    await refreshPlayerWindow(conn, cardRows[0].player_id);
    const rows = await conn.query(
      `SELECT c.card_instance_id,c.player_id,p.raw_json,p.overall,p.rarity,s.stock,s.base_stock,s.purchases_24h,s.sales_24h
       FROM user_player_cards c JOIN players_catalog p ON p.player_id=c.player_id JOIN market_stock s ON s.player_id=p.player_id
       WHERE c.card_instance_id=? AND c.user_id=? FOR UPDATE`, [cardId, userId]
    );
    if (!rows.length) throw new Error('Kartu pemain tidak ditemukan.');
    const row = rows[0];
    const used = await conn.query('SELECT 1 FROM squad_slots WHERE card_instance_id=? AND user_id=? LIMIT 1', [cardId, userId]);
    if (used.length) throw new Error('Keluarkan pemain dari squad sebelum memasang listing.');
    const existing = await conn.query("SELECT 1 FROM user_market_listings WHERE card_instance_id=? AND status='active' LIMIT 1", [cardId]);
    if (existing.length) throw new Error('Kartu sudah dipasang di User Market.');
    const player = safeJson(row.raw_json, {});
    const reference = calculateMarketPrice(player, row.stock, row.base_stock, row.purchases_24h, row.sales_24h);
    const price = Math.trunc(Number(askingPrice));
    const minPrice = Math.round(reference * config.economy.listingMinFactor);
    const maxPrice = Math.round(reference * config.economy.listingMaxFactor);
    if (!Number.isFinite(price) || price < minPrice || price > maxPrice) {
      throw new Error(`Harga listing harus antara ${minPrice.toLocaleString('en-US')}–${maxPrice.toLocaleString('en-US')} CR.`);
    }
    const listingId = uuid();
    const publicListingId = makePublicId('UL');
    await conn.query('INSERT INTO user_market_listings (listing_id,public_listing_id,seller_user_id,card_instance_id,asking_price) VALUES (?,?,?,?,?)',
      [listingId, publicListingId, userId, cardId, price]);
    await conn.query('INSERT INTO market_activity (player_id,user_id,action_type,quantity,price) VALUES (?,?,?,?,?)',
      [row.player_id, userId, 'user_list', 1, price]);
    await conn.commit();
    return { listingId, publicListingId, askingPrice: price, referencePrice: reference, player };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function listUserListings({ search = '', rarity = '', limit = 10, offset = 0 } = {}) {
  const clauses = ["l.status='active'"];
  const params = [];
  if (search) { clauses.push('p.name LIKE ?'); params.push(`%${String(search).slice(0, 60)}%`); }
  if (['bronze', 'silver', 'gold'].includes(rarity)) { clauses.push('p.rarity=?'); params.push(rarity); }
  const rows = await getPool().query(
    `SELECT l.listing_id,l.public_listing_id,l.seller_user_id,u.username AS seller_name,u.discord_id AS seller_discord_id,l.card_instance_id,l.asking_price,l.created_at,
      c.level,c.xp,c.current_stats_json,p.raw_json,p.rarity,p.overall,p.player_id
     FROM user_market_listings l JOIN users u ON u.id=l.seller_user_id
     JOIN user_player_cards c ON c.card_instance_id=l.card_instance_id
     JOIN players_catalog p ON p.player_id=c.player_id WHERE ${clauses.join(' AND ')}
     ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.max(1, Math.min(10, Number(limit) || 10)), Math.max(0, Number(offset) || 0)]
  );
  return rows.map(row => {
    const player = safeJson(row.raw_json, {});
    const currentStats = safeJson(row.current_stats_json, {});
    return {
      listingId: row.listing_id,
      publicListingId: row.public_listing_id,
      sellerId: Number(row.seller_user_id), sellerName: row.seller_name,
      sellerDiscordId: row.seller_discord_id, cardInstanceId: row.card_instance_id,
      askingPrice: Number(row.asking_price), level: Number(row.level), xp: Number(row.xp),
      currentStats, currentOvr: estimatedOverall({ level: Number(row.level), currentStats }, player, player.positions?.primary), player
    };
  });
}


async function getSystemMarketItem(listingReference) {
  await refreshMarketWindows();
  const rows = await getPool().query(
    `SELECT sml.listing_id,p.player_id,p.raw_json,p.rarity,p.overall,s.stock,s.base_stock,s.purchases_24h,s.sales_24h
     FROM system_market_listings sml
     JOIN players_catalog p ON p.player_id=sml.player_id
     JOIN market_stock s ON s.player_id=p.player_id
     WHERE sml.listing_id=? OR p.player_id=? LIMIT 1`,
    [listingReference, listingReference]
  );
  if (!rows.length) throw new Error('Listing System Market tidak ditemukan.');
  const row = rows[0];
  if (Number(row.stock) <= 0) throw new Error('Stok pemain habis. Refresh market untuk melihat stok terbaru.');
  const player = safeJson(row.raw_json, {});
  return {
    id: row.player_id,
    listingId: row.listing_id,
    player,
    rarity: row.rarity,
    currentOvr: Number(row.overall),
    marketPrice: calculateMarketPrice(player, row.stock, row.base_stock, row.purchases_24h, row.sales_24h),
    stock: Number(row.stock)
  };
}

async function getUserMarketPage({ buyerUserId, limit = 10, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 10));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const countRows = await getPool().query(
    "SELECT COUNT(*) AS total FROM user_market_listings WHERE status='active' AND seller_user_id<>?",
    [buyerUserId]
  );
  const rows = await getPool().query(
    `SELECT l.listing_id,l.public_listing_id,l.seller_user_id,u.username AS seller_name,l.asking_price,l.created_at,
      c.level,c.xp,c.current_stats_json,p.raw_json,p.rarity,p.overall,p.player_id
     FROM user_market_listings l
     JOIN users u ON u.id=l.seller_user_id
     JOIN user_player_cards c ON c.card_instance_id=l.card_instance_id
     JOIN players_catalog p ON p.player_id=c.player_id
     WHERE l.status='active' AND l.seller_user_id<>?
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`,
    [buyerUserId, safeLimit, safeOffset]
  );
  const listings = rows.map(row => {
    const player = safeJson(row.raw_json, {});
    const currentStats = safeJson(row.current_stats_json, {});
    return {
      listingId: row.listing_id,
      publicListingId: row.public_listing_id,
      sellerId: Number(row.seller_user_id),
      sellerName: row.seller_name,
      askingPrice: Number(row.asking_price),
      level: Number(row.level),
      xp: Number(row.xp),
      currentStats,
      currentOvr: estimatedOverall({ level: Number(row.level), currentStats }, player, player.positions?.primary),
      rarity: row.rarity,
      player
    };
  });
  return { listings, total: Number(countRows[0]?.total || 0), limit: safeLimit, offset: safeOffset };
}

async function getUserListingById(listingReference) {
  const rows = await getPool().query(
    `SELECT l.listing_id,l.public_listing_id,l.seller_user_id,u.username AS seller_name,l.asking_price,
      c.level,c.xp,c.current_stats_json,p.raw_json,p.rarity,p.overall,p.player_id
     FROM user_market_listings l
     JOIN users u ON u.id=l.seller_user_id
     JOIN user_player_cards c ON c.card_instance_id=l.card_instance_id
     JOIN players_catalog p ON p.player_id=c.player_id
     WHERE (l.listing_id=? OR l.public_listing_id=?) AND l.status='active' LIMIT 1`,
    [listingReference, listingReference]
  );
  if (!rows.length) throw new Error('Listing sudah tidak tersedia.');
  const row = rows[0];
  const player = safeJson(row.raw_json, {});
  const currentStats = safeJson(row.current_stats_json, {});
  return {
    listingId: row.listing_id,
    publicListingId: row.public_listing_id,
    sellerId: Number(row.seller_user_id),
    sellerName: row.seller_name,
    askingPrice: Number(row.asking_price),
    level: Number(row.level),
    xp: Number(row.xp),
    currentStats,
    currentOvr: estimatedOverall({ level: Number(row.level), currentStats }, player, player.positions?.primary),
    rarity: row.rarity,
    player
  };
}

async function buyUserListing(buyerId, listingReference) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const rows = await conn.query(
      `SELECT l.*,c.player_id,p.name FROM user_market_listings l
       JOIN user_player_cards c ON c.card_instance_id=l.card_instance_id
       JOIN players_catalog p ON p.player_id=c.player_id
       WHERE (l.listing_id=? OR l.public_listing_id=?) AND l.status='active' FOR UPDATE`,
      [listingReference, listingReference]
    );
    if (!rows.length) throw new Error('Listing tidak tersedia.');
    const listing = rows[0];
    if (Number(listing.seller_user_id) === Number(buyerId)) throw new Error('Kamu tidak dapat membeli listing milik sendiri.');
    const first = Math.min(Number(buyerId), Number(listing.seller_user_id));
    const second = Math.max(Number(buyerId), Number(listing.seller_user_id));
    await conn.query('SELECT id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE', [first, second]);
    await addCredits(conn, buyerId, -Number(listing.asking_price), 'user_market_purchase', listing.listing_id);
    await addCredits(conn, Number(listing.seller_user_id), Number(listing.asking_price), 'user_market_sale', listing.listing_id);
    await conn.query('UPDATE user_player_cards SET user_id=? WHERE card_instance_id=?', [buyerId, listing.card_instance_id]);
    await conn.query("UPDATE user_market_listings SET status='sold',buyer_user_id=?,completed_at=NOW() WHERE listing_id=?", [buyerId, listing.listing_id]);
    await conn.query('INSERT INTO market_activity (player_id,user_id,action_type,quantity,price) VALUES (?,?,?,?,?)',
      [listing.player_id, buyerId, 'user_trade', 1, Number(listing.asking_price)]);
    await conn.commit();
    return { player: listing.name, price: Number(listing.asking_price), sellerId: Number(listing.seller_user_id), cardInstanceId: listing.card_instance_id, publicListingId: listing.public_listing_id };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function cancelUserListing(userId, listingReference) {
  const result = await getPool().query(
    "UPDATE user_market_listings SET status='cancelled',completed_at=NOW() WHERE (listing_id=? OR public_listing_id=?) AND seller_user_id=? AND status='active'",
    [listingReference, listingReference, userId]
  );
  if (!result.affectedRows) throw new Error('Listing tidak ditemukan atau sudah selesai.');
  return { cancelled: true };
}

function chooseWeightedRarity(buckets, weights) {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  let roll = Math.random() * Math.max(1, total);
  const rarity = roll < weights[0] ? 'bronze' : (roll -= weights[0]) < weights[1] ? 'silver' : 'gold';
  const candidates = buckets[rarity] || [];
  return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)]
    : (buckets.bronze[0] || buckets.silver[0] || buckets.gold[0]);
}

async function getRarityBuckets(conn) {
  const rows = await conn.query('SELECT raw_json,rarity FROM players_catalog ORDER BY player_id');
  const buckets = { bronze: [], silver: [], gold: [] };
  for (const row of rows) buckets[row.rarity].push(safeJson(row.raw_json, {}));
  return buckets;
}

async function openPack(userId, packType = 'pro', quantity = 1) {
  const pack = config.economy.packs?.[packType];
  if (!pack) throw new Error('Jenis pack tidak valid.');
  const count = Math.max(1, Math.min(config.economy.packMaxQuantity || 5, Number(quantity) || 1));
  const totalPrice = Number(pack.price) * count;
  if (!Number.isSafeInteger(totalPrice) || totalPrice < 1) throw new Error('Harga pack tidak valid.');

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const balanceAfter = await addCredits(conn, userId, -totalPrice, 'player_pack_purchase', `pack-${packType}-${Date.now()}`);
    const buckets = await getRarityBuckets(conn);
    const season = await conn.query("SELECT meta_value FROM game_meta WHERE meta_key='season_id' LIMIT 1");
    const seasonId = Number(season[0]?.meta_value || 1);
    const results = [];
    const playersPerPack = Math.max(1, Math.min(5, Number(pack.players) || 3));
    const totalCards = playersPerPack * count;
    const perCardPrice = Math.floor(totalPrice / totalCards);

    for (let index = 0; index < totalCards; index += 1) {
      const player = chooseWeightedRarity(buckets, pack.weights);
      const cardInstanceId = await createPlayerCard(conn, userId, player, 'pack', seasonId);
      results.push({ player, cardInstanceId });
      await conn.query('INSERT INTO market_activity (player_id,user_id,action_type,quantity,price) VALUES (?,?,?,?,?)',
        [player.id, userId, 'pack', 1, perCardPrice]);
      await conn.query('UPDATE market_stock SET stock=GREATEST(0,stock-1),purchases_24h=purchases_24h+1 WHERE player_id=?', [player.id]);
    }
    await conn.commit();
    return {
      players: results,
      packType,
      packName: pack.name,
      quantity: count,
      playersPerPack,
      pricePerPack: Number(pack.price),
      totalPrice,
      balanceAfter
    };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

function claimStatusFromRow(row, now = Date.now()) {
  const cooldownMs = Number(config.economy.claimCooldownHours) * 60 * 60 * 1000;
  return buildClaimStatus(row, cooldownMs, now);
}

async function queryClaimState(conn, userId, { lock = false } = {}) {
  // market_activity is the source of truth for an actual claim. Older versions
  // could leave last_claim_at populated during registration, causing a new
  // account to see a false 120-minute cooldown. A successful claim inserts
  // this ledger row in the same transaction as the card and timestamp update.
  const rows = await conn.query(
    `SELECT u.claim_pity_count,
      (SELECT ROUND(UNIX_TIMESTAMP(MAX(ma.created_at))*1000)
       FROM market_activity ma
       WHERE ma.user_id=u.id AND ma.action_type='claim') AS last_claim_at_ms,
      ROUND(UNIX_TIMESTAMP(NOW(3))*1000) AS db_now_ms
     FROM users u WHERE u.id=? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  if (!rows.length) throw new Error('Pengguna tidak ditemukan.');
  return rows[0];
}

async function getClaimStatus(userId) {
  const row = await queryClaimState(getPool(), userId);
  return claimStatusFromRow(row);
}

async function claimPlayer(userId) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const userState = await queryClaimState(conn, userId, { lock: true });
    const status = claimStatusFromRow(userState);
    if (!status.available) {
      const error = new Error('Claim belum tersedia.');
      error.code = 'CLAIM_COOLDOWN';
      error.remainingMs = status.remainingMs;
      error.nextClaimAtMs = status.nextClaimAtMs;
      throw error;
    }

    const buckets = await getRarityBuckets(conn);
    const pity = Number(userState.claim_pity_count || 0);
    const weights = [...config.economy.claimWeights];
    const guaranteed = pity >= config.economy.claimPityGuarantee - 1;
    if (!guaranteed) weights[2] += Math.min(55, pity * 2);
    const player = guaranteed && buckets.gold.length
      ? buckets.gold[Math.floor(Math.random() * buckets.gold.length)]
      : chooseWeightedRarity(buckets, weights);

    const season = await conn.query("SELECT meta_value FROM game_meta WHERE meta_key='season_id' LIMIT 1");
    const cardInstanceId = await createPlayerCard(
      conn,
      userId,
      player,
      'claim',
      Number(season[0]?.meta_value || 1)
    );
    const nextPity = player.overall >= 81 ? 0 : pity + 1;

    // Store the cooldown timestamp from MariaDB itself. This avoids a mismatch
    // between the Discord bot host clock and the database server clock.
    await conn.query(
      `UPDATE users
       SET last_claim_at=NOW(3),
           last_claim_at_ms=ROUND(UNIX_TIMESTAMP(NOW(3))*1000),
           claim_pity_count=?
       WHERE id=?`,
      [nextPity, userId]
    );
    await conn.query(
      'INSERT INTO market_activity (player_id,user_id,action_type,quantity,price) VALUES (?,?,?,?,?)',
      [player.id, userId, 'claim', 1, 0]
    );
    await conn.query(
      'UPDATE market_stock SET stock=GREATEST(0,stock-1),purchases_24h=purchases_24h+1 WHERE player_id=?',
      [player.id]
    );

    const freshClock = await conn.query(
      'SELECT ROUND(UNIX_TIMESTAMP(NOW(3))*1000) AS db_now_ms FROM users WHERE id=? LIMIT 1',
      [userId]
    );
    const claimedAtMs = Number(freshClock[0]?.db_now_ms || Date.now());
    const nextClaimAtMs = claimedAtMs + status.cooldownMs;
    await conn.commit();

    return {
      player,
      cardInstanceId,
      pity: nextPity,
      pityGuarantee: config.economy.claimPityGuarantee,
      cooldownHours: config.economy.claimCooldownHours,
      nextClaimAtMs
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function getCard(cardReference, userId) {
  const rows = await getPool().query(
    `SELECT c.card_instance_id,c.public_id,c.player_id,c.level,c.xp,c.current_stats_json,c.acquired_source,
      p.raw_json,p.rarity,p.overall
     FROM user_player_cards c JOIN players_catalog p ON p.player_id=c.player_id
     WHERE (c.card_instance_id=? OR c.public_id=?) AND c.user_id=? LIMIT 1`, [cardReference, cardReference, userId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    cardInstanceId: row.card_instance_id,
    publicId: row.public_id,
    playerId: row.player_id,
    level: Number(row.level),
    xp: Number(row.xp),
    currentStats: safeJson(row.current_stats_json, {}),
    rarity: row.rarity,
    player: safeJson(row.raw_json, {})
  };
}

module.exports = {
  calculateMarketPrice, refreshMarketWindows, listSystemMarket, buySystemPlayer, sellToSystem,
  createUserListing, listUserListings, buyUserListing, cancelUserListing,
  openPack, claimPlayer, getClaimStatus, claimStatusFromRow, claimElapsedMs, getCard, getSystemMarketItem, getUserMarketPage, getUserListingById
};
