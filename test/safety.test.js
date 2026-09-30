// NSFW screening and advisory AI case summaries, run against a stubbed AI provider.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4500 + Math.floor(Math.random() * 400);
const BASE = `http://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lootrova-safety-'));
let server;
const { PNG: PngJs } = require('pngjs');
// Solid-colour test images: magenta = explicit, yellow = borderline, grey = normal (see stub-nsfw.js).
function solid(r, g, b) { const p = new PngJs({ width: 96, height: 96 }); for (let i = 0; i < p.data.length; i += 4) p.data.set([r, g, b, 255], i); return PngJs.sync.write(p); }
const IMG = { fine: solid(120, 120, 120), NSFWTEST: solid(255, 0, 255), UNSURETEST: solid(255, 255, 0) };
const dataUrl = (marker) => 'data:image/png;base64,' + IMG[marker].toString('base64');

before(async () => {
  server = spawn(process.execPath, ['--require', path.join(__dirname, 'stub-nsfw.js'), path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, DB_PATH: path.join(TMP, 'db'), UPLOAD_DIR: path.join(TMP, 'up'), FILES_DIR: path.join(TMP, 'f'), ADMIN_USERS: 'boss' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/config'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => { server.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const h = { ...(cookie && { cookie }), ...headers };
    let payload = body;
    if (body !== undefined && !(body instanceof Buffer)) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const t = await res.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
    return { status: res.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b),
    upload: (n, buf) => call('POST', '/api/files', buf, { 'content-type': 'application/octet-stream', 'x-file-name': n }) };
}
const until = async (fn) => { for (let i = 0; i < 40; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return fn(); };
async function mk(name) { const c = client(); await c.post('/api/signup', { username: name, password: 'password123' }); return c; }
async function list(s, images, title) {
  const f = await s.upload('p.zip', Buffer.from('PK ' + title));
  const r = await s.post('/api/listings', { game: 'Jailbreak', title, description: 'd', delivers: 'd', compatibility: 'c', licence: 'personal', price: '5', file_id: f.data.id, usable: true, owns_rights: true, images });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}

test('listing images are screened: unsafe removed, unsure held, safe shown', async () => {
  const s = await mk('img_seller');
  const guest = client();
  const safe = await list(s, [dataUrl('fine')], 'Safe pic');
  const bad = await list(s, [dataUrl('fine'), dataUrl('NSFWTEST')], 'Bad pic');
  const unsure = await list(s, [dataUrl('UNSURETEST')], 'Blurry pic');
  await until(async () => (await guest.get(`/api/listings/${safe}`)).status === 200);
  assert.equal((await guest.get(`/api/listings/${safe}`)).status, 200);
  assert.equal((await guest.get(`/api/listings/${bad}`)).status, 404, 'unsafe listing hidden');
  const own = (await s.get(`/api/listings/${bad}`)).data.listing;
  assert.equal(own.status, 'removed');
  assert.match(own.removal_reason, /safety check/);
  assert.equal((await guest.get(`/api/listings/${unsure}`)).status, 404, 'unsure listing held');
  const browse = (await guest.get('/api/listings')).data.listings.map((l) => l.id);
  assert.ok(browse.includes(safe) && !browse.includes(bad) && !browse.includes(unsure));

  const admin = await mk('boss');
  const checks = (await admin.get('/api/admin/image-checks')).data.checks;
  const held = checks.find((c) => c.ref_id === unsure);
  assert.equal(held.verdict, 'unsure');
  assert.equal((await s.post(`/api/admin/image-checks/${held.id}/decide`, { decision: 'approve' })).status, 403);
  assert.equal((await admin.post(`/api/admin/image-checks/${held.id}/decide`, { decision: 'approve' })).status, 200);
  assert.equal((await guest.get(`/api/listings/${unsure}`)).status, 200, 'approved by the owner');
});

test('case screenshots are screened and the evidence score is advice only', async () => {
  const s = await mk('case_s');
  const b = await mk('case_b');
  const id = await list(s, [], 'Plain');
  const co = await b.post('/api/checkout', { listing_id: id, email: 'b@example.com', consent: true });
  await b.post(`/provider/sandbox/payment_intents/${co.data.payment.intent_id}/confirm`, { client_secret: co.data.payment.client_secret, card: { number: '4242424242424242', exp_month: '12', exp_year: '34', cvc: '123' } });
  const oid = co.data.order.id;
  await b.post(`/api/orders/${oid}/sync`);
  assert.equal((await b.post(`/api/orders/${oid}/refund-request`, { reason: 'Never received the item in game.' })).status, 200);
  const bad = await b.upload('x.png', IMG.NSFWTEST);
  await until(async () => true);
  await b.post(`/api/orders/${oid}/evidence`, { note: 'see pic', file_id: bad.data.id });
  const c = await until(async () => { const r = (await b.get(`/api/orders/${oid}/case`)).data.case; return r.ai && r.evidence[0].file.safety === 'unsafe' && r; });
  assert.equal(c.evidence[0].file.safety, 'unsafe');
  assert.equal((await s.get(c.evidence[0].file.url)).status, 403, 'unsafe evidence hidden from the parties');
  assert.equal(c.ai.recommendation, 'refund_buyer', 'no recording and no seller reply favours the buyer');
  assert.match(c.ai.summary, /No trade recording from the seller \(-3\)/);
  assert.equal(c.status, 'open', 'the score never resolves the case');
  assert.equal((await b.get(`/api/orders/${oid}`)).data.order.status, 'disputed', 'order untouched until the owner decides');
});
