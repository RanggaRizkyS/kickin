'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getPool } = require('../db');
const config = require('../config');

const settings = config.cardImages;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const inFlight = new Map();

function safeId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function isPng(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= PNG_SIGNATURE.length
    && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function isAllowedSofifaPortraitUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
  if (parsed.hostname.toLowerCase() !== 'cdn.sofifa.net') return false;
  if (parsed.search || parsed.hash) return false;

  // Accept only SoFIFA player portrait paths, not arbitrary CDN resources.
  return /^\/players\/\d{3}\/\d{3}\/\d{2}_120\.png$/i.test(parsed.pathname);
}

function getSofifaRequestHeaders() {
  return {
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': settings.sofifaReferer || 'https://sofifa.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  };
}

function relativePortraitPath(player) {
  const sourceId = safeId(player?.source_player_id) || safeId(player?.id);
  if (!sourceId) throw new Error('Player source ID is not safe for a portrait cache filename.');
  // hq3 invalidates older portrait caches after the high-resolution source update.
  return path.join(settings.gameVersion.toLowerCase(), 'hq3', `${sourceId}.png`);
}

function isCurrentPortraitCacheProfile(row) {
  const relative = String(row?.cache_path || '').replace(/\\/g, '/');
  return relative.startsWith(`${settings.gameVersion.toLowerCase()}/hq3/`);
}

function getPortraitCandidateUrls(imageUrl) {
  if (!isAllowedSofifaPortraitUrl(imageUrl)) return [];
  const base = new URL(imageUrl);
  // Try larger CDN variants first. Some player/version combinations only expose
  // 240px or 120px, so unavailable sizes fall through without changing the source ID.
  return [480, 360, 240, 120].map(size => {
    const candidate = new URL(base);
    candidate.pathname = candidate.pathname.replace(/_\d{2,3}\.png$/i, `_${size}.png`);
    return candidate.toString();
  });
}

function getPngDimensions(buffer) {
  if (!isPng(buffer) || buffer.length < 24) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) return null;
  return { width, height };
}

function resolveCachePath(relative) {
  if (!relative || path.isAbsolute(relative) || String(relative).split(/[\\/]+/).includes('..')) return null;
  const root = path.resolve(settings.portraitCacheDir);
  const target = path.resolve(root, relative);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

async function convertToPng(buffer) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const image = await loadImage(buffer);
  const width = Number(image.width);
  const height = Number(image.height);

  if (!width || !height || width > 4096 || height > 4096 || width * height > 16000000) {
    throw new Error('SoFIFA portrait dimensions are invalid or too large.');
  }

  if (isPng(buffer)) return buffer;
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  return canvas.toBuffer('image/png');
}

