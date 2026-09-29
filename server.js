// Lootrova — marketplace for digital game items. Zero dependencies (Node 22.5+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSandboxProvider } = require('./payments');

const PORT = process.env.PORT || 3000;
const FEE_RATE = 0.10;       // Lootrova keeps 10% of every successful sale, taken from the seller's share
const BUYER_FEE_CENTS = 0;   // Buyers pay exactly the listed price
const CURRENCY = (process.env.CURRENCY || 'GBP').toUpperCase();
const HOLD_DAYS = Number(process.env.HOLD_DAYS ?? 7); // earnings stay pending this long unless the buyer confirms sooner
const RESERVATION_MS = 15 * 60 * 1000;                // single-copy items are held for a buyer during checkout
const MIN_PAYOUT_CENTS = 100;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');           // public listing images
const FILES_DIR = process.env.FILES_DIR || path.join(__dirname, 'storage', 'files');   // private product files
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

const LICENCES = {
  personal: 'Personal use: for the buyer’s own use only. No resale or redistribution.',
  commercial: 'Commercial use: may be used in the buyer’s own commercial projects. The files themselves may not be resold or redistributed.',
  single_use: 'Single-use code: can be redeemed once by the buyer.',
  custom: 'Custom licence',
};
const REPORT_CATEGORIES = {
  pirated: 'Pirated or cracked content',
  stolen: 'Stolen content or account',
  malware: 'Malware or harmful file',
  illegal: 'Illegal content',
  copyright: 'Copyright or IP infringement',
  misleading: 'Misleading listing',
  not_working: 'Item doesn’t work as described',
  other: 'Something else',
};
const ALLOWED_FILE_TYPES = ['zip', '7z', 'rar', 'pdf', 'txt', 'md', 'json', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'gif',
  'mp3', 'wav', 'ogg', 'flac', 'mp4', 'webm', 'ttf', 'otf', 'woff2', 'unitypackage', 'blend', 'fbx', 'obj', 'glb', 'gltf',
  'psd', 'pak', 'mcpack', 'mcworld', 'mcaddon', 'rbxm', 'rbxl'];
const PAID_STATES = ['paid', 'completed', 'disputed']; // states that grant the buyer access

// ---------- Database ----------
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'lootrova.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
  balance_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL, game TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL, price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | sold | removed
  images TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
  price_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment', -- awaiting_payment | paid | completed | disputed | refunded | chargeback | cancelled
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ratings (
  order_id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL, stars INTEGER NOT NULL, comment TEXT);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, stored_name TEXT NOT NULL, original_name TEXT NOT NULL,
  ext TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_attempts (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, intent_id TEXT NOT NULL, status TEXT NOT NULL,
  error_code TEXT, message TEXT, card_last4 TEXT, created_at TEXT NOT NULL);
-- Append-only money records. Balances are always the sum of these rows.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL,
  type TEXT NOT NULL,   -- purchase | platform_fee | seller_earning | earning_release | refund | chargeback | fee_reversal | earning_reversal | payout | payout_reversal | legacy_balance
  order_id INTEGER, payout_id INTEGER,
  user_id INTEGER,      -- NULL for the platform
  bucket TEXT NOT NULL, -- buyer | platform | pending | available
  amount_cents INTEGER NOT NULL, memo TEXT);
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested', -- requested | paid | failed
  created_at TEXT NOT NULL, processed_at TEXT, reference TEXT);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL, reporter_id INTEGER, category TEXT NOT NULL, details TEXT NOT NULL,
  contact_name TEXT, contact_email TEXT, original_work TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | actioned | dismissed
  created_at TEXT NOT NULL, resolved_at TEXT, resolved_by INTEGER, resolution_note TEXT);
CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL,
  message TEXT NOT NULL, created_at TEXT NOT NULL);
`);
const addColumn = (table, def) => { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`); } catch {} };
addColumn('users', `role TEXT NOT NULL DEFAULT 'user'`);
addColumn('users', `status TEXT NOT NULL DEFAULT 'active'`);
addColumn('users', 'suspended_reason TEXT');
addColumn('listings', `images TEXT NOT NULL DEFAULT '[]'`);
for (const col of ['delivers', 'compatibility', 'requirements', 'licence', 'licence_text']) addColumn('listings', `${col} TEXT NOT NULL DEFAULT ''`);
addColumn('listings', 'stock INTEGER');
addColumn('listings', 'sold_count INTEGER NOT NULL DEFAULT 0');
addColumn('listings', 'file_id INTEGER');
addColumn('listings', 'removed_by TEXT');
addColumn('listings', 'removal_reason TEXT');
addColumn('listings', 'revoke_access INTEGER NOT NULL DEFAULT 0');
addColumn('listings', 'updated_at TEXT');
for (const col of ['product_title', 'currency', 'email', 'consent_at', 'payment_intent_id', 'receipt_no', 'card_brand', 'card_last4',
  'paid_at', 'available_at', 'released_at', 'refunded_at', 'dispute_reason', 'dispute_at', 'note']) addColumn('orders', `${col} TEXT`);
addColumn('orders', 'buyer_fee_cents INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'total_cents INTEGER');

// Databases from the first version had no real payments: close out those orders and carry balances into the ledger.
if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  db.exec('BEGIN');
  db.exec(`UPDATE orders SET status = 'cancelled', note = 'Created before payments existed; no money was taken.'
    WHERE status IN ('pending', 'disputed') AND payment_intent_id IS NULL`);
  db.exec(`UPDATE orders SET released_at = created_at WHERE status = 'completed' AND released_at IS NULL`);
  db.exec(`UPDATE orders SET total_cents = price_cents, currency = '${CURRENCY}' WHERE total_cents IS NULL`);
  for (const u of db.prepare('SELECT id, balance_cents FROM users WHERE balance_cents != 0').all()) {
    db.prepare(`INSERT INTO ledger (created_at, type, user_id, bucket, amount_cents, memo) VALUES (?, 'legacy_balance', ?, 'available', ?, 'Balance from before payments existed')`)
      .run(new Date().toISOString(), u.id, u.balance_cents);
  }
  db.exec('UPDATE users SET balance_cents = 0');
  db.exec('PRAGMA user_version = 2');
  db.exec('COMMIT');
}
if (ADMIN_USERS.length) db.prepare(`UPDATE users SET role = 'admin' WHERE lower(username) IN (${ADMIN_USERS.map(() => '?').join(',')})`).run(...ADMIN_USERS);

