'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getPool } = require('../db');
const config = require('../config');

const settings = config.cardImages;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const inFlight = new Map();
let mappingPromise = null;

function safeId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= PNG_SIGNATURE.length
    && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function isAllowedImageUrl(value, allowedHosts = settings.allowedHosts) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return false;
  return allowedHosts.some(domain => host === domain || host.endsWith(`.${domain}`));
}

async function loadMapping() {
  if (!mappingPromise) {
    mappingPromise = (async () => {
      try {
        const raw = await fs.readFile(settings.mapPath, 'utf8');
        const parsed = JSON.parse(raw);
        const players = parsed && typeof parsed === 'object' && parsed.players && typeof parsed.players === 'object'
          ? parsed.players
          : parsed;
        return players && typeof players === 'object' && !Array.isArray(players) ? players : {};
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn(`[CARD CACHE] Could not read mapping file: ${error.message}`);
        }
        return {};
      }
    })();
  }
  return mappingPromise;
}

function expandUrlTemplate(template, values) {
  return String(template || '').replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key) => {
    if (!(key in values) || values[key] === null || values[key] === undefined) return '';
    return encodeURIComponent(String(values[key]));
  });
}

async function getMappedSource(player) {
  const map = await loadMapping();
  const lookupIds = [player?.source_player_id, player?.id].filter(Boolean).map(String);
  let entry = null;
  let mappingKey = null;
  for (const id of lookupIds) {
    if (map[id] && typeof map[id] === 'object') {
      entry = map[id];
      mappingKey = id;
      break;
    }
  }
  if (!entry) return null;
  if (entry.gameVersion && String(entry.gameVersion).toUpperCase() !== settings.gameVersion) return null;

  const values = {
    playerId: player?.id,
    sourcePlayerId: player?.source_player_id,
    eaItemId: entry.eaItemId || entry.ea_item_id,
    providerCardId: entry.providerCardId || entry.provider_card_id,
    name: player?.name,
    gameVersion: settings.gameVersion
  };
  const imageUrl = entry.imageUrl || entry.image_url
    || (settings.urlTemplate ? expandUrlTemplate(settings.urlTemplate, values) : '');
  if (!imageUrl || !isAllowedImageUrl(imageUrl)) {
    if (imageUrl) console.warn(`[CARD CACHE] Rejected image URL host for player ${player?.id || mappingKey}.`);
    return null;
  }

  return {
    mappingKey,
    provider: String(entry.provider || 'manual').slice(0, 32),
    eaItemId: values.eaItemId ? String(values.eaItemId).slice(0, 32) : null,
    providerCardId: values.providerCardId ? String(values.providerCardId).slice(0, 64) : null,
    imageUrl
  };
}

function relativeCachePath(playerId) {
  const safePlayerId = safeId(playerId);
  if (!safePlayerId) throw new Error('Player ID is not safe for a cache filename.');
  return path.join(settings.gameVersion.toLowerCase(), `${safePlayerId}.png`);
}

