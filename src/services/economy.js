const { getPool } = require('../db');
const config = require('../config');
const { clamp, round, safeJson, xpRequired, accountXpRequired } = require('../utils/football');

async function addCredits(conn, userId, amount, reason, referenceId = null) {
  const value = Math.trunc(Number(amount));
  if (!Number.isFinite(value) || value === 0) return null;
  const rows = await conn.query('SELECT credits FROM users WHERE id=? FOR UPDATE', [userId]);
  if (!rows.length) throw new Error('Manager account not found.');
  const next = Number(rows[0].credits) + value;
  if (next < 0) throw new Error('You do not have enough Credits.');
  await conn.query('UPDATE users SET credits=? WHERE id=?', [next, userId]);
  await conn.query('INSERT INTO credit_transactions (user_id,amount,balance_after,reason,reference_id) VALUES (?,?,?,?,?)',
    [userId, value, next, reason, referenceId]);
  return next;
}

async function addAccountXp(conn, userId, amount) {
  const gained = Math.max(0, Math.trunc(Number(amount) || 0));
  const rows = await conn.query('SELECT account_level,account_xp FROM users WHERE id=? FOR UPDATE', [userId]);
  if (!rows.length) return null;
  let level = Number(rows[0].account_level);
  let currentXp = Number(rows[0].account_xp) + gained;
  let threshold = accountXpRequired(level);
  while (currentXp >= threshold && level < 100) {
    currentXp -= threshold;
    level += 1;
    threshold = accountXpRequired(level);
  }
  if (level >= 100) currentXp = Math.min(currentXp, threshold - 1);
  await conn.query('UPDATE users SET account_level=?,account_xp=? WHERE id=?', [level, currentXp, userId]);
  return { level, xp: currentXp, requiredXp: threshold, gained };
}

function calculatePlayerXp(position, contribution = {}) {
  let xp = 3;
  const goals = Number(contribution.goals || 0);
  const assists = Number(contribution.assists || 0);
  const shots = Number(contribution.shots || 0);
  const passes = Number(contribution.passes || 0);
  const tackles = Number(contribution.tackles || 0);
  const interceptions = Number(contribution.interceptions || 0);
  const saves = Number(contribution.saves || 0);
  if (position === 'GK') return Math.round(xp + saves * 2.2 + cleanSheets(contribution) * 5 + passes * 0.02);
  if (['ST', 'CF', 'LW', 'RW', 'LM', 'RM'].includes(position)) xp += goals * 7 + assists * 4 + shots * 1.4;
  else if (['CAM', 'CM'].includes(position)) xp += goals * 5 + assists * 5 + passes * 0.07 + shots * 0.7;
  else xp += goals * 3 + assists * 2 + tackles * 1.8 + interceptions * 1.8 + passes * 0.04;
  return Math.max(1, Math.round(xp));
}
function cleanSheets(contribution) { return Number(contribution.cleanSheets || 0); }

function growAttributes(stats, position, contribution = {}, isKeeper = false) {
  const growth = isKeeper
    ? { diving: 0.36, handling: 0.34, kicking: 0.18, reflexes: 0.42, speed: 0.12, positioning: 0.40, one_on_ones: 0.26, reactions: 0.34 }
    : (['ST', 'CF'].includes(position)
      ? { PAC: 0.10, SHO: 0.43, PAS: 0.08, DRI: 0.17, DEF: 0.02, PHY: 0.12 }
      : ['LW', 'RW', 'LM', 'RM'].includes(position)
        ? { PAC: 0.27, SHO: 0.18, PAS: 0.15, DRI: 0.38, DEF: 0.02, PHY: 0.08 }
        : ['CAM', 'CM'].includes(position)
          ? { PAC: 0.09, SHO: 0.12, PAS: 0.38, DRI: 0.25, DEF: 0.10, PHY: 0.12 }
          : ['CDM', 'CB', 'LB', 'RB'].includes(position)
            ? { PAC: 0.10, SHO: 0.02, PAS: 0.12, DRI: 0.06, DEF: 0.43, PHY: 0.35 }
            : { PAC: 0.12, SHO: 0.14, PAS: 0.20, DRI: 0.18, DEF: 0.18, PHY: 0.18 });
  const goalBonus = Number(contribution.goals || 0) * 0.05;
  const assistBonus = Number(contribution.assists || 0) * 0.04;
  const defenseBonus = (Number(contribution.tackles || 0) + Number(contribution.interceptions || 0)) * 0.012;
  for (const [key, amount] of Object.entries(growth)) {
    const actualKey = Object.keys(stats).find(k => k.toLowerCase() === key.toLowerCase()) || key;
    const extra = key === 'SHO' ? goalBonus : key === 'PAS' ? assistBonus : key === 'DEF' ? defenseBonus : 0;
    stats[actualKey] = clamp(round(Number(stats[actualKey] || 60) + amount + extra, 2), 1, 99);
  }
  if (!isKeeper) {
    const detailMap = ['ST', 'CF'].includes(position)
      ? { finishing: 0.42, attacking_positioning: 0.32, shot_power: 0.22, volleys: 0.16, composure: 0.14 }
      : ['LW', 'RW', 'LM', 'RM'].includes(position)
        ? { acceleration: 0.24, sprint_speed: 0.25, dribbling: 0.36, ball_control: 0.28, crossing: 0.16 }
        : ['CAM', 'CM'].includes(position)
          ? { vision: 0.30, short_passing: 0.30, long_passing: 0.20, ball_control: 0.22, composure: 0.18 }
          : { defensive_awareness: 0.34, standing_tackle: 0.32, sliding_tackle: 0.24, interceptions: 0.30, strength: 0.20 };
    for (const [key, amount] of Object.entries(detailMap)) {
      if (stats[key] === undefined) continue;
      const extra = key === 'finishing' ? goalBonus : key === 'short_passing' ? assistBonus : (key.includes('tackle') || key === 'interceptions') ? defenseBonus : 0;
      stats[key] = clamp(round(Number(stats[key]) + amount + extra, 2), 1, 99);
    }
  }
}