const nowIso = () => new Date().toISOString();
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const ledgerAdd = (e) => db.prepare(`INSERT INTO ledger (created_at, type, order_id, payout_id, user_id, bucket, amount_cents, memo)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(nowIso(), e.type, e.order_id ?? null, e.payout_id ?? null, e.user_id ?? null, e.bucket, e.amount, e.memo ?? null);
const balance = (userId, bucket) => db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM ledger WHERE user_id = ? AND bucket = ?').get(userId, bucket).n;
const receiptNo = (id) => `LR-${new Date().getUTCFullYear()}-${String(id).padStart(6, '0')}`;

// ---------- Payments ----------
const payments = createSandboxProvider(db, { onEvent: onPaymentEvent });

function onPaymentEvent(type, intent) {
  const orderId = Number(intent.metadata.order_id);
  db.prepare(`INSERT INTO payment_attempts (order_id, intent_id, status, error_code, message, card_last4, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(orderId, intent.id, type === 'payment_intent.succeeded' ? 'succeeded' : 'failed',
      intent.last_error?.code ?? null, intent.last_error?.message ?? null, intent.card?.last4 ?? null, nowIso());
  if (type === 'payment_intent.succeeded') fulfilOrder(orderId);
}

// Marks an order paid only after re-checking the payment with the provider. Safe to call repeatedly.
function fulfilOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'awaiting_payment' || !order.payment_intent_id) return;
  const intent = payments.retrieveIntent(order.payment_intent_id);
  if (!intent || intent.status !== 'succeeded') return;
  if (intent.amount !== order.total_cents || intent.currency !== order.currency || Number(intent.metadata.order_id) !== order.id) {
    console.error(`Payment ${intent.id} does not match order ${order.id}; not fulfilling`);
    return;
  }
  const listing = db.prepare('SELECT l.*, u.status AS seller_status FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.id = ?').get(order.listing_id);
  const soldOut = listing.stock != null && listing.sold_count >= listing.stock;
  if (listing.status === 'removed' || listing.seller_status !== 'active' || soldOut) {
    // Paid for something that can no longer be delivered: give the money straight back.
    const r = payments.refund(intent.id);
    tx(() => {
      db.prepare(`UPDATE orders SET status = 'cancelled', refunded_at = ?, note = ? WHERE id = ? AND status = 'awaiting_payment'`)
        .run(nowIso(), 'The item became unavailable during payment, so your payment was refunded in full.', order.id);
      ledgerAdd({ type: 'purchase', order_id: order.id, user_id: order.buyer_id, bucket: 'buyer', amount: order.total_cents, memo: `Payment ${intent.id}` });
      if (!r.error) ledgerAdd({ type: 'refund', order_id: order.id, user_id: order.buyer_id, bucket: 'buyer', amount: -order.total_cents, memo: 'Automatic refund: item unavailable' });
    });
    return;
  }
  const net = order.price_cents - order.fee_cents;
  tx(() => {
    const r = db.prepare(`UPDATE orders SET status = 'paid', paid_at = ?, available_at = ?, receipt_no = ?, card_brand = ?, card_last4 = ?
      WHERE id = ? AND status = 'awaiting_payment'`).run(nowIso(), new Date(Date.now() + HOLD_DAYS * 86400000).toISOString(),
      receiptNo(order.id), intent.card?.brand ?? null, intent.card?.last4 ?? null, order.id);
    if (!r.changes) return;
    db.prepare(`UPDATE listings SET sold_count = sold_count + 1,
      status = CASE WHEN stock IS NOT NULL AND sold_count + 1 >= stock THEN 'sold' ELSE status END WHERE id = ?`).run(listing.id);
    ledgerAdd({ type: 'purchase', order_id: order.id, user_id: order.buyer_id, bucket: 'buyer', amount: order.total_cents, memo: `Payment ${intent.id}` });
    ledgerAdd({ type: 'platform_fee', order_id: order.id, bucket: 'platform', amount: order.fee_cents + order.buyer_fee_cents, memo: `${FEE_RATE * 100}% platform fee` });
    ledgerAdd({ type: 'seller_earning', order_id: order.id, user_id: order.seller_id, bucket: 'pending', amount: net, memo: 'Held until release' });
  });
}

function releaseOrder(orderId) {
  tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const r = db.prepare(`UPDATE orders SET status = 'completed', released_at = ? WHERE id = ? AND released_at IS NULL AND status IN ('paid', 'disputed')`)
      .run(nowIso(), orderId);
    if (!r.changes) return;
    const net = o.price_cents - o.fee_cents;
    ledgerAdd({ type: 'earning_release', order_id: o.id, user_id: o.seller_id, bucket: 'pending', amount: -net });
    ledgerAdd({ type: 'earning_release', order_id: o.id, user_id: o.seller_id, bucket: 'available', amount: net });
  });
}
// Pending earnings become available once the hold period ends, unless the order is disputed.
function releaseDue() {
  for (const o of db.prepare(`SELECT id FROM orders WHERE status = 'paid' AND released_at IS NULL AND available_at <= ?`).all(nowIso())) releaseOrder(o.id);
}
setInterval(releaseDue, 10 * 60 * 1000).unref();

// Refund or chargeback: money goes back to the buyer and comes out of the seller's pending or available balance.
function reverseOrder(order, kind, memo) {
  if (!PAID_STATES.includes(order.status)) throw httpError(400, 'Only paid orders can be refunded.');
  if (kind === 'refund') {
    const r = payments.refund(order.payment_intent_id);
    if (r.error) throw httpError(502, 'The payment provider could not process the refund: ' + r.error.message);
  }
  tx(() => {
    const r = db.prepare(`UPDATE orders SET status = ?, refunded_at = ?, note = ? WHERE id = ? AND status IN ('paid', 'completed', 'disputed')`)
      .run(kind === 'refund' ? 'refunded' : 'chargeback', nowIso(), memo, order.id);
    if (!r.changes) return;
    ledgerAdd({ type: kind, order_id: order.id, user_id: order.buyer_id, bucket: 'buyer', amount: -order.total_cents, memo });
    ledgerAdd({ type: 'fee_reversal', order_id: order.id, bucket: 'platform', amount: -(order.fee_cents + order.buyer_fee_cents), memo });
    ledgerAdd({ type: 'earning_reversal', order_id: order.id, user_id: order.seller_id, bucket: order.released_at ? 'available' : 'pending',
      amount: -(order.price_cents - order.fee_cents), memo });
  });
}

// Stops unpaid checkouts from completing once an item or seller is taken down.
function cancelOpenCheckouts(where, param) {
  for (const o of db.prepare(`SELECT o.id, o.payment_intent_id FROM orders o JOIN listings l ON l.id = o.listing_id
      WHERE o.status = 'awaiting_payment' AND ${where}`).all(param)) {
    if (o.payment_intent_id) payments.cancelIntent(o.payment_intent_id);
    db.prepare(`UPDATE orders SET status = 'cancelled', note = 'Item no longer available' WHERE id = ? AND status = 'awaiting_payment'`).run(o.id);
  }
}

