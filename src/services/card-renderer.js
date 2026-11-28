'use strict';

const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { clamp } = require('../utils/football');
const { getPlayerPortrait } = require('./player-portrait-cache');
const { getPlayerBadgeAssets } = require('./sofifa-badge-cache');

const BLUEPRINT_DIR = path.resolve(__dirname, '../../public/img/blueprint');
const imageCache = new Map();
const portraitImageCache = new Map();
const badgeImageCache = new Map();
const CARD_WIDTH = 1024;
const CARD_HEIGHT = 1536;

// Coordinates are measured against the supplied 1024x1536 FUT template.
// The portrait has a rectangular safe area and is never clipped by an inner
// silhouette mask. The source PNG itself already contains the transparent
// player cut-out.
const FONT_DISPLAY = '\"Arial Black\", \"Inter Display\", \"DejaVu Sans\", sans-serif';
const FONT_CONDENSED = '\"Arial Narrow\", \"Inter Display\", \"DejaVu Sans Condensed\", sans-serif';

// Layout is tuned to the supplied blank FUT template and the visual reference:
// bold top-left rating/position, centered full portrait, clean name strip,
// one compact stats row, and nation/league/club badges at the foot of the card.
const CARD_LAYOUT = Object.freeze({
  portrait: Object.freeze({
    subjectCenterX: 650,
    subjectBottomY: 908,
    maxSubjectWidth: 680,
    maxSubjectHeight: 748
  }),
  overall: Object.freeze({ x: 108, y: 344, size: 150 }),
  position: Object.freeze({ x: 114, y: 426, size: 80 }),
  name: Object.freeze({ x: 512, y: 991, maxWidth: 850, size: 90, minSize: 38 }),
  stats: Object.freeze({
    centers: Object.freeze([158, 302, 442, 581, 722, 875]),
    valueBaseline: 1230,
    valueSize: 76
  }),
  identity: Object.freeze({
    flag: Object.freeze({ x: 264, y: 1358, width: 100, height: 64 }),
    league: Object.freeze({ x: 512, y: 1390, radius: 47 }),
    club: Object.freeze({ x: 760, y: 1390, radius: 47 })
  })
});

async function getBlueprint(rarity) {
  const key = ['gold', 'silver', 'bronze'].includes(String(rarity || '').toLowerCase())
    ? String(rarity).toLowerCase()
    : 'bronze';
  if (!imageCache.has(key)) {
    imageCache.set(key, loadImage(path.join(BLUEPRINT_DIR, `card-${key}.png`)));
  }
  return imageCache.get(key);
}

function fitText(ctx, text, maxWidth, initialSize, minSize = 16, weight = 700, family = FONT_DISPLAY) {
  let size = initialSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

async function loadPortraitImage(player) {
  try {
    const buffer = await getPlayerPortrait(player);
    if (!buffer) return null;

    const key = `${player?.source_player_id || player?.id || 'unknown'}:${buffer.length}`;
    if (portraitImageCache.has(key)) return portraitImageCache.get(key);

    const image = await loadImage(buffer);
    portraitImageCache.set(key, image);
    if (portraitImageCache.size > 250) {
      const oldestKey = portraitImageCache.keys().next().value;
      portraitImageCache.delete(oldestKey);
    }
    return image;
  } catch (error) {
    console.warn(`[CARD RENDERER] SoFIFA portrait unavailable; using clean template: ${error.message}`);
    return null;
  }
}

function getVisibleAlphaBounds(image) {
  try {
    const sample = createCanvas(image.width, image.height);
    const sampleCtx = sample.getContext('2d');
    sampleCtx.drawImage(image, 0, 0);
    const { data } = sampleCtx.getImageData(0, 0, image.width, image.height);
    let minX = image.width;
    let maxX = -1;
    let minY = image.height;
    let maxY = -1;

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (data[(y * image.width + x) * 4 + 3] > 18) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) return null;
    return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
  } catch {
    return null;
  }
}

