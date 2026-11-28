'use strict';

const crypto = require('node:crypto');

const POSITION_ALIASES = {
  LS: 'ST', RS: 'ST', LST: 'ST', RST: 'ST', CF: 'CF', LF: 'CF', RF: 'CF',
  LAM: 'CAM', RAM: 'CAM', LCM: 'CM', RCM: 'CM', LDM: 'CDM', RDM: 'CDM',
  LWB: 'LB', RWB: 'RB', LCB: 'CB', RCB: 'CB'
};
const POSITION_RATING_COLUMNS = [
  'st','cf','lw','rw','lm','rm','cam','cm','cdm','cb','lb','rb','lwb','rwb',
  'ls','rs','lf','rf','lam','ram','lcm','rcm','ldm','rdm','lcb','rcb','gk'
];

function get(row, ...keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value).trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[;,|]/).map(value => value.trim()).filter(Boolean);
}

function cleanId(value, fallbackText) {
  const source = value === null || value === undefined || String(value).trim() === ''
    ? null
    : String(value).trim();
  if (source) {
    const safe = source.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    if (safe) return `EA26-${safe}`.slice(0, 32);
  }
  // Never truncate a player name into an ID: that causes collisions for names
  // sharing the same prefix. A SHA-1 digest of stable identity fields is deterministic.
  return `EA26-${crypto.createHash('sha1').update(String(fallbackText)).digest('hex').slice(0, 24)}`;
}

function parsePositionRating(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/^-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(99, Math.round(parsed))) : null;
}

function normalisePosition(position) {
  const upper = text(position).toUpperCase();
  return POSITION_ALIASES[upper] || upper;
}

function estimatePositionRatings(main, detailed, isGoalkeeper) {
  if (isGoalkeeper) {
    const gkAverage = ['PAC','SHO','PAS','DRI','DEF','PHY']
      .reduce((sum, key) => sum + num(main[key]), 0) / 6;
    return { GK: Math.round(gkAverage) };
  }

  const attr = (key, fallback) => num(detailed[key], num(fallback));
  const values = {
    acceleration: attr('movement_acceleration', main.PAC),
    sprint: attr('movement_sprint_speed', main.PAC),
    finishing: attr('attacking_finishing', main.SHO),
    positioning: attr('attacking_positioning', main.SHO),
    shotPower: attr('power_shot_power', main.SHO),
    longShots: attr('attacking_long_shots', main.SHO),
    crossing: attr('attacking_crossing', main.PAS),
    shortPassing: attr('skill_short_passing', main.PAS),
    longPassing: attr('skill_long_passing', main.PAS),
    vision: attr('mentality_vision', main.PAS),
    dribbling: attr('skill_dribbling', main.DRI),
    ballControl: attr('skill_ball_control', main.DRI),
    agility: attr('movement_agility', main.DRI),
    reactions: attr('movement_reactions', main.DRI),
    defensiveAwareness: attr('defending_defensive_awareness', main.DEF),
    interceptions: attr('mentality_interceptions', main.DEF),
    standingTackle: attr('defending_standing_tackle', main.DEF),
    strength: attr('power_strength', main.PHY),
    stamina: attr('power_stamina', main.PHY),
    aggression: attr('mentality_aggression', main.PHY),
    heading: attr('attacking_heading_accuracy', main.PHY),
    jumping: attr('power_jumping', main.PHY)
  };
  const weighted = entries => Math.round(entries.reduce((sum, [key, weight]) => sum + values[key] * weight, 0));
  return {
    ST: weighted([['finishing',.25],['positioning',.20],['shotPower',.12],['reactions',.10],['sprint',.10],['dribbling',.08],['strength',.08],['heading',.07]]),
    CF: weighted([['finishing',.18],['positioning',.16],['vision',.14],['shortPassing',.12],['ballControl',.12],['dribbling',.10],['reactions',.10],['shotPower',.08]]),
    LW: weighted([['acceleration',.12],['sprint',.12],['dribbling',.18],['ballControl',.14],['agility',.10],['crossing',.10],['shortPassing',.08],['finishing',.08],['vision',.08]]),
    RW: weighted([['acceleration',.12],['sprint',.12],['dribbling',.18],['ballControl',.14],['agility',.10],['crossing',.10],['shortPassing',.08],['finishing',.08],['vision',.08]]),
    LM: weighted([['acceleration',.10],['sprint',.08],['crossing',.16],['shortPassing',.14],['dribbling',.12],['ballControl',.10],['stamina',.10],['vision',.10],['defensiveAwareness',.10]]),
    RM: weighted([['acceleration',.10],['sprint',.08],['crossing',.16],['shortPassing',.14],['dribbling',.12],['ballControl',.10],['stamina',.10],['vision',.10],['defensiveAwareness',.10]]),
    CAM: weighted([['vision',.18],['shortPassing',.14],['dribbling',.14],['ballControl',.12],['longShots',.10],['positioning',.10],['reactions',.08],['agility',.08],['finishing',.06]]),
    CM: weighted([['shortPassing',.15],['longPassing',.10],['vision',.14],['ballControl',.10],['stamina',.10],['interceptions',.10],['defensiveAwareness',.10],['reactions',.08],['dribbling',.07],['longShots',.06]]),
    CDM: weighted([['interceptions',.18],['defensiveAwareness',.18],['standingTackle',.15],['strength',.10],['stamina',.10],['aggression',.08],['shortPassing',.09],['longPassing',.07],['reactions',.05]]),
    CB: weighted([['defensiveAwareness',.22],['standingTackle',.18],['interceptions',.15],['strength',.12],['sprint',.08],['jumping',.07],['heading',.06],['reactions',.07],['aggression',.05]]),
    LB: weighted([['defensiveAwareness',.13],['standingTackle',.10],['interceptions',.08],['sprint',.12],['acceleration',.10],['crossing',.12],['stamina',.10],['shortPassing',.08],['dribbling',.07],['strength',.05],['agility',.05]]),
    RB: weighted([['defensiveAwareness',.13],['standingTackle',.10],['interceptions',.08],['sprint',.12],['acceleration',.10],['crossing',.12],['stamina',.10],['shortPassing',.08],['dribbling',.07],['strength',.05],['agility',.05]]),
    LWB: weighted([['sprint',.12],['acceleration',.10],['crossing',.14],['stamina',.12],['dribbling',.10],['shortPassing',.10],['defensiveAwareness',.10],['standingTackle',.10],['agility',.06],['strength',.06]]),
    RWB: weighted([['sprint',.12],['acceleration',.10],['crossing',.14],['stamina',.12],['dribbling',.10],['shortPassing',.10],['defensiveAwareness',.10],['standingTackle',.10],['agility',.06],['strength',.06]])
  };
}

