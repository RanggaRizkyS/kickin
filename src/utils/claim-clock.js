'use strict';

/**
 * Cooldown clock based only on timestamps written by MariaDB.
 * The query layer exposes MariaDB's last_claim_at DATETIME as epoch milliseconds
 * (falling back to last_claim_at_ms for compatibility). New users explicitly set
 * both columns to NULL so their first claim is immediately available.
 */
function claimElapsedMs(row, fallbackNow = Date.now()) {
  const dbNow = Number(row?.db_now_ms || fallbackNow);
  const raw = row?.last_claim_at_ms;
  if (raw === null || raw === undefined || raw === '') return null;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  const lastClaimMs = value < 1_000_000_000_000 ? value * 1000 : value;

  // Recover from timestamps written by an old host clock that was ahead of DB.
  if (!Number.isFinite(dbNow) || lastClaimMs > dbNow) return null;
  return Math.max(0, dbNow - lastClaimMs);
}

function claimStatusFromRow(row, cooldownMs, fallbackNow = Date.now()) {
  const safeCooldown = Math.max(0, Number(cooldownMs) || 0);
  const dbNow = Number(row?.db_now_ms || fallbackNow);
  const elapsedMs = claimElapsedMs(row, fallbackNow);
  const remainingMs = elapsedMs === null
    ? 0
    : Math.max(0, safeCooldown - elapsedMs);

  return {
    available: remainingMs <= 0,
    remainingMs,
    nextClaimAtMs: dbNow + remainingMs,
    pity: Number(row?.claim_pity_count || 0),
    cooldownMs: safeCooldown
  };
}

module.exports = { claimElapsedMs, claimStatusFromRow };
