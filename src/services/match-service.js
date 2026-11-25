const crypto = require('node:crypto');
const { getPool } = require('../db');
const config = require('../config');
const { FORMATIONS, safeJson, round, clamp, randomInt, uuid } = require('../utils/football');
const { getSquadSnapshot } = require('./squad');
const { generateMatch } = require('./match-engine');
const { rewardMatch } = require('./economy');
const { buildKickoffEmbed, buildLiveMatchEmbed, buildHalfTimeEmbed, buildMatchResultEmbed } = require('../utils/message');

const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

async function safeEditMessage(message, payload) {
    try {
        return await message.edit(payload);

    } catch (error) {
        console.error('[MATCH MESSAGE EDIT ERROR]', {
            code: error?.code,
            status: error?.status,
            message: error?.message,
            channelId: message?.channelId,
            messageId: message?.id
        });

        if (error?.code === 10008) {
            throw new Error(
                'Pesan pertandingan tidak ditemukan. Pastikan pesan belum dihapus.'
            );
        }

        if (error?.code === 50001) {
            throw new Error(
                'Bot tidak memiliki akses ke channel pertandingan.'
            );
        }

        if (error?.code === 50013) {
            throw new Error(
                'Bot tidak memiliki izin mengirim atau memperbarui embed di channel.'
            );
        }

        throw new Error(
            `Gagal memperbarui pertandingan. Discord Error: ${error?.code || error?.message || 'Unknown'}`
        );
    }
}

const activeMatchUsers = new Set();

function teamIsComplete(team) {
  return team?.players?.length === 11 && team.players.every(player => player.player && player.cardInstanceId);
}

function serializeTeam(team, username) {
  return {
    userId: team.userId || null,
    username: username || team.username || 'Club',
    formation: team.formation,
    teamOvr: team.teamOvr,
    teamChemistry: team.teamChemistry,
    teamStrength: team.teamStrength,
    isBot: !!team.isBot,
    botPersonality: team.botPersonality || null,
    players: team.players.map(player => ({
      cardInstanceId: player.cardInstanceId,
      playerId: player.playerId,
      slotKey: player.slotKey,
      slotPosition: player.slotPosition,
      level: player.level,
      xp: player.xp,
      currentOvr: player.currentOvr,
      currentStats: player.currentStats,
      chemistry: player.chemistry,
      chemistryDetails: player.chemistryDetails,
      shirtNumber: player.shirtNumber,
      player: player.player
    }))
  };
}

async function getUserById(id) {
  const rows = await getPool().query('SELECT id,discord_id,username FROM users WHERE id=? LIMIT 1', [id]);
  return rows[0] || null;
}

async function findHumanOpponent(userId, strength) {
  const users = await getPool().query(
    `SELECT u.id,u.username FROM users u
     JOIN user_squads s ON s.user_id=u.id
     WHERE u.id<>? AND (SELECT COUNT(*) FROM squad_slots ss WHERE ss.user_id=u.id)=11
       AND NOT EXISTS (
         SELECT 1 FROM matches m WHERE m.status='running' AND (m.home_user_id=u.id OR m.away_user_id=u.id)
       )`, [userId]
  );
  const candidates = [];
  for (const row of users) {
    try {
      const squad = await getSquadSnapshot(Number(row.id));
      if (teamIsComplete(squad)) candidates.push({ userId: Number(row.id), username: row.username, squad });
    } catch { /* Ignore incomplete/corrupt squads. */ }
  }
  candidates.sort((a, b) => Math.abs(a.squad.teamStrength - strength) - Math.abs(b.squad.teamStrength - strength));
  const ranges = [];
  for (let range = config.match.minStrengthRange; range <= config.match.maxStrengthRange; range += 2) ranges.push(range);
  for (const range of ranges) {
    const found = candidates.filter(candidate => Math.abs(candidate.squad.teamStrength - strength) <= range);
    if (found.length) {
      const shortlist = found.slice(0, Math.min(3, found.length));
      return shortlist[randomInt(0, shortlist.length - 1)];
    }
  }
  return null;
}

