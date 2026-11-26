const { FORMATIONS, clamp, round, randomInt } = require('../utils/football');

const BOT_NAME_RANGES = [
  {
    min: 0,
    max: 399,
    names: [
      'Joko Kodok', 'Udin Kacang', 'Bowo Kerupuk', 'Tono Offside', 'Darto Kiper',
      'Mamat Nyangkut', 'Rudi Tiang', 'Agus Sepatu', 'Komeng Gelandang', 'Pardi Ngantuk',
      'Tegar Sendal', 'Wawan Jaring', 'Rojak Penalti', 'Dede Bek'
    ]
  },
  {
    min: 400,
    max: 799,
    names: [
      'Dimas Taktik', 'Rio Tendangan', 'Fajar Crossing', 'Raka Bek Kiri', 'Asep Penjaga',
      'Seno Lapangan', 'Beni Sprint', 'Yudha Sayap', 'Gilang Umpan', 'Niko Press',
      'Farhan Corner', 'Reza Striker', 'Bayu Dribble', 'Irfan Volley'
    ]
  },
  {
    min: 800,
    max: 1199,
    names: [
      'Bagas Maestro', 'Nando Striker', 'Bima Playmaker', 'Rizky Counter', 'Ardi Pressing',
      'Vino Finisher', 'Rafi Maestro', 'Aldi Box-to-Box', 'Kevin Winger', 'Daffa Anchor',
      'Rendy Runner', 'Mikael Tempo', 'Ilham Sweeper', 'Yoga Targetman'
    ]
  },
  {
    min: 1200,
    max: 1599,
    names: [
      'Arga Taktikus', 'Rafael Goal', 'Marco Maestro', 'Kenji Captain', 'Dion Strategist',
      'Julian Varela', 'Bruno Castan', 'Thiago Moretti', 'Satria Mahendra', 'Enzo Rinaldi',
      'Malik Hassan', 'Hugo Laurent', 'Paulo Esteves', 'Noah Bennett'
    ]
  },
  {
    min: 1600,
    max: 2000,
    names: [
      'Sultan Pitch', 'Lord Taktikus', 'Raja Lapangan', 'The Professor', 'El Supremo',
      'Don Veloz', 'Sir Striker', 'Capitano Nero', 'El Matador', 'Maestro Azul',
      'Kaiser North', 'Valerio Forte', 'Magnus Eleven', 'Zlatanovic Jr'
    ]
  }
];

const ALL_BOT_NAMES = BOT_NAME_RANGES.flatMap(range => range.names);

function botManagerNameForStrength(strength, rng = Math.random) {
  const power = clamp(Math.round(Number(strength || 0) * 20), 0, 2000);
  const range = BOT_NAME_RANGES.find(item => power >= item.min && power <= item.max)
    || BOT_NAME_RANGES[BOT_NAME_RANGES.length - 1];
  return {
    name: range.names[Math.floor(rng() * range.names.length)],
    power,
    range: `${range.min}-${range.max}`
  };
}

function positionRating(player, position) {
  return Number(player.position_ratings?.[position] ?? player.overall ?? 60);
}

function shuffle(values, rng) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function centeredRatings(mean, count, rng, amplitude = 9) {
  let values = Array.from({ length: count }, () => (rng() - 0.5) * amplitude * 2);
  for (let pass = 0; pass < 5; pass += 1) {
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    values = values.map(value => clamp(mean + value - average, 60, 95) - mean);
  }
  return values.map(value => clamp(mean + value, 60, 95));
}

function makeRatingTargets(targetMean, rng) {
  const mean = clamp(Number(targetMean), 60, 95);
  const totalBudgetAbove60 = (mean - 60) * 11;
  const maxStars = Math.min(4, Math.floor(totalBudgetAbove60 / 30));
  const starCount = maxStars > 0 ? randomInt(1, maxStars, rng) : 0;
  const stars = [];

  for (let index = 0; index < starCount; index += 1) {
    stars.push(randomInt(89, 95, rng));
  }

  while (stars.length && stars.reduce((sum, value) => sum + value, 0) + (11 - stars.length) * 60 > mean * 11) {
    stars.pop();
  }

  const remainingCount = 11 - stars.length;
  const remainingMean = remainingCount
    ? (mean * 11 - stars.reduce((sum, value) => sum + value, 0)) / remainingCount
    : 60;
  const remaining = centeredRatings(remainingMean, remainingCount, rng, Math.min(12, 5 + (mean - 60) * 0.10));
  return shuffle([...stars, ...remaining], rng);
}

