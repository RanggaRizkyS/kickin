const { getPool, makePublicId } = require('../db');
const config = require('../config');
const { FORMATIONS, uuid } = require('../utils/football');
const { selectStarterPlayersFromCatalog } = require('./starter-selection');
const { getGameCatalog } = require('./catalog-cache');

function buildCurrentStats(player) {
  return {
    ...(player.stats?.type === 'goalkeeper' ? (player.stats?.goalkeeper || {}) : (player.stats?.outfield || {})),
    ...(player.stats?.main || {})
  };
}

async function findOrCreateDiscordUser(discordUser) {
  const pool = getPool();
  const username = String(discordUser.globalName || discordUser.username || 'Player').slice(0, 100);
  const avatarUrl = discordUser.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
  await pool.query(
    `INSERT INTO users (discord_id,username,avatar_url,credits,last_claim_at,last_claim_at_ms)
     VALUES (?,?,?,?,NULL,NULL)
     ON DUPLICATE KEY UPDATE username=VALUES(username),avatar_url=VALUES(avatar_url)`,
    [discordUser.id, username, avatarUrl, config.economy.startingCredits]
  );
  const rows = await pool.query('SELECT * FROM users WHERE discord_id=? LIMIT 1', [discordUser.id]);
  return rows[0];
}

async function getUserByDiscordId(discordId) {
  const rows = await getPool().query('SELECT * FROM users WHERE discord_id=? LIMIT 1', [String(discordId)]);
  return rows[0] || null;
}

async function getUserById(userId) {
  const rows = await getPool().query('SELECT * FROM users WHERE id=? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function selectStarterPlayers(conn) {
  const catalog = await getGameCatalog(conn);
  return selectStarterPlayersFromCatalog(catalog);
}

async function createPlayerCard(conn, userId, player, source, seasonId) {
  const cardId = uuid();
  let publicId;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    publicId = makePublicId('PC');
    try {
      await conn.query(
        `INSERT INTO user_player_cards (card_instance_id,public_id,user_id,player_id,level,xp,current_stats_json,acquired_source,season_id)
         VALUES (?,?,?,?,1,0,?,?,?)`,
        [cardId, publicId, userId, player.id, JSON.stringify(buildCurrentStats(player)), source, seasonId]
      );
      return cardId;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY' || attempt === 7) throw error;
    }
  }
  throw new Error('Could not generate a unique card reference.');
}

async function ensureStarterSquad(userId, options = {}) {
  const pool = getPool();
  const exists = await pool.query('SELECT user_id FROM user_squads WHERE user_id=? LIMIT 1', [userId]);
  if (exists.length) return { created: false };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const existing = await conn.query('SELECT user_id FROM user_squads WHERE user_id=? FOR UPDATE', [userId]);
    if (existing.length) {
      await conn.commit();
      return { created: false };
    }
    const seasonRows = await conn.query("SELECT meta_value FROM game_meta WHERE meta_key='season_id' LIMIT 1");
    const seasonId = Number(seasonRows[0]?.meta_value || 1);
    const starter = await selectStarterPlayers(conn);
    await conn.query('INSERT INTO user_squads (user_id,formation,squad_matches) VALUES (?,?,0)', [userId, '4-3-3']);
    for (const entry of starter) {
      const cardId = await createPlayerCard(conn, userId, entry.player, options.source || 'starter', seasonId);
      await conn.query('INSERT INTO squad_slots (user_id,slot_key,card_instance_id) VALUES (?,?,?)', [userId, entry.slotKey, cardId]);
    }
    await conn.commit();
    return { created: true, players: starter.map(entry => entry.player.name) };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function requireRegisteredUser(discordUser) {
  const user = await getUserByDiscordId(discordUser.id);
  if (!user) throw new Error('You do not have a club yet. Run `/start` first.');
  return user;
}

module.exports = {
  findOrCreateDiscordUser,
  getUserByDiscordId,
  getUserById,
  ensureStarterSquad,
  selectStarterPlayers,
  createPlayerCard,
  buildCurrentStats,
  requireRegisteredUser
};
