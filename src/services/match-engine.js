const { clamp, round } = require('../utils/football');

function seededRandom(seed) {
  let a = Number(seed) >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function average(values, fallback = 65) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}
function getStat(player, key, fallback = 65) {
  const current = player.currentStats || {};
  const raw = player.player?.stats?.outfield || player.player?.stats?.goalkeeper || {};
  const value = current[key] ?? current[key.toUpperCase()] ?? raw[key] ?? raw[key.toUpperCase()] ?? fallback;
  const boostCap = 0.10;
  const boost = 1 + (Number(player.chemistry || 0) / 100) * boostCap;
  return clamp(Number(value) * boost, 1, 99);
}
function getMainStat(player, key, fallback = 65) {
  const current = player.currentStats || {};
  const main = player.player?.stats?.main || {};
  const value = current[key] ?? current[key.toUpperCase()] ?? main[key] ?? main[key.toUpperCase()] ?? fallback;
  const boost = 1 + (Number(player.chemistry || 0) / 100) * 0.10;
  return clamp(Number(value) * boost, 1, 99);
}

function getTeamProfile(team) {
  const outfield = team.players.filter(player => player.slotPosition !== 'GK');
  const keepers = team.players.filter(player => player.slotPosition === 'GK');
  const main = key => average(outfield.map(player => getMainStat(player, key)));
  const keeper = keepers[0];
  const goalkeeper = keeper
    ? average(['reflexes', 'handling', 'diving', 'positioning'].map(key => getStat(keeper, key, 70)))
    : 60;
  return {
    attack: main('SHO') * 0.42 + main('DRI') * 0.20 + main('PAC') * 0.16 + main('PAS') * 0.22,
    midfield: main('PAS') * 0.40 + main('DRI') * 0.22 + main('PHY') * 0.14 + main('DEF') * 0.14 + main('PAC') * 0.10,
    defense: main('DEF') * 0.48 + main('PHY') * 0.24 + main('PAC') * 0.10 + main('PAS') * 0.10 + main('DRI') * 0.08,
    goalkeeper,
    strength: Number(team.teamStrength || 70)
  };
}