async function awardPlayerDevelopment(conn, teamSnapshot, contributions = {}) {
  const results = [];
  for (const player of teamSnapshot.players) {
    if (!player.cardInstanceId || String(player.cardInstanceId).startsWith('BOT-')) continue;
    const contribution = contributions[player.cardInstanceId] || {};
    const gainedXp = calculatePlayerXp(player.slotPosition, contribution);
    const rows = await conn.query('SELECT level,xp,current_stats_json FROM user_player_cards WHERE card_instance_id=? AND user_id=? FOR UPDATE',
      [player.cardInstanceId, teamSnapshot.userId]);
    if (!rows.length) continue;
    let level = Number(rows[0].level);
    let xp = Number(rows[0].xp) + gainedXp;
    const oldLevel = level;
    const stats = safeJson(rows[0].current_stats_json, player.currentStats || {});
    while (level < config.progression.playerMaxLevel && xp >= xpRequired(level)) {
      xp -= xpRequired(level);
      level += 1;
      growAttributes(stats, player.slotPosition, contribution, player.slotPosition === 'GK');
    }
    if (level >= config.progression.playerMaxLevel) xp = Math.min(xp, xpRequired(level) - 1);
    await conn.query('UPDATE user_player_cards SET level=?,xp=?,current_stats_json=? WHERE card_instance_id=? AND user_id=?',
      [level, xp, JSON.stringify(stats), player.cardInstanceId, teamSnapshot.userId]);
    results.push({ name: player.player.name, gainedXp, oldLevel, newLevel: level });
  }
  return results;
}

async function updateChemistryHistory(conn, userId, teamSnapshot) {
  const ids = teamSnapshot.players.map(p => p.cardInstanceId).filter(id => id && !String(id).startsWith('BOT-')).sort();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      await conn.query(
        `INSERT INTO chemistry_pair_history (user_id,card_a,card_b,matches_together) VALUES (?,?,?,1)
         ON DUPLICATE KEY UPDATE matches_together=matches_together+1`, [userId, ids[i], ids[j]]
      );
    }
  }
  await conn.query('UPDATE user_squads SET squad_matches=squad_matches+1 WHERE user_id=?', [userId]);
}

async function rewardMatch(conn, { userId, team, opponent, result, mode, matchId, contributions, stats }) {
  if (!userId) return null;
  const strengthDiff = Number(opponent.teamStrength) - Number(team.teamStrength);
  const underdog = Math.max(0, strengthDiff);
  const underdogFactor = result === 'win' ? 1 : result === 'draw' ? 0.35 : 0;
  let credits = config.economy.matchBaseCredits
    + (result === 'win' ? config.economy.matchWinBonus : result === 'draw' ? Math.round(config.economy.matchWinBonus * 0.35) : 0)
    + underdog * config.economy.underdogCreditFactor * underdogFactor;
  credits = Math.round(clamp(credits, 25, config.economy.matchBaseCredits + config.economy.matchWinBonus + 350));

  const dailyRows = await conn.query('SELECT rewarded_matches FROM user_daily_activity WHERE user_id=? AND activity_date=CURDATE() FOR UPDATE', [userId]);
  const previous = Number(dailyRows[0]?.rewarded_matches || 0);
  if (previous >= config.economy.dailySoftCap) credits = Math.round(credits * config.economy.afterCapFactor);
  await conn.query(
    `INSERT INTO user_daily_activity (user_id,activity_date,rewarded_matches) VALUES (?,CURDATE(),1)
     ON DUPLICATE KEY UPDATE rewarded_matches=rewarded_matches+1`, [userId]
  );
  const balance = await addCredits(conn, userId, credits, `match_${mode}_reward`, matchId);

  const baseXp = config.progression.accountXp[mode] || config.progression.accountXp.classic;
  const performance = Number(stats.goals || 0) * 12 + Number(stats.shotsOnTarget || 0) * 2 + Number(stats.passesCompleted || 0) * 0.08;
  const xp = Math.round(baseXp + performance * config.progression.accountXp.performanceFactor + (result === 'win' ? 5 : result === 'draw' ? 2 : 0));
  const account = await addAccountXp(conn, userId, xp);
  const playerXp = await awardPlayerDevelopment(conn, team, contributions);
  await updateChemistryHistory(conn, userId, team);

  let rankDelta = 0;
  if (mode === 'ranked') {
    const expected = 1 / (1 + (10 ** ((Number(opponent.teamStrength) - Number(team.teamStrength)) / config.match.rankScale)));
    const actual = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    rankDelta = round(config.match.rankK * (actual - expected), 3);
    await conn.query('UPDATE users SET rank_points=GREATEST(0,rank_points+?) WHERE id=?', [rankDelta, userId]);
  }
  return { result, credits, balance, accountXp: account, playerXp, rankDelta, rewardedMatchesToday: previous + 1 };
}

module.exports = {
  addCredits, addAccountXp, awardPlayerDevelopment, updateChemistryHistory, rewardMatch,
  playerXpRequired: xpRequired, accountXpRequired
};
