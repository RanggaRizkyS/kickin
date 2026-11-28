'use strict';

const { FORMATIONS, randomInt } = require('../utils/football');

function selectStarterPlayersFromCatalog(catalog, rng = Math.random) {
  if (!Array.isArray(catalog) || catalog.length < 11) {
    throw new Error('The EAFC26 catalog does not contain enough players for a starter squad.');
  }

  const slots = FORMATIONS['4-3-3'];
  const used = new Set();
  const selected = [];
  const targetRating = 64;

  for (const slot of slots) {
    const preferred = slot.label;
    const wantsKeeper = preferred === 'GK';
    const eligible = catalog.filter(player => {
      if (used.has(player.id)) return false;
      const isKeeper = player.stats?.type === 'goalkeeper';
      if (isKeeper !== wantsKeeper) return false;
      const native = player.positions?.primary === preferred ||
        (player.positions?.secondary || []).includes(preferred);
      const positional = Number(player.position_ratings?.[preferred] || 0);
      return native || positional >= 72;
    });

    if (!eligible.length) {
      throw new Error(`No EAFC26 player is eligible for the starter position ${preferred}.`);
    }

    // New clubs begin with modest cards, not the highest-rated players in the
    // entire catalog. This keeps the intended long-term progression meaningful.
    const modest = eligible.filter(player => Number(player.overall) >= 60 && Number(player.overall) <= 70);
    const pool = modest.length ? modest : eligible;
    const ranked = pool.map(player => {
      const rating = Number(player.position_ratings?.[preferred] || player.overall || 60);
      const score = Math.abs(rating - targetRating) + Math.abs(Number(player.overall) - targetRating) * 0.25;
      return { player, score };
    }).sort((a, b) => a.score - b.score || a.player.name.localeCompare(b.player.name));

    // A small top band introduces variety while keeping starter strength similar.
    const shortlist = ranked.slice(0, Math.min(24, ranked.length));
    const chosen = shortlist[randomInt(0, shortlist.length - 1, rng)];
    used.add(chosen.player.id);
    selected.push({ slotKey: slot.key, player: chosen.player });
  }

  return selected;
}

module.exports = { selectStarterPlayersFromCatalog };
