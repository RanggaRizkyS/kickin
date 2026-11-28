const { getPool } = require('../db');
const config = require('../config');
const {
  FORMATIONS, safeJson, isPositionCompatible, estimatedOverall, round, clamp, pairKey
} = require('../utils/football');

function parsePlayerRow(row) {
  return {
    ...safeJson(row.raw_json, {}),
    id: row.player_id,
    overall: Number(row.overall),
    potential: Number(row.potential),
    rarity: row.rarity
  };
}

async function getSquadSnapshot(userId, conn = getPool()) {
  const squads = await conn.query('SELECT formation,squad_matches FROM user_squads WHERE user_id=? LIMIT 1', [userId]);
  if (!squads.length) throw new Error('Your squad has not been created. Run `/start` first.');
  const squad = squads[0];
  const formation = FORMATIONS[squad.formation] ? squad.formation : '4-3-3';
  const slots = FORMATIONS[formation];
  const rows = await conn.query(
    `SELECT ss.slot_key,c.card_instance_id,c.public_id,c.player_id,c.level,c.xp,c.current_stats_json,
      p.name,p.primary_position,p.overall,p.potential,p.nationality_json,p.positions_json,p.position_ratings_json,
      p.role_json,p.skills_json,p.stats_json,p.club_json,p.raw_json,p.rarity
     FROM squad_slots ss JOIN user_player_cards c ON c.card_instance_id=ss.card_instance_id
     JOIN players_catalog p ON p.player_id=c.player_id WHERE ss.user_id=?`, [userId]
  );
  const pairRows = await conn.query('SELECT card_a,card_b,matches_together FROM chemistry_pair_history WHERE user_id=?', [userId]);
  const pairCounts = new Map(pairRows.map(row => [`${row.card_a}|${row.card_b}`, Number(row.matches_together)]));
  const basePlayers = rows.map(row => {
    const player = parsePlayerRow(row);
    const slot = slots.find(item => item.key === row.slot_key);
    const slotPosition = slot?.label || row.slot_key;
    const currentStats = safeJson(row.current_stats_json, player.stats?.main || {});
    const card = { level: Number(row.level), currentStats };
    return {
      cardInstanceId: row.card_instance_id,
      publicId: row.public_id,
      playerId: row.player_id,
      slotKey: row.slot_key,
      slotPosition,
      player,
      level: Number(row.level),
      xp: Number(row.xp),
      currentStats,
      currentOvr: estimatedOverall(card, player, slotPosition),
      shirtNumber: Number(player.shirt_number || 0)
    };
  });

  const positionCategory = position => {
    if (position === 'GK') return 'GK';
    if (['LB','RB','CB','LWB','RWB'].includes(position)) return 'DEF';
    if (['CDM','CM','CAM','LM','RM'].includes(position)) return 'MID';
    return 'ATT';
  };
  const players = basePlayers.map((entry, index) => {
    const peers = basePlayers.filter((_, peerIndex) => peerIndex !== index);
    const same = (a, b, key) => Boolean(a?.[key] && b?.[key] && String(a[key]).toLowerCase() === String(b[key]).toLowerCase());
    const clubLinks = peers.filter(peer => same(entry.player.club, peer.player.club, 'id') || same(entry.player.club, peer.player.club, 'name')).length;
    const nationalityLinks = peers.filter(peer => same(entry.player.nationality, peer.player.nationality, 'country') || same(entry.player.nationality, peer.player.nationality, 'code')).length;
    const leagueLinks = peers.filter(peer => same(entry.player.club, peer.player.club, 'league')).length;
    const baseLinks = clubLinks + nationalityLinks + leagueLinks;
    const pairTotal = peers.reduce((sum, peer) => sum + (pairCounts.get(pairKey(entry.cardInstanceId, peer.cardInstanceId)) || 0), 0);
    // User-selected familiarity layer: repeated pair appearances and squad matches
    // progressively add chemistry links, while the public Soccer Guru link rules
    // remain the base calculation.
    const pairFamiliarityLinks = Math.min(3, Math.floor(pairTotal / 3));
    const squadFamiliarityLinks = Math.min(2, Math.floor(Number(squad.squad_matches) / 10));
    const positionCompatible = isPositionCompatible(entry.player, entry.slotPosition);
    const sameCategory = positionCategory(entry.player.positions?.primary) === positionCategory(entry.slotPosition);
    const effectiveLinks = baseLinks + pairFamiliarityLinks + squadFamiliarityLinks;

    let chemistryGrade = 'red';
    if (!sameCategory) chemistryGrade = 'red';
    else if (positionCompatible && effectiveLinks >= 5) chemistryGrade = 'green';
    else if (effectiveLinks >= 5) chemistryGrade = 'yellow';
    else if (positionCompatible && effectiveLinks >= 3) chemistryGrade = 'yellow';

    const chemistryPoints = chemistryGrade === 'green' ? 7 : chemistryGrade === 'yellow' ? 5 : 0;
    const individualChemistry = chemistryGrade === 'green' ? 100 : chemistryGrade === 'yellow' ? 65 : 0;
    return {
      ...entry,
      chemistry: individualChemistry,
      chemistryGrade,
      chemistryPoints,
      chemistryDetails: {
        clubLinks, nationalityLinks, leagueLinks, baseLinks,
        pairFamiliarityLinks, squadFamiliarityLinks, effectiveLinks,
        positionCompatible, sameCategory
      }
    };
  });
  const complete = players.length === 11 && slots.every(slot => players.some(player => player.slotKey === slot.key));
  const teamOvr = complete ? round(players.reduce((sum, player) => sum + player.currentOvr, 0) / 11, 3) : 0;
  const chemistryPoints = complete ? players.reduce((sum, player) => sum + Number(player.chemistryPoints || 0), 0) : 0;
  const teamChemistryGrade = chemistryPoints >= 62 ? 'green' : chemistryPoints >= 49 ? 'yellow' : 'red';
  const teamChemistry = complete ? round((chemistryPoints / 77) * 100, 3) : 0;
  const teamChemistryMultiplier = teamChemistryGrade === 'green' ? 1 : teamChemistryGrade === 'yellow' ? 0.95 : 0.88;
  for (const player of players) player.teamChemistryMultiplier = teamChemistryMultiplier;
  const teamStrength = complete ? round((teamOvr + teamChemistry) / 2, 3) : 0;
  return {
    userId: Number(userId), formation, squadMatches: Number(squad.squad_matches), players,
    teamOvr, teamChemistry, chemistryPoints, teamChemistryGrade, teamChemistryMultiplier, teamStrength, complete,
    missingSlots: slots.filter(slot => !players.some(player => player.slotKey === slot.key)).map(slot => slot.key)
  };
}

