// End-to-end API tests for the purchase, seller, refund, download and moderation flows.
// Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3900 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lootrova-test-'));
const DB_PATH = path.join(TMP, 'test.db');
let server;

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, DB_PATH, UPLOAD_DIR: path.join(TMP, 'up'), FILES_DIR: path.join(TMP, 'files'), ADMIN_USERS: 'admin', NSFW_DISABLED: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/config'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { server.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body, opts = {}) => {
    const headers = { ...(cookie && { cookie }), ...opts.headers };
    let payload;
    if (body instanceof Buffer) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b = {}) => call('POST', u, b),
    upload: (name, buf) => call('POST', '/api/files', buf, { headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) } }),
    logout() { return call('POST', '/api/logout', {}); },
  };
}
async function user(name) {
  const c = client();
  const r = await c.post('/api/signup', { username: name, password: 'password123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  c.name = name;
  return c;
}
const CARD_OK = { number: '4242 4242 4242 4242', exp_month: '12', exp_year: '34', cvc: '123' };
const CARD_DECLINE = { ...CARD_OK, number: '4000 0000 0000 0002' };

async function listItem(seller, over = {}) {
  const file = await seller.upload(over.fileName || 'pack.zip', Buffer.from('PK\x03\x04 test product ' + Math.random()));
  assert.equal(file.status, 200, JSON.stringify(file.data));
  const r = await seller.post('/api/listings', {
    game: 'Blox Fruits', title: 'Test Pack', description: 'A test product.', delivers: 'One ZIP with 20 skins', compatibility: 'Windows, CS2',
    requirements: '', licence: 'personal', price: '10', copies: 'unlimited', file_id: file.data.id, usable: true, owns_rights: true, ...over,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}
async function pay(buyer, listingId, card = CARD_OK, extra = {}) {
  const co = await buyer.post('/api/checkout', { listing_id: listingId, email: 'buyer@example.com', consent: true, ...extra });
  if (co.status !== 200) return { checkout: co };
  const conf = await buyer.post(`/provider/sandbox/payment_intents/${co.data.payment.intent_id}/confirm`, { client_secret: co.data.payment.client_secret, card });
  const sync = await buyer.post(`/api/orders/${co.data.order.id}/sync`, {});
  return { checkout: co, confirm: conf, order: sync.data.order };
}
async function deliver(seller, orderId) {
  const rec = await seller.upload('trade-recording.mp4', Buffer.from('fake mp4 recording ' + orderId));
  const r = await seller.post(`/api/orders/${orderId}/deliver`, { file_id: rec.data.id, recorded: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
const dash = async (c) => (await c.get('/api/dashboard')).data;
const db = () => new DatabaseSync(DB_PATH);

let seller, sellerB, buyerA, buyerB, admin;
test('setup accounts', async () => {
  seller = await user('seller_one');
  sellerB = await user('seller_two');
  buyerA = await user('buyer_a');
  buyerB = await user('buyer_b');
  admin = await user('admin');
  assert.equal((await admin.get('/api/me')).data.user.role, 'admin');
});

test('Flow 12: listing needs all required info and ownership confirmation', async () => {
  const file = await seller.upload('pack.zip', Buffer.from('PK test'));
  const base = { game: 'Blox Fruits', title: 'Pack', description: 'Desc', delivers: 'ZIP', compatibility: 'PC', licence: 'personal', price: '5', file_id: file.data.id, usable: true, owns_rights: true };
  let r = await seller.post('/api/listings', { ...base, delivers: '', compatibility: '' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /what the buyer receives/);
  r = await seller.post('/api/listings', { ...base, file_id: undefined });
  assert.match(r.data.error, /product file/);
  r = await seller.post('/api/listings', { ...base, owns_rights: false });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /own this content/);
  r = await seller.post('/api/listings', base);
  assert.equal(r.status, 200);
});

test('executables and disallowed file types are rejected', async () => {
  assert.equal((await seller.upload('game.exe', Buffer.from('MZ....'))).status, 400);
  const r = await seller.upload('game.zip', Buffer.from('MZ\x90\x00 disguised program'));
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Programs/);
});

test('Flows 1 & 2: consent required, normal purchase, download, library, persists after re-login', async () => {
  const id = await listItem(seller, { title: 'Normal Product' });
  const page = (await buyerA.get(`/api/listings/${id}`)).data.listing;
  assert.equal(page.title, 'Normal Product');
  assert.equal(page.seller, 'seller_one');
  assert.equal(page.price_cents, 1000);
  assert.equal(page.purchasable, true);

  const q = (await buyerA.get(`/api/checkout/${id}`)).data.quote;
  assert.deepEqual([q.product_title, q.seller, q.price_cents, q.buyer_fee_cents, q.total_cents], ['Normal Product', 'seller_one', 1000, 0, 1000]);

  const noConsent = await buyerA.post('/api/checkout', { listing_id: id, email: 'a@example.com', consent: false });
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.data.field, 'consent');
  assert.match(noConsent.data.error, /right to cancel/);
  const badEmail = await buyerA.post('/api/checkout', { listing_id: id, email: 'nope', consent: true });
  assert.equal(badEmail.data.field, 'email');

  const { confirm, order } = await pay(buyerA, id);
  assert.equal(confirm.status, 200);
  assert.equal(order.status, 'paid');
  assert.equal(order.product_title, 'Normal Product');
  assert.equal(order.total_cents, 1000);
  assert.match(order.receipt_no, /^LR-\d{4}-\d{6}$/);
  assert.equal(order.card.last4, '4242');
  assert.equal(order.download_url, `/download/${order.id}`);
  const count = db().prepare('SELECT COUNT(*) AS n FROM orders WHERE listing_id = ? AND status = ?').get(id, 'paid').n;
  assert.equal(count, 1);

  const dl = await buyerA.get(order.download_url);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="pack.zip"/);
  assert.match(dl.data, /test product/);

  assert.ok((await dash(buyerA)).library.some((o) => o.id === order.id && o.can_download));
  await buyerA.logout();
  assert.equal((await buyerA.get('/api/dashboard')).status, 401);
  await buyerA.post('/api/login', { username: 'buyer_a', password: 'password123' });
  assert.ok((await dash(buyerA)).library.some((o) => o.id === order.id));
  assert.equal((await buyerA.get(order.download_url)).status, 200);

  const again = await buyerA.post('/api/checkout', { listing_id: id, email: 'a@example.com', consent: true });
  assert.equal(again.status, 409, 'buying something you already own is blocked');
});

test('Flows 3 & 4: failed payment gives nothing, retry reuses the order', async () => {
  const id = await listItem(seller, { title: 'Retry Product' });
  const before = (await dash(seller)).balances;
  const first = await pay(buyerB, id, CARD_DECLINE);
  assert.equal(first.confirm.status, 402);
  assert.match(first.confirm.data.error.message, /declined/);
  assert.equal(first.order.status, 'awaiting_payment');
  assert.equal(first.order.can_download, false);
  assert.match(first.order.last_payment_error, /declined/);
  assert.equal((await buyerB.get(`/download/${first.order.id}`)).status, 403);
  assert.deepEqual((await dash(seller)).balances, before, 'seller earnings unchanged after a failed payment');
  assert.ok(!(await dash(buyerB)).library.some((o) => o.id === first.order.id));

  const retry = await pay(buyerB, id, CARD_OK);
  assert.equal(retry.checkout.data.order.id, first.order.id, 'retry uses the same order');
  assert.equal(retry.order.status, 'paid');
  const rows = db().prepare('SELECT status FROM orders WHERE listing_id = ? AND buyer_id = (SELECT id FROM users WHERE username = ?)').all(id, 'buyer_b');
  assert.deepEqual(rows.map((r) => r.status), ['paid']);
  const attempts = db().prepare('SELECT status FROM payment_attempts WHERE order_id = ? ORDER BY id').all(first.order.id).map((r) => r.status);
  assert.deepEqual(attempts, ['failed', 'succeeded'], 'both attempts are recorded');
});

test('Flow 5: rapid double clicks create one order and one charge', async () => {
  const id = await listItem(seller, { title: 'Double Click Product' });
  const c = await user('double_clicker');
  const [a, b] = await Promise.all([1, 2].map(() => c.post('/api/checkout', { listing_id: id, email: 'd@example.com', consent: true })));
  assert.equal(a.data.order.id, b.data.order.id);
  const { intent_id, client_secret } = a.data.payment;
  const confirms = await Promise.all([1, 2, 3, 4].map(() => c.post(`/provider/sandbox/payment_intents/${intent_id}/confirm`, { client_secret, card: CARD_OK })));
  assert.ok(confirms.every((r) => r.status === 200));
  await c.post(`/api/orders/${a.data.order.id}/sync`, {});
  const d = db();
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM orders WHERE listing_id = ?').get(id).n, 1);
  assert.equal(d.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE type = 'purchase' AND order_id = ?`).get(a.data.order.id).n, 1);
  assert.equal(d.prepare(`SELECT COUNT(*) AS n FROM payment_attempts WHERE order_id = ? AND status = 'succeeded'`).get(a.data.order.id).n, 1);
});

test('Flow 6: seller dashboard shows gross, fee, earnings and balances for a 10.00 sale', async () => {
  const s = await user('fresh_seller');
  const b = await user('fresh_buyer');
  const id = await listItem(s, { price: '10' });
  const { order } = await pay(b, id);
  const d = await dash(s);
  assert.deepEqual(d.totals, { gross_cents: 1000, fee_cents: 100, net_cents: 900, refunded_cents: 0 });
  assert.deepEqual(d.balances, { pending_cents: 900, available_cents: 0 });
  const sale = d.sales.find((x) => x.id === order.id);
  assert.deepEqual([sale.price_cents, sale.fee_cents, sale.net_cents, sale.status], [1000, 100, 900, 'paid']);
  assert.ok(new Date(sale.available_at) > new Date(), 'earnings have a future release date');

  // Buyer confirms the item works: earnings move from pending to available, then the seller cashes out.
  await deliver(s, order.id);
  assert.equal((await b.post(`/api/orders/${order.id}/confirm`, { stars: 5 })).status, 200);
  assert.deepEqual((await dash(s)).balances, { pending_cents: 0, available_cents: 900 });
  const p = await s.post('/api/payouts', {});
  assert.equal(p.status, 200);
  assert.equal(p.data.payout.amount_cents, 900);
  let d2 = await dash(s);
  assert.equal(d2.balances.available_cents, 0);
  assert.equal(d2.payouts[0].status, 'requested');
  assert.equal((await s.post(`/api/admin/payouts/${p.data.payout.id}/paid`, {})).status, 403, 'sellers cannot mark payouts paid');
  assert.equal((await admin.post(`/api/admin/payouts/${p.data.payout.id}/paid`, { reference: 'BANK-1' })).status, 200);
  d2 = await dash(s);
  assert.equal(d2.payouts[0].status, 'paid');
});

test('Flow 7: refund request and refund adjust status, earnings and records', async () => {
  const s = await user('refund_seller');
  const b = await user('refund_buyer');
  const id = await listItem(s, { price: '20' });
  const { order } = await pay(b, id);
  assert.equal((await dash(s)).balances.pending_cents, 1800);
  assert.equal((await b.post(`/api/orders/${order.id}/refund-request`, { reason: 'short' })).status, 400);
  assert.equal((await b.post(`/api/orders/${order.id}/refund-request`, { reason: 'The files are corrupted and will not open.' })).status, 200);
  assert.equal((await b.get(`/api/orders/${order.id}`)).data.order.status, 'disputed');
  assert.equal((await sellerB.post(`/api/orders/${order.id}/refund`, {})).status, 404, 'other sellers cannot refund');
  assert.equal((await s.post(`/api/orders/${order.id}/refund`, {})).status, 200);
  const o = (await b.get(`/api/orders/${order.id}`)).data.order;
  assert.equal(o.status, 'refunded');
  assert.equal(o.can_download, false);
  assert.equal((await b.get(`/download/${order.id}`)).status, 403);
  const d = await dash(s);
  assert.deepEqual(d.balances, { pending_cents: 0, available_cents: 0 });
  assert.equal(d.totals.gross_cents, 0);
  assert.equal(d.totals.refunded_cents, 2000);
  const types = db().prepare('SELECT type, amount_cents FROM ledger WHERE order_id = ? ORDER BY id').all(order.id).map((r) => `${r.type}:${r.amount_cents}`);
  assert.deepEqual(types, ['purchase:2000', 'platform_fee:200', 'seller_earning:1800', 'refund:-2000', 'fee_reversal:-200', 'earning_reversal:-1800']);
  const sbx = db().prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM sandbox_refunds r JOIN orders o ON o.payment_intent_id = r.intent_id WHERE o.id = ?').get(order.id).n;
  assert.equal(sbx, 2000, 'refund went through the payment provider');
});

test('chargebacks reverse released earnings', async () => {
  const s = await user('cb_seller');
  const b = await user('cb_buyer');
  const { order } = await pay(b, await listItem(s, { price: '10' }));
  await deliver(s, order.id);
  await b.post(`/api/orders/${order.id}/confirm`, { stars: 4 });
  assert.equal((await dash(s)).balances.available_cents, 900);
  assert.equal((await s.post(`/api/admin/orders/${order.id}/chargeback`, {})).status, 403);
  assert.equal((await admin.post(`/api/admin/orders/${order.id}/chargeback`, {})).status, 200);
  assert.deepEqual((await dash(s)).balances, { pending_cents: 0, available_cents: 0 });
  assert.equal((await b.get(`/api/orders/${order.id}`)).data.order.status, 'chargeback');
  assert.equal((await dash(s)).totals.refunded_cents, 1000);

  // A chargeback after the money was paid out leaves the seller owing it (negative balance).
  const second = await pay(b, await listItem(s, { price: '10' }));
  await deliver(s, second.order.id);
  await b.post(`/api/orders/${second.order.id}/confirm`, { stars: 5 });
  assert.equal((await s.post('/api/payouts', {})).status, 200);
  await admin.post(`/api/admin/orders/${second.order.id}/chargeback`, {});
  assert.deepEqual((await dash(s)).balances, { pending_cents: 0, available_cents: -900 });
});

test('Flows 8 & 9: downloads are only for the logged-in buyer', async () => {
  const id = await listItem(seller, { title: 'Private Product' });
  const { order } = await pay(buyerA, id);
  const other = await buyerB.get(`/download/${order.id}`);
  assert.equal(other.status, 403);
  assert.doesNotMatch(String(other.data), /test product/);
  assert.equal((await buyerB.get(`/api/orders/${order.id}`)).status, 404, 'cannot view another buyer’s order');
  assert.equal((await buyerB.post(`/api/orders/${order.id}/confirm`, {})).status, 404, 'cannot modify another buyer’s order');
  const anon = client();
  const r = await anon.get(`/download/${order.id}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/#/login?next=${encodeURIComponent('/download/' + order.id)}`);
  assert.equal((await anon.get('/download/999999')).status, 302);
  assert.equal((await client().get('/storage/files/x')).data.includes?.('test product'), false);
});

test('Flows 10 & 11: price and fee manipulation is ignored', async () => {
  const id = await listItem(seller, { title: 'Tamper Product', price: '25' });
  const c = await user('tamperer');
  const co = await c.post('/api/checkout', { listing_id: id, email: 't@example.com', consent: true, price_cents: 1, price: '0.01', total_cents: 1, fee_cents: 0, buyer_fee_cents: -500 });
  assert.equal(co.status, 200);
  assert.equal(co.data.order.total_cents, 2500);
  const intent = db().prepare('SELECT amount FROM sandbox_intents WHERE id = ?').get(co.data.payment.intent_id);
  assert.equal(intent.amount, 2500, 'provider is charged the real price');
  const mismatch = await c.post('/api/checkout', { listing_id: id, email: 't@example.com', consent: true, expected_total_cents: 1 });
  assert.equal(mismatch.status, 409);
  await c.post(`/provider/sandbox/payment_intents/${co.data.payment.intent_id}/confirm`, { client_secret: co.data.payment.client_secret, card: CARD_OK });
  await c.post(`/api/orders/${co.data.order.id}/sync`, {});
  const row = db().prepare('SELECT price_cents, fee_cents, total_cents FROM orders WHERE id = ?').get(co.data.order.id);
  assert.deepEqual({ ...row }, { price_cents: 2500, fee_cents: 250, total_cents: 2500 });
  assert.equal((await c.post(`/provider/sandbox/payment_intents/${co.data.payment.intent_id}/confirm`, { client_secret: 'wrong', card: CARD_OK })).status, 402);
});

test('client cannot mark an order paid without the provider', async () => {
  const id = await listItem(seller, { title: 'Fake Paid Product' });
  const c = await user('faker');
  const co = await c.post('/api/checkout', { listing_id: id, email: 'f@example.com', consent: true });
  const sync = await c.post(`/api/orders/${co.data.order.id}/sync`, { status: 'paid', paid: true, payment_successful: true });
  assert.equal(sync.data.order.status, 'awaiting_payment');
  assert.equal((await c.get(`/download/${co.data.order.id}`)).status, 403);
});

test('Flow 13: sellers cannot edit, remove or see other sellers’ listings and sales', async () => {
  const id = await listItem(seller, { title: 'Seller A Product' });
  const edit = await sellerB.post(`/api/listings/${id}/edit`, { title: 'Hacked', price: '0.5' });
  assert.equal(edit.status, 403);
  assert.equal((await sellerB.post(`/api/listings/${id}/remove`, {})).status, 403);
  assert.equal((await buyerA.get(`/api/listings/${id}`)).data.listing.title, 'Seller A Product');
  const d = await dash(sellerB);
  assert.equal(d.sales.length, 0);
  assert.ok(!d.listings.some((l) => l.id === id));
  // The owner can edit their own listing.
  const l = (await seller.get(`/api/listings/${id}`)).data.listing;
  const ok = await seller.post(`/api/listings/${id}/edit`, { ...l, title: 'Seller A Product v2', price: '12', copies: 'unlimited', usable: true, owns_rights: true, file_id: undefined });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await buyerA.get(`/api/listings/${id}`)).data.listing.price_cents, 1200);
});

test('Flow 14: reports are stored with product, reason and reporter, and admins can review them', async () => {
  const id = await listItem(seller, { title: 'Reported Product' });
  assert.equal((await buyerB.post(`/api/listings/${id}/report`, { category: 'bogus', details: 'x' })).status, 400);
  const r = await buyerB.post(`/api/listings/${id}/report`, { category: 'malware', details: 'The zip contains a virus according to my scanner.' });
  assert.equal(r.status, 200);
  const cr = await client().post(`/api/listings/${id}/report`, { category: 'copyright', details: 'This is my artwork copied without permission.', contact_name: 'Jo Artist', contact_email: 'jo@example.com', original_work: 'https://example.com/portfolio', good_faith: false });
  assert.equal(cr.status, 400, 'copyright reports need the good-faith statement');
  assert.equal((await client().post(`/api/listings/${id}/report`, { category: 'copyright', details: 'This is my artwork copied without permission.', contact_name: 'Jo Artist', contact_email: 'jo@example.com', original_work: 'https://example.com/portfolio', good_faith: true })).status, 200);
  assert.equal((await buyerB.get('/api/admin/overview')).status, 403, 'non-admins cannot see moderation');
  const reports = (await admin.get('/api/admin/overview')).data.reports.filter((x) => x.listing_id === id);
  assert.equal(reports.length, 2);
  const malware = reports.find((x) => x.category === 'malware');
  assert.equal(malware.reporter, 'buyer_b');
  assert.equal(malware.title, 'Reported Product');
  assert.equal((await admin.post(`/api/admin/reports/${malware.id}/resolve`, { action: 'dismiss', note: 'Scanned clean' })).status, 200);
});

test('Flow 15: removed listings cannot be bought but history and legitimate access stay', async () => {
  const id = await listItem(seller, { title: 'To Remove' });
  const { order } = await pay(buyerA, id);
  const pending = await buyerB.post('/api/checkout', { listing_id: id, email: 'b@example.com', consent: true });
  assert.equal((await buyerB.post(`/api/admin/listings/${id}/remove`, { reason: 'x' })).status, 403);
  assert.equal((await admin.post(`/api/admin/listings/${id}/remove`, { reason: 'Misleading listing' })).status, 200);
  assert.equal((await buyerB.post('/api/checkout', { listing_id: id, email: 'b@example.com', consent: true })).status, 404);
  const late = await buyerB.post(`/provider/sandbox/payment_intents/${pending.data.payment.intent_id}/confirm`, { client_secret: pending.data.payment.client_secret, card: CARD_OK });
  assert.equal(late.status, 402, 'open checkouts are cancelled when a listing is removed');
  assert.equal((await buyerB.get(`/api/listings/${id}`)).status, 404);
  assert.equal((await buyerA.get(`/api/orders/${order.id}`)).data.order.status, 'paid', 'order record kept');
  assert.equal((await buyerA.get(`/download/${order.id}`)).status, 200, 'buyer keeps access to a legitimate purchase');
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM ledger WHERE order_id = ?').get(order.id).n, 3);

  const bad = await listItem(seller, { title: 'Malware Product' });
  const bought = await pay(buyerA, bad);
  await admin.post(`/api/admin/listings/${bad}/remove`, { reason: 'Malware confirmed', revoke_access: true });
  assert.equal((await buyerA.get(`/download/${bought.order.id}`)).status, 403, 'downloads revoked for confirmed malware');
});

test('suspended sellers cannot list, sell or cash out', async () => {
  const s = await user('bad_seller');
  const id = await listItem(s);
  const sid = db().prepare('SELECT id FROM users WHERE username = ?').get('bad_seller').id;
  assert.equal((await buyerA.post(`/api/admin/users/${sid}/suspend`, {})).status, 403);
  assert.equal((await admin.post(`/api/admin/users/${sid}/suspend`, { reason: 'Stolen content' })).status, 200);
  const file = await s.upload('x.zip', Buffer.from('PK'));
  assert.equal(file.status, 403);
  assert.equal((await s.post('/api/listings', {})).status, 403);
  assert.equal((await s.post('/api/payouts', {})).status, 403);
  assert.equal((await buyerA.get(`/api/listings/${id}`)).status, 404);
  assert.equal((await buyerA.post('/api/checkout', { listing_id: id, email: 'a@example.com', consent: true })).status, 404);
  assert.ok(!(await buyerA.get('/api/listings')).data.listings.some((l) => l.id === id));
  await admin.post(`/api/admin/users/${sid}/unsuspend`, {});
  assert.equal((await buyerA.get(`/api/listings/${id}`)).status, 200);
});

test('single-copy items sell once', async () => {
  const id = await listItem(seller, { title: 'One Code', copies: 'single', licence: 'single_use' });
  const c1 = await user('code_buyer_1');
  const c2 = await user('code_buyer_2');
  assert.equal((await pay(c1, id)).order.status, 'paid');
  const r = await c2.post('/api/checkout', { listing_id: id, email: 'c@example.com', consent: true });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /sold out/);
});

test('buyers cannot buy their own items; ledger is append-only', async () => {
  const id = await listItem(seller);
  assert.equal((await seller.post('/api/checkout', { listing_id: id, email: 's@example.com', consent: true })).status, 400);
  const d = db();
  assert.throws(() => d.exec('UPDATE ledger SET amount_cents = 0'), /append-only/);
  assert.throws(() => d.exec('DELETE FROM ledger'), /append-only/);
});

test('support messages and cross-site form posts', async () => {
  assert.equal((await client().post('/api/support', { name: 'A', email: 'a@example.com', subject: 'Help', message: 'I need help with my order please.' })).status, 200);
  assert.ok((await admin.get('/api/admin/overview')).data.support.length >= 1);
  const r = await fetch(BASE + '/api/support', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
});

test('order chat and required buyer info (e.g. in-game username)', async () => {
  const s = await user('chat_seller');
  const b = await user('chat_buyer');
  const id = await listItem(s, { title: 'Needs Username', buyer_info_label: 'Your Roblox username' });
  assert.equal((await b.get(`/api/checkout/${id}`)).data.quote.buyer_info_label, 'Your Roblox username');
  const missing = await b.post('/api/checkout', { listing_id: id, email: 'c@example.com', consent: true });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.field, 'buyer_info');
  const { order } = await pay(b, id, CARD_OK, { buyer_info: 'CoolKid123' });
  assert.equal(order.buyer_info, 'CoolKid123');
  assert.equal((await dash(s)).sales[0].buyer_info, 'CoolKid123', 'seller sees the username');

  assert.equal((await b.post(`/api/orders/${order.id}/messages`, { body: 'Hi! Add me: CoolKid123' })).status, 200);
  assert.equal((await s.post(`/api/orders/${order.id}/messages`, { body: 'Sent the trade now.' })).status, 200);
  const thread = (await b.get(`/api/orders/${order.id}/messages`)).data.messages;
  assert.deepEqual(thread.map((m) => [m.sender, m.side]), [['chat_buyer', 'buyer'], ['chat_seller', 'seller']]);
  assert.equal((await buyerB.get(`/api/orders/${order.id}/messages`)).status, 404, 'outsiders cannot read the chat');
  assert.equal((await buyerB.post(`/api/orders/${order.id}/messages`, { body: 'hi' })).status, 404);
  assert.equal((await b.post(`/api/orders/${order.id}/messages`, { body: '  ' })).status, 400);

  const unpaid = await (await user('chat_unpaid')).post('/api/checkout', { listing_id: id, email: 'u@example.com', consent: true, buyer_info: 'x' });
  assert.equal(unpaid.status, 200);
});

test('members can follow each other and see a feed', async () => {
  const s = await user('follow_seller');
  const f = await user('follow_fan');
  const id = await listItem(s, { title: 'Followed Item' });
  assert.equal((await f.post('/api/follow', { username: 'follow_fan' })).status, 400, 'no self-follow');
  const r = await f.post('/api/follow', { username: 'follow_seller' });
  assert.deepEqual(r.data, { following: true, followers: 1 });
  await f.post('/api/follow', { username: 'follow_seller' });
  const prof = (await f.get('/api/profile?u=follow_seller')).data;
  assert.equal(prof.profile.followers, 1, 'following twice counts once');
  assert.equal(prof.profile.is_following, true);
  assert.ok(prof.listings.some((l) => l.id === id));
  assert.ok((await f.get('/api/feed')).data.listings.some((l) => l.id === id));
  assert.equal((await f.post('/api/follow', { username: 'follow_seller', follow: false })).data.followers, 0);
  assert.equal((await f.get('/api/feed')).data.listings.length, 0);
  assert.equal((await client().post('/api/follow', { username: 'follow_seller' })).status, 401);
  assert.equal((await f.get('/api/profile?u=nobody_here')).status, 404);
});

test('only supported Roblox games can be listed', async () => {
  const s = await user('game_seller');
  const file = await s.upload('x.zip', Buffer.from('PK'));
  const r = await s.post('/api/listings', { game: 'CS2', title: 't', description: 'd', delivers: 'd', compatibility: 'c', licence: 'personal', price: '5', file_id: file.data.id, usable: true, owns_rights: true });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Pet Simulator 99/);
  assert.deepEqual((await s.get('/api/config')).data.games, ['Pet Simulator 99', 'Steal a Brainrot', 'Jailbreak', 'Blox Fruits']);
});

test('both sides must confirm: seller delivery needs a recording, buyer alone does not release money', async () => {
  const s = await user('both_seller');
  const b = await user('both_buyer');
  const { order } = await pay(b, await listItem(s, { price: '10' }));
  assert.equal((await b.post(`/api/orders/${order.id}/confirm`, { stars: 5 })).status, 200);
  assert.deepEqual((await dash(s)).balances, { pending_cents: 900, available_cents: 0 }, 'buyer confirmation alone does not pay out');
  assert.equal((await s.post(`/api/orders/${order.id}/deliver`, { recorded: true })).status, 400, 'recording required');
  const rec = await s.upload('rec.mp4', Buffer.from('video'));
  assert.equal((await s.post(`/api/orders/${order.id}/deliver`, { file_id: rec.data.id })).status, 400, 'must acknowledge the rules');
  assert.equal((await b.post(`/api/orders/${order.id}/deliver`, { file_id: rec.data.id, recorded: true })).status, 404, 'buyer cannot mark delivered');
  await deliver(s, order.id);
  assert.deepEqual((await dash(s)).balances, { pending_cents: 0, available_cents: 900 }, 'released once both confirmed');
  const o = (await b.get(`/api/orders/${order.id}`)).data.order;
  assert.ok(o.seller_delivered_at && o.buyer_confirmed_at);
});

test('missing confirmations open a case with evidence; admin resolves it', async () => {
  const s = await user('case_seller');
  const b = await user('case_buyer');
  const { order } = await pay(b, await listItem(s, { price: '10' }));
  await deliver(s, order.id);
  // Simulate the deadline passing without the buyer confirming.
  db().prepare('UPDATE orders SET available_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', order.id);
  await s.get('/api/me');
  const c = (await b.get(`/api/orders/${order.id}/case`)).data.case;
  assert.ok(c, 'case opened automatically');
  assert.match(c.reason, /buyer did not confirm/);
  assert.equal(c.evidence[0].by, 'seller', 'seller recording is included as evidence');
  assert.equal((await b.get(`/api/orders/${order.id}`)).data.order.status, 'disputed');
  assert.equal((await b.post(`/api/orders/${order.id}/evidence`, { note: 'I never got the item in game.' })).status, 200);
  assert.equal((await buyerB.post(`/api/orders/${order.id}/evidence`, { note: 'x' })).status, 404);
  const evUrl = c.evidence[0].file.url;
  assert.equal((await b.get(evUrl)).status, 200, 'buyer can view seller recording');
  assert.equal((await buyerB.get(evUrl)).status, 403, 'outsiders cannot');
  const cases = (await admin.get('/api/admin/cases')).data.cases;
  const mine = cases.find((x) => x.order.id === order.id);
  assert.equal(mine.evidence.length, 2);
  assert.equal((await b.post(`/api/admin/cases/${mine.id}/resolve`, { decision: 'pay_seller' })).status, 403);
  assert.equal((await admin.post(`/api/admin/cases/${mine.id}/resolve`, { decision: 'pay_seller' })).status, 200);
  assert.deepEqual((await dash(s)).balances, { pending_cents: 0, available_cents: 900 });
});

test('seller online status and delivery average after 4 sales', async () => {
  const s = await user('speedy_seller');
  let p = (await s.get('/api/profile?u=speedy_seller')).data.profile;
  assert.equal(p.presence.online, false);
  assert.equal((await s.post('/api/presence', { online: true })).data.presence.online, true);
  p = (await client().get('/api/profile?u=speedy_seller')).data.profile;
  assert.equal(p.presence.online, true);
  assert.equal(p.delivery.avg_delivery_minutes, null, 'hidden before 4 sales');
  const b = await user('speedy_buyer');
  const id = await listItem(s, { price: '1' });
  for (let i = 0; i < 4; i++) {
    const { order } = await pay(b, await listItem(s, { price: '1', title: 'Speed ' + i }));
    await deliver(s, order.id);
    if (i < 3) assert.equal((await client().get('/api/profile?u=speedy_seller')).data.profile.delivery.avg_delivery_minutes, null);
  }
  const d = (await client().get('/api/profile?u=speedy_seller')).data.profile.delivery;
  assert.equal(d.delivered, 4);
  assert.ok(d.avg_delivery_minutes >= 1);
  assert.equal((await s.post('/api/presence', { online: false })).data.presence.online, false);
  assert.ok(id);
});

test('boosts: paid, labelled, listed first, own listings only', async () => {
  const s = await user('boost_seller');
  const other = await user('boost_other');
  const plain = await listItem(s, { title: 'Plain item' });
  const star = await listItem(s, { title: 'Boosted item' });
  await listItem(s, { title: 'Newest item' });
  assert.equal((await other.post(`/api/listings/${star}/boost`, { tier: '24h' })).status, 403);
  const b = await s.post(`/api/listings/${star}/boost`, { tier: '24h', price: 1 });
  assert.equal(b.status, 200);
  assert.equal(b.data.payment.amount_cents, 99, 'server price, not client');
  let listed = (await client().get('/api/listings')).data.listings;
  assert.ok(!listed[0].boosted_until, 'not boosted before payment');
  const bad = await s.post(`/provider/sandbox/payment_intents/${b.data.payment.intent_id}/confirm`, { client_secret: b.data.payment.client_secret, card: CARD_DECLINE });
  assert.equal(bad.status, 402);
  await s.post(`/provider/sandbox/payment_intents/${b.data.payment.intent_id}/confirm`, { client_secret: b.data.payment.client_secret, card: CARD_OK });
  const synced = (await s.post(`/api/boosts/${b.data.boost_id}/sync`, {})).data.boost;
  assert.equal(synced.status, 'active');
  listed = (await client().get('/api/listings')).data.listings;
  assert.equal(listed[0].id, star, 'boosted listing shows first');
  assert.ok(listed[0].boosted_until);
  assert.ok(!listed.find((l) => l.id === plain).boosted_until);
});

test('macro subscriptions: plans, quota of 100, unlimited plan, key-only macro API', async () => {
  const s = await user('macro_seller');
  const plans = (await s.get('/api/plans')).data.plans;
  assert.deepEqual(plans.map((p) => [p.id, p.monthly_limit]), [['macro_basic', 100], ['macro_unlimited', null]]);
  assert.ok(plans[1].price > plans[0].price);
  assert.equal((await s.post('/api/macro-key', {})).status, 403, 'no key without a plan');
  const sub = await s.post('/api/subscriptions', { plan: 'macro_basic', consent: true });
  await s.post(`/provider/sandbox/payment_intents/${sub.data.payment.intent_id}/confirm`, { client_secret: sub.data.payment.client_secret, card: CARD_OK });
  const cur = (await s.post(`/api/subscriptions/${sub.data.subscription_id}/sync`, {})).data.current;
  assert.equal(cur.limit, 100);
  const key = (await s.post('/api/macro-key', {})).data.key;
  assert.match(key, /^mk_/);
  const macro = async (method, url, body) => {
    const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  assert.equal((await macro('GET', '/api/macro/status')).data.plan.remaining, 100);
  assert.equal((await macro('GET', '/api/dashboard')).status, 401, 'macro key cannot reach the rest of the site');
  const b = await user('macro_buyer');
  const { order } = await pay(b, await listItem(s, { title: 'Macro sale' }));
  assert.ok((await macro('GET', '/api/macro/orders')).data.orders.some((o) => o.id === order.id));
  const st = await macro('POST', `/api/macro/orders/${order.id}/start`, {});
  assert.equal(st.data.plan.used, 1);
  assert.equal((await macro('POST', `/api/macro/orders/${order.id}/start`, {})).data.plan.used, 1, 'same order counts once');
  // Use up the allowance.
  const sid = db().prepare('SELECT id FROM users WHERE username = ?').get('macro_seller').id;
  const ins = db().prepare('INSERT INTO macro_usage (user_id, order_id, created_at) VALUES (?, ?, ?)');
  for (let i = 0; i < 99; i++) ins.run(sid, 100000 + i, new Date().toISOString());
  const { order: o2 } = await pay(b, await listItem(s, { title: 'Over quota' }));
  assert.equal((await macro('POST', `/api/macro/orders/${o2.id}/start`, {})).status, 429);
  // Upgrading to unlimited replaces the basic plan.
  const up = await s.post('/api/subscriptions', { plan: 'macro_unlimited', consent: true });
  await s.post(`/provider/sandbox/payment_intents/${up.data.payment.intent_id}/confirm`, { client_secret: up.data.payment.client_secret, card: CARD_OK });
  assert.equal((await s.post(`/api/subscriptions/${up.data.subscription_id}/sync`, {})).data.current.plan, 'macro_unlimited');
  assert.equal((await macro('POST', `/api/macro/orders/${o2.id}/start`, {})).status, 200);
  // The macro can deliver with the recording using only its key.
  const up2 = await fetch(`http://localhost:${PORT}/api/files`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/octet-stream', 'x-file-name': 'rec.mp4' }, body: Buffer.from('video') });
  const fid = (await up2.json()).id;
  assert.equal((await macro('POST', `/api/orders/${o2.id}/deliver`, { file_id: fid, recorded: true })).status, 200);
  assert.equal((await macro('GET', '/api/macro/status')).status, 200);
  assert.equal((await fetch(`http://localhost:${PORT}/api/macro/status`, { headers: { authorization: 'Bearer mk_' + '0'.repeat(48) } })).status, 401);
});