function deriveRole(position, main, detailed) {
  const pace = num(main.PAC), shooting = num(main.SHO), passing = num(main.PAS);
  const dribbling = num(main.DRI), defending = num(main.DEF), physical = num(main.PHY);
  const finishing = num(detailed.attacking_finishing, shooting);
  const vision = num(detailed.mentality_vision, passing);
  const strength = num(detailed.power_strength, physical);
  const interception = num(detailed.mentality_interceptions, defending);

  if (position === 'GK') return {
    id: 'goalkeeper', name: 'Goalkeeper', source: 'derived-from-position'
  };
  if (['ST','CF'].includes(position)) {
    if (strength >= 84 && pace < 75) return { id: 'target_forward', name: 'Target Forward', source: 'derived-from-attributes' };
    if (pace >= 88 && finishing >= 78) return { id: 'advanced_forward', name: 'Advanced Forward', source: 'derived-from-attributes' };
    return { id: 'poacher', name: 'Poacher', source: 'derived-from-position' };
  }
  if (['LW','RW','LM','RM'].includes(position)) {
    return { id: dribbling >= 84 ? 'wide_dribbler' : 'wide_playmaker', name: dribbling >= 84 ? 'Wide Dribbler' : 'Wide Playmaker', source: 'derived-from-attributes' };
  }
  if (['CAM'].includes(position)) return { id: 'hole_player', name: 'Hole Player', source: 'derived-from-position' };
  if (['CDM'].includes(position)) return { id: 'destroyer', name: 'The Destroyer', source: 'derived-from-position' };
  if (['CM'].includes(position)) {
    if (defending >= 75 && passing >= 75) return { id: 'box_to_box', name: 'Box-to-Box', source: 'derived-from-attributes' };
    return { id: vision >= 80 ? 'orchestrator' : 'build_up', name: vision >= 80 ? 'Orchestrator' : 'Build Up', source: 'derived-from-attributes' };
  }
  if (['CB'].includes(position)) return { id: passing >= 75 ? 'build_up_cb' : 'destroyer_cb', name: passing >= 75 ? 'Build Up' : 'The Destroyer', source: 'derived-from-attributes' };
  if (['LB','RB','LWB','RWB'].includes(position)) return { id: pace >= 82 ? 'offensive_fullback' : 'defensive_fullback', name: pace >= 82 ? 'Offensive Fullback' : 'Defensive Fullback', source: 'derived-from-attributes' };
  return { id: 'balanced', name: 'Balanced', source: 'derived-from-position' };
}