async function getAvailableCards(userId, conn = getPool()) {
  const rows = await conn.query(
    `SELECT c.card_instance_id,c.public_id,c.player_id,c.level,c.xp,c.current_stats_json,c.acquired_source,c.acquired_at,
      p.raw_json,p.rarity,p.overall,l.listing_id AS active_listing
     FROM user_player_cards c JOIN players_catalog p ON p.player_id=c.player_id
     LEFT JOIN squad_slots ss ON ss.card_instance_id=c.card_instance_id AND ss.user_id=c.user_id
     LEFT JOIN user_market_listings l ON l.card_instance_id=c.card_instance_id AND l.status='active'
     WHERE c.user_id=? AND ss.card_instance_id IS NULL AND l.listing_id IS NULL
     ORDER BY p.overall DESC,p.name ASC`, [userId]
  );
  return rows.map(row => {
    const player = safeJson(row.raw_json, {});
    const currentStats = safeJson(row.current_stats_json, {});
    return {
      cardInstanceId: row.card_instance_id, publicId: row.public_id, playerId: row.player_id,
      level: Number(row.level), xp: Number(row.xp), currentStats, rarity: row.rarity,
      currentOvr: estimatedOverall({ level: Number(row.level), currentStats }, player, player.positions?.primary),
      acquiredSource: row.acquired_source, acquiredAt: row.acquired_at, player
    };
  });
}

