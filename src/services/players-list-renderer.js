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

function pill(ctx, x, y, width, text, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, 27, 8);
  ctx.fill();
  ctx.fillStyle = '#101720';
  ctx.textAlign = 'center';
  ctx.font = '700 13px Arial';
  ctx.fillText(text, x + width / 2, y + 18);
}

async function renderPlayersList({ rows, page, total, username }) {
  const width = 1600;
  const headerHeight = 180;
  const rowHeight = 60;
  const footerHeight = 72;
  const height = headerHeight + Math.max(rows.length, 1) * rowHeight + footerHeight;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#101925');
  bg.addColorStop(0.58, '#0d131d');
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
  ctx.fillText('MY PLAYERS', 52, 66);
  ctx.fillStyle = C.muted;
  ctx.font = '500 18px Arial';
  ctx.fillText(`${username || 'Your Club'}  ·  Player Collection`, 54, 101);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.green;
  ctx.font = '800 21px Arial';
  ctx.fillText(`${Number(total).toLocaleString('en-US')} PLAYER CARDS`, width - 54, 66);
  ctx.fillStyle = C.muted;
  ctx.font = '600 16px Arial';
  ctx.fillText(`PAGE ${page}  ·  ${rows.length} SHOWN  ·  20 PER PAGE`, width - 54, 101);

  const headings = [
    [48, '#'], [105, 'CARD ID'], [300, 'PLAYER PROFILE'], [720, 'SKILLS'],
    [1035, 'SELL PRICE'], [1195, 'DEVELOPMENT'], [1455, 'STATUS']
  ];
  ctx.fillStyle = C.muted;
  ctx.font = '800 15px Arial';
  ctx.textAlign = 'left';
  headings.forEach(([x, label]) => ctx.fillText(label, x, 160));

  rows.forEach((row, index) => {
    const y = headerHeight + index * rowHeight;
    ctx.fillStyle = index % 2 === 0 ? C.rowA : C.rowB;
    ctx.beginPath();
    ctx.roundRect(24, y, width - 48, rowHeight - 4, 9);
    ctx.fill();
    ctx.fillStyle = rarityColor(row.rarity);
    ctx.fillRect(24, y + 5, 4, rowHeight - 14);

    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted;
    ctx.font = '700 15px Arial';
    ctx.fillText(String((page - 1) * 20 + index + 1).padStart(2, '0'), 48, y + 35);

    ctx.fillStyle = '#d6dfeb';
    const id = String(row.publicId || 'PC-PENDING');
    const idSize = fit(ctx, id, 165, 14, 10, 700);
    ctx.font = `700 ${idSize}px Arial`;
    ctx.fillText(id, 105, y + 35);

    const ovr = Math.round(Number(row.currentOvr || row.overall || 0));
    ctx.fillStyle = rarityColor(row.rarity);
    ctx.beginPath();
    ctx.arc(268, y + 29, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#101720';
    ctx.textAlign = 'center';
    ctx.font = '800 15px Arial';
    ctx.fillText(String(ovr), 268, y + 34);

    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    const nameSize = fit(ctx, row.name, 360, 19, 12, 800);
    ctx.font = `800 ${nameSize}px Arial`;
    ctx.fillText(String(row.name || 'Unknown'), 300, y + 26);
    ctx.fillStyle = C.muted;
    ctx.font = '500 13px Arial';
    ctx.fillText(`${row.primaryPosition || '-'}  ·  ${row.nationality || 'Unknown'}  ·  Lv.${row.level}/50`, 301, y + 45);

    const skills = (row.skills || []).slice(0, 2).join(' · ') || 'No special skill';
    ctx.fillStyle = '#c7d1de';
    const skillSize = fit(ctx, skills, 285, 15, 10, 600);
    ctx.font = `600 ${skillSize}px Arial`;
    ctx.fillText(skills, 720, y + 36);

    ctx.fillStyle = C.green;
    ctx.font = '800 17px Arial';
    ctx.fillText(String(row.sellPriceText || '—'), 1035, y + 36);

    ctx.fillStyle = C.text;
    ctx.font = '700 14px Arial';
    ctx.fillText(`Lv.${row.level}/50`, 1195, y + 26);
    ctx.fillStyle = '#354253';
    ctx.beginPath();
    ctx.roundRect(1195, y + 36, 175, 7, 4);
    ctx.fill();
    ctx.fillStyle = C.green;
    ctx.beginPath();
    ctx.roundRect(1195, y + 36, 175 * Math.max(0, Math.min(1, Number(row.xpProgress || 0))), 7, 4);
    ctx.fill();

    const status = row.statusCode === 'IN XI' ? 'IN XI' : row.statusCode === 'LISTED' ? 'LISTED' : 'AVAILABLE';
    const statusColor = status === 'IN XI' ? '#86b8ed' : status === 'LISTED' ? C.gold : C.green;
    pill(ctx, 1455, y + 16, 112, status, statusColor);
  });

  const footerY = headerHeight + Math.max(rows.length, 1) * rowHeight + 12;
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(36, footerY);
  ctx.lineTo(width - 36, footerY);
  ctx.stroke();
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.font = '500 14px Arial';
  ctx.fillText('Select a player from the Discord menu below to open details, set in XI, or sell.', 48, footerY + 31);
  ctx.textAlign = 'right';
  ctx.fillText('PUBLIC CARD ID  ·  INTERNAL UUID HIDDEN', width - 48, footerY + 31);
  return canvas.toBuffer('image/png');
}

module.exports = { renderPlayersList };
