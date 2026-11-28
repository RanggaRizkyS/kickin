'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src/services/card-renderer.js'), 'utf8');
const portraitBlock = renderer.match(/function drawPortraitOnTemplate\([\s\S]*?\n}\n\nfunction drawHeavyText/);

function pngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

test('Gold, Silver and Bronze keep the same 1024x1536 template dimensions', () => {
  for (const rarity of ['gold', 'silver', 'bronze']) {
    assert.deepEqual(
      pngDimensions(path.join(root, `public/img/blueprint/card-${rarity}.png`)),
      { width: 1024, height: 1536 }
    );
  }
});

test('portrait rendering uses proportional contain-fit and has no inner face clipping mask', () => {
  assert.ok(portraitBlock, 'portrait renderer function must exist');
  assert.match(portraitBlock[0], /Math\.min\(/);
  assert.match(portraitBlock[0], /maxSubjectWidth/);
  assert.match(portraitBlock[0], /maxSubjectHeight/);
  assert.doesNotMatch(portraitBlock[0], /\.clip\s*\(/);
  assert.match(portraitBlock[0], /sourceIsSmall/);
});

test('metadata and stat values stay inside the measured empty template zones', () => {
  assert.match(renderer, /subjectBottomY:\s*908/);
  assert.match(renderer, /overall: Object\.freeze\(\{ x: 108, y: 344/);
  assert.match(renderer, /position: Object\.freeze\(\{ x: 114, y: 426/);
  assert.match(renderer, /identity: Object\.freeze\(\{/);
  assert.match(renderer, /name: Object\.freeze\(\{ x: 512, y: 991, maxWidth: 850, size: 90/);
  assert.match(renderer, /valueBaseline:\s*1230/);
  assert.match(renderer, /FONT_DISPLAY/);
  assert.match(renderer, /FONT_CONDENSED/);
  assert.match(renderer, /drawBottomIdentity/);
  assert.match(renderer, /badgeImages\.league/);
  assert.match(renderer, /badgeImages\.team/);
});
