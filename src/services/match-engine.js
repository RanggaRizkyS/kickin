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
  return values.length
    ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length
    : fallback;
}

function getStat(player, key, fallback = 65) {
  const current = player.currentStats || {};
  const raw = player.player?.stats?.outfield || player.player?.stats?.goalkeeper || {};
  const value = current[key] ?? current[key.toUpperCase()] ?? raw[key] ?? raw[key.toUpperCase()] ?? fallback;
  const boost = 1 + (Number(player.chemistry || 0) / 100) * 0.10;
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
  const goalkeeper = team.players.find(player => player.slotPosition === 'GK');
  const main = key => average(outfield.map(player => getMainStat(player, key)));
  const goalkeeperRating = goalkeeper
    ? average(['reflexes', 'handling', 'diving', 'positioning'].map(key => getStat(goalkeeper, key, 70)))
    : 60;

  return {
    attack: main('SHO') * 0.38 + main('DRI') * 0.22 + main('PAC') * 0.16 + main('PAS') * 0.24,
    midfield: main('PAS') * 0.42 + main('DRI') * 0.20 + main('PHY') * 0.14 + main('DEF') * 0.14 + main('PAC') * 0.10,
    defense: main('DEF') * 0.48 + main('PHY') * 0.24 + main('PAC') * 0.10 + main('PAS') * 0.10 + main('DRI') * 0.08,
    goalkeeper: goalkeeperRating,
    strength: Number(team.teamStrength || 70)
  };
}