async function readCachedPortrait(row) {
  if (!row || row.status !== 'ready') return null;
  const relative = String(row.cache_path || '').replace(/\\/g, '/');
  const expectedPrefix = `${settings.gameVersion.toLowerCase()}/hq3/`;
  // Ignore older cache entries so this quality-profile update is fetched once.
  if (!relative.startsWith(expectedPrefix)) return null;

  const fullPath = resolveCachePath(row.cache_path);
  if (!fullPath) return null;

  try {
    const buffer = await fs.readFile(fullPath);
    return getPngDimensions(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

async function upsertPortraitAsset(player, imageUrl, values) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO player_portrait_assets
      (game_version, player_id, source_player_id, source_image_url, cache_path,
       image_sha256, status, last_checked_at, last_checked_at_ms, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, ?)
     ON DUPLICATE KEY UPDATE
       source_player_id=VALUES(source_player_id),
       source_image_url=VALUES(source_image_url),
       cache_path=VALUES(cache_path),
       image_sha256=VALUES(image_sha256),
       status=VALUES(status),
       last_checked_at=VALUES(last_checked_at),
       last_checked_at_ms=VALUES(last_checked_at_ms),
       last_error=VALUES(last_error)`,
    [
      settings.gameVersion,
      String(player.id),
      String(player.source_player_id || player.id),
      imageUrl,
      values.cachePath || null,
      values.sha256 || null,
      values.status,
      Date.now(),
      values.error ? String(values.error).slice(0, 500) : null
    ]
  );
}

function retryWindowPassed(row) {
  const checked = Number(row?.last_checked_at_ms);
  if (!Number.isFinite(checked) || checked <= 0) return true;
  const age = Date.now() - checked;
  if (row.status === 'missing') {
    return age >= settings.portraitMissingRetryHours * 60 * 60 * 1000;
  }
  if (row.status === 'failed') {
    return age >= settings.portraitFailedRetryMinutes * 60 * 1000;
  }
  return true;
}

async function fetchSofifaPortrait(imageUrl) {
  const candidates = getPortraitCandidateUrls(imageUrl);
  if (!candidates.length) throw new Error('Invalid SoFIFA portrait URL.');

  let lastStatus = null;
  let lastProbeError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidateUrl = candidates[index];
    let response;
    try {
      // Probe speculative sizes quickly; keep the configured timeout for the
      // known 240px and 120px fallbacks so the best available portrait wins.
      const isSpeculativeSize = index < 2;
      response = await fetch(candidateUrl, {
        method: 'GET',
        headers: getSofifaRequestHeaders(),
        redirect: 'error',
        signal: AbortSignal.timeout(isSpeculativeSize ? Math.min(settings.timeoutMs, 3000) : settings.timeoutMs)
      });
    } catch (error) {
      lastProbeError = error;
      if (index < candidates.length - 1) continue;
      throw error;
    }

    if (response.status === 404 || response.status === 403) {
      lastStatus = response.status;
      continue;
    }
    if (!response.ok) {
      if (index < candidates.length - 1 && response.status >= 500) continue;
      throw new Error(`SoFIFA CDN returned HTTP ${response.status} for ${candidateUrl}.`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
      throw new Error(`SoFIFA returned a non-image response (${contentType}).`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > settings.maxBytes) {
      throw new Error('SoFIFA portrait exceeds the configured size limit.');
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > settings.maxBytes) {
      throw new Error('SoFIFA portrait response is empty or too large.');
    }

    const png = await convertToPng(body);
    const dimensions = getPngDimensions(png);
    if (!dimensions) throw new Error('SoFIFA portrait conversion did not produce a valid PNG.');
    return { png, ...dimensions, resolvedUrl: candidateUrl };
  }

  if (lastStatus === 404 || lastStatus === 403) {
    return { missing: true, lastStatus, attempted: candidates };
  }
  if (lastProbeError) throw lastProbeError;
  return { missing: true, attempted: candidates };
}

async function getPlayerPortrait(player) {
  const playerId = safeId(player?.id);
  const imageUrl = String(player?.player_face_url || '').trim();
  if (!playerId || !imageUrl || !isAllowedSofifaPortraitUrl(imageUrl)) return null;

  const key = `${settings.gameVersion}:${playerId}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const task = (async () => {
    const pool = getPool();
    const rows = await pool.query(
      `SELECT * FROM player_portrait_assets
       WHERE game_version=? AND player_id=? LIMIT 1`,
      [settings.gameVersion, playerId]
    );
    const row = rows[0] || null;
    const sameSource = row && String(row.source_image_url || '') === imageUrl;

    if (sameSource && isCurrentPortraitCacheProfile(row)) {
      const cached = await readCachedPortrait(row);
      if (cached) return cached;
      if (row.status !== 'ready' && !retryWindowPassed(row)) return null;
    }

    try {
      const result = await fetchSofifaPortrait(imageUrl);
      if (result.missing) {
        await upsertPortraitAsset(player, imageUrl, {
          status: 'missing',
          cachePath: relativePortraitPath(player).replace(/\.png$/i, '.missing'),
          error: `SoFIFA portrait sizes unavailable (${(result.attempted || []).map(url => new URL(url).pathname.split('_').pop()).join(', ')}; last HTTP ${result.lastStatus || '404'}).`
        });
        return null;
      }

      const relative = relativePortraitPath(player);
      const destination = resolveCachePath(relative);
      if (!destination) throw new Error('Portrait cache path is invalid.');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;

      try {
        await fs.writeFile(temporary, result.png, { flag: 'wx' });
        await fs.rename(temporary, destination);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }

      const sha256 = crypto.createHash('sha256').update(result.png).digest('hex');
      console.log(`[PORTRAIT CACHE] Saved ${player.name || playerId} at ${result.width}x${result.height} (${new URL(result.resolvedUrl).pathname.split('_').pop()}).`);
      await upsertPortraitAsset(player, imageUrl, {
        status: 'ready',
        cachePath: relative,
        sha256
      });
      return result.png;
    } catch (error) {
      await upsertPortraitAsset(player, imageUrl, {
        status: 'failed',
        cachePath: relativePortraitPath(player).replace(/\.png$/i, '.failed'),
        error: error.message
      }).catch(dbError => {
        console.warn(`[PORTRAIT CACHE] Could not record failure for ${playerId}: ${dbError.message}`);
      });
      console.warn(`[PORTRAIT CACHE] SoFIFA portrait unavailable for ${player.name || playerId}: ${error.message}`);
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

module.exports = {
  getPlayerPortrait,
  isAllowedSofifaPortraitUrl,
  getSofifaRequestHeaders,
  getPortraitCandidateUrls,
  isCurrentPortraitCacheProfile,
  getPngDimensions,
  isPng,
  relativePortraitPath
};
