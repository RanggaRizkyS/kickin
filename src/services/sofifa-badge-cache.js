'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');
const { getSofifaRequestHeaders, isPng } = require('./player-portrait-cache');

const settings = config.cardImages;
const badgeRoot = path.resolve(settings.portraitCacheDir, 'badges', settings.gameVersion.toLowerCase());
const memoryCache = new Map();
const inFlight = new Map();

function normalizeNumericId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > 999999999) return null;
  return String(numeric);
}

function buildSofifaBadgeUrl(kind, id) {
  const type = String(kind || '').toLowerCase();
  const safeId = normalizeNumericId(id);
  if (!safeId || !['team', 'league'].includes(type)) return null;
  return `https://cdn.sofifa.net/meta/${type}/${safeId}/120.png`;
}

function getPlayerBadgeIds(player) {
  return {
    team: normalizeNumericId(player?.club?.id ?? player?.source_raw?.club_team_id),
    league: normalizeNumericId(player?.club?.league_id ?? player?.source_raw?.league_id)
  };
}

async function convertToPng(buffer) {
  if (isPng(buffer)) return buffer;
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const image = await loadImage(buffer);
  if (!image.width || !image.height || image.width > 2048 || image.height > 2048) {
    throw new Error('SoFIFA badge dimensions are invalid.');
  }
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0, image.width, image.height);
  return canvas.toBuffer('image/png');
}

async function getSofifaBadge(kind, id) {
  const url = buildSofifaBadgeUrl(kind, id);
  if (!url) return null;
  const key = `${kind}:${id}`;
  if (memoryCache.has(key)) return memoryCache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const task = (async () => {
    const filePath = path.join(badgeRoot, `${kind}-${id}.png`);
    const missingMarker = `${filePath}.missing`;
    try {
      const cached = await fs.readFile(filePath);
      if (isPng(cached)) {
        memoryCache.set(key, cached);
        return cached;
      }
    } catch {
      // Cache miss: fetch once from SoFIFA.
    }

    try {
      const markerStat = await fs.stat(missingMarker);
      if (Date.now() - markerStat.mtimeMs < 24 * 60 * 60 * 1000) return null;
      await fs.rm(missingMarker, { force: true }).catch(() => {});
    } catch {
      // No recent negative-cache marker.
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: getSofifaRequestHeaders(),
        redirect: 'error',
        signal: AbortSignal.timeout(settings.timeoutMs)
      });
      if (response.status === 403 || response.status === 404) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(missingMarker, String(Date.now()), 'utf8');
        return null;
      }
      if (!response.ok) throw new Error(`SoFIFA ${kind} badge returned HTTP ${response.status}.`);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.startsWith('image/')) return null;
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length || body.length > 2 * 1024 * 1024) return null;
      const png = await convertToPng(body);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temporary, png, { flag: 'w' });
        await fs.rename(temporary, filePath);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      await fs.rm(missingMarker, { force: true }).catch(() => {});
      memoryCache.set(key, png);
      return png;
    } catch (error) {
      console.warn(`[SOFIFA BADGE] ${kind} ${id} unavailable: ${error.message}`);
      return null;
    }
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

async function getPlayerBadgeAssets(player) {
  const ids = getPlayerBadgeIds(player);
  const [league, team] = await Promise.all([
    ids.league ? getSofifaBadge('league', ids.league) : Promise.resolve(null),
    ids.team ? getSofifaBadge('team', ids.team) : Promise.resolve(null)
  ]);
  return { league, team };
}

module.exports = {
  normalizeNumericId,
  buildSofifaBadgeUrl,
  getPlayerBadgeIds,
  getSofifaBadge,
  getPlayerBadgeAssets
};