function drawPortraitOnTemplate(ctx, portrait) {
  if (!portrait) return false;

  const bounds = getVisibleAlphaBounds(portrait) || {
    minX: 0,
    maxX: portrait.width - 1,
    minY: 0,
    maxY: portrait.height - 1,
    width: portrait.width,
    height: portrait.height
  };
  const layout = CARD_LAYOUT.portrait;

  // Do not crop or stretch the source. Larger SoFIFA portraits get a larger
  // natural presentation; if only the 120px fallback exists, keep the display
  // scale restrained so the face does not become visibly over-enlarged.
  const sourceIsSmall = Math.max(portrait.width, portrait.height) <= 128;
  const qualityWidth = sourceIsSmall ? 520 : layout.maxSubjectWidth;
  const qualityHeight = sourceIsSmall ? 590 : layout.maxSubjectHeight;
  const scale = Math.min(
    qualityWidth / Math.max(1, bounds.width),
    qualityHeight / Math.max(1, bounds.height)
  );

  const drawWidth = portrait.width * scale;
  const drawHeight = portrait.height * scale;
  const visibleCenterX = (bounds.minX + bounds.maxX) / 2;
  const drawX = layout.subjectCenterX - visibleCenterX * scale;
  const drawY = layout.subjectBottomY - bounds.maxY * scale;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.shadowColor = 'rgba(25, 16, 3, 0.22)';
  ctx.shadowBlur = 13;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 5;
  ctx.drawImage(portrait, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
  return true;
}

function drawHeavyText(ctx, text, x, y, size, maxWidth, options = {}) {
  const weight = options.weight || 900;
  const family = options.family || FONT_DISPLAY;
  const minSize = options.minSize || Math.max(22, Math.floor(size * 0.56));
  const fitted = fitText(ctx, text, maxWidth, size, minSize, weight, family);
  ctx.font = `${weight} ${fitted}px ${family}`;
  ctx.textAlign = options.align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = options.fill || '#251b0e';
  ctx.shadowColor = options.shadow || 'rgba(255, 250, 228, 0.32)';
  ctx.shadowBlur = options.shadowBlur ?? 1.5;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillText(text, x, y, maxWidth);
  return fitted;
}

const COUNTRY_FLAGS = {
  argentina: { type: 'horizontal', colors: ['#74ACDF', '#FFFFFF', '#74ACDF'] },
  portugal: { type: 'vertical', colors: ['#046A38', '#DA291C'], split: 0.42 },
  france: { type: 'vertical', colors: ['#0055A4', '#FFFFFF', '#EF4135'] },
  spain: { type: 'horizontal', colors: ['#AA151B', '#F1BF00', '#AA151B'], weights: [1, 2, 1] },
  brazil: { type: 'brazil' },
  germany: { type: 'horizontal', colors: ['#111111', '#DD0000', '#FFCE00'] },
  england: { type: 'cross', background: '#FFFFFF', cross: '#CF142B' },
  'united states': { type: 'usa' },
  usa: { type: 'usa' },
  italy: { type: 'vertical', colors: ['#009246', '#FFFFFF', '#CE2B37'] },
  netherlands: { type: 'horizontal', colors: ['#AE1C28', '#FFFFFF', '#21468B'] },
  belgium: { type: 'vertical', colors: ['#111111', '#FAE042', '#ED2939'] },
  croatia: { type: 'horizontal', colors: ['#FF0000', '#FFFFFF', '#171796'] },
  uruguay: { type: 'horizontal', colors: ['#FFFFFF', '#5CB8E6', '#FFFFFF', '#5CB8E6', '#FFFFFF'] },
  colombia: { type: 'horizontal', colors: ['#FCD116', '#003893', '#CE1126'], weights: [2, 1, 1] },
  mexico: { type: 'vertical', colors: ['#006847', '#FFFFFF', '#CE1126'] },
  japan: { type: 'dot', background: '#FFFFFF', dot: '#BC002D' },
  sweden: { type: 'cross', background: '#006AA7', cross: '#FECC00' },
  denmark: { type: 'cross', background: '#C60C30', cross: '#FFFFFF' },
  norway: { type: 'cross', background: '#BA0C2F', cross: '#FFFFFF', innerCross: '#00205B' },
  poland: { type: 'horizontal', colors: ['#FFFFFF', '#DC143C'] },
  ukraine: { type: 'horizontal', colors: ['#0057B7', '#FFD700'] },
  switzerland: { type: 'cross', background: '#FF0000', cross: '#FFFFFF' },
  turkey: { type: 'crescent', background: '#E30A17', dot: '#FFFFFF' },
  senegal: { type: 'vertical', colors: ['#00853F', '#FDEF42', '#E31B23'] },
  nigeria: { type: 'vertical', colors: ['#008751', '#FFFFFF', '#008751'] },
  'ivory coast': { type: 'vertical', colors: ['#F77F00', '#FFFFFF', '#009E60'] },
  'cote d’ivoire': { type: 'vertical', colors: ['#F77F00', '#FFFFFF', '#009E60'] },
  ghana: { type: 'horizontal', colors: ['#CE1126', '#FCD116', '#006B3F'] },
  cameroon: { type: 'vertical', colors: ['#007A5E', '#CE1126', '#FCD116'] },
  morocco: { type: 'solid-star', background: '#C1272D', detail: '#006233' },
  serbia: { type: 'horizontal', colors: ['#C6363C', '#0C4076', '#FFFFFF'] },
  'south korea': { type: 'dot', background: '#FFFFFF', dot: '#CD2E3A' },
  austria: { type: 'horizontal', colors: ['#ED2939', '#FFFFFF', '#ED2939'] },
  switzerland: { type: 'cross', background: '#FF0000', cross: '#FFFFFF' },
  algeria: { type: 'vertical', colors: ['#006633', '#FFFFFF'] },
  egypt: { type: 'horizontal', colors: ['#CE1126', '#FFFFFF', '#000000'] },
  'saudi arabia': { type: 'solid-star', background: '#006C35', detail: '#FFFFFF' },
  australia: { type: 'usa' },
  canada: { type: 'vertical', colors: ['#D80621', '#FFFFFF', '#D80621'] }
};

function normalizeCountry(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’']/g, '’');
}

function drawFlag(ctx, country, x, y, width, height) {
  const key = normalizeCountry(country);
  const spec = COUNTRY_FLAGS[key];
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 5);
  ctx.clip();

  if (!spec) {
    ctx.fillStyle = '#2b2112';
    ctx.fillRect(x, y, width, height);
    const code = String(country || 'UNK').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'UNK';
    ctx.fillStyle = '#fff1c8';
    ctx.font = '800 23px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(code, x + width / 2, y + height / 2 + 1);
  } else if (spec.type === 'horizontal') {
    const colors = spec.colors;
    const weights = spec.weights || colors.map(() => 1);
    const total = weights.reduce((sum, item) => sum + item, 0);
    let yOffset = y;
    colors.forEach((color, index) => {
      const bandHeight = index === colors.length - 1
        ? y + height - yOffset
        : height * weights[index] / total;
      ctx.fillStyle = color;
      ctx.fillRect(x, yOffset, width, bandHeight + 1);
      yOffset += bandHeight;
    });
  } else if (spec.type === 'vertical') {
    const colors = spec.colors;
    const split = spec.split;
    if (split) {
      ctx.fillStyle = colors[0];
      ctx.fillRect(x, y, width * split, height);
      ctx.fillStyle = colors[1];
      ctx.fillRect(x + width * split, y, width * (1 - split), height);
    } else {
      colors.forEach((color, index) => {
        ctx.fillStyle = color;
        const left = x + width * index / colors.length;
        const right = x + width * (index + 1) / colors.length;
        ctx.fillRect(left, y, right - left + 1, height);
      });
    }
  } else if (spec.type === 'cross') {
    ctx.fillStyle = spec.background;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = spec.cross;
    ctx.fillRect(x + width * 0.29, y, width * 0.16, height);
    ctx.fillRect(x, y + height * 0.40, width, height * 0.22);
    if (spec.innerCross) {
      ctx.fillStyle = spec.innerCross;
      ctx.fillRect(x + width * 0.325, y, width * 0.09, height);
      ctx.fillRect(x, y + height * 0.445, width, height * 0.13);
    }
  } else if (spec.type === 'dot') {
    ctx.fillStyle = spec.background;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = spec.dot;
    ctx.beginPath();
    ctx.arc(x + width * 0.52, y + height / 2, height * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (spec.type === 'brazil') {
    ctx.fillStyle = '#009739';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#FFDF00';
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y + height * 0.12);
    ctx.lineTo(x + width * 0.88, y + height / 2);
    ctx.lineTo(x + width / 2, y + height * 0.88);
    ctx.lineTo(x + width * 0.12, y + height / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#002776';
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height / 2, height * 0.24, 0, Math.PI * 2);
    ctx.fill();
  } else if (spec.type === 'usa') {
    const stripeHeight = height / 7;
    for (let index = 0; index < 7; index += 1) {
      ctx.fillStyle = index % 2 === 0 ? '#B22234' : '#FFFFFF';
      ctx.fillRect(x, y + index * stripeHeight, width, stripeHeight + 1);
    }
    ctx.fillStyle = '#3C3B6E';
    ctx.fillRect(x, y, width * 0.43, height * 0.55);
  } else if (spec.type === 'crescent') {
    ctx.fillStyle = spec.background;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = spec.dot;
    ctx.beginPath();
    ctx.arc(x + width * 0.43, y + height / 2, height * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = spec.background;
    ctx.beginPath();
    ctx.arc(x + width * 0.51, y + height * 0.42, height * 0.23, 0, Math.PI * 2);
    ctx.fill();
  } else if (spec.type === 'solid-star') {
    ctx.fillStyle = spec.background;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = spec.detail;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + width * 0.5, y + height * 0.2);
    ctx.lineTo(x + width * 0.56, y + height * 0.42);
    ctx.lineTo(x + width * 0.78, y + height * 0.42);
    ctx.lineTo(x + width * 0.60, y + height * 0.57);
    ctx.lineTo(x + width * 0.67, y + height * 0.8);
    ctx.lineTo(x + width * 0.5, y + height * 0.66);
    ctx.lineTo(x + width * 0.33, y + height * 0.8);
    ctx.lineTo(x + width * 0.40, y + height * 0.57);
    ctx.lineTo(x + width * 0.22, y + height * 0.42);
    ctx.lineTo(x + width * 0.44, y + height * 0.42);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 246, 219, 0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 5);
  ctx.stroke();
  ctx.restore();
}

function drawRatingAndPosition(ctx, overall, position) {
  const rating = String(overall);
  const pos = String(position || 'CM').toUpperCase();
  ctx.save();
  drawHeavyText(ctx, rating, CARD_LAYOUT.overall.x, CARD_LAYOUT.overall.y,
    CARD_LAYOUT.overall.size, 205, {
      family: FONT_DISPLAY,
      fill: '#21180d',
      shadow: 'rgba(255,255,255,0.25)',
      shadowBlur: 1
    });
  drawHeavyText(ctx, pos, CARD_LAYOUT.position.x, CARD_LAYOUT.position.y,
    CARD_LAYOUT.position.size, 155, {
      family: FONT_CONDENSED,
      fill: '#21180d',
      shadow: 'rgba(255,255,255,0.22)',
      shadowBlur: 1
    });
  ctx.restore();
}

function shortLeagueName(value) {
  const league = String(value || '').trim().toLowerCase();
  const known = [
    [/premier league|english premier/, 'PL'],
    [/la liga|laliga|primera division/, 'LL'],
    [/bundesliga/, 'BL'],
    [/serie a/, 'SA'],
    [/ligue 1/, 'L1'],
    [/eredivisie/, 'ERE'],
    [/primeira liga|liga portugal/, 'LP'],
    [/mls|major league soccer/, 'MLS'],
    [/pro league|saudi/, 'SPL'],
    [/super lig|süper lig/, 'SL'],
    [/championship/, 'CH'],
    [/liga mx/, 'MX']
  ];
  for (const [pattern, code] of known) if (pattern.test(league)) return code;
  const words = String(value || '').toUpperCase().match(/[A-Z0-9]+/g) || [];
  if (!words.length) return 'LEAGUE';
  return words.length === 1 ? words[0].slice(0, 3) : words.slice(0, 3).map(word => word[0]).join('');
}

function shortClubName(value) {
  const ignored = new Set(['FC', 'CF', 'AFC', 'SC', 'AS', 'AC', 'RCD', 'CD', 'FK', 'CLUB', 'DE', 'THE']);
  const words = String(value || '').toUpperCase().match(/[A-Z0-9]+/g) || [];
  const useful = words.filter(word => !ignored.has(word));
  if (!useful.length) return 'FC';
  if (useful.length === 1) return useful[0].slice(0, 3);
  return useful.slice(0, 3).map(word => word[0]).join('');
}

function stableBadgeColor(value) {
  const palette = ['#263d63', '#772e32', '#315d4b', '#4d3d70', '#8a572d', '#263b43', '#7c3d56'];
  const text = String(value || 'club');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function drawCircularBadge(ctx, label, x, y, radius, fill, options = {}) {
  ctx.save();
  ctx.shadowColor = 'rgba(30, 20, 6, 0.24)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = options.background || 'rgba(255, 249, 231, 0.96)';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  if (options.image) {
    const image = options.image;
    const inner = radius - 12;
    const scale = Math.min((inner * 2) / image.width, (inner * 2) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, inner, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
    ctx.restore();
  } else {
    const fontSize = label.length >= 4 ? 23 : label.length === 3 ? 27 : 33;
    ctx.font = `900 ${fontSize}px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = options.text || '#261b0d';
    ctx.fillText(label, x, y + 1, radius * 1.55);
  }

  ctx.lineWidth = 5;
  ctx.strokeStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(x, y, radius - 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

async function loadBadgeImage(buffer, cacheKey) {
  if (!buffer) return null;
  if (badgeImageCache.has(cacheKey)) return badgeImageCache.get(cacheKey);
  try {
    const image = await loadImage(buffer);
    badgeImageCache.set(cacheKey, image);
    if (badgeImageCache.size > 120) {
      const oldestKey = badgeImageCache.keys().next().value;
      badgeImageCache.delete(oldestKey);
    }
    return image;
  } catch {
    return null;
  }
}

function drawBottomIdentity(ctx, player, rarity, badgeImages = {}) {
  const country = String(player?.nationality?.country || player?.nationality_name || player?.country || '').trim();
  const league = String(player?.club?.league || player?.league_name || player?.league || 'Unknown League');
  const club = String(player?.club?.name || player?.club_name || player?.team_name || 'Free Agent');
  const { flag, league: leagueBox, club: clubBox } = CARD_LAYOUT.identity;
  const accent = String(rarity || '').toLowerCase() === 'silver'
    ? '#5e6d7b'
    : String(rarity || '').toLowerCase() === 'bronze' ? '#80512e' : '#8c6419';

  if (country && country.toLowerCase() !== 'unknown') {
    ctx.save();
    ctx.shadowColor = 'rgba(30,20,6,0.22)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = 'rgba(255,249,231,0.95)';
    ctx.beginPath();
    ctx.roundRect(flag.x - 8, flag.y - 8, flag.width + 16, flag.height + 16, 12);
    ctx.fill();
    ctx.restore();
    drawFlag(ctx, country, flag.x, flag.y, flag.width, flag.height);
  }

  drawCircularBadge(ctx, shortLeagueName(league), leagueBox.x, leagueBox.y,
    leagueBox.radius, accent, { image: badgeImages.league || null });
  drawCircularBadge(ctx, shortClubName(club), clubBox.x, clubBox.y,
    clubBox.radius, stableBadgeColor(club), { image: badgeImages.team || null });
}

function drawNameplate(ctx, name) {
  const { x, y, maxWidth, size, minSize } = CARD_LAYOUT.name;
  const label = String(name || 'UNKNOWN').trim().toUpperCase();
  ctx.save();
  const fitted = fitText(ctx, label, maxWidth, size, minSize, 900, FONT_DISPLAY);
  ctx.font = `900 ${fitted}px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#241a0d';
  ctx.shadowColor = 'rgba(255,255,255,0.2)';
  ctx.shadowBlur = 1;
  ctx.fillText(label, x, y, maxWidth);
  ctx.restore();
}

function drawStats(ctx, player, currentStats) {
  const rawStats = currentStats || player.stats?.main || {};
  const isGoalkeeper = player.stats?.type === 'goalkeeper';
  const keys = isGoalkeeper
    ? ['diving', 'handling', 'kicking', 'reflexes', 'speed', 'positioning']
    : ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
  const fallback = isGoalkeeper ? player.stats?.goalkeeper : player.stats?.main;
  const values = keys.map(key => rawStats[key] ?? rawStats[key.toUpperCase()] ?? fallback?.[key] ?? fallback?.[key.toUpperCase()] ?? 0);
  const { centers, valueBaseline, valueSize } = CARD_LAYOUT.stats;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 ${valueSize}px ${FONT_DISPLAY}`;
  ctx.fillStyle = '#21180d';
  ctx.shadowColor = 'rgba(255,255,255,0.22)';
  ctx.shadowBlur = 1;
  values.forEach((value, index) => {
    const number = Math.max(0, Math.min(99, Math.round(Number(value) || 0)));
    ctx.fillText(String(number), centers[index], valueBaseline);
  });
  ctx.restore();
}

async function renderBlueprintPlayerCard({ player, rarity, currentOvr, position, currentStats }) {
  const image = await getBlueprint(rarity || player.rarity || 'silver');
  if (image.width !== CARD_WIDTH || image.height !== CARD_HEIGHT) {
    throw new Error(`Card template must be ${CARD_WIDTH}x${CARD_HEIGHT}; received ${image.width}x${image.height}.`);
  }

  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT);

  const portrait = await loadPortraitImage(player);
  drawPortraitOnTemplate(ctx, portrait);

  // Keep typography and metadata in the dedicated empty zones of the supplied
  // template; the pre-printed stat labels are not redrawn or covered.
  const overall = clamp(Math.round(currentOvr ?? player.overall), 1, 99);
  drawRatingAndPosition(ctx, overall, position || player.positions?.primary || 'CM');
  drawNameplate(ctx, player.name);
  drawStats(ctx, player, currentStats);
  const badgeBuffers = await getPlayerBadgeAssets(player).catch(() => ({ league: null, team: null }));
  const badgeImages = {
    league: await loadBadgeImage(badgeBuffers.league, `league:${player?.club?.league_id || player?.source_raw?.league_id || 'unknown'}`),
    team: await loadBadgeImage(badgeBuffers.team, `team:${player?.club?.id || player?.source_raw?.club_team_id || 'unknown'}`)
  };
  drawBottomIdentity(ctx, player, rarity || player.rarity, badgeImages);

  return canvas.toBuffer('image/png');
}

async function renderPlayerCard(options) {
  // Always use the selected local template so Gold/Silver/Bronze share the same
  // geometry and player-information positions. Original card-image lookup is
  // intentionally not used by this renderer.
  return renderBlueprintPlayerCard(options);
}

module.exports = {
  renderPlayerCard,
  renderBlueprintPlayerCard,
  CARD_LAYOUT,
  getVisibleAlphaBounds,
  drawPortraitOnTemplate,
  shortLeagueName,
  shortClubName
};