// ---------- Auth ----------
function hashPass(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPass(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, salt, 32));
}
function currentUser(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  return db.prepare(`SELECT u.id, u.username, u.role, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(m[1]) || null;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
}

// ---------- HTTP helpers ----------
const httpError = (code, message, extra) => Object.assign(new Error(message), { code, extra });
const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
// Resolves to the raw body, or null when it exceeds `limit` bytes.
const readRaw = (req, limit) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size <= limit) chunks.push(c); });
  req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks)));
});
const readBody = async (req, limit = 1e5) => {
  const raw = await readRaw(req, limit);
  if (!raw) return null;
  try { const v = JSON.parse(raw.toString() || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requireUser = (user) => { if (!user) throw httpError(401, 'Please log in first.'); return user; };
const requireActive = (user) => {
  requireUser(user);
  if (user.status !== 'active') throw httpError(403, 'Your seller account is suspended. Contact support if you think this is a mistake.');
  return user;
};
const requireAdmin = (user) => { if (!user || user.role !== 'admin') throw httpError(403, 'Admins only.'); return user; };
const parseImages = (row) => row && { ...row, images: JSON.parse(row.images || '[]') };

// Validates a base64 image data URL by its magic bytes and writes it to the public uploads folder.
const SIGNATURES = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  webp: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
function saveImage(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  const ext = Object.keys(SIGNATURES).find((k) => SIGNATURES[k](buf));
  if (!ext || buf.length > MAX_IMAGE_BYTES) return null;
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}
// Windows/Linux/macOS programs and scripts are never accepted as product files.
const looksExecutable = (b) => b.toString('latin1', 0, 2) === 'MZ' || b.toString('latin1', 0, 4) === '\x7fELF' || b.toString('latin1', 0, 2) === '#!'
  || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(b.length >= 4 ? b.readUInt32BE(0) : 0);

// ---------- Listings ----------
const LISTING_SELECT = `SELECT l.*, u.username AS seller, u.status AS seller_status,
    (SELECT ROUND(AVG(stars),1) FROM ratings WHERE seller_id = l.seller_id) AS seller_rating,
    (SELECT COUNT(*) FROM ratings WHERE seller_id = l.seller_id) AS seller_reviews
  FROM listings l JOIN users u ON u.id = l.seller_id`;

const reservedCount = (listingId, buyerId) => db.prepare(`SELECT COUNT(*) AS n FROM orders
  WHERE listing_id = ? AND status = 'awaiting_payment' AND buyer_id != ? AND created_at >= ?`)
  .get(listingId, buyerId ?? 0, new Date(Date.now() - RESERVATION_MS).toISOString()).n;
const ownedOrder = (listingId, buyerId) => buyerId && db.prepare(`SELECT id FROM orders WHERE listing_id = ? AND buyer_id = ?
  AND status IN ('paid', 'completed', 'disputed') ORDER BY id DESC`).get(listingId, buyerId);

// Server-side price and fee for a listing. Nothing the browser sends affects these numbers.
function quote(listingId, user) {
  const l = db.prepare(LISTING_SELECT + ' WHERE l.id = ?').get(listingId);
  const no = (code, error, extra) => ({ ok: false, code, error, ...extra });
  if (!l || l.status === 'removed' || l.seller_status !== 'active') return no(404, 'This item is no longer available.');
  if (user && l.seller_id === user.id) return no(400, 'You can’t buy your own item.');
  const owned = user && ownedOrder(l.id, user.id);
  if (owned) return no(409, 'You already own this item. You can download it from your library.', { order_id: owned.id });
  if (l.status === 'sold' || (l.stock != null && l.sold_count >= l.stock)) return no(409, 'This item has sold out.');
  if (l.stock != null && l.sold_count + reservedCount(l.id, user?.id) >= l.stock) {
    return no(409, 'Another buyer is checking out this item right now. Please try again in a few minutes.');
  }
  if (!l.file_id) return no(409, 'This listing doesn’t have a product file yet, so it can’t be bought.');
  return {
    ok: true, listing_id: l.id, product_title: l.title, game: l.game, seller: l.seller, image: JSON.parse(l.images)[0] || null,
    delivers: l.delivers, price_cents: l.price_cents, buyer_fee_cents: BUYER_FEE_CENTS, total_cents: l.price_cents + BUYER_FEE_CENTS,
    currency: CURRENCY,
  };
}

function listingDetail(l, user) {
  const file = l.file_id ? db.prepare('SELECT ext, size FROM files WHERE id = ?').get(l.file_id) : null;
  const q = quote(l.id, user);
  return {
    ...parseImages(l),
    licence_label: LICENCES[l.licence] || '',
    file,
    copies_left: l.stock == null ? null : Math.max(0, l.stock - l.sold_count),
    seller_sales: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE seller_id = ? AND status IN ('paid', 'completed', 'disputed')`).get(l.seller_id).n,
    purchasable: q.ok,
    unavailable_reason: q.ok ? null : q.error,
    owned_order_id: q.order_id || null,
    is_owner: !!user && user.id === l.seller_id,
  };
}

// Shared by create and edit. Returns the columns to save, or throws a readable error.
function validateListing(b, user, existing) {
  const f = {
    game: str(b.game, 60), title: str(b.title, 100), description: str(b.description, 3000), delivers: str(b.delivers, 500),
    compatibility: str(b.compatibility, 300), requirements: str(b.requirements, 500), licence: str(b.licence, 20),
    licence_text: str(b.licence_text, 1500),
  };
  const missing = [];
  if (!f.game) missing.push('game');
  if (!f.title) missing.push('item name');
  if (!f.description) missing.push('description');
  if (!f.delivers) missing.push('what the buyer receives');
  if (!f.compatibility) missing.push('compatibility / platform');
  if (!LICENCES[f.licence]) missing.push('licence');
  if (f.licence === 'custom' && !f.licence_text) missing.push('custom licence terms');
  const fileId = b.file_id == null || b.file_id === '' ? existing?.file_id : Number(b.file_id);
  if (!fileId) missing.push('product file');
  if (missing.length) throw httpError(400, 'Please complete: ' + missing.join(', ') + '.');
  if (f.licence !== 'custom') f.licence_text = '';
  const price = Math.round(Number(b.price) * 100);
  if (!Number.isFinite(price) || price < 50 || price > 1000000) throw httpError(400, 'Price must be between 0.50 and 10,000.');
  if (b.usable !== true) throw httpError(400, 'Please confirm the item works and the buyer can use it.');
  if (b.owns_rights !== true) throw httpError(400, 'Please confirm you own this content or have permission to sell it.');
  if (fileId !== existing?.file_id) {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(fileId, user.id);
    if (!file) throw httpError(400, 'Upload the product file again.');
    if (db.prepare('SELECT 1 FROM listings WHERE file_id = ? AND id != ?').get(fileId, existing?.id ?? 0)) throw httpError(400, 'That file is already used by another listing.');
  }
  const raw = Array.isArray(b.images) ? b.images : [];
  if (raw.length > MAX_IMAGES) throw httpError(400, `Up to ${MAX_IMAGES} images per listing.`);
  const keep = new Set(existing ? JSON.parse(existing.images) : []);
  const images = raw.map((img) => (keep.has(img) ? img : saveImage(img)));
  if (images.includes(null)) throw httpError(400, 'Images must be JPG, PNG or WebP under 3 MB.');
  const stock = b.copies === 'single' ? 1 : null;
  return { ...f, price_cents: price, file_id: fileId, images: JSON.stringify(images), stock };
}

