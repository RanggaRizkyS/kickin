const { createCanvas } = require('@napi-rs/canvas');

const C = {
  text: '#edf2f7', muted: '#9eacbd', line: '#2a3748', green: '#50cf82',
  gold: '#d9b35e', silver: '#b4bfcb', bronze: '#bd896b', rowA: '#1b2532', rowB: '#151e29'
};

function fit(ctx, value, maxWidth, start, min = 11, weight = 600) {
  let size = start;
  while (size > min) {
    ctx.font = `${weight} ${size}px Arial`;
    if (ctx.measureText(String(value ?? '')).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

function rarityColor(rarity) {
  return rarity === 'gold' ? C.gold : rarity === 'silver' ? C.silver : C.bronze;
}

async function renderMarketTable({ entries, type = 'system', page = 1, total = 0, balance = 0 }) {
  const width = 1450;
  const headerHeight = 178;
  const rowHeight = 70;
  const footerHeight = 68;
  const height = headerHeight + Math.max(entries.length, 1) * rowHeight + footerHeight;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#101925');
  bg.addColorStop(0.54, '#0d131d');
  bg.addColorStop(1, '#172231');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#202c3b';
  ctx.beginPath();
  ctx.roundRect(24, 20, width - 48, 112, 18);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = '800 34px Arial';
  ctx.fillText(type === 'system' ? 'SYSTEM PLAYER MARKET' : 'COMMUNITY PLAYER MARKET', 52, 66);
  ctx.fillStyle = C.muted;
  ctx.font = '500 17px Arial';
  ctx.fillText(type === 'system' ? 'Global supply & demand pricing' : 'Player cards listed by other managers', 54, 101);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.green;
  ctx.font = '800 20px Arial';
  ctx.fillText(`${Number(total).toLocaleString('en-US')} LISTINGS`, width - 54, 66);
  ctx.fillStyle = C.muted;
  ctx.font = '600 16px Arial';
  ctx.fillText(`PAGE ${page}  ·  BALANCE ${Number(balance).toLocaleString('en-US')} CR`, width - 54, 101);

  const headers = [
    [48, '#'], [105, 'LISTING ID'], [300, 'PLAYER'], [780, 'OVR'],
    [900, 'POSITION'], [1040, 'RARITY'], [1155, 'PRICE'], [1320, type === 'system' ? 'STOCK' : 'SELLER']
  ];
  ctx.textAlign = 'left';
  ctx.fillStyle = C.muted;
  ctx.font = '800 15px Arial';
  headers.forEach(([x, label]) => ctx.fillText(label, x, 160));

  entries.forEach((entry, index) => {
    const player = entry.player || entry;
    const listingId = type === 'system' ? entry.listingId : entry.publicListingId;
    const ovr = Math.round(Number(entry.currentOvr ?? player.overall ?? 0));
    const position = player.positions?.primary || player.primary_position || '-';
    const price = Number(type === 'system' ? entry.marketPrice : entry.askingPrice) || 0;
    const rarity = entry.rarity || player.rarity || 'bronze';
    const y = headerHeight + index * rowHeight;

    ctx.fillStyle = index % 2 === 0 ? C.rowA : C.rowB;
    ctx.beginPath();
    ctx.roundRect(24, y, width - 48, rowHeight - 5, 10);
    ctx.fill();
    ctx.fillStyle = rarityColor(rarity);
    ctx.fillRect(24, y + 6, 4, rowHeight - 16);

    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted;
    ctx.font = '700 15px Arial';
    ctx.fillText(String((page - 1) * 10 + index + 1).padStart(2, '0'), 48, y + 41);

    ctx.fillStyle = '#d6dfeb';
    const id = String(listingId || '—');
    const idSize = fit(ctx, id, 165, 14, 10, 700);
    ctx.font = `700 ${idSize}px Arial`;
    ctx.fillText(id, 105, y + 41);

    ctx.fillStyle = C.text;
    const nameSize = fit(ctx, player.name || 'Unknown', 435, 20, 12, 800);
    ctx.font = `800 ${nameSize}px Arial`;
    ctx.fillText(String(player.name || 'Unknown'), 300, y + 31);
    ctx.fillStyle = C.muted;
    ctx.font = '500 13px Arial';
    ctx.fillText(String(player.nationality?.country || 'Unknown'), 301, y + 51);

    ctx.fillStyle = rarityColor(rarity);
    ctx.beginPath();
    ctx.arc(808, y + 34, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#101720';
    ctx.textAlign = 'center';
    ctx.font = '800 15px Arial';
    ctx.fillText(String(ovr), 808, y + 39);

    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    ctx.font = '700 16px Arial';
    ctx.fillText(String(position), 900, y + 40);
    ctx.fillStyle = rarityColor(rarity);
    ctx.font = '800 14px Arial';
    ctx.fillText(String(rarity).toUpperCase(), 1040, y + 40);
    ctx.fillStyle = C.green;
    ctx.font = '800 17px Arial';
    ctx.fillText(`${price.toLocaleString('en-US')} CR`, 1155, y + 40);
    ctx.fillStyle = C.muted;
    const stockOrSeller = type === 'system'
      ? `${Number(entry.stock || 0).toLocaleString('en-US')} cards`
      : String(entry.sellerName || 'Manager');
    const metaSize = fit(ctx, stockOrSeller, 100, 14, 10, 600);
    ctx.font = `600 ${metaSize}px Arial`;
    ctx.fillText(stockOrSeller, 1320, y + 40);
  });

  const footerY = headerHeight + Math.max(entries.length, 1) * rowHeight + 12;
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(36, footerY);
  ctx.lineTo(width - 36, footerY);
  ctx.stroke();
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.font = '500 14px Arial';
  ctx.fillText('Select a LISTING ID from the Discord menu below to inspect and purchase.', 48, footerY + 30);
  ctx.textAlign = 'right';
  ctx.fillText('10 LISTINGS PER PAGE  ·  LISTING ID ≠ PLAYER CARD ID', width - 48, footerY + 30);

  return canvas.toBuffer('image/png');
}

module.exports = { renderMarketTable };