const BOT_NAME_RANGES = [
  { min: 0, max: 399, names: ['Joko Kodok', 'Udin Ngegas', 'Bowo Kerupuk', 'Tono Offside', 'Darto Kiper'] },
  { min: 400, max: 799, names: ['Dimas Taktik', 'Rio Tendangan', 'Fajar Crossing', 'Raka Bek Kiri', 'Asep Penjaga'] },
  { min: 800, max: 1199, names: ['Bagas Maestro', 'Nando Striker', 'Bima Playmaker', 'Rizky Counter', 'Ardi Pressing'] },
  { min: 1200, max: 1599, names: ['Arga Taktikus', 'Rafael Goal', 'Marco Maestro', 'Kenji Captain', 'Dion Strategist'] },
  { min: 1600, max: 2000, names: ['Sultan Pitch', 'Lord Taktikus', 'Raja Lapangan', 'The Professor', 'El Supremo'] }
];

function botManagerNameForStrength(strength, rng = Math.random) {
  const power = clamp(Math.round(Number(strength || 0) * 20), 0, 2000);
  const range = BOT_NAME_RANGES.find(item => power >= item.min && power <= item.max)
    || BOT_NAME_RANGES[BOT_NAME_RANGES.length - 1];
  const index = Math.floor(rng() * range.names.length);
  return { name: range.names[index], power, range: `${range.min}-${range.max}` };
}

async function buildBotSquad(targetTeam, botName = null) {
  const rows = await getPool().query('SELECT raw_json FROM players_catalog ORDER BY overall ASC');
  const catalog = rows.map(row => safeJson(row.raw_json, {}));
  const formations = Object.keys(FORMATIONS);
  const formation = formations[randomInt(0, formations.length - 1)];
  const slots = FORMATIONS[formation];

  // Match the user's actual OVR + chemistry profile. Earlier versions gave
  // every CPU a random 55–88 chemistry, which unfairly inflated bot strength
  // against newly registered clubs with low familiarity.
  const target = typeof targetTeam === 'object' && targetTeam
    ? targetTeam
    : { teamStrength: Number(targetTeam), teamOvr: Number(targetTeam), teamChemistry: 0 };
  const desiredStrength = Number(target.teamStrength ?? targetTeam ?? 50);
  const botIdentity = botName ? { ...botManagerNameForStrength(desiredStrength), name: botName } : botManagerNameForStrength(desiredStrength);
  const userChemistry = Number(target.teamChemistry ?? 0);
  const botChemistry = round(clamp(userChemistry + randomInt(-2, 2), 0, 100), 2);
  const desiredOvr = clamp((desiredStrength * 2) - botChemistry, 40, 95);
  const used = new Set();
  const players = [];

  for (const slot of slots) {
    const isGk = slot.label === 'GK';
    const candidates = catalog
      .filter(player => !used.has(player.id) && ((player.stats?.type === 'goalkeeper') === isGk))
      .map(player => ({
        player,
        score: Math.abs(Number(player.position_ratings?.[slot.label] || player.overall) - desiredOvr) + Math.random() * 1.2
      }))
      .sort((a, b) => a.score - b.score);
    const player = candidates[0]?.player;
    if (!player) throw new Error(`Bot tidak menemukan pemain untuk posisi ${slot.label}.`);
    used.add(player.id);
    players.push({
      cardInstanceId: `BOT-${player.id}-${slot.key}`,
      playerId: player.id,
      slotKey: slot.key,
      slotPosition: slot.label,
      player,
      level: 1,
      xp: 0,
      currentStats: player.stats?.type === 'goalkeeper'
        ? (player.stats?.goalkeeper || {})
        : (player.stats?.main || {}),
      currentOvr: Number(player.position_ratings?.[slot.label] || player.overall),
      shirtNumber: Number(player.shirt_number || 0),
      chemistry: botChemistry,
      chemistryDetails: { generated: true }
    });
  }

  const teamOvr = round(players.reduce((sum, player) => sum + player.currentOvr, 0) / 11, 3);
  const teamStrength = round((teamOvr + botChemistry) / 2, 3);
  const botPersonality = ['possession', 'direct_play', 'wide_play', 'adaptive_press'].at(randomInt(0, 3));
  return {
    userId: null,
    username: botIdentity.name,
    formation,
    players,
    teamOvr,
    teamChemistry: botChemistry,
    teamStrength,
    complete: true,
    isBot: true,
    botPersonality,
    botPower: botIdentity.power,
    botPowerRange: botIdentity.range
  };
}