// ---------- Views ----------
function orderView(o, forAdmin = false) {
  const l = db.prepare('SELECT l.*, u.username AS seller FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.id = ?').get(o.listing_id);
  const file = l.file_id ? db.prepare('SELECT original_name, ext, size FROM files WHERE id = ?').get(l.file_id) : null;
  const canDownload = PAID_STATES.includes(o.status) && !l.revoke_access && !!file;
  const lastAttempt = o.status === 'awaiting_payment'
    ? db.prepare('SELECT status, message FROM payment_attempts WHERE order_id = ? ORDER BY id DESC').get(o.id) : null;
  return {
    id: o.id, receipt_no: o.receipt_no, status: o.status, listing_id: o.listing_id, product_title: o.product_title || l.title,
    game: l.game, image: JSON.parse(l.images)[0] || null, seller: l.seller,
    buyer: db.prepare('SELECT username FROM users WHERE id = ?').get(o.buyer_id).username,
    email: o.email, price_cents: o.price_cents, buyer_fee_cents: o.buyer_fee_cents, total_cents: o.total_cents ?? o.price_cents,
    currency: o.currency || CURRENCY, created_at: o.created_at, paid_at: o.paid_at, refunded_at: o.refunded_at,
    card: o.card_last4 ? { brand: o.card_brand, last4: o.card_last4 } : null,
    delivers: l.delivers, licence_label: LICENCES[l.licence] || '', licence_text: l.licence_text,
    file: file && { name: file.original_name, ext: file.ext, size: file.size },
    can_download: canDownload, download_url: canDownload ? `/download/${o.id}` : null,
    access_note: l.revoke_access ? 'This item was removed for breaking marketplace rules, so downloads are disabled.' : o.note,
    dispute_reason: o.dispute_reason, available_at: o.available_at, released_at: o.released_at,
    rated: !!db.prepare('SELECT 1 FROM ratings WHERE order_id = ?').get(o.id),
    last_payment_error: lastAttempt?.status === 'failed' ? lastAttempt.message : null,
    ...(forAdmin ? { fee_cents: o.fee_cents, payment_intent_id: o.payment_intent_id, buyer_id: o.buyer_id, seller_id: o.seller_id } : {}),
  };
}
function saleView(o) {
  const l = db.prepare('SELECT title, game, images FROM listings WHERE id = ?').get(o.listing_id);
  return {
    id: o.id, receipt_no: o.receipt_no, status: o.status, product_title: o.product_title || l.title, game: l.game,
    image: JSON.parse(l.images)[0] || null, buyer: db.prepare('SELECT username FROM users WHERE id = ?').get(o.buyer_id).username,
    price_cents: o.price_cents, fee_cents: o.fee_cents, net_cents: o.price_cents - o.fee_cents, paid_at: o.paid_at,
    available_at: o.available_at, released_at: o.released_at, refunded_at: o.refunded_at, dispute_reason: o.dispute_reason,
  };
}
const getOrderFor = (id, user, role) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const allowed = o && (user.role === 'admin' || (role === 'buyer' ? o.buyer_id === user.id : role === 'seller' ? o.seller_id === user.id
    : o.buyer_id === user.id || o.seller_id === user.id));
  if (!allowed) throw httpError(404, 'Order not found.');
  return o;
};

