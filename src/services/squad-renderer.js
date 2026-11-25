const { createCanvas } = require('@napi-rs/canvas');
const { FORMATIONS } = require('../utils/football');

const C = {
  bg: '#0d141e', panel: '#202c3b', rowA: '#1b2532', rowB: '#151e29',
  text: '#edf2f7', muted: '#9eacbd', line: '#2a3748', green: '#50cf82',
  gold: '#d9b35e', silver: '#b4bfcb', bronze: '#bd896b', blue: '#86b8ed'
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

async function renderSquadTable(squad, { title = 'CLUB SQUAD', subtitle = 'Starting XI' } = {}) {
  const width = 1300;
  const headerHeight = 190;
  const rowHeight = 58;
  const footerHeight = 72;
  const height = headerHeight + 11 * rowHeight + footerHeight;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#111b28');
  bg.addColorStop(0.5, C.bg);
  bg.addColorStop(1, '#172231');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = C.panel;
  ctx.beginPath();
  ctx.roundRect(22, 18, width - 44, 120, 16);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = '800 34px Arial';
  ctx.fillText(title, 48, 64);
  ctx.fillStyle = C.muted;
  ctx.font = '500 18px Arial';
  ctx.fillText(`${subtitle}  ·  Formation ${squad.formation}  ·  ${squad.players.length}/11 players`, 50, 101);

  const summary = [
    ['TEAM OVR', Number(squad.teamOvr || 0).toFixed(3)],
    ['CHEMISTRY', `${Number(squad.teamChemistry || 0).toFixed(3)} / 100`],
    ['TEAM STRENGTH', Number(squad.teamStrength || 0).toFixed(3)]
  ];
  const startX = 760;
  summary.forEach(([label, value], index) => {
    const x = startX + index * 165;
    ctx.fillStyle = C.muted;
    ctx.font = '700 12px Arial';
    ctx.fillText(label, x, 54);
    ctx.fillStyle = index === 2 ? C.green : C.text;
    ctx.font = '800 20px Arial';
    ctx.fillText(value, x, 88);
  });

  const headings = [[48, '#'], [105, 'POSITION'], [265, 'PLAYER'], [800, 'OVR'], [940, 'CHEMISTRY'], [1100, 'LEVEL / STATUS']];
  ctx.fillStyle = C.muted;
  ctx.font = '800 14px Arial';
  headings.forEach(([x, label]) => ctx.fillText(label, x, 168));

  const formationSlots = FORMATIONS[squad.formation] || FORMATIONS['4-3-3'];
  const bySlot = new Map((squad.players || []).map(player => [player.slotKey, player]));
  formationSlots.forEach((slot, index) => {
    const player = bySlot.get(slot.key);
    const y = headerHeight + index * rowHeight;
    ctx.fillStyle = index % 2 === 0 ? C.rowA : C.rowB;
    ctx.beginPath();
    ctx.roundRect(24, y, width - 48, rowHeight - 4, 8);
    ctx.fill();
    ctx.fillStyle = player ? C.green : '#657386';
    ctx.fillRect(24, y + 6, 4, rowHeight - 16);

    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted;
    ctx.font = '700 15px Arial';
    ctx.fillText(String(index + 1).padStart(2, '0'), 48, y + 34);

    ctx.fillStyle = C.blue;
    ctx.font = '800 15px Arial';
    ctx.fillText(slot.key, 105, y + 34);
    ctx.fillStyle = C.muted;
    ctx.font = '500 12px Arial';
    ctx.fillText(slot.label, 165, y + 34);

    if (!player) {
      ctx.fillStyle = '#768396';
      ctx.font = '600 16px Arial';
      ctx.fillText('EMPTY SLOT', 265, y + 34);
      ctx.fillText('—', 800, y + 34);
      ctx.fillText('—', 940, y + 34);
      ctx.fillText('—', 1100, y + 34);
      return;
    }

    const rarity = player.player?.rarity || (Number(player.player?.overall) >= 81 ? 'gold' : Number(player.player?.overall) >= 70 ? 'silver' : 'bronze');
    const rarityColor = rarity === 'gold' ? C.gold : rarity === 'silver' ? C.silver : C.bronze;
    const nameSize = fit(ctx, player.player?.name || 'Unknown', 490, 18, 12, 800);
    ctx.fillStyle = C.text;
    ctx.font = `800 ${nameSize}px Arial`;
    ctx.fillText(String(player.player?.name || 'Unknown'), 265, y + 25);
    ctx.fillStyle = C.muted;
    ctx.font = '500 12px Arial';
    ctx.fillText(`${player.player?.nationality?.country || 'Unknown'}  ·  ${player.player?.role?.name || 'Player'}`, 266, y + 43);

    ctx.fillStyle = rarityColor;
    ctx.font = '800 17px Arial';
    ctx.fillText(String(Math.round(Number(player.currentOvr || 0))), 800, y + 35);
    ctx.fillStyle = C.text;
    ctx.font = '700 15px Arial';
    ctx.fillText(Number(player.chemistry || 0).toFixed(1), 940, y + 35);
    ctx.fillStyle = C.muted;
    ctx.font = '600 13px Arial';
    ctx.fillText(`Lv.${player.level || 1}/50`, 1100, y + 35);
  });

  const footerY = headerHeight + 11 * rowHeight + 10;
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(36, footerY);
  ctx.lineTo(width - 36, footerY);
  ctx.stroke();
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.font = '500 14px Arial';
  ctx.fillText('Pilih posisi lalu pilih kartu melalui dropdown Discord di bawah tabel.', 48, footerY + 30);
  ctx.textAlign = 'right';
  ctx.fillText('ONE ACTIVE SQUAD PER USER', width - 48, footerY + 30);

  return canvas.toBuffer('image/png');
}

module.exports = { renderSquadTable };
