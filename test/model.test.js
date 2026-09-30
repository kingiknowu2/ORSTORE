// Runs the real bundled NSFW.js model (no stub) to make sure it loads offline and screens images.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const moderation = require('../moderation');

test('real NSFW model loads offline and passes a normal game image', { timeout: 120000 }, async () => {
  const hero = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'hero.jpg'));
  const v = await moderation.checkImage(hero, 'image/jpeg');
  assert.equal(v.verdict, 'safe', JSON.stringify(v));
});

test('tiny low-quality images are still checked', { timeout: 120000 }, async () => {
  const p = new PNG({ width: 12, height: 12 });
  for (let i = 0; i < p.data.length; i += 4) p.data.set([40, 90, 160, 255], i);
  const v = await moderation.checkImage(PNG.sync.write(p), 'image/png');
  assert.ok(['safe', 'unsure'].includes(v.verdict), JSON.stringify(v));
});

test('formats the server cannot decode go to a person', async () => {
  const v = await moderation.checkImage(Buffer.from('RIFF....WEBP'), 'image/webp');
  assert.equal(v.verdict, 'unsure');
});