async function getOwnedCard(userId, cardReference, conn = getPool()) {
  const reference = String(cardReference ?? '').trim();
  if (!reference) return null;

  const selectSql = `
    SELECT c.card_instance_id,c.public_id,c.player_id,c.level,c.xp,c.current_stats_json,
      p.raw_json,p.rarity,p.overall,l.listing_id AS active_listing,
      ss.slot_key AS current_slot
    FROM user_player_cards c
    JOIN players_catalog p ON p.player_id=c.player_id
    LEFT JOIN user_market_listings l
      ON l.card_instance_id=c.card_instance_id AND l.status='active'
    LEFT JOIN squad_slots ss
      ON ss.card_instance_id=c.card_instance_id AND ss.user_id=c.user_id
    WHERE c.user_id=? AND %s
    ORDER BY (l.listing_id IS NULL) DESC,
      (ss.slot_key IS NULL) DESC,
      c.acquired_at ASC
    LIMIT 1`;

  // 1) Public Card ID or internal UUID. Prefer the public ID when both match.
  let rows = await conn.query(
    `SELECT c.card_instance_id,c.public_id,c.player_id,c.level,c.xp,c.current_stats_json,
      p.raw_json,p.rarity,p.overall,l.listing_id AS active_listing,ss.slot_key AS current_slot
     FROM user_player_cards c
     JOIN players_catalog p ON p.player_id=c.player_id
     LEFT JOIN user_market_listings l ON l.card_instance_id=c.card_instance_id AND l.status='active'
     LEFT JOIN squad_slots ss ON ss.card_instance_id=c.card_instance_id AND ss.user_id=c.user_id
     WHERE c.user_id=? AND (UPPER(c.public_id)=UPPER(?) OR UPPER(c.card_instance_id)=UPPER(?))
     ORDER BY (UPPER(c.public_id)=UPPER(?)) DESC LIMIT 1`,
    [userId, reference, reference, reference]
  );

  // 2) Compatibility: accept a catalog player_id when the user owns one or more copies.
  // The first available, unlisted copy is selected; duplicates remain independent cards.
  if (!rows.length) {
    rows = await conn.query(selectSql.replace('%s', 'UPPER(c.player_id)=UPPER(?)'), [userId, reference]);
  }

  // 3) Compatibility: exact player-name lookup for users who paste a name instead of an ID.
  if (!rows.length) {
    rows = await conn.query(selectSql.replace('%s', 'LOWER(p.name)=LOWER(?)'), [userId, reference]);
  }

  if (!rows.length) return null;
  const row = rows[0];
  const player = safeJson(row.raw_json, {});
  const currentStats = safeJson(row.current_stats_json, {});
  return {
    cardInstanceId: row.card_instance_id,
    publicId: row.public_id || row.card_instance_id,
    playerId: row.player_id,
    level: Number(row.level),
    xp: Number(row.xp),
    currentStats,
    rarity: row.rarity,
    player,
    isListed: !!row.active_listing,
    currentSlot: row.current_slot || null
  };
}

async function setSquadSlot(userId, slotKey, cardId) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const squadRows = await conn.query('SELECT formation FROM user_squads WHERE user_id=? FOR UPDATE', [userId]);
    if (!squadRows.length) throw new Error('Your squad has not been created. Run `/start` first.');
    const formation = squadRows[0].formation;
    const slot = FORMATIONS[formation].find(item => item.key === slotKey);
    if (!slot) throw new Error(`Slot ${slotKey} is not available in formation ${formation}.`);
    const owned = await getOwnedCard(userId, cardId, conn);
    if (!owned) throw new Error('That card is not in your collection. Select one of your own cards from the player picker.');
    if (owned.isListed) throw new Error('This card is currently listed on the User Market.');
    const actualCardId = owned.cardInstanceId;
    const goalKeeper = owned.player.stats?.type === 'goalkeeper';
    if ((slot.label === 'GK') !== goalKeeper) throw new Error(slot.label === 'GK' ? 'The GK slot only accepts a goalkeeper.' : 'A goalkeeper can only fill the GK slot.');

    const existingAtTarget = await conn.query('SELECT card_instance_id FROM squad_slots WHERE user_id=? AND slot_key=? FOR UPDATE', [userId, slotKey]);
    const existingLocation = await conn.query('SELECT slot_key FROM squad_slots WHERE user_id=? AND card_instance_id=? LIMIT 1 FOR UPDATE', [userId, actualCardId]);
    const oldTargetCard = existingAtTarget[0]?.card_instance_id || null;
    const oldPlayerSlot = existingLocation[0]?.slot_key || null;

    if (oldPlayerSlot && oldPlayerSlot !== slotKey) {
      // Move/swap atomically without temporarily violating uq_user_card.
      await conn.query('DELETE FROM squad_slots WHERE user_id=? AND slot_key IN (?,?)', [userId, oldPlayerSlot, slotKey]);
      if (oldTargetCard) {
        await conn.query('INSERT INTO squad_slots (user_id,slot_key,card_instance_id) VALUES (?,?,?)', [userId, oldPlayerSlot, oldTargetCard]);
      }
      await conn.query('INSERT INTO squad_slots (user_id,slot_key,card_instance_id) VALUES (?,?,?)', [userId, slotKey, actualCardId]);
    } else if (oldPlayerSlot === slotKey) {
      await conn.commit();
      return { changed: false, message: 'That player is already in this position.' };
    } else if (oldTargetCard) {
      await conn.query('UPDATE squad_slots SET card_instance_id=? WHERE user_id=? AND slot_key=?', [actualCardId, userId, slotKey]);
    } else {
      await conn.query('INSERT INTO squad_slots (user_id,slot_key,card_instance_id) VALUES (?,?,?)', [userId, slotKey, actualCardId]);
    }
    await conn.commit();
    return { changed: true, player: owned.player.name, slot: slotKey, replacedCardId: oldTargetCard };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function removeSquadSlot(userId, slotKey) {
  const result = await getPool().query('DELETE FROM squad_slots WHERE user_id=? AND slot_key=?', [userId, slotKey]);
  if (!result.affectedRows) throw new Error('That position is empty or could not be found.');
  return { removed: true };
}