function buildCandidateLineup(slots, catalog, targetRatings, rng) {
  const used = new Set();
  const players = [];
  const slotOrder = shuffle(slots.map((slot, index) => ({ slot, index })), rng);

  for (const { slot, index } of slotOrder) {
    const isGoalkeeper = slot.label === 'GK';
    const desired = targetRatings[index];
    const candidates = catalog.filter(player =>
      !used.has(player.id) &&
      ((player.stats?.type === 'goalkeeper') === isGoalkeeper) &&
      positionRating(player, slot.label) >= 60
    );

    if (!candidates.length) return null;

    const ranked = candidates
      .map(player => ({
        player,
        rating: positionRating(player, slot.label),
        score: Math.abs(positionRating(player, slot.label) - desired) + rng() * 3.5
      }))
      .sort((a, b) => a.score - b.score);

    // Pick among the closest few rather than always taking the same best card.
    const shortlist = ranked.slice(0, Math.min(9, ranked.length));
    const selected = shortlist[randomInt(0, shortlist.length - 1, rng)];
    used.add(selected.player.id);
    players.push({
      cardInstanceId: `BOT-${selected.player.id}-${slot.key}`,
      playerId: selected.player.id,
      slotKey: slot.key,
      slotPosition: slot.label,
      player: selected.player,
      level: 1,
      xp: 0,
      currentStats: selected.player.stats?.type === 'goalkeeper'
        ? (selected.player.stats?.goalkeeper || {})
        : (selected.player.stats?.main || {}),
      currentOvr: selected.rating,
      shirtNumber: Number(selected.player.shirt_number || index + 1),
      chemistry: 0,
      chemistryDetails: { generated: true }
    });
  }

  const bySlot = new Map(players.map(player => [player.slotKey, player]));
  return slots.map(slot => bySlot.get(slot.key));
}

function buildBotSquadFromCatalog(targetTeam, catalog, options = {}) {
  if (!Array.isArray(catalog) || catalog.length < 11) {
    throw new Error('The bot squad builder requires a player catalog with at least 11 players.');
  }

  const rng = options.rng || Math.random;
  const userStrength = Number(targetTeam.teamStrength ?? targetTeam ?? 50);
  const desiredStrength = clamp(userStrength + (randomInt(-200, 200, rng) / 100), 30, 97.5);
  const userChemistry = Number(targetTeam.teamChemistry ?? 0);
  const initialChemistry = clamp(userChemistry + randomInt(-2, 2, rng), 0, 100);
  const desiredOvr = clamp((desiredStrength * 2) - initialChemistry, 60, 95);
  const manager = options.botName
    ? { ...botManagerNameForStrength(userStrength, rng), name: options.botName }
    : botManagerNameForStrength(userStrength, rng);

  let best = null;
  const formations = Object.keys(FORMATIONS);
  const attempts = Math.max(80, Number(options.attempts) || 180);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const formation = formations[randomInt(0, formations.length - 1, rng)];
    const slots = FORMATIONS[formation];
    const targets = makeRatingTargets(desiredOvr, rng);
    const players = buildCandidateLineup(slots, catalog, targets, rng);
    if (!players) continue;

    const teamOvr = round(players.reduce((sum, player) => sum + player.currentOvr, 0) / 11, 3);
    const teamStrengthWithInitialChem = round((teamOvr + initialChemistry) / 2, 3);
    const ratingValues = players.map(player => player.currentOvr);
    const spread = Math.max(...ratingValues) - Math.min(...ratingValues);
    const standardDeviation = Math.sqrt(
      ratingValues.reduce((sum, value) => sum + ((value - teamOvr) ** 2), 0) / ratingValues.length
    );
    const strengthDiff = Math.abs(teamStrengthWithInitialChem - desiredStrength);
    const score = strengthDiff * 100 - Math.min(standardDeviation, 13) * 0.12 - Math.min(spread, 35) * 0.015;

    if (!best || score < best.score) {
      best = { formation, players, teamOvr, strengthDiff, score, spread };
    }
  }

  if (!best) throw new Error('The bot squad builder could not assemble a valid eleven-player squad.');

  // If positional ratings make the initial chemistry target slightly miss,
  // tune the bot's generated familiarity to keep Team Strength within range.
  let botChemistry = initialChemistry;
  let teamStrength = round((best.teamOvr + botChemistry) / 2, 3);
  if (Math.abs(teamStrength - userStrength) > 2) {
    const requiredChemistry = clamp((desiredStrength * 2) - best.teamOvr, 0, 100);
    botChemistry = round(requiredChemistry, 2);
    teamStrength = round((best.teamOvr + botChemistry) / 2, 3);
  }

  for (const player of best.players) player.chemistry = botChemistry;
  const personality = ['possession', 'direct_play', 'wide_play', 'adaptive_press'][randomInt(0, 3, rng)];

  return {
    userId: null,
    username: manager.name,
    formation: best.formation,
    players: best.players,
    teamOvr: best.teamOvr,
    teamChemistry: botChemistry,
    teamStrength,
    complete: true,
    isBot: true,
    botPersonality: personality,
    botPower: manager.power,
    botPowerRange: manager.range,
    ratingSpread: best.spread
  };
}

module.exports = {
  BOT_NAME_RANGES,
  ALL_BOT_NAMES,
  botManagerNameForStrength,
  buildBotSquadFromCatalog
};