function weightedPick(list, weightFn, rng) {
  if (!list.length) return null;
  const weights = list.map(item => Math.max(0.1, Number(weightFn(item)) || 0.1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let index = 0; index < list.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return list[index];
  }
  return list[list.length - 1];
}

function chooseAttacker(team, rng) {
  const outfield = team.players.filter(player => player.slotPosition !== 'GK');
  return weightedPick(outfield, player => {
    const position = player.slotPosition;
    const positionWeight = ['ST', 'CF'].includes(position) ? 2.5
      : ['LW', 'RW', 'CAM', 'LM', 'RM'].includes(position) ? 1.8
        : ['CM', 'CDM'].includes(position) ? 1.1 : 0.7;
    return positionWeight * (0.6 + getMainStat(player, 'SHO') / 100) * (0.7 + getMainStat(player, 'DRI') / 150);
  }, rng);
}

function chooseCreator(team, excludedId, rng) {
  return weightedPick(
    team.players.filter(player => player.cardInstanceId !== excludedId && player.slotPosition !== 'GK'),
    player => {
      const positionWeight = ['CM', 'CAM', 'LW', 'RW', 'LM', 'RM'].includes(player.slotPosition) ? 1.7 : 1;
      return (0.4 + getMainStat(player, 'PAS') / 100) * positionWeight;
    },
    rng
  );
}

function chooseDefender(team, rng) {
  return weightedPick(
    team.players.filter(player => player.slotPosition !== 'GK'),
    player => getMainStat(player, 'DEF') * 0.8 + getMainStat(player, 'PHY') * 0.2,
    rng
  );
}

function createStats() {
  return {
    possession: 0,
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    passes: 0,
    passesCompleted: 0,
    passAccuracy: 0,
    corners: 0,
    fouls: 0,
    saves: 0,
    tackles: 0,
    interceptions: 0,
    yellowCards: 0,
    redCards: 0,
    penaltiesAwarded: 0,
    penaltiesScored: 0
  };
}

function contributionBucket(store, side, cardId) {
  if (!cardId || String(cardId).startsWith('BOT-')) return null;
  if (!store[side][cardId]) {
    store[side][cardId] = {
      goals: 0,
      assists: 0,
      shots: 0,
      passes: 0,
      tackles: 0,
      interceptions: 0,
      saves: 0,
      cleanSheets: 0
    };
  }
  return store[side][cardId];
}

function teamLabel(team) {
  return team.username || 'Club';
}

function botTendency(team, key) {
  if (!team?.isBot) return 0;
  const adjustments = {
    possession: { buildUp: 0.08, shot: -0.035, defend: 0 },
    direct_play: { buildUp: -0.06, shot: 0.055, defend: -0.015 },
    wide_play: { buildUp: 0.02, shot: 0.018, defend: -0.005 },
    adaptive_press: { buildUp: -0.02, shot: 0.012, defend: 0.07 }
  };
  return adjustments[team.botPersonality]?.[key] || 0;
}

function opponentSide(side) {
  return side === 'home' ? 'away' : 'home';
}

function scoreSnapshot(stats, minute) {
  return {
    minute,
    home: stats.home.goals,
    away: stats.away.goals
  };
}

function eventLog({ minute, side, type, actor, target = null, assist = null, text, stats }) {
  return {
    minute,
    side,
    type,
    actor: actor || null,
    target: target || null,
    assist: assist || null,
    text,
    score: {
      home: stats.home.goals,
      away: stats.away.goals
    }
  };
}

function resolvePenalty({ minute, pendingPenalty, teams, stats, contributions, rng }) {
  const side = pendingPenalty.side;
  const other = opponentSide(side);
  const team = teams[side];
  const opponent = teams[other];
  const taker = pendingPenalty.taker || chooseAttacker(team, rng);
  const goalkeeper = opponent.players.find(player => player.slotPosition === 'GK');
  const penaltySkill = getStat(taker, 'penalties', getMainStat(taker, 'SHO'));
  const keeperSkill = goalkeeper ? getStat(goalkeeper, 'reflexes', 70) : 65;
  const successChance = clamp(
    0.74 + (penaltySkill - 70) * 0.002 - (keeperSkill - 70) * 0.0015,
    0.55,
    0.91
  );

  stats[side].shots += 1;
  stats[side].shotsOnTarget += 1;
  if (rng() < successChance) {
    stats[side].goals += 1;
    stats[side].penaltiesScored += 1;
    const contribution = contributionBucket(contributions, side, taker?.cardInstanceId);
    if (contribution) {
      contribution.goals += 1;
      contribution.shots += 1;
    }
    return eventLog({
      minute,
      side,
      type: 'penalty_scored',
      actor: taker?.player?.name,
      text: `${taker?.player?.name || teamLabel(team)} converts the penalty.`,
      stats
    });
  }

  stats[other].saves += 1;
  const saveContribution = contributionBucket(contributions, other, goalkeeper?.cardInstanceId);
  if (saveContribution) saveContribution.saves += 1;

  // A saved penalty is logged as a successful defensive action. The event
  // belongs to the goalkeeper's side, and remains within the approved event set.
  return eventLog({
    minute,
    side: other,
    type: 'defend',
    actor: goalkeeper?.player?.name,
    target: taker?.player?.name,
    text: `${goalkeeper?.player?.name || 'The goalkeeper'} saves the penalty from ${taker?.player?.name || 'the taker'}.`,
    stats
  });
}

/**
 * Builds a chronological 90-minute match timeline.
 * A minute can have no event. Only the seven approved football events are
 * stored in `logs`; minuteScores keeps the clock and score for all minutes 0-90.
 */
function generateMatch(home, away, seed = Date.now()) {
  if (!home?.players || !away?.players || home.players.length !== 11 || away.players.length !== 11) {
    throw new Error('The match engine requires two complete eleven-player squads.');
  }

  const rng = seededRandom(seed);
  const teams = { home, away };
  const profiles = { home: getTeamProfile(home), away: getTeamProfile(away) };
  const stats = { home: createStats(), away: createStats() };
  const contributions = { home: {}, away: {} };
  const redCards = { home: 0, away: 0 };
  const yellowCards = { home: 0, away: 0 };
  const logs = [];
  const minuteScores = [scoreSnapshot(stats, 0)];
  const timeline = [{ minute: 0, event: null, score: { home: 0, away: 0 } }];

  const controlProbability = clamp(
    0.5 + (profiles.home.midfield - profiles.away.midfield) * 0.0021 +
      (profiles.home.strength - profiles.away.strength) * 0.0011,
    0.33,
    0.67
  );

  let possessionSide = rng() < controlProbability ? 'home' : 'away';
  let activeAttack = null;
  let pendingPenalty = null;

  for (let minute = 1; minute <= 90; minute += 1) {
    let currentSide = possessionSide;
    let log = null;

    if (pendingPenalty) {
      currentSide = pendingPenalty.side;
      log = resolvePenalty({ minute, pendingPenalty, teams, stats, contributions, rng });
      possessionSide = opponentSide(pendingPenalty.side);
      pendingPenalty = null;
      activeAttack = null;
    } else if (activeAttack) {
      const attackingSide = activeAttack.side;
      const defendingSide = opponentSide(attackingSide);
      const attackingTeam = teams[attackingSide];
      const defendingTeam = teams[defendingSide];
      const attackProfile = profiles[attackingSide];
      const defenceProfile = profiles[defendingSide];
      const attacker = activeAttack.finisher || chooseAttacker(attackingTeam, rng);
      const defender = chooseDefender(defendingTeam, rng);
      const attackAge = minute - activeAttack.startedAt;
      const redPenalty = redCards[defendingSide] * 0.055;
      currentSide = attackingSide;

      // A penalty can only follow an established attacking sequence and is
      // resolved on the next simulated minute. No unrelated event can jump in.
      const penaltyChance = attackAge >= 1
        ? clamp(0.012 + (attackProfile.attack - defenceProfile.defense) * 0.00008, 0.006, 0.025)
        : 0;

      if (minute < 90 && rng() < penaltyChance) {
        stats[defendingSide].fouls += 1;
        stats[attackingSide].penaltiesAwarded += 1;
        pendingPenalty = {
          side: attackingSide,
          taker: chooseAttacker(attackingTeam, rng),
          fouledPlayer: attacker,
          offender: defender
        };
        log = eventLog({
          minute,
          // Colour the event by the team of the player who committed the foul.
          side: defendingSide,
          type: 'penalty_awarded',
          actor: defender?.player?.name,
          target: attacker?.player?.name,
          text: `${defender?.player?.name || 'A defender'} brings down ${attacker?.player?.name || 'the attacker'} in the penalty area. Penalty awarded to ${teamLabel(attackingTeam)}.`,
          stats
        });
        activeAttack = null;
      } else {
        const cardChance = 0.028 + redPenalty * 0.04;
        const cardRoll = rng();
        if (cardRoll < cardChance) {
          const isRed = rng() < 0.075;
          if (isRed) {
            redCards[defendingSide] += 1;
            stats[defendingSide].redCards += 1;
          } else {
            yellowCards[defendingSide] += 1;
            stats[defendingSide].yellowCards += 1;
          }
          stats[defendingSide].fouls += 1;
          const type = isRed ? 'red_card' : 'yellow_card';
          log = eventLog({
            minute,
            side: defendingSide,
            type,
            actor: defender?.player?.name,
            text: `${defender?.player?.name || 'A defender'} receives a ${isRed ? 'red' : 'yellow'} card.`,
            stats
          });
          // Play restarts with the attacking side after the booking.
          activeAttack.remaining -= 1;
          if (activeAttack.remaining <= 0) activeAttack = null;
        } else {
          const defendChance = clamp(
            0.23 + (defenceProfile.defense - attackProfile.attack) * 0.0012 + redPenalty +
              botTendency(defendingTeam, 'defend'),
            0.14,
            0.48
          );
          if (rng() < defendChance) {
            stats[defendingSide].tackles += 1;
            stats[defendingSide].interceptions += 1;
            const contribution = contributionBucket(contributions, defendingSide, defender?.cardInstanceId);
            if (contribution) {
              contribution.tackles += 1;
              contribution.interceptions += 1;
            }
            log = eventLog({
              minute,
              side: defendingSide,
              type: 'defend',
              actor: defender?.player?.name,
              target: attacker?.player?.name,
              text: `${defender?.player?.name || 'A defender'} makes a successful defensive stop against ${attacker?.player?.name || 'the attacker'}.`,
              stats
            });
            activeAttack = null;
            possessionSide = defendingSide;
            currentSide = defendingSide;
          } else {
            const shotChance = clamp(
              0.105 + (attackProfile.attack - defenceProfile.defense) * 0.0015 + attackAge * 0.012 - redPenalty +
                botTendency(attackingTeam, 'shot'),
              0.035,
              0.24
            );
            if (rng() < shotChance) {
              stats[attackingSide].shots += 1;
              const contribution = contributionBucket(contributions, attackingSide, attacker?.cardInstanceId);
              if (contribution) contribution.shots += 1;
              const finishing = getStat(attacker, 'finishing', getMainStat(attacker, 'SHO'));
              const shotPower = getStat(attacker, 'shot_power', getMainStat(attacker, 'SHO'));
              const onTarget = rng() < clamp(0.27 + finishing / 240 + shotPower / 600, 0.34, 0.84);
              const goalkeeper = defendingTeam.players.find(player => player.slotPosition === 'GK');
              const reflexes = goalkeeper ? getStat(goalkeeper, 'reflexes', 70) : 65;
              const handling = goalkeeper ? getStat(goalkeeper, 'handling', 70) : 65;
              const goalChance = clamp(
                0.20 + (finishing - 70) * 0.003 + (shotPower - 70) * 0.0012 -
                  (reflexes - 70) * 0.0022 - (handling - 70) * 0.0011 - redPenalty,
                0.035,
                0.42
              );

              if (onTarget) {
                stats[attackingSide].shotsOnTarget += 1;
                if (rng() < goalChance) {
                  stats[attackingSide].goals += 1;
                  const assist = rng() < 0.68
                    ? chooseCreator(attackingTeam, attacker?.cardInstanceId, rng)
                    : null;
                  if (contribution) contribution.goals += 1;
                  const assistContribution = contributionBucket(contributions, attackingSide, assist?.cardInstanceId);
                  if (assistContribution) assistContribution.assists += 1;
                  log = eventLog({
                    minute,
                    side: attackingSide,
                    type: 'goal',
                    actor: attacker?.player?.name,
                    assist: assist?.player?.name || null,
                    text: `${attacker?.player?.name || 'The attacker'} scores${assist ? `, assisted by ${assist.player.name}` : ''}.`,
                    stats
                  });
                } else {
                  stats[defendingSide].saves += 1;
                  const saveContribution = contributionBucket(contributions, defendingSide, goalkeeper?.cardInstanceId);
                  if (saveContribution) saveContribution.saves += 1;
                }
              }
              // A shot ends this attacking phase whether it scores or not.
              activeAttack = null;
              possessionSide = defendingSide;
            } else {
              activeAttack.remaining -= 1;
              if (activeAttack.remaining <= 0 || minute === 90) {
                activeAttack = null;
                possessionSide = defendingSide;
              }
            }
          }
        }
      }
    } else {
      // Possession changes naturally when no attacking phase is active.
      const control = clamp(
        controlProbability + (redCards.away - redCards.home) * 0.018,
        0.30,
        0.70
      );
      currentSide = rng() < control ? 'home' : 'away';
      possessionSide = currentSide;

      const buildUpChance = minute < 90
        ? clamp(0.27 + botTendency(teams[currentSide], 'buildUp'), 0.12, 0.40)
        : 0;
      if (rng() < buildUpChance) {
        const team = teams[currentSide];
        const builder = chooseCreator(team, null, rng) || chooseAttacker(team, rng);
        const finisher = chooseAttacker(team, rng);
        stats[currentSide].passes += 2;
        stats[currentSide].passesCompleted += 2;
        const contribution = contributionBucket(contributions, currentSide, builder?.cardInstanceId);
        if (contribution) contribution.passes += 2;
        log = eventLog({
          minute,
          side: currentSide,
          type: 'build_up',
          actor: builder?.player?.name,
          text: `${builder?.player?.name || teamLabel(team)} starts a build-up.`,
          stats
        });
        activeAttack = {
          side: currentSide,
          startedAt: minute,
          remaining: 2 + Math.floor(rng() * 4),
          finisher
        };
      }
    }

    stats[currentSide].possession += 1;
    minuteScores.push(scoreSnapshot(stats, minute));
    if (log) logs.push(log);
    timeline.push({
      minute,
      event: log,
      score: { home: stats.home.goals, away: stats.away.goals }
    });
  }

  const totalPossession = stats.home.possession + stats.away.possession;
  stats.home.possession = totalPossession
    ? round((stats.home.possession / totalPossession) * 100, 1)
    : 50;
  stats.away.possession = round(100 - stats.home.possession, 1);
  for (const side of ['home', 'away']) {
    stats[side].passAccuracy = stats[side].passes
      ? round((stats[side].passesCompleted / stats[side].passes) * 100, 1)
      : 0;
  }

  for (const [side, opponent] of [['home', 'away'], ['away', 'home']]) {
    if (stats[opponent].goals === 0) {
      const goalkeeper = teams[side].players.find(player => player.slotPosition === 'GK');
      const contribution = contributionBucket(contributions, side, goalkeeper?.cardInstanceId);
      if (contribution) contribution.cleanSheets = 1;
    }
  }

  const winner = stats.home.goals > stats.away.goals
    ? 'home'
    : stats.away.goals > stats.home.goals ? 'away' : 'draw';

  return {
    duration: 90,
    homeScore: stats.home.goals,
    awayScore: stats.away.goals,
    winner,
    logs,
    events: logs,
    timeline,
    minuteScores,
    stats,
    playerContributions: contributions,
    profiles
  };
}

module.exports = {
  generateMatch,
  getTeamProfile,
  seededRandom,
  getMainStat,
  getStat
};
