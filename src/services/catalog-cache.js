'use strict';

const { getPool } = require('../db');
const { safeJson } = require('../utils/football');

let catalogPromise = null;

function gamePlayerView(raw) {
  const player = safeJson(raw, null);
  if (!player || !player.id || !player.name || !player.stats?.main) return null;

  // Keep only gameplay-facing data in memory. The complete EAFC source record
  // remains in players_catalog.raw_json and is not duplicated in this cache.
  return {
    id: String(player.id),
    source_player_id: player.source_player_id || null,
    source: player.source || 'EAFC26-DataHub',
    name: String(player.name),
    full_name: player.full_name || player.name,
    nationality: player.nationality || { country: 'Unknown', code: 'UNK' },
    age: player.age ?? null,
    birth_date: player.birth_date || null,
    height_cm: player.height_cm ?? null,
    weight_kg: player.weight_kg ?? null,
    strong_foot: player.strong_foot || 'Right',
    weak_foot_rating: Number(player.weak_foot_rating || 3),
    skill_moves: Number(player.skill_moves || 2),
    shirt_number: Number(player.shirt_number || 0),
    positions: player.positions || { primary: 'CM', secondary: [], familiarity: {} },
    overall: Number(player.overall || 1),
    potential: Number(player.potential || player.overall || 1),
    position_ratings: player.position_ratings || {},
    role: player.role || { id: 'balanced', name: 'Balanced', source: 'derived' },
    skills: Array.isArray(player.skills) ? player.skills.slice(0, 5) : [],
    traits: Array.isArray(player.traits) ? player.traits : [],
    work_rates: player.work_rates || { attacking: 'Medium', defensive: 'Medium' },
    stats: player.stats,
    development: player.development || {},
    club: {
      ...(player.club || { id: 'free-agent', name: 'Free Agent', league: 'Unknown League' }),
      league_id: player.club?.league_id ?? player.source_raw?.league_id ?? null
    },
    contract: player.contract || {},
    market_value_eur: Number(player.market_value_eur || 0),
    player_face_url: player.player_face_url || null
  };
}

async function getGameCatalog(conn = getPool()) {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const rows = await conn.query(
        "SELECT raw_json FROM players_catalog WHERE catalog_source='eafc26' ORDER BY player_id"
      );
      const players = rows.map(row => gamePlayerView(row.raw_json)).filter(Boolean);
      if (players.length < 10000) {
        throw new Error(`EAFC26 game catalog is incomplete: expected 10,000+ players, found ${players.length}.`);
      }
      return players;
    })().catch(error => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

function clearGameCatalogCache() {
  catalogPromise = null;
}

module.exports = { getGameCatalog, clearGameCatalogCache, gamePlayerView };