function buildSkills(row, main, detailed) {
  const styles = splitList(get(row, 'playstyles', 'play_styles', 'skill_names')); // Only use explicitly named playstyles/skills.
  const unique = [...new Set(styles)].slice(0, 5).map(value => ({
    id: value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36),
    name: value.replace(/\+/g, ' +'),
    description: 'EA FC player playstyle.'
  }));
  if (unique.length) return unique;

  const inferred = [];
  if (num(main.PAC) >= 88) inferred.push('Speedster');
  if (num(main.DRI) >= 86) inferred.push('Dribbler');
  if (num(main.PAS) >= 84) inferred.push('Good Passer');
  if (num(main.SHO) >= 84) inferred.push('Clinical Finisher');
  if (num(main.DEF) >= 84) inferred.push('Defensive Specialist');
  if (num(detailed.goalkeeping_reflexes) >= 84) inferred.push('Shot Stopper');
  return inferred.slice(0, 5).map(value => ({
    id: value.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    name: value,
    description: 'Derived from the player attribute profile.'
  }));
}

function normalizeEafc26Record(row) {
  const sourceId = get(row, 'player_id', 'id', 'sofifa_id', 'ea_id');
  const shortName = get(row, 'short_name', 'common_name', 'name');
  const longName = get(row, 'long_name', 'full_name', 'name', 'short_name');
  const displayName = text(shortName || longName, 'Unknown Player');
  const positionsRaw = splitList(get(row, 'player_positions', 'positions', 'position'));
  const positions = positionsRaw.map(normalisePosition);
  const primary = positions[0] || normalisePosition(get(row, 'club_position', 'position')) || 'CM';
  const isGoalkeeper = primary === 'GK';
  const overall = Math.max(1, Math.min(99, Math.round(num(get(row, 'overall', 'overall_rating', 'ovr'), 60))));
  const potential = Math.max(overall, Math.min(99, Math.round(num(get(row, 'potential'), overall))));

  const gk = {
    diving: num(get(row, 'goalkeeping_diving', 'gk_diving'), 1),
    handling: num(get(row, 'goalkeeping_handling', 'gk_handling'), 1),
    kicking: num(get(row, 'goalkeeping_kicking', 'gk_kicking'), 1),
    reflexes: num(get(row, 'goalkeeping_reflexes', 'gk_reflexes'), 1),
    speed: num(get(row, 'goalkeeping_speed', 'gk_speed'), 1),
    positioning: num(get(row, 'goalkeeping_positioning', 'gk_positioning'), 1)
  };
  const main = isGoalkeeper ? {
    PAC: gk.diving, SHO: gk.handling, PAS: gk.kicking,
    DRI: gk.reflexes, DEF: gk.speed, PHY: gk.positioning
  } : {
    PAC: num(get(row, 'pace'), 1),
    SHO: num(get(row, 'shooting'), 1),
    PAS: num(get(row, 'passing'), 1),
    DRI: num(get(row, 'dribbling'), 1),
    DEF: num(get(row, 'defending'), 1),
    PHY: num(get(row, 'physic', 'physicality'), 1)
  };

  const detailed = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || value === '') continue;
    if (/^(attacking_|skill_|movement_|power_|mentality_|defending_|goalkeeping_)/.test(key)) {
      const parsed = num(value, NaN);
      if (Number.isFinite(parsed)) detailed[key] = parsed;
    }
  }
  if (isGoalkeeper) Object.assign(detailed, {
    goalkeeping_diving: gk.diving,
    goalkeeping_handling: gk.handling,
    goalkeeping_kicking: gk.kicking,
    goalkeeping_reflexes: gk.reflexes,
    goalkeeping_speed: gk.speed,
    goalkeeping_positioning: gk.positioning
  });

  const positionRatings = estimatePositionRatings(main, detailed, isGoalkeeper);
  const sourceRatedPositions = new Set();
  // If source-supplied position ratings exist, they take precedence over the
  // Joko-derived estimate. If none exists for the primary position, use the
  // dataset OVR as its authoritative primary-position rating.
  for (const key of POSITION_RATING_COLUMNS) {
    const value = parsePositionRating(row[key]);
    if (value !== null) {
      const normalized = normalisePosition(key);
      positionRatings[normalized] = value;
      sourceRatedPositions.add(normalized);
    }
  }
  if (!sourceRatedPositions.has(primary)) positionRatings[primary] = overall;
  for (const [position, value] of Object.entries(positionRatings)) {
    positionRatings[position] = Math.max(40, Math.min(99, Math.round(Number(value) || overall)));
  }

  const nationalityName = text(get(row, 'nationality_name', 'nationality', 'country'), 'Unknown');
  const clubName = text(get(row, 'club_name', 'club', 'team_name'), 'Free Agent');
  const leagueName = text(get(row, 'league_name', 'league'), 'Unknown League');
  const clubId = text(get(row, 'club_team_id', 'club_id', 'team_id'), clubName);
  const age = num(get(row, 'age'), null);
  const valueEur = num(get(row, 'value_eur', 'market_value_eur', 'market_value'), 0);
  const identityFallback = [longName, displayName, nationalityName, text(get(row, 'dob', 'birth_date')), clubId, primary, age].join('|');
  const id = cleanId(sourceId, identityFallback);
  const traits = splitList(get(row, 'player_traits', 'traits')); // Preserve source traits separately from Joko's derived skills.

  const player = {
    id,
    source_player_id: sourceId === null || sourceId === undefined || String(sourceId).trim() === '' ? id : String(sourceId).trim(),
    source: 'EAFC26-DataHub',
    name: displayName,
    full_name: text(longName, displayName),
    nationality: {
      country: nationalityName,
      code: text(get(row, 'nationality_code', 'nation_code'), nationalityName.slice(0, 3).toUpperCase()),
      nationality_id: num(get(row, 'nationality_id'), null)
    },
    age,
    birth_date: text(get(row, 'dob', 'birth_date')) || null,
    height_cm: num(get(row, 'height_cm', 'height'), null),
    weight_kg: num(get(row, 'weight_kg', 'weight'), null),
    strong_foot: text(get(row, 'preferred_foot'), 'Right'),
    weak_foot_rating: num(get(row, 'weak_foot'), 3),
    skill_moves: num(get(row, 'skill_moves'), 2),
    shirt_number: num(get(row, 'club_jersey_number', 'shirt_number'), 0),
    positions: {
      primary,
      secondary: [...new Set(positions.filter(position => position !== primary))],
      familiarity: Object.fromEntries(positions.map(position => [position, 'natural']))
    },
    overall,
    potential,
    position_ratings: positionRatings,
    role: deriveRole(primary, main, detailed),
    skills: buildSkills(row, main, detailed),
    work_rates: {
      attacking: text(get(row, 'work_rate')).split('/')[0]?.trim() || 'Medium',
      defensive: text(get(row, 'work_rate')).split('/')[1]?.trim() || 'Medium'
    },
    stats: {
      type: isGoalkeeper ? 'goalkeeper' : 'outfield',
      main,
      ...(isGoalkeeper ? { goalkeeper: { ...gk, ...detailed } } : { outfield: detailed })
    },
    traits,
    development: { growth_remaining: Math.max(0, potential - overall), development_rate: 'normal', preferred_training: primary },
    club: {
      id: clubId,
      name: clubName,
      league: leagueName,
      league_id: num(get(row, 'league_id'), null),
      is_fictional: false
    },
    contract: {
      expires_year: num(get(row, 'club_contract_valid_until_year'), null),
      weekly_wage_eur: num(get(row, 'wage_eur'), 0)
    },
    market_value_eur: valueEur,
    player_face_url: text(get(row, 'player_face_url', 'face_url')) || null,
    game_state: { fitness: 100, morale: 70, form: 50, sharpness: 80, suspension_matches: 0, injury: null },
    source_raw: row
  };

  return player;
}

module.exports = { normalizeEafc26Record, parsePositionRating, normalisePosition, estimatePositionRatings };