function weightedPick(list, weightFn, rng) {
  if (!list.length) return null;
  const weights = list.map(item => Math.max(0.1, Number(weightFn(item)) || 0.1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let value = rng() * total;
  for (let index = 0; index < list.length; index += 1) {
    value -= weights[index];
    if (value <= 0) return list[index];
  }
  return list[list.length - 1];
}

function chooseAttacker(team, rng) {
  const outfield = team.players.filter(player => player.slotPosition !== 'GK');
  return weightedPick(outfield, player => {
    const position = player.slotPosition;
    const positionWeight = ['ST', 'CF'].includes(position) ? 2.3
      : ['LW', 'RW', 'CAM', 'LM', 'RM'].includes(position) ? 1.7
        : ['CM', 'CDM'].includes(position) ? 1.1 : 0.7;
    return positionWeight * (0.6 + getMainStat(player, 'SHO') / 100) * (0.7 + getMainStat(player, 'DRI') / 150);
  }, rng);
}
function chooseCreator(team, excludedId, rng) {
  return weightedPick(team.players.filter(player => player.cardInstanceId !== excludedId && player.slotPosition !== 'GK'), player => {
    const creatorWeight = ['CM', 'CAM', 'LW', 'RW', 'LM', 'RM'].includes(player.slotPosition) ? 1.6 : 1;
    return (0.4 + getMainStat(player, 'PAS') / 100) * creatorWeight;
  }, rng);
}
function chooseDefender(team, rng) {
  return weightedPick(team.players.filter(player => player.slotPosition !== 'GK'), player => getMainStat(player, 'DEF') * 0.8 + getMainStat(player, 'PHY') * 0.2, rng);
}
function chooseMatchEvent(team, side, minute, score, rng) {
  const weights = {
    pass: 12, tackle: 10, build_up: 9, dribble: 12,
    chance: 25, corner: 8, foul: 7, penalty: 2, interception: 15
  };
  const personality = team.isBot ? team.botPersonality : null;
  const adjust = changes => {
    for (const [key, value] of Object.entries(changes)) weights[key] = Math.max(0.5, weights[key] + value);
  };

  if (personality === 'possession') adjust({ pass: 5, build_up: 4, chance: -3, corner: -2, interception: -2, dribble: -2 });
  if (personality === 'direct_play') adjust({ chance: 7, dribble: 2, pass: -3, build_up: -3, interception: -2, corner: -1 });
  if (personality === 'wide_play') adjust({ dribble: 4, corner: 4, chance: 2, pass: -3, build_up: -4, tackle: -2, interception: -1 });
  if (personality === 'adaptive_press') adjust({ tackle: 5, interception: 5, foul: 2, pass: -4, build_up: -3, corner: -3, chance: -2 });

  const ownGoals = Number(score[side] || 0);
  const opponentGoals = Number(score[side === 'home' ? 'away' : 'home'] || 0);
  // Adaptive bots react to the scoreline without exposing manual tactic controls.
  if (personality && minute >= 65 && ownGoals < opponentGoals) {
    adjust({ chance: 6, dribble: 2, pass: -3, build_up: -3, tackle: -1, interception: -1 });
  } else if (personality && minute >= 78 && ownGoals > opponentGoals) {
    adjust({ tackle: 4, interception: 3, chance: -5, dribble: -1, pass: -1 });
  }

  const events = Object.keys(weights);
  const total = events.reduce((sum, key) => sum + weights[key], 0);
  let roll = rng() * total;
  for (const event of events) {
    roll -= weights[event];
    if (roll <= 0) return event;
  }
  return 'interception';
}

function createStats() {
  return {
    possession: 0, shots: 0, shotsOnTarget: 0, goals: 0, passes: 0, passesCompleted: 0,
    passAccuracy: 0, corners: 0, fouls: 0, saves: 0, tackles: 0, interceptions: 0,
    yellowCards: 0, redCards: 0
  };
}
function contributionBucket(store, side, cardId) {
  if (!cardId || String(cardId).startsWith('BOT-')) return null;
  if (!store[side][cardId]) store[side][cardId] = { goals: 0, assists: 0, shots: 0, passes: 0, tackles: 0, interceptions: 0, saves: 0, cleanSheets: 0 };
  return store[side][cardId];
}
function teamLabel(team) { return team.username || 'Club'; }

/**
 * Generates one and only one textual log for each of the 90 in-game minutes.
 * The Discord presentation layer reveals these log entries one second apart.
 * No user-selectable Attack / Defense / Balance tactic exists in this engine.
 */
function generateMatch(home, away, seed = Date.now()) {
  if (!home?.players || !away?.players || home.players.length !== 11 || away.players.length !== 11) {
    throw new Error('Match engine memerlukan dua squad lengkap berisi 11 pemain.');
  }
  const rng = seededRandom(seed);
  const homeProfile = getTeamProfile(home);
  const awayProfile = getTeamProfile(away);
  const stats = { home: createStats(), away: createStats() };
  const contributions = { home: {}, away: {} };
  const logs = [];
  const redCards = { home: 0, away: 0 };

  for (let minute = 1; minute <= 90; minute += 1) {
    if (minute === 45) {
      logs.push({ minute, side: 'system', type: 'halftime', text: 'Half-time — kedua tim memasuki jeda pertandingan.', score: { home: stats.home.goals, away: stats.away.goals } });
      continue;
    }
    if (minute === 90) {
      logs.push({ minute, side: 'system', type: 'fulltime', text: 'Full-time — pertandingan selesai.', score: { home: stats.home.goals, away: stats.away.goals } });
      continue;
    }

    const midfieldDiff = homeProfile.midfield - awayProfile.midfield;
    const strengthDiff = homeProfile.strength - awayProfile.strength;
    const homeControlProbability = clamp(0.50 + midfieldDiff * 0.0021 + strengthDiff * 0.0011, 0.33, 0.67);
    const side = rng() < homeControlProbability ? 'home' : 'away';
    const otherSide = side === 'home' ? 'away' : 'home';
    const team = side === 'home' ? home : away;
    const opponent = side === 'home' ? away : home;
    const ownProfile = side === 'home' ? homeProfile : awayProfile;
    const opponentProfile = side === 'home' ? awayProfile : homeProfile;
    const ownStats = stats[side];
    const opponentStats = stats[otherSide];
    const ownRedPenalty = redCards[side] * 0.045;
    const opponentRedPenalty = redCards[otherSide] * 0.045;
    ownStats.possession += 1;

    const event = chooseMatchEvent(team, side, minute, {
      home: stats.home.goals,
      away: stats.away.goals
    }, rng);
    let log;
    if (event === 'pass') {
      const player = chooseCreator(team, null, rng) || chooseAttacker(team, rng);
      ownStats.passes += 1;
      ownStats.passesCompleted += 1;
      const contribution = contributionBucket(contributions, side, player?.cardInstanceId);
      if (contribution) contribution.passes += 1;
      log = { minute, side, type: 'pass', actor: player?.player.name, text: `${player?.player.name || teamLabel(team)} mengalirkan umpan dan mempertahankan penguasaan bola.` };
    } else if (event === 'tackle') {
      const defender = chooseDefender(team, rng);
      ownStats.tackles += 1;
      const contribution = contributionBucket(contributions, side, defender?.cardInstanceId);
      if (contribution) contribution.tackles += 1;
      log = { minute, side, type: 'tackle', actor: defender?.player.name, text: `${defender?.player.name || teamLabel(team)} memenangkan duel dan merebut bola.` };
    } else if (event === 'build_up') {
      const attacker = chooseAttacker(team, rng);
      const creator = chooseCreator(team, attacker?.cardInstanceId, rng);
      ownStats.passes += 1;
      ownStats.passesCompleted += 1;
      const contribution = contributionBucket(contributions, side, creator?.cardInstanceId);
      if (contribution) contribution.passes += 1;
      log = { minute, side, type: 'build_up', actor: creator?.player.name, text: `${teamLabel(team)} membangun serangan melalui ${creator?.player.name || 'lini tengah'}.` };
    } else if (event === 'dribble') {
      const attacker = chooseAttacker(team, rng);
      const defender = chooseDefender(opponent, rng);
      const winner = rng() < clamp(0.48 + (ownProfile.attack - opponentProfile.defense) / 250 - opponentRedPenalty, 0.2, 0.8);
      if (winner) {
        const contribution = contributionBucket(contributions, side, attacker?.cardInstanceId);
        if (contribution) contribution.passes += 1;
        log = { minute, side, type: 'dribble', actor: attacker?.player.name, text: `${attacker?.player.name || teamLabel(team)} melewati penjagaan lawan.` };
      } else {
        opponentStats.tackles += 1;
        const contribution = contributionBucket(contributions, otherSide, defender?.cardInstanceId);
        if (contribution) contribution.tackles += 1;
        log = { minute, side: otherSide, type: 'tackle', actor: defender?.player.name, text: `${defender?.player.name || teamLabel(opponent)} menghentikan laju serangan.` };
      }
    } else if (event === 'chance') {
      const attacker = chooseAttacker(team, rng);
      const defender = chooseDefender(opponent, rng);
      const penalty = Math.max(0, redCards[otherSide]) * 0.045;
      const shotChance = clamp(0.38 + (ownProfile.attack - opponentProfile.defense) / 230 - penalty, 0.22, 0.62);
      if (rng() > shotChance) {
        if (rng() < 0.28) ownStats.corners += 1;
        log = { minute, side, type: 'chance', actor: attacker?.player.name, text: `${attacker?.player.name || teamLabel(team)} mencari ruang, tetapi peluangnya berhasil ditutup.` };
      } else {
        ownStats.shots += 1;
        const contribution = contributionBucket(contributions, side, attacker?.cardInstanceId);
        if (contribution) contribution.shots += 1;
        const finishing = getStat(attacker, 'finishing', getMainStat(attacker, 'SHO'));
        const shotPower = getStat(attacker, 'shot_power', getMainStat(attacker, 'SHO'));
        const onTarget = rng() < clamp(0.25 + finishing / 210 + shotPower / 500, 0.32, 0.82);
        if (!onTarget) {
          log = { minute, side, type: 'shot_wide', actor: attacker?.player.name, text: `${attacker?.player.name || teamLabel(team)} melepaskan tembakan, tetapi bola melenceng dari sasaran.` };
        } else {
          ownStats.shotsOnTarget += 1;
          const goalkeeper = opponent.players.find(player => player.slotPosition === 'GK');
          const reflexes = goalkeeper ? getStat(goalkeeper, 'reflexes', 70) : 65;
          const handling = goalkeeper ? getStat(goalkeeper, 'handling', 70) : 65;
          const goalProbability = clamp(0.19 + (finishing - 70) * 0.0032 + (shotPower - 70) * 0.0014 - (reflexes - 70) * 0.0022 - (handling - 70) * 0.0011 - penalty, 0.035, 0.43);
          if (rng() < goalProbability) {
            ownStats.goals += 1;
            const assist = rng() < 0.72 ? chooseCreator(team, attacker?.cardInstanceId, rng) : null;
            if (contribution) contribution.goals += 1;
            const assistContribution = contributionBucket(contributions, side, assist?.cardInstanceId);
            if (assistContribution) assistContribution.assists += 1;
            log = {
              minute, side, type: 'goal', actor: attacker?.player.name, assist: assist?.player.name || null,
              text: `GOAL! ${attacker?.player.name || teamLabel(team)} mencetak gol${assist ? `, assist ${assist.player.name}` : ''}!`
            };
          } else {
            opponentStats.saves += 1;
            const saveContribution = contributionBucket(contributions, otherSide, goalkeeper?.cardInstanceId);
            if (saveContribution) saveContribution.saves += 1;
            log = { minute, side: otherSide, type: 'save', actor: goalkeeper?.player.name, text: `${goalkeeper?.player.name || teamLabel(opponent)} melakukan penyelamatan penting.` };
          }
        }
      }
    } else if (event === 'corner') {
      ownStats.corners += 1;
      const player = chooseAttacker(team, rng);
      log = { minute, side, type: 'corner', actor: player?.player.name, text: `${teamLabel(team)} mendapatkan tendangan sudut.` };
    } else if (event === 'foul') {
      opponentStats.fouls += 1;
      const defender = chooseDefender(opponent, rng);
      const booking = rng();
      if (booking < 0.035) {
        opponentStats.redCards += 1;
        redCards[otherSide] += 1;
        log = { minute, side: otherSide, type: 'red_card', actor: defender?.player.name, text: `${defender?.player.name || teamLabel(opponent)} mendapat kartu merah.` };
      } else if (booking < 0.24) {
        opponentStats.yellowCards += 1;
        log = { minute, side: otherSide, type: 'yellow_card', actor: defender?.player.name, text: `${defender?.player.name || teamLabel(opponent)} mendapat kartu kuning.` };
      } else {
        log = { minute, side: otherSide, type: 'foul', actor: defender?.player.name, text: `${defender?.player.name || teamLabel(opponent)} melakukan pelanggaran.` };
      }
    } else if (event === 'penalty') {
      const taker = chooseAttacker(team, rng);
      const keeper = opponent.players.find(player => player.slotPosition === 'GK');
      const kick = getStat(taker, 'penalties', getMainStat(taker, 'SHO'));
      const keeperStat = keeper ? getStat(keeper, 'reflexes', 70) : 65;
      const scored = rng() < clamp(0.72 + (kick - 70) * 0.002 - (keeperStat - 70) * 0.0015, 0.55, 0.90);
      ownStats.shots += 1;
      ownStats.shotsOnTarget += 1;
      if (scored) {
        ownStats.goals += 1;
        const contribution = contributionBucket(contributions, side, taker?.cardInstanceId);
        if (contribution) contribution.goals += 1;
        log = { minute, side, type: 'penalty_goal', actor: taker?.player.name, text: `PENALTI MASUK! ${taker?.player.name || teamLabel(team)} berhasil mengeksekusi penalti.` };
      } else {
        opponentStats.saves += 1;
        const contribution = contributionBucket(contributions, otherSide, keeper?.cardInstanceId);
        if (contribution) contribution.saves += 1;
        log = { minute, side: otherSide, type: 'penalty_save', actor: keeper?.player.name, text: `PENALTI GAGAL! ${keeper?.player.name || teamLabel(opponent)} berhasil menggagalkan tendangan.` };
      }
    } else {
      const player = chooseDefender(team, rng);
      ownStats.interceptions += 1;
      const contribution = contributionBucket(contributions, side, player?.cardInstanceId);
      if (contribution) contribution.interceptions += 1;
      log = { minute, side, type: 'interception', actor: player?.player.name, text: `${player?.player.name || teamLabel(team)} membaca arah umpan dan memotong bola.` };
    }

    logs.push({
      minute,
      side: log.side || side,
      type: log.type || 'play',
      actor: log.actor || null,
      assist: log.assist || null,
      text: log.text,
      score: { home: stats.home.goals, away: stats.away.goals }
    });
  }

  const totalPossession = stats.home.possession + stats.away.possession;
  stats.home.possession = totalPossession ? round(stats.home.possession / totalPossession * 100, 1) : 50;
  stats.away.possession = round(100 - stats.home.possession, 1);
  for (const side of ['home', 'away']) {
    stats[side].passAccuracy = stats[side].passes ? round(stats[side].passesCompleted / stats[side].passes * 100, 1) : 0;
  }
  for (const [side, opponentSide] of [['home', 'away'], ['away', 'home']]) {
    if (stats[opponentSide].goals === 0) {
      for (const player of teamFor(side, home, away).players) {
        const contribution = contributionBucket(contributions, side, player.cardInstanceId);
        if (contribution && player.slotPosition === 'GK') contribution.cleanSheets = 1;
      }
    }
  }

  const winner = stats.home.goals > stats.away.goals ? 'home' : stats.away.goals > stats.home.goals ? 'away' : 'draw';
  return {
    duration: 90,
    homeScore: stats.home.goals,
    awayScore: stats.away.goals,
    winner,
    logs,
    events: logs,
    stats,
    playerContributions: contributions,
    profiles: { home: homeProfile, away: awayProfile }
  };
}

function teamFor(side, home, away) { return side === 'home' ? home : away; }

module.exports = { generateMatch, getTeamProfile, seededRandom, getMainStat, getStat };
