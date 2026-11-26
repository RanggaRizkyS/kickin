const bcrypt = require('bcryptjs');
const config = require('../config');
const { getPool } = require('../db');
const { selectStarterPlayers, createPlayerCard } = require('./users');
const { getSquadSnapshot } = require('./squad');

function userAllowed(discordId) {
  return config.admin.allowedUserIds.length === 0 || config.admin.allowedUserIds.includes(String(discordId));
}

async function checkAdminAttempts(discordId) {
  const rows = await getPool().query(
    `SELECT COUNT(*) AS total FROM admin_login_attempts WHERE discord_id=? AND created_at>=DATE_SUB(NOW(), INTERVAL ${Math.max(1, Math.trunc(config.admin.attemptWindowMinutes))} MINUTE)`,
    [String(discordId)]
  );
  return Number(rows[0]?.total || 0);
}

async function loginAdmin(discordId, password) {
  if (!userAllowed(discordId)) throw new Error('This Discord account is not on the admin allowlist.');
  if (!config.admin.passwordHash) throw new Error('ADMIN_PASSWORD_HASH is not set in .env. Generate one with `npm run hash-admin-password -- "your-password"`.');
  const attempts = await checkAdminAttempts(discordId);
  if (attempts >= config.admin.maxAttempts) throw new Error(`Login limit reached: maximum ${config.admin.maxAttempts} attempts per ${config.admin.attemptWindowMinutes} minutes.`);
  const valid = await bcrypt.compare(password, config.admin.passwordHash);
  await getPool().query('INSERT INTO admin_login_attempts (discord_id,succeeded) VALUES (?,?)', [String(discordId), valid ? 1 : 0]);
  if (!valid) throw new Error('The administrator password is incorrect.');
  await getPool().query(
    `INSERT INTO discord_admin_sessions (discord_id,expires_at) VALUES (?,DATE_ADD(NOW(),INTERVAL ${Math.max(1, Math.trunc(config.admin.sessionMinutes))} MINUTE))
     ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at),created_at=CURRENT_TIMESTAMP`,
    [String(discordId)]
  );
  return { expiresMinutes: config.admin.sessionMinutes };
}

async function requireAdminSession(discordId) {
  if (!userAllowed(discordId)) throw new Error('This Discord account is not allowed to access the admin panel.');
  const rows = await getPool().query('SELECT discord_id FROM discord_admin_sessions WHERE discord_id=? AND expires_at>NOW() LIMIT 1', [String(discordId)]);
  if (!rows.length) throw new Error('Your admin session is not active. Run `/admin login` first.');
  return true;
}

async function resetSeason() {
  const pool = getPool();
  const users = await pool.query('SELECT id,discord_id,username FROM users ORDER BY id');
  const currentSeasonRows = await pool.query("SELECT meta_value FROM game_meta WHERE meta_key='season_id' LIMIT 1");
  const currentSeason = Number(currentSeasonRows[0]?.meta_value || 1);
  const nextSeason = currentSeason + 1;

  const snapshots = [];
  for (const user of users) {
    try {
      const squad = await getSquadSnapshot(Number(user.id));
      snapshots.push({ userId: Number(user.id), data: {
        username: user.username,
        formation: squad.formation,
        teamOvr: squad.teamOvr,
        chemistry: squad.teamChemistry,
        teamStrength: squad.teamStrength,
        complete: squad.complete,
        players: squad.players.map(player => ({
          name: player.player.name,
          playerId: player.playerId,
          cardInstanceId: player.cardInstanceId,
          position: player.slotPosition,
          ovr: player.currentOvr,
          level: player.level,
          rarity: player.player.rarity,
          nationality: player.player.nationality?.country,
          club: player.player.club?.name
        }))
      } });
    } catch {
      snapshots.push({ userId: Number(user.id), data: { username: user.username, formation: '4-3-3', complete: false, players: [] } });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const snapshot of snapshots) {
      await conn.query('INSERT INTO seasonal_formations (user_id,season_id,formation_snapshot_json) VALUES (?,?,?)',
        [snapshot.userId, currentSeason, JSON.stringify(snapshot.data)]);
    }

    await conn.query('DELETE FROM user_player_cards');
    await conn.query('DELETE FROM chemistry_pair_history');
    await conn.query("UPDATE user_market_listings SET status='cancelled',completed_at=NOW() WHERE status='active'");
    await conn.query("UPDATE users SET rank_points=1000,last_claim_at=NULL,last_claim_at_ms=NULL,claim_pity_count=0");
    await conn.query("UPDATE user_squads SET formation='4-3-3',squad_matches=0");

    const starter = await selectStarterPlayers(conn);
    for (const user of users) {
      const userId = Number(user.id);
      await conn.query('INSERT INTO user_squads (user_id,formation,squad_matches) VALUES (?,?,0) ON DUPLICATE KEY UPDATE formation=VALUES(formation),squad_matches=0', [userId, '4-3-3']);
      for (const entry of starter) {
        const seasonRows = await conn.query("SELECT meta_value FROM game_meta WHERE meta_key='season_id' LIMIT 1");
        const cardId = await createPlayerCard(conn, userId, entry.player, 'season_starter', nextSeason);
        await conn.query('INSERT INTO squad_slots (user_id,slot_key,card_instance_id) VALUES (?,?,?)', [userId, entry.slotKey, cardId]);
      }
    }
    await conn.query("UPDATE game_meta SET meta_value=?,updated_at=NOW() WHERE meta_key='season_id'", [String(nextSeason)]);
    await conn.query("UPDATE game_meta SET meta_value=?,updated_at=NOW() WHERE meta_key='season_name'", [`Season ${nextSeason}`]);
    await conn.commit();
    return { previousSeason: currentSeason, currentSeason: nextSeason, usersReset: users.length, starterCardsPerUser: 11 };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

module.exports = { loginAdmin, requireAdminSession, resetSeason, checkAdminAttempts };
