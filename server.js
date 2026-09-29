// Lootrova — marketplace for digital game items. Zero dependencies (Node 22.5+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const FEE_RATE = 0.10; // Lootrova keeps 10% of every completed sale

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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
  price_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending (held) | completed | disputed
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ratings (
  order_id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL, stars INTEGER NOT NULL, comment TEXT);
`);

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
  return db.prepare(`SELECT u.id, u.username, u.balance_cents FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(m[1]) || null;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
});
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const routes = {
  'POST /api/signup': async (req, res) => {
    const b = await readBody(req);
    const username = str(b.username, 30), password = typeof b.password === 'string' ? b.password : '';
    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) return send(res, 400, { error: 'Username: 3-30 letters, numbers or _' });
    if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters' });
    try {
      const r = db.prepare('INSERT INTO users (username, pass) VALUES (?, ?)').run(username, hashPass(password));
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
  'GET /api/me': (req, res, user) => send(res, 200, { user }),

  'GET /api/listings': (req, res, user, url) => {
    const q = '%' + (url.searchParams.get('q') || '') + '%';
    const rows = db.prepare(`SELECT l.*, u.username AS seller,
        (SELECT ROUND(AVG(stars),1) FROM ratings WHERE seller_id = l.seller_id) AS seller_rating
      FROM listings l JOIN users u ON u.id = l.seller_id
      WHERE l.status = 'active' AND (l.title LIKE ? OR l.game LIKE ?)
      ORDER BY l.id DESC LIMIT 100`).all(q, q);
    send(res, 200, { listings: rows });
  },
  'POST /api/listings': async (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Log in first' });
    const b = await readBody(req);
    const game = str(b.game, 60), title = str(b.title, 100), description = str(b.description, 2000);
    const price = Math.round(Number(b.price) * 100);
    if (!game || !title || !description) return send(res, 400, { error: 'Fill in every field' });
    if (!(price >= 50 && price <= 1000000)) return send(res, 400, { error: 'Price must be between $0.50 and $10,000' });
    if (b.usable !== true) return send(res, 400, { error: 'You must confirm the item is usable' });
    const r = db.prepare('INSERT INTO listings (seller_id, game, title, description, price_cents) VALUES (?,?,?,?,?)')
      .run(user.id, game, title, description, price);
    send(res, 200, { id: r.lastInsertRowid });
  },
  'POST /api/listings/:id/remove': (req, res, user, url, id) => {
    if (!user) return send(res, 401, { error: 'Log in first' });
    const r = db.prepare(`UPDATE listings SET status='removed' WHERE id=? AND seller_id=? AND status='active'`).run(id, user.id);
    send(res, r.changes ? 200 : 404, r.changes ? { ok: true } : { error: 'Not found' });
  },
  // Buying holds the money until the buyer confirms the item works (no real payments yet).
  'POST /api/listings/:id/buy': (req, res, user, url, id) => {
    if (!user) return send(res, 401, { error: 'Log in first' });
    const l = db.prepare(`SELECT * FROM listings WHERE id=? AND status='active'`).get(id);
    if (!l) return send(res, 404, { error: 'Item is no longer available' });
    if (l.seller_id === user.id) return send(res, 400, { error: "You can't buy your own item" });
    const fee = Math.round(l.price_cents * FEE_RATE);
    db.exec('BEGIN');
    db.prepare(`UPDATE listings SET status='sold' WHERE id=?`).run(id);
    const r = db.prepare('INSERT INTO orders (listing_id, buyer_id, seller_id, price_cents, fee_cents) VALUES (?,?,?,?,?)')
      .run(id, user.id, l.seller_id, l.price_cents, fee);
    db.exec('COMMIT');
    send(res, 200, { orderId: r.lastInsertRowid });
  },
  'POST /api/orders/:id/confirm': async (req, res, user, url, id) => {
    if (!user) return send(res, 401, { error: 'Log in first' });
    const b = await readBody(req);
    const o = db.prepare(`SELECT * FROM orders WHERE id=? AND buyer_id=? AND status IN ('pending','disputed')`).get(id, user.id);
    if (!o) return send(res, 404, { error: 'Order not found' });
    const stars = Math.min(5, Math.max(1, parseInt(b.stars, 10) || 5));
    db.exec('BEGIN');
    db.prepare(`UPDATE orders SET status='completed' WHERE id=?`).run(id);
    db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id=?').run(o.price_cents - o.fee_cents, o.seller_id);
    db.prepare('INSERT OR REPLACE INTO ratings (order_id, seller_id, stars, comment) VALUES (?,?,?,?)')
      .run(id, o.seller_id, stars, str(b.comment, 500));
    db.exec('COMMIT');
    send(res, 200, { ok: true });
  },
  'POST /api/orders/:id/dispute': (req, res, user, url, id) => {
    if (!user) return send(res, 401, { error: 'Log in first' });
    const r = db.prepare(`UPDATE orders SET status='disputed' WHERE id=? AND buyer_id=? AND status='pending'`).run(id, user.id);
    send(res, r.changes ? 200 : 404, r.changes ? { ok: true } : { error: 'Order not found' });
  },
  'GET /api/dashboard': (req, res, user) => {
    if (!user) return send(res, 401, { error: 'Log in first' });
    const q = `SELECT o.*, l.title, l.game, b.username AS buyer, s.username AS seller FROM orders o
      JOIN listings l ON l.id=o.listing_id JOIN users b ON b.id=o.buyer_id JOIN users s ON s.id=o.seller_id`;
    send(res, 200, {
      user,
      listings: db.prepare(`SELECT * FROM listings WHERE seller_id=? AND status='active' ORDER BY id DESC`).all(user.id),
      purchases: db.prepare(q + ' WHERE o.buyer_id=? ORDER BY o.id DESC').all(user.id),
      sales: db.prepare(q + ' WHERE o.seller_id=? ORDER BY o.id DESC').all(user.id),
    });
  },
};

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const idMatch = /^(\/api\/\w+\/)(\d+)(\/\w+)$/.exec(url.pathname);
    const key = req.method + ' ' + (idMatch ? idMatch[1] + ':id' + idMatch[3] : url.pathname);
    const handler = routes[key];
    if (!handler) return send(res, 404, { error: 'Not found' });
    try { return await handler(req, res, currentUser(req), url, idMatch && Number(idMatch[2])); }
    catch (e) { console.error(e); return send(res, 500, { error: 'Server error' }); }
  }
  const file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(path.join(__dirname, 'public'))) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return fs.readFile(path.join(__dirname, 'public', 'index.html'), (_, d) => {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d);
    });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`Lootrova running on http://localhost:${PORT}`));
module.exports = server;