function matchResultForSide(sim, side) {
  if (sim.winner === 'draw') return 'draw';
  return sim.winner === side ? 'win' : 'loss';
}

async function createRunningMatch({ mode, home, away, homeUserId, awayUserId, homeName, awayName, channelId, messageId }) {
  const seed = crypto.randomInt(1, 2_147_483_000);
  const sim = generateMatch(home, away, seed);
  const matchId = uuid();
  const homeSnapshot = serializeTeam(home, homeName);
  const awaySnapshot = serializeTeam(away, awayName);
  const emptyReward = {};
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const userId of [homeUserId, awayUserId].filter(Boolean)) {
      const active = await conn.query(
        "SELECT match_id FROM matches WHERE status='running' AND (home_user_id=? OR away_user_id=?) LIMIT 1 FOR UPDATE", [userId, userId]
      );
      if (active.length) throw new Error('Kamu masih memiliki pertandingan yang sedang berjalan.');
    }
    await conn.query(
      `INSERT INTO matches
      (match_id,mode,status,home_user_id,away_user_id,home_name,away_name,home_strength,away_strength,home_score,away_score,winner_user_id,
       home_snapshot_json,away_snapshot_json,home_stats_json,away_stats_json,events_json,reward_json,seed,channel_id,message_id)
      VALUES (?,?, 'running',?,?,?,?,?, ?,0,0,NULL,?,?,?,?,?,?,?,?,?)`,
      [matchId, mode, homeUserId || null, awayUserId || null, homeName, awayName, home.teamStrength, away.teamStrength,
        JSON.stringify(homeSnapshot), JSON.stringify(awaySnapshot), JSON.stringify(sim.stats.home), JSON.stringify(sim.stats.away),
        JSON.stringify(sim.logs), JSON.stringify(emptyReward), seed, channelId || null, messageId || null]
    );
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
  return { matchId, mode, seed, sim, home, away, homeUserId, awayUserId, homeName, awayName };
}

async function completeMatch(match) {
  const { sim, mode, home, away, homeUserId, awayUserId, matchId, homeName, awayName } = match;
  const homeResult = matchResultForSide(sim, 'home');
  const awayResult = matchResultForSide(sim, 'away');
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const rewards = {
      home: homeUserId ? await rewardMatch(conn, {
        userId: homeUserId, team: home, opponent: away, result: homeResult, mode, matchId,
        contributions: sim.playerContributions.home, stats: sim.stats.home
      }) : null,
      away: awayUserId ? await rewardMatch(conn, {
        userId: awayUserId, team: away, opponent: home, result: awayResult, mode, matchId,
        contributions: sim.playerContributions.away, stats: sim.stats.away
      }) : null
    };
    const winnerUserId = sim.winner === 'home' ? homeUserId : sim.winner === 'away' ? awayUserId : null;
    await conn.query(
      `UPDATE matches SET status='completed',home_score=?,away_score=?,winner_user_id=?,home_stats_json=?,away_stats_json=?,events_json=?,reward_json=?,completed_at=NOW()
       WHERE match_id=? AND status='running'`,
      [sim.homeScore, sim.awayScore, winnerUserId, JSON.stringify(sim.stats.home), JSON.stringify(sim.stats.away),
        JSON.stringify(sim.logs), JSON.stringify(rewards), matchId]
    );
    await conn.commit();
    return {
      matchId, mode, status: 'completed', homeName, awayName,
      homeScore: sim.homeScore, awayScore: sim.awayScore, winner: sim.winner,
      homeStrength: home.teamStrength, awayStrength: away.teamStrength,
      homeTeamOvr: home.teamOvr, awayTeamOvr: away.teamOvr,
      homeChemistry: home.teamChemistry, awayChemistry: away.teamChemistry,
      logs: sim.logs, stats: sim.stats, rewards, contributions: sim.playerContributions
    };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}


