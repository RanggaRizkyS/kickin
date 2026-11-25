const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { clamp } = require('../utils/football');

const BLUEPRINT_DIR = path.resolve(__dirname, '../../public/img/blueprint');
const imageCache = new Map();

async function getBlueprint(rarity) {
  const key = ['gold', 'silver', 'bronze'].includes(rarity) ? rarity : 'bronze';
  if (!imageCache.has(key)) {
    imageCache.set(key, loadImage(path.join(BLUEPRINT_DIR, `card-${key}.png`)));
  }
  return imageCache.get(key);
}

function fitText(ctx, text, maxWidth, initialSize, minSize = 16, weight = 700) {
  let size = initialSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px Arial`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

async function renderPlayerCard({ player, rarity, currentOvr, position, currentStats }) {
  const image = await getBlueprint(rarity || player.rarity || 'silver');
  const canvas = createCanvas(1024, 1536);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, 1024, 1536);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f2f2f2';
  ctx.shadowColor = 'rgba(255,255,255,.20)';
  ctx.shadowBlur = 5;
  ctx.font = '700 114px Arial';
  ctx.fillText(String(clamp(Math.round(currentOvr ?? player.overall), 1, 99)), 100, 374);
  ctx.font = '700 68px Arial';
  ctx.fillText(String(position || player.positions?.primary || 'CM').toUpperCase(), 110, 470);

  const name = String(player.name || 'UNKNOWN').toUpperCase();
  ctx.textAlign = 'center';
  fitText(ctx, name, 840, 56, 30, 700);
  const nameSize = fitText(ctx, name, 840, 56, 30, 700);
  ctx.font = `700 ${nameSize}px Arial`;
  ctx.fillText(name, 512, 1166);

  const stats = currentStats || player.stats?.main || {};
  const isGoalkeeper = player.stats?.type === 'goalkeeper';
  const labels = isGoalkeeper ? ['DIV', 'HAN', 'KIC', 'REF', 'SPD', 'POS'] : ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
  const statKeys = isGoalkeeper
    ? ['diving', 'handling', 'kicking', 'reflexes', 'speed', 'positioning']
    : ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
  const fallbackStats = isGoalkeeper ? player.stats?.goalkeeper : player.stats?.main;
  const values = statKeys.map(key => stats[key] ?? stats[key.toUpperCase()] ?? fallbackStats?.[key] ?? fallbackStats?.[key.toUpperCase()] ?? 0);
  const centers = [145, 290, 435, 580, 725, 870];
  ctx.textAlign = 'center';
  ctx.shadowBlur = 2;
  if (isGoalkeeper) {
    // The supplied blueprint has fixed outfield labels; replace only that label area for GK cards.
    centers.forEach((center, index) => {
      ctx.fillStyle = 'rgba(8,8,8,0.88)';
      ctx.fillRect(center - 48, 1218, 96, 68);
      ctx.fillStyle = '#bfc0c2';
      ctx.font = '700 40px Arial';
      ctx.fillText(labels[index], center, 1273);
    });
  }
  ctx.fillStyle = '#d4d4d6';
  ctx.font = '700 43px Arial';
  values.forEach((value, index) => ctx.fillText(String(Math.round(Number(value) || 0)), centers[index], 1382));
  return canvas.toBuffer('image/png');
}

module.exports = { renderPlayerCard };
