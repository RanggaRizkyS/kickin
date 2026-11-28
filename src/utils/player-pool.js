'use strict';

const RARITIES = ['bronze', 'silver', 'gold'];

function buildRarityIndex(rows) {
  const index = { bronze: [], silver: [], gold: [] };
  for (const row of rows || []) {
    const rarity = String(row.rarity || '').toLowerCase();
    const id = String(row.player_id || '');
    if (id && index[rarity]) index[rarity].push(id);
  }
  return index;
}

function chooseWeightedPlayerId(index, weights, rng = Math.random) {
  const safeWeights = RARITIES.map((_, position) => Math.max(0, Number(weights?.[position]) || 0));
  const total = safeWeights.reduce((sum, value) => sum + value, 0);
  const available = RARITIES.filter(rarity => index?.[rarity]?.length);
  if (!available.length) throw new Error('The EAFC26 catalog has no available players.');

  let selectedRarity = null;
  if (total > 0) {
    let roll = rng() * total;
    for (let position = 0; position < RARITIES.length; position += 1) {
      roll -= safeWeights[position];
      if (roll < 0) {
        selectedRarity = RARITIES[position];
        break;
      }
    }
  }

  if (!selectedRarity || !index[selectedRarity]?.length) {
    // If a requested rarity has no source records, fall back to the nearest
    // available rarity instead of returning an undefined player.
    selectedRarity = available.find(rarity => safeWeights[RARITIES.indexOf(rarity)] > 0) || available[0];
  }

  const candidates = index[selectedRarity];
  const selected = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return candidates[selected];
}

module.exports = { RARITIES, buildRarityIndex, chooseWeightedPlayerId };