// ---------- API routes ----------
const routes = {
  'GET /api/config': (req, res) => send(res, 200, {
    currency: CURRENCY, fee_rate: FEE_RATE, buyer_fee_cents: BUYER_FEE_CENTS, hold_days: HOLD_DAYS, min_payout_cents: MIN_PAYOUT_CENTS,
    test_mode: payments.testMode, test_cards: payments.testCards, licences: LICENCES, report_categories: REPORT_CATEGORIES,
    allowed_file_types: ALLOWED_FILE_TYPES, max_file_mb: MAX_FILE_BYTES / 1024 / 1024, support_email: process.env.SUPPORT_EMAIL || null,
  }),

  'POST /api/signup': async (req, res) => {
    const b = await readBody(req);
    const username = str(b.username, 30), password = typeof b.password === 'string' ? b.password : '';
    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) return send(res, 400, { error: 'Username: 3-30 letters, numbers or _' });
    if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters' });
    try {
      const role = ADMIN_USERS.includes(username.toLowerCase()) ? 'admin' : 'user';
      const r = db.prepare('INSERT INTO users (username, pass, role) VALUES (?, ?, ?)').run(username, hashPass(password), role);
      startSession(res, r.lastInsertRowid);
      send(res, 200, { ok: true });
    } catch { send(res, 409, { error: 'Username taken' }); }
  },
  'POST /api/login': async (req, res) => {
    const b = await readBody(req);
    const u = db.prepare('SELECT id, pass FROM users WHERE username = ?').get(str(b.username, 30));
    if (!u || !checkPass(String(b.password || ''), u.pass)) return send(res, 401, { error: 'Wrong username or password' });
    startSession(res, u.id);
    send(res, 200, { ok: true });
  },
  'POST /api/logout': (req, res) => {
    const m = /sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
    res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
    send(res, 200, { ok: true });
  },
  'GET /api/me': (req, res, user) => {
    if (user) releaseDue();
    send(res, 200, { user: user && { ...user, balance_cents: balance(user.id, 'available') } });
  },

  'GET /api/listings': (req, res, user, url) => {
    const q = '%' + (url.searchParams.get('q') || '') + '%';
    const game = url.searchParams.get('game') || '';
    const visible = `l.status = 'active' AND u.status = 'active' AND l.file_id IS NOT NULL`;
    const rows = db.prepare(LISTING_SELECT + ` WHERE ${visible} AND (l.title LIKE ? OR l.game LIKE ?)
      AND (? = '' OR l.game = ? COLLATE NOCASE) ORDER BY l.id DESC LIMIT 100`).all(q, q, game, game);
    const games = db.prepare(`SELECT l.game, COUNT(*) AS count FROM listings l JOIN users u ON u.id = l.seller_id WHERE ${visible}
      GROUP BY l.game COLLATE NOCASE ORDER BY count DESC LIMIT 12`).all();
    const stats = db.prepare(`SELECT
      (SELECT COUNT(*) FROM listings l JOIN users u ON u.id = l.seller_id WHERE ${visible}) AS live,
      (SELECT COUNT(DISTINCT seller_id) FROM listings) AS sellers,
      (SELECT COUNT(*) FROM orders WHERE status IN ('paid', 'completed', 'disputed')) AS completed`).get();
    send(res, 200, { listings: rows.map(parseImages), games, stats });
  },
  'GET /api/listings/:id': (req, res, user, url, id) => {
    const l = db.prepare(LISTING_SELECT + ' WHERE l.id = ?').get(id);
    const privileged = user && (user.role === 'admin' || (l && l.seller_id === user.id));
    if (!l || (!privileged && (l.status === 'removed' || l.seller_status !== 'active'))) return send(res, 404, { error: 'This item isn’t available.' });
    send(res, 200, { listing: listingDetail(l, user), fee_rate: FEE_RATE });
  },
  // Product files are uploaded as raw bytes before the listing is saved.
  'POST /api/files': async (req, res, user) => {
    requireActive(user);
    let rawName = String(req.headers['x-file-name'] || '');
    try { rawName = decodeURIComponent(rawName); } catch {}
    const name = str(rawName, 200).replace(/[/\\]/g, '_');
    const ext = path.extname(name).slice(1).toLowerCase();
    const buf = await readRaw(req, MAX_FILE_BYTES);
    if (!ALLOWED_FILE_TYPES.includes(ext)) return send(res, 400, { error: `.${ext || '?'} files aren’t allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}.` });
    if (!buf) return send(res, 413, { error: `Files must be ${MAX_FILE_BYTES / 1024 / 1024} MB or smaller.` });
    if (!buf.length) return send(res, 400, { error: 'That file is empty.' });
    if (looksExecutable(buf)) return send(res, 400, { error: 'Programs and scripts can’t be sold on Lootrova.' });
    const stored = crypto.randomBytes(16).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(FILES_DIR, stored), buf);
    const r = db.prepare('INSERT INTO files (owner_id, stored_name, original_name, ext, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, stored, name, ext, buf.length, nowIso());
    send(res, 200, { id: r.lastInsertRowid, name, ext, size: buf.length });
  },
  'POST /api/listings': async (req, res, user) => {
    requireActive(user);
    const b = await readBody(req, (MAX_IMAGE_BYTES * 4 / 3 + 1000) * MAX_IMAGES + 20000);
    if (!b) return send(res, 413, { error: 'Images are too large' });
    const f = validateListing(b, user, null);
    const r = db.prepare(`INSERT INTO listings (seller_id, game, title, description, delivers, compatibility, requirements, licence, licence_text,
      price_cents, file_id, images, stock, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(user.id, f.game, f.title, f.description, f.delivers, f.compatibility, f.requirements, f.licence, f.licence_text,
        f.price_cents, f.file_id, f.images, f.stock, nowIso(), nowIso());
    send(res, 200, { id: r.lastInsertRowid });
  },
  'POST /api/listings/:id/edit': async (req, res, user, url, id) => {
    requireActive(user);
    const b = await readBody(req, (MAX_IMAGE_BYTES * 4 / 3 + 1000) * MAX_IMAGES + 20000);
    if (!b) return send(res, 413, { error: 'Images are too large' });
    const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
    if (!l || l.seller_id !== user.id) return send(res, 403, { error: 'You can only edit your own listings.' });
    if (l.status === 'removed') return send(res, 400, { error: 'Removed listings can’t be edited.' });
    const f = validateListing(b, user, l);
    const soldOut = f.stock != null && l.sold_count >= f.stock;
    db.prepare(`UPDATE listings SET game=?, title=?, description=?, delivers=?, compatibility=?, requirements=?, licence=?, licence_text=?,
      price_cents=?, file_id=?, images=?, stock=?, status=?, updated_at=? WHERE id=? AND seller_id=?`)
      .run(f.game, f.title, f.description, f.delivers, f.compatibility, f.requirements, f.licence, f.licence_text, f.price_cents,
        f.file_id, f.images, f.stock, soldOut ? 'sold' : 'active', nowIso(), id, user.id);
    send(res, 200, { id });
  },
  'POST /api/listings/:id/remove': (req, res, user, url, id) => {
    requireUser(user);
    const r = db.prepare(`UPDATE listings SET status = 'removed', removed_by = 'seller', updated_at = ?
      WHERE id = ? AND seller_id = ? AND status != 'removed'`).run(nowIso(), id, user.id);
    if (!r.changes) return send(res, 403, { error: 'You can only remove your own listings.' });
    cancelOpenCheckouts('l.id = ?', id);
    send(res, 200, { ok: true });
  },
  'POST /api/listings/:id/report': async (req, res, user, url, id) => {
    const b = await readBody(req);
    if (!db.prepare('SELECT 1 FROM listings WHERE id = ?').get(id)) return send(res, 404, { error: 'Item not found.' });
    const category = str(b.category, 30), details = str(b.details, 3000);
    const contactName = str(b.contact_name, 120), contactEmail = str(b.contact_email, 200), originalWork = str(b.original_work, 2000);
    if (!REPORT_CATEGORIES[category]) return send(res, 400, { error: 'Choose a reason for your report.' });
    if (details.length < 10) return send(res, 400, { error: 'Please describe the problem (at least 10 characters).' });
    if (!user && !EMAIL_RE.test(contactEmail)) return send(res, 400, { error: 'Enter your email so we can follow up.' });
    if (contactEmail && !EMAIL_RE.test(contactEmail)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (category === 'copyright') {
      if (!contactName || !EMAIL_RE.test(contactEmail) || !originalWork) {
        return send(res, 400, { error: 'Copyright reports need your full name, email and a description of your original work.' });
      }
      if (b.good_faith !== true) return send(res, 400, { error: 'Please confirm the good-faith statement for copyright reports.' });
    }
    const r = db.prepare(`INSERT INTO reports (listing_id, reporter_id, category, details, contact_name, contact_email, original_work, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, user?.id ?? null, category, details, contactName || null, contactEmail || null, originalWork || null, nowIso());
    send(res, 200, { id: r.lastInsertRowid });
  },

  // ----- Checkout -----
  'GET /api/checkout/:id': (req, res, user, url, id) => {
    const q = quote(id, user);
    send(res, q.ok ? 200 : q.code, q.ok ? { quote: q } : { error: q.error, order_id: q.order_id });
  },
  'POST /api/checkout': async (req, res, user) => {
    requireUser(user);
    const b = await readBody(req);
    const listingId = Number(b.listing_id);
    const q = quote(listingId, user);
    if (!q.ok) return send(res, q.code, { error: q.error, order_id: q.order_id });
    const email = str(b.email, 200);
    if (!EMAIL_RE.test(email)) return send(res, 400, { error: 'Enter a valid email address for your receipt.', field: 'email' });
    if (b.consent !== true) {
      return send(res, 400, { field: 'consent', error: 'Please tick the box to confirm you want immediate access and understand you lose your 14-day right to cancel once the download is available.' });
    }
    if (b.expected_total_cents !== undefined && Number(b.expected_total_cents) !== q.total_cents) {
      return send(res, 409, { error: 'The price of this item has changed. Please review the new total before paying.', quote: q });
    }
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
    const fee = Math.round(q.price_cents * FEE_RATE);
    // Reuse the buyer's unpaid checkout for this item so retries and double clicks never create extra orders.
    let order = db.prepare(`SELECT * FROM orders WHERE buyer_id = ? AND listing_id = ? AND status = 'awaiting_payment' ORDER BY id DESC`).get(user.id, listingId);
    const intentOf = (o) => o && payments.retrieveIntent(o.payment_intent_id);
    if (order && (order.total_cents !== q.total_cents || order.price_cents !== q.price_cents || intentOf(order)?.status === 'canceled')) {
      if (order.payment_intent_id) payments.cancelIntent(order.payment_intent_id);
      db.prepare(`UPDATE orders SET status = 'cancelled', note = 'Replaced by a new checkout' WHERE id = ? AND status = 'awaiting_payment'`).run(order.id);
      order = null;
    }
    if (order) {
      db.prepare('UPDATE orders SET email = ?, consent_at = ?, created_at = ? WHERE id = ?').run(email, nowIso(), nowIso(), order.id);
    } else {
      tx(() => {
        const r = db.prepare(`INSERT INTO orders (listing_id, buyer_id, seller_id, price_cents, fee_cents, buyer_fee_cents, total_cents, currency,
          product_title, email, consent_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'awaiting_payment', ?)`)
          .run(listingId, user.id, listing.seller_id, q.price_cents, fee, q.buyer_fee_cents, q.total_cents, CURRENCY, listing.title, email, nowIso(), nowIso());
        const intent = payments.createIntent({ amount: q.total_cents, currency: CURRENCY, metadata: { order_id: Number(r.lastInsertRowid) } });
        db.prepare('UPDATE orders SET payment_intent_id = ? WHERE id = ?').run(intent.id, r.lastInsertRowid);
        order = { id: Number(r.lastInsertRowid) };
      });
    }
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    const intent = intentOf(order);
    if (intent.status === 'succeeded') fulfilOrder(order.id);
    send(res, 200, {
      order: orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)),
      payment: { provider: payments.name, intent_id: intent.id, client_secret: intent.client_secret, status: intent.status },
    });
  },
  // Re-checks the payment with the provider; never trusts a "paid" flag from the browser.
  'POST /api/orders/:id/sync': (req, res, user, url, id) => {
    requireUser(user);
    const o = getOrderFor(id, user, 'buyer');
    fulfilOrder(o.id);
    send(res, 200, { order: orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)) });
  },
  'GET /api/orders/:id': (req, res, user, url, id) => {
    requireUser(user);
    const o = getOrderFor(id, user, 'buyer');
    send(res, 200, { order: orderView(o, user.role === 'admin') });
  },
  'POST /api/orders/:id/confirm': async (req, res, user, url, id) => {
    requireUser(user);
    const b = await readBody(req);
    const o = getOrderFor(id, user, 'buyer');
    if (o.buyer_id !== user.id || !PAID_STATES.includes(o.status)) return send(res, 400, { error: 'This order can’t be confirmed.' });
    releaseOrder(o.id);
    const stars = Math.min(5, Math.max(1, parseInt(b.stars, 10) || 5));
    db.prepare('INSERT OR REPLACE INTO ratings (order_id, seller_id, stars, comment) VALUES (?,?,?,?)').run(o.id, o.seller_id, stars, str(b.comment, 500));
    send(res, 200, { ok: true });
  },
  'POST /api/orders/:id/refund-request': async (req, res, user, url, id) => {
    requireUser(user);
    const b = await readBody(req);
    const o = getOrderFor(id, user, 'buyer');
    const reason = str(b.reason, 1000);
    if (o.buyer_id !== user.id) return send(res, 404, { error: 'Order not found.' });
    if (reason.length < 10) return send(res, 400, { error: 'Please explain what went wrong (at least 10 characters).' });
    const r = db.prepare(`UPDATE orders SET status = 'disputed', dispute_reason = ?, dispute_at = ? WHERE id = ? AND status = 'paid'`)
      .run(reason, nowIso(), o.id);
    if (!r.changes) {
      return send(res, 400, { error: o.status === 'disputed' ? 'You already asked for a refund on this order.'
        : 'Refund requests can be opened during the protection period. Please contact support about this order.' });
    }
    send(res, 200, { ok: true });
  },
  // The seller can refund their own sale; admins can refund any paid order.
  'POST /api/orders/:id/refund': (req, res, user, url, id) => {
    requireUser(user);
    const o = getOrderFor(id, user, 'seller');
    reverseOrder(o, 'refund', user.role === 'admin' && o.seller_id !== user.id ? 'Refunded by Lootrova support' : 'Refunded by seller');
    send(res, 200, { ok: true });
  },

  'GET /api/dashboard': (req, res, user) => {
    requireUser(user);
    releaseDue();
    const sales = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND status NOT IN ('awaiting_payment', 'cancelled') ORDER BY id DESC`).all(user.id);
    const counted = sales.filter((o) => PAID_STATES.includes(o.status));
    const sum = (rows, f) => rows.reduce((s, o) => s + f(o), 0);
    const nextRelease = db.prepare(`SELECT MIN(available_at) AS t FROM orders WHERE seller_id = ? AND status = 'paid'`).get(user.id).t;
    send(res, 200, {
      user: { ...user, balance_cents: balance(user.id, 'available') },
      balances: { pending_cents: balance(user.id, 'pending'), available_cents: balance(user.id, 'available') },
      totals: {
        gross_cents: sum(counted, (o) => o.price_cents), fee_cents: sum(counted, (o) => o.fee_cents),
        net_cents: sum(counted, (o) => o.price_cents - o.fee_cents),
        refunded_cents: sum(sales.filter((o) => ['refunded', 'chargeback'].includes(o.status)), (o) => o.price_cents),
      },
      next_release_at: nextRelease,
      library: db.prepare(`SELECT * FROM orders WHERE buyer_id = ? AND (paid_at IS NOT NULL OR refunded_at IS NOT NULL OR status = 'completed')
        ORDER BY id DESC`).all(user.id).map((o) => orderView(o)),
      sales: sales.map(saleView),
      listings: db.prepare(`SELECT * FROM listings WHERE seller_id = ? AND (status != 'removed' OR removed_by = 'admin') ORDER BY id DESC`).all(user.id)
        .map((l) => ({ ...parseImages(l), has_file: !!l.file_id })),
      payouts: db.prepare('SELECT * FROM payouts WHERE seller_id = ? ORDER BY id DESC').all(user.id),
    });
  },
  'POST /api/payouts': (req, res, user) => {
    requireActive(user);
    const payout = tx(() => {
      const amount = balance(user.id, 'available');
      if (amount < MIN_PAYOUT_CENTS) throw httpError(400, 'You need at least 1.00 available to request a payout.');
      const r = db.prepare(`INSERT INTO payouts (seller_id, amount_cents, status, created_at) VALUES (?, ?, 'requested', ?)`).run(user.id, amount, nowIso());
      ledgerAdd({ type: 'payout', payout_id: r.lastInsertRowid, user_id: user.id, bucket: 'available', amount: -amount, memo: 'Payout requested' });
      return { id: r.lastInsertRowid, amount_cents: amount };
    });
    send(res, 200, { payout });
  },

  'POST /api/support': async (req, res, user) => {
    const b = await readBody(req);
    const f = { name: str(b.name, 120), email: str(b.email, 200), subject: str(b.subject, 200), message: str(b.message, 5000) };
    if (!f.name || !EMAIL_RE.test(f.email) || !f.subject || f.message.length < 10) {
      return send(res, 400, { error: 'Please fill in your name, a valid email, a subject and a message (at least 10 characters).' });
    }
    db.prepare('INSERT INTO support_messages (user_id, name, email, subject, message, created_at) VALUES (?,?,?,?,?,?)')
      .run(user?.id ?? null, f.name, f.email, f.subject, f.message, nowIso());
    send(res, 200, { ok: true });
  },

  // ----- Admin / moderation -----
  'GET /api/admin/overview': (req, res, user) => {
    requireAdmin(user);
    releaseDue();
    const name = (id) => id && db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username;
    send(res, 200, {
      reports: db.prepare(`SELECT r.*, l.title, l.status AS listing_status, l.seller_id, u.username AS seller FROM reports r
        JOIN listings l ON l.id = r.listing_id JOIN users u ON u.id = l.seller_id ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 200`).all()
        .map((r) => ({ ...r, category_label: REPORT_CATEGORIES[r.category], reporter: name(r.reporter_id) })),
      disputes: db.prepare(`SELECT * FROM orders WHERE status = 'disputed' ORDER BY dispute_at`).all().map((o) => orderView(o, true)),
      orders: db.prepare(`SELECT * FROM orders WHERE status != 'awaiting_payment' OR paid_at IS NOT NULL ORDER BY id DESC LIMIT 100`).all().map((o) => orderView(o, true)),
      payouts: db.prepare(`SELECT p.*, u.username AS seller FROM payouts p JOIN users u ON u.id = p.seller_id ORDER BY p.status = 'requested' DESC, p.id DESC LIMIT 100`).all(),
      users: db.prepare(`SELECT id, username, role, status, suspended_reason, created_at,
        (SELECT COUNT(*) FROM listings WHERE seller_id = users.id AND status = 'active') AS active_listings FROM users ORDER BY id DESC LIMIT 200`).all(),
      listings: db.prepare(LISTING_SELECT + ' ORDER BY l.id DESC LIMIT 200').all().map((l) => ({ id: l.id, title: l.title, seller: l.seller, seller_id: l.seller_id, status: l.status, removed_by: l.removed_by, removal_reason: l.removal_reason })),
      transactions: db.prepare('SELECT * FROM ledger ORDER BY id DESC LIMIT 300').all().map((t) => ({ ...t, user: t.user_id ? name(t.user_id) : 'Lootrova' })),
      support: db.prepare('SELECT * FROM support_messages ORDER BY id DESC LIMIT 100').all(),
      platform_fees_cents: db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM ledger WHERE bucket = 'platform'`).get().n,
    });
  },
  'POST /api/admin/reports/:id/resolve': async (req, res, user, url, id) => {
    requireAdmin(user);
    const b = await readBody(req);
    const status = b.action === 'dismiss' ? 'dismissed' : 'actioned';
    const r = db.prepare(`UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ?`)
      .run(status, nowIso(), user.id, str(b.note, 1000), id);
    send(res, r.changes ? 200 : 404, r.changes ? { ok: true } : { error: 'Report not found.' });
  },
  'POST /api/admin/listings/:id/remove': async (req, res, user, url, id) => {
    requireAdmin(user);
    const b = await readBody(req);
    const reason = str(b.reason, 500) || 'Breaks marketplace rules';
    const r = db.prepare(`UPDATE listings SET status = 'removed', removed_by = 'admin', removal_reason = ?, revoke_access = ?, updated_at = ? WHERE id = ?`)
      .run(reason, b.revoke_access === true ? 1 : 0, nowIso(), id);
    if (!r.changes) return send(res, 404, { error: 'Listing not found.' });
    cancelOpenCheckouts('l.id = ?', id);
    db.prepare(`UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE listing_id = ? AND status = 'open'`)
      .run(nowIso(), user.id, 'Listing removed: ' + reason, id);
    send(res, 200, { ok: true });
  },
  'POST /api/admin/users/:id/suspend': async (req, res, user, url, id) => {
    requireAdmin(user);
    const b = await readBody(req);
    if (id === user.id) return send(res, 400, { error: 'You can’t suspend yourself.' });
    const r = db.prepare(`UPDATE users SET status = 'suspended', suspended_reason = ? WHERE id = ?`).run(str(b.reason, 500) || 'Breaking marketplace rules', id);
    if (!r.changes) return send(res, 404, { error: 'User not found.' });
    cancelOpenCheckouts('l.seller_id = ?', id);
    send(res, 200, { ok: true });
  },
  'POST /api/admin/users/:id/unsuspend': (req, res, user, url, id) => {
    requireAdmin(user);
    const r = db.prepare(`UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = ?`).run(id);
    send(res, r.changes ? 200 : 404, r.changes ? { ok: true } : { error: 'User not found.' });
  },
  'POST /api/admin/orders/:id/reject-dispute': (req, res, user, url, id) => {
    requireAdmin(user);
    const r = db.prepare(`UPDATE orders SET status = 'paid', note = 'Refund request reviewed and declined by Lootrova support' WHERE id = ? AND status = 'disputed'`).run(id);
    send(res, r.changes ? 200 : 400, r.changes ? { ok: true } : { error: 'This order has no open refund request.' });
  },
  // Records a chargeback reported by the payment provider.
  'POST /api/admin/orders/:id/chargeback': (req, res, user, url, id) => {
    requireAdmin(user);
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) return send(res, 404, { error: 'Order not found.' });
    reverseOrder(o, 'chargeback', 'Chargeback reported by the payment provider');
    send(res, 200, { ok: true });
  },
  'POST /api/admin/payouts/:id/paid': async (req, res, user, url, id) => {
    requireAdmin(user);
    const b = await readBody(req);
    const r = db.prepare(`UPDATE payouts SET status = 'paid', processed_at = ?, reference = ? WHERE id = ? AND status = 'requested'`)
      .run(nowIso(), str(b.reference, 100) || null, id);
    send(res, r.changes ? 200 : 400, r.changes ? { ok: true } : { error: 'This payout isn’t waiting to be processed.' });
  },
  'POST /api/admin/payouts/:id/failed': (req, res, user, url, id) => {
    requireAdmin(user);
    tx(() => {
      const p = db.prepare('SELECT * FROM payouts WHERE id = ? AND status = ?').get(id, 'requested');
      if (!p) throw httpError(400, 'This payout isn’t waiting to be processed.');
      db.prepare(`UPDATE payouts SET status = 'failed', processed_at = ? WHERE id = ?`).run(nowIso(), id);
      ledgerAdd({ type: 'payout_reversal', payout_id: p.id, user_id: p.seller_id, bucket: 'available', amount: p.amount_cents, memo: 'Payout failed; returned to balance' });
    });
    send(res, 200, { ok: true });
  },
};