async function runPreparedMatchDiscord({
  message, mode, home, away, homeUserId, awayUserId, homeName, awayName
}) {
  const participantIds = [homeUserId, awayUserId].filter(Boolean).map(Number);
  for (const userId of participantIds) {
    if (activeMatchUsers.has(userId)) {
      throw new Error('Kamu masih memiliki pertandingan yang sedang berjalan.');
    }
  }
  participantIds.forEach(userId => activeMatchUsers.add(userId));

  let running = null;
  try {
    running = await createRunningMatch({
      mode,
      home,
      away,
      homeUserId,
      awayUserId,
      homeName,
      awayName,
      channelId: message.channelId,
      messageId: message.id
    });

    // The visible kick-off message is the exact start of the match clock.
    // Live Discord edits are dispatched without awaiting their network round-trip;
    // otherwise each REST response would extend a nominal 90-second match.
    await safeEditMessage(message, {
      embeds: [buildKickoffEmbed({ homeName, awayName, mode })],
      components: []
    });
    const startedAt = Date.now();
    let pendingPayload = null;
    const priorityPayloads = [];
    let editWorker = null;
    let lastEditError = null;

    // Discord REST edits can be slower than the simulation tick. Coalesce
    // normal live frames to the newest one, while preserving half-time and
    // full-time as priority screens. This prevents a 90-request backlog from
    // extending the real match after minute 90.
    const dispatchEdit = (payload, { priority = false, final = false } = {}) => {
      if (final) {
        // Drop any stale live/half-time frame so no old screen can overwrite
        // the final result or extend the visible match after minute 90.
        pendingPayload = null;
        priorityPayloads.length = 0;
        priorityPayloads.push(payload);
      } else if (priority) {
        priorityPayloads.push(payload);
      } else {
        pendingPayload = payload;
      }

      if (!editWorker) {
        editWorker = (async () => {
          while (priorityPayloads.length || pendingPayload) {
            let nextPayload;
            if (priorityPayloads.length) {
              nextPayload = priorityPayloads.shift();
            } else {
              nextPayload = pendingPayload;
              pendingPayload = null;
            }
            try {
              await safeEditMessage(message, nextPayload);
            } catch (error) {
              lastEditError = error;
              console.error('[MATCH LIVE MESSAGE EDIT]', error);
            }
          }
        })().finally(() => {
          editWorker = null;
        });
      }
      return editWorker;
    };

    for (let minute = 1; minute <= 90; minute += 1) {
      const targetAt = startedAt + (minute * 1000);
      const waitMs = targetAt - Date.now();
      if (waitMs > 0) await sleep(waitMs);

      // The simulation advances every second (one real second = one match minute).
      // Publish each match minute immediately. The clock is monotonic and the
      // ordered edit queue never blocks the next one-second simulation tick.
      const shouldPublish = true;
      if (shouldPublish) {
        const view = { mode, homeName, awayName, home, away, sim: running.sim };
        const embed = minute === 45
          ? buildHalfTimeEmbed(view)
          : buildLiveMatchEmbed(view, minute);
        dispatchEdit({ embeds: [embed], components: [] }, { priority: minute === 45 });
      }
    }

    // The simulation clock has now reached 90 seconds. Final persistence and
    // the full-time result are performed once; no intro or half-time sleep is added.
    const result = await completeMatch(running);
    await dispatchEdit({
      embeds: [buildMatchResultEmbed(result)],
      components: []
    }, { final: true });
    if (lastEditError) {
      console.warn('[MATCH] At least one live tick could not be displayed; full logs remain available through /matchlogs.');
    }
    return result;
  } catch (error) {
    if (running?.matchId) {
      await getPool().query(
        "UPDATE matches SET status='cancelled', completed_at=NOW() WHERE match_id=? AND status='running'",
        [running.matchId]
      ).catch(() => {});
    }
    throw error;
  } finally {
    participantIds.forEach(userId => activeMatchUsers.delete(userId));
  }
}

async function prepareQuickMatch(user, mode) {
  const squad = await getSquadSnapshot(user.id);
  if (!teamIsComplete(squad)) throw new Error(`Squad belum lengkap. Slot kosong: ${squad.missingSlots.join(', ')}`);
  const humanOpponent = await findHumanOpponent(user.id, squad.teamStrength);
  if (humanOpponent) {
    const home = { ...squad, userId: Number(user.id), username: user.username };
    const away = { ...humanOpponent.squad, userId: humanOpponent.userId, username: humanOpponent.username };
    return { home, away, homeUserId: Number(user.id), awayUserId: humanOpponent.userId, homeName: user.username, awayName: humanOpponent.username, mode, viewerSide: 'home', opponentType: 'human' };
  }
  if (mode === 'ranked') throw new Error('Belum ada pengguna dengan Team Strength yang sesuai. Ranked tidak menggunakan bot. Coba lagi nanti.');
  const bot = await buildBotSquad(squad);
  const home = { ...squad, userId: Number(user.id), username: user.username };
  return { home, away: bot, homeUserId: Number(user.id), awayUserId: null, homeName: user.username, awayName: bot.username, mode: 'classic', viewerSide: 'home', opponentType: 'bot' };
}