async function readCachedImage(row) {
  if (!row || row.status !== 'ready' || !row.cache_path) return null;
  const relative = String(row.cache_path);
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/).includes('..')) return null;
  const fullPath = path.resolve(settings.cacheDir, relative);
  if (!fullPath.startsWith(`${path.resolve(settings.cacheDir)}${path.sep}`)) return null;
  try {
    const buffer = await fs.readFile(fullPath);
    return isPng(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

async function convertImageToPng(buffer) {
  // Keep the existing @napi-rs/canvas dependency; no second image package is needed.
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const image = await loadImage(buffer);
  const width = Number(image.width);
  const height = Number(image.height);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16000000) {
    throw new Error('Card image dimensions are invalid or too large.');
  }
  if (isPng(buffer)) return buffer;
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  return canvas.toBuffer('image/png');
}

async function upsertAsset(playerId, source, values) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO player_card_assets
      (game_version, player_id, ea_item_id, provider_card_id, provider,
       source_image_url, cache_path, image_sha256, status, last_checked_at, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
     ON DUPLICATE KEY UPDATE
       ea_item_id=VALUES(ea_item_id), provider_card_id=VALUES(provider_card_id),
       provider=VALUES(provider), source_image_url=VALUES(source_image_url),
       cache_path=VALUES(cache_path), image_sha256=VALUES(image_sha256),
       status=VALUES(status), last_checked_at=VALUES(last_checked_at),
       last_checked_at_ms=VALUES(last_checked_at_ms), last_error=VALUES(last_error)`,
    [
      settings.gameVersion,
      String(playerId),
      source?.eaItemId || null,
      source?.providerCardId || null,
      source?.provider || null,
      source?.imageUrl || null,
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
  if (row.status === 'missing') return age >= settings.missingRetryHours * 60 * 60 * 1000;
  if (row.status === 'failed') return age >= settings.failedRetryMinutes * 60 * 1000;
  return true;
}

async function fetchCardImage(source) {
  const headers = { Accept: 'image/png,image/*;q=0.9,*/*;q=0.1' };
  const parsedUrl = new URL(source.imageUrl);
  const authForHost = settings.apiKeyHosts.some(domain => {
    const normalized = String(domain).toLowerCase();
    return parsedUrl.hostname.toLowerCase() === normalized || parsedUrl.hostname.toLowerCase().endsWith(`.${normalized}`);
  });
  if (settings.apiKey && authForHost) {
    const header = settings.apiKeyHeader || 'X-API-Key';
    const value = settings.apiKeyPrefix
      ? `${settings.apiKeyPrefix} ${settings.apiKey}`
      : settings.apiKey;
    headers[header] = value;
  }
  const response = await fetch(source.imageUrl, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(settings.timeoutMs)
  });
  if (response.status === 404) return { missing: true };
  if (!response.ok) throw new Error(`Image provider returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > settings.maxBytes) throw new Error('Card image exceeds the configured size limit.');
  const input = Buffer.from(await response.arrayBuffer());
  if (!input.length || input.length > settings.maxBytes) throw new Error('Card image response is empty or too large.');
  const png = await convertImageToPng(input);
  if (!isPng(png)) throw new Error('Image conversion did not produce a valid PNG.');
  return { png };
}

async function getOfficialCardImage(player) {
  const playerId = safeId(player?.id);
  if (!playerId) return null;

  const source = await getMappedSource(player);
  if (!source) return null;

  const key = `${settings.gameVersion}:${playerId}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const task = (async () => {
    const pool = getPool();
    let rows = await pool.query(
      'SELECT * FROM player_card_assets WHERE game_version=? AND player_id=? LIMIT 1',
      [settings.gameVersion, playerId]
    );
    let row = rows[0] || null;

    const cached = await readCachedImage(row);
    if (cached) return cached;
    if (row && !retryWindowPassed(row) && row.status !== 'ready') return null;

    try {
      const result = await fetchCardImage(source);
      if (result.missing) {
        await upsertAsset(playerId, source, { status: 'missing', error: 'Provider image not found (HTTP 404).' });
        return null;
      }

      const relative = relativeCachePath(playerId);
      const destination = path.join(settings.cacheDir, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, result.png, { flag: 'wx' });
        await fs.rename(temporary, destination);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }

      const sha256 = crypto.createHash('sha256').update(result.png).digest('hex');
      await upsertAsset(playerId, source, { status: 'ready', cachePath: relative, sha256 });
      return result.png;
    } catch (error) {
      await upsertAsset(playerId, source, { status: 'failed', error: error.message }).catch(dbError => {
        console.warn(`[CARD CACHE] Could not record failure for ${playerId}: ${dbError.message}`);
      });
      console.warn(`[CARD CACHE] Original card image unavailable for ${playerId}: ${error.message}`);
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

async function getMappedPlayerKeys() {
  const map = await loadMapping();
  return Object.keys(map).filter(key => map[key] && typeof map[key] === 'object');
}

function clearCardImageMappingCache() {
  mappingPromise = null;
}

module.exports = {
  getOfficialCardImage,
  getMappedPlayerKeys,
  clearCardImageMappingCache,
  isPng,
  isAllowedImageUrl,
  expandUrlTemplate,
  getMappedSource
};