// Matches "/api/admin/orders/12/refund" against "/api/admin/orders/:id/refund".
const routeTable = Object.entries(routes).map(([key, handler]) => {
  const [method, pattern] = key.split(' ');
  return { method, parts: pattern.split('/'), handler };
});
function matchRoute(method, pathname) {
  const parts = pathname.split('/');
  for (const r of routeTable) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    let id = null;
    const ok = r.parts.every((p, i) => (p === ':id' ? /^\d+$/.test(parts[i]) && ((id = Number(parts[i])), true) : p === parts[i]));
    if (ok) return { handler: r.handler, id };
  }
  return null;
}

// ---------- Static files and downloads ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};
function serveFile(res, file, fallback) {
  fs.readFile(file, (err, data) => {
    if (err) return fallback ? serveFile(res, fallback) : send(res, 404, { error: 'Not found' });
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
    if (file.startsWith(UPLOAD_DIR)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, headers);
    res.end(data);
  });
}
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function deniedPage(res, code, title, text) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} — Lootrova</title><link rel="stylesheet" href="/style.css"></head><body>
<main><div class="auth-wrap"><div class="auth glass" style="text-align:center"><img class="logo-mark" src="/logo.svg" alt="">
<h1>${escHtml(title)}</h1><p class="sub">${escHtml(text)}</p><a class="btn block" href="/#/dashboard?tab=library">Go to my library</a>
<p class="switch"><a href="/#/contact">Contact support</a></p></div></div></main></body></html>`);
}
// Every download is checked against the logged-in buyer and the order's payment state.
function handleDownload(req, res, user, orderId) {
  if (!user) {
    res.writeHead(302, { Location: `/#/login?next=${encodeURIComponent('/download/' + orderId)}` });
    return res.end();
  }
  const o = db.prepare('SELECT o.*, l.file_id, l.revoke_access FROM orders o JOIN listings l ON l.id = o.listing_id WHERE o.id = ?').get(orderId);
  if (!o || o.buyer_id !== user.id) return deniedPage(res, 403, 'Access denied', 'Only the buyer of this order can download it. Log in with the account you used to buy it.');
  if (!PAID_STATES.includes(o.status)) {
    return deniedPage(res, 403, 'Download unavailable', ['refunded', 'chargeback'].includes(o.status)
      ? 'This order was refunded, so the download is no longer available.' : 'This order hasn’t been paid, so there is nothing to download.');
  }
  if (o.revoke_access) return deniedPage(res, 403, 'Download disabled', 'This item was removed for breaking marketplace rules, so downloads are disabled. Contact support about a refund.');
  const f = o.file_id && db.prepare('SELECT * FROM files WHERE id = ?').get(o.file_id);
  const filePath = f && path.join(FILES_DIR, path.basename(f.stored_name));
  if (!f || !fs.existsSync(filePath)) return deniedPage(res, 404, 'File missing', 'We couldn’t find this file. Please contact support.');
  const ascii = f.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream', 'Content-Length': f.size, 'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const url = new URL(req.url, 'http://x');
  try {
    const dl = /^\/download\/(\d+)$/.exec(url.pathname);
    if (dl && req.method === 'GET') return handleDownload(req, res, currentUser(req), Number(dl[1]));

    // Test payment provider endpoint, called by the buyer's browser (the marketplace API never sees this request).
    const pay = /^\/provider\/sandbox\/payment_intents\/(pi_sbx_[a-f0-9]+)\/confirm$/.exec(url.pathname);
    if (pay && req.method === 'POST') {
      const b = await readBody(req, 10000);
      const r = payments.confirmIntent(pay[1], b?.client_secret, b?.card);
      return send(res, r.error ? 402 : 200, r.error ? { error: r.error } : { status: r.intent.status });
    }

    if (url.pathname.startsWith('/api/')) {
      const m = matchRoute(req.method, url.pathname);
      if (!m) return send(res, 404, { error: 'Not found' });
      // JSON-only writes (plus raw file uploads) block cross-site form posts.
      const type = String(req.headers['content-type'] || '');
      const wantType = url.pathname === '/api/files' ? 'application/octet-stream' : 'application/json';
      if (req.method === 'POST' && !type.startsWith(wantType)) return send(res, 415, { error: 'Unsupported request type' });
      return await m.handler(req, res, currentUser(req), url, m.id);
    }
    if (url.pathname.startsWith('/uploads/')) return serveFile(res, path.join(UPLOAD_DIR, path.basename(url.pathname)));
    const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
    serveFile(res, file, path.join(PUBLIC_DIR, 'index.html'));
  } catch (e) {
    if (e.code >= 400 && e.code < 600) return send(res, e.code, { error: e.message, ...e.extra });
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
});

if (require.main === module) server.listen(PORT, () => console.log(`Lootrova running on http://localhost:${PORT}`));
module.exports = server;