async function createFriendlyInvitation(fromUser, targetDiscordId, channelId) {
  if (String(fromUser.discord_id) === String(targetDiscordId)) throw new Error('Kamu tidak bisa menantang diri sendiri.');
  const targetRows = await getPool().query('SELECT id,discord_id,username FROM users WHERE discord_id=? LIMIT 1', [targetDiscordId]);
  if (!targetRows.length) throw new Error('Teman tersebut belum terdaftar. Minta dia menjalankan `/start` terlebih dahulu.');
  const target = targetRows[0];
  const existing = await getPool().query(
    "SELECT invitation_id FROM match_invitations WHERE from_user_id=? AND to_user_id=? AND status='pending' AND expires_at>NOW() LIMIT 1",
    [fromUser.id, target.id]
  );
  if (existing.length) throw new Error('Kamu sudah memiliki undangan yang masih menunggu jawaban dari pengguna tersebut.');
  const invitationId = uuid();
  await getPool().query(
    'INSERT INTO match_invitations (invitation_id,from_user_id,to_user_id,channel_id,expires_at) VALUES (?,?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))',
    [invitationId, fromUser.id, target.id, channelId]
  );
  return { invitationId, target };
}

async function acceptFriendlyInvitation(invitationId, targetDiscordId) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const rows = await conn.query(
      `SELECT i.*,u.discord_id AS from_discord_id,u.username AS from_name,t.discord_id AS to_discord_id,t.username AS to_name
       FROM match_invitations i JOIN users u ON u.id=i.from_user_id JOIN users t ON t.id=i.to_user_id
       WHERE i.invitation_id=? AND i.status='pending' AND i.expires_at>NOW() FOR UPDATE`, [invitationId]
    );
    if (!rows.length) throw new Error('Undangan tidak tersedia atau sudah kedaluwarsa.');
    const invite = rows[0];
    if (String(invite.to_discord_id) !== String(targetDiscordId)) throw new Error('Hanya pengguna yang ditantang yang dapat menerima undangan ini.');
    await conn.query("UPDATE match_invitations SET status='accepted' WHERE invitation_id=?", [invitationId]);
    await conn.commit();
    return { fromId: Number(invite.from_user_id), toId: Number(invite.to_user_id), fromName: invite.from_name, toName: invite.to_name };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function declineFriendlyInvitation(invitationId, targetDiscordId) {
  const rows = await getPool().query(
    `UPDATE match_invitations i JOIN users u ON u.id=i.to_user_id
     SET i.status='declined' WHERE i.invitation_id=? AND u.discord_id=? AND i.status='pending'`,
    [invitationId, targetDiscordId]
  );
  if (!rows.affectedRows) throw new Error('Undangan tidak ditemukan atau bukan milikmu.');
  return true;
}

async function getMatchLogs(matchId, userId, page = 1) {
  const rows = await getPool().query(
    'SELECT events_json,home_name,away_name,home_score,away_score,mode,status,home_user_id,away_user_id FROM matches WHERE match_id=? AND (home_user_id=? OR away_user_id=?) LIMIT 1',
    [matchId, userId, userId]
  );
  if (!rows.length) throw new Error('Pertandingan tidak ditemukan.');
  if (rows[0].status !== 'completed') throw new Error('Log lengkap tersedia setelah pertandingan selesai.');
  const logs = safeJson(rows[0].events_json, []);
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(logs.length / pageSize));
  const safePage = Math.max(1, Math.min(totalPages, Number(page) || 1));
  return { ...rows[0], logs: logs.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, totalPages, total: logs.length };
}

module.exports = {
  teamIsComplete, findHumanOpponent, buildBotSquad, botManagerNameForStrength, createRunningMatch, completeMatch,
  prepareQuickMatch, createFriendlyInvitation,
  acceptFriendlyInvitation, declineFriendlyInvitation, getMatchLogs, runPreparedMatchDiscord
};
