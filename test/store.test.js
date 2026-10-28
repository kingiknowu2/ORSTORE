// A second store from the same code: PetVault sells Pet Simulator 99 items only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4500 + Math.floor(Math.random() * 400);
const BASE = `http://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'petvault-test-'));
let server;

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, DB_PATH: path.join(TMP, 'test.db'), UPLOAD_DIR: path.join(TMP, 'up'), FILES_DIR: path.join(TMP, 'files'),
      NSFW_DISABLED: '1', DEMO_SEED: '1', STORE_NAME: 'PetVault', STORE_GAMES: 'pet simulator 99', STORE_THEME: 'petvault' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try { const r = await (await fetch(BASE + '/api/listings')).json(); if (r.listings.length >= 5) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start or seed');
});
after(() => { server.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('config carries the store name and only its games', async () => {
  const c = await (await fetch(BASE + '/api/config')).json();
  assert.equal(c.name, 'PetVault');
  assert.deepEqual(c.games, ['Pet Simulator 99']);
});

test('demo data only fills in Pet Simulator 99 items', async () => {
  const { listings } = await (await fetch(BASE + '/api/listings')).json();
  assert.equal(listings.length, 5);
  assert.ok(listings.every((l) => l.game === 'Pet Simulator 99'));
});

test('sellers cannot list games the store does not sell', async () => {
  const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'NovaTrades', password: 'demo-password' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(BASE + '/api/listings', { method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ game: 'Jailbreak', title: 'Torpedo', description: 'Car', delivers: 'Car', compatibility: 'Roblox', licence: 'single_use', price: '5', usable: true, owns_rights: true }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Pet Simulator 99/);
});

test('download denial pages use the store name', async () => {
  const html = await (await fetch(BASE + '/evidence/1')).text();
  assert.match(html, /— PetVault<\/title>/);
});

test('pages are served with the PetVault theme, logo and name', async () => {
  const html = await (await fetch(BASE + '/')).text();
  assert.match(html, /<html lang="en" data-theme="petvault">/);
  assert.match(html, /href="\/themes\/petvault\/theme\.css"/);
  assert.match(html, /src="\/themes\/petvault\/logo\.svg"/);
  assert.match(html, /Pet<b>Vault<\/b>/);
  assert.doesNotMatch(html.replace(/<script>[\s\S]*<\/script>/, ''), /Lootrova/);
  assert.equal((await fetch(BASE + '/themes/petvault/theme.css')).status, 200);
});