async function setFormation(userId, nextFormation) {
  if (!FORMATIONS[nextFormation]) throw new Error('That formation is not valid.');
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const squadRows = await conn.query('SELECT formation FROM user_squads WHERE user_id=? FOR UPDATE', [userId]);
    if (!squadRows.length) throw new Error('Your squad has not been created.');
    const oldFormation = squadRows[0].formation;
    if (oldFormation === nextFormation) { await conn.commit(); return { changed: false, formation: nextFormation }; }
    const oldRows = await conn.query(
      `SELECT ss.slot_key,c.card_instance_id,c.player_id,p.raw_json
       FROM squad_slots ss JOIN user_player_cards c ON c.card_instance_id=ss.card_instance_id
       JOIN players_catalog p ON p.player_id=c.player_id WHERE ss.user_id=? FOR UPDATE`, [userId]
    );
    const roster = oldRows.map(row => ({ cardId: row.card_instance_id, player: safeJson(row.raw_json, {}) }));
    const slots = [...FORMATIONS[nextFormation]];
    const assignments = [];
    const remaining = [...roster];
    for (const slot of slots) {
      const isGk = slot.label === 'GK';
      const candidates = remaining.filter(entry => (entry.player.stats?.type === 'goalkeeper') === isGk);
      if (!candidates.length) continue;
      candidates.sort((a, b) => Number(b.player.position_ratings?.[slot.label] || b.player.overall) - Number(a.player.position_ratings?.[slot.label] || a.player.overall));
      const selected = candidates[0];
      assignments.push({ slotKey: slot.key, cardId: selected.cardId });
      remaining.splice(remaining.indexOf(selected), 1);
    }
    await conn.query('DELETE FROM squad_slots WHERE user_id=?', [userId]);
    for (const assignment of assignments) {
      await conn.query('INSERT INTO squad_slots (user_id,slot_key,card_instance_id) VALUES (?,?,?)', [userId, assignment.slotKey, assignment.cardId]);
    }
    await conn.query('UPDATE user_squads SET formation=? WHERE user_id=?', [nextFormation, userId]);
    await conn.commit();
    return { changed: true, formation: nextFormation, reassigned: assignments.length };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function getPlayerAutocomplete(userId, query = '', includeSquad = true) {
  const clauses = ['c.user_id=?'];
  const params = [userId];
  if (!includeSquad) clauses.push('ss.card_instance_id IS NULL');
  clauses.push('ml.listing_id IS NULL');
  if (query) {
    clauses.push('(p.name LIKE ? OR c.public_id LIKE ?)');
    params.push(`%${String(query).slice(0, 40)}%`, `%${String(query).slice(0, 40)}%`);
  }
  const rows = await getPool().query(
    `SELECT c.card_instance_id,COALESCE(c.public_id,c.card_instance_id) AS public_id,c.player_id,c.level,p.name,p.overall,p.primary_position,ss.slot_key
     FROM user_player_cards c
     JOIN players_catalog p ON p.player_id=c.player_id
     LEFT JOIN squad_slots ss ON ss.card_instance_id=c.card_instance_id AND ss.user_id=c.user_id
     LEFT JOIN user_market_listings ml ON ml.card_instance_id=c.card_instance_id AND ml.status='active'
     WHERE ${clauses.join(' AND ')}
     ORDER BY p.overall DESC,p.name,c.acquired_at ASC
     LIMIT 25`,
    params
  );
  const copies = new Map();
  return rows.map(row => {
    const copyNumber = (copies.get(row.player_id) || 0) + 1;
    copies.set(row.player_id, copyNumber);
    const copySuffix = copyNumber > 1 ? ` · Copy ${copyNumber}` : '';
    const publicReference = String(row.public_id || row.card_instance_id);
    return {
      name: `${publicReference} · ${row.name} · ${row.overall} OVR · ${row.primary_position} · Lv.${row.level}${copySuffix}`.slice(0, 100),
      // Public Card ID is unique per owned copy. The database UUID remains
      // private and getOwnedCard resolves the public reference transactionally.
      value: publicReference
    };
  });
}

module.exports = { getSquadSnapshot, getAvailableCards, getOwnedCard, setSquadSlot, removeSquadSlot, setFormation, getPlayerAutocomplete };
