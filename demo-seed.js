// Fills an empty site with sample sellers, listings and orders so a fresh deploy has something to look at.
// Runs only when DEMO_SEED=1 and the database has no listings. Uses the site's own API, so everything goes
// through the normal checks. Demo accounts use the password "demo-password".
const { PNG } = require('pngjs');

function cover(r, g, b) {
  const p = new PNG({ width: 480, height: 360 });
  for (let y = 0; y < 360; y++) for (let x = 0; x < 480; x++) {
    const i = (y * 480 + x) * 4, stripe = ((x + y) >> 5) % 2 ? 1 : 0.85, fade = 1 - y / 720;
    p.data.set([r * stripe * fade, g * stripe * fade, b * stripe * fade, 255], i);
  }
  return 'data:image/png;base64,' + PNG.sync.write(p).toString('base64');
}

const ITEMS = [
  ['NovaTrades', 'Pet Simulator 99', 'Huge Hell Rock', 'One Huge Hell Rock pet, traded in-game.', 'Huge Hell Rock pet', '18.50', [150, 40, 40]],
  ['NovaTrades', 'Pet Simulator 99', '10B Diamonds', '10 billion diamonds delivered by trade.', '10,000,000,000 diamonds', '6.99', [40, 110, 170]],
  ['NovaTrades', 'Blox Fruits', 'Permanent Dragon Fruit', 'Gifted permanent Dragon fruit.', 'Permanent Dragon fruit', '24.00', [170, 70, 30]],
  ['PixelForge', 'Steal a Brainrot', 'Tralalero Tralala', 'Secret brainrot, delivered in your base.', 'Tralalero Tralala brainrot', '9.50', [60, 140, 90]],
  ['PixelForge', 'Steal a Brainrot', 'La Vacca Saturno', 'Rare brainrot, fast delivery.', 'La Vacca Saturno brainrot', '4.75', [120, 60, 150]],
  ['PixelForge', 'Jailbreak', 'Torpedo (Hyperchrome)', 'Torpedo with hyperchrome level 2.', 'Torpedo vehicle, hyperchrome L2', '12.00', [50, 50, 60]],
  ['NovaTrades', 'Jailbreak', '5M Cash', '5 million cash via trade.', '5,000,000 in-game cash', '3.99', [40, 140, 60]],
  ['PixelForge', 'Blox Fruits', 'Leopard Fruit', 'Physical Leopard fruit.', 'Leopard fruit (physical)', '15.00', [180, 140, 40]],
];

async function seed(base, db) {
  if (process.env.DEMO_SEED !== '1' || db.prepare('SELECT COUNT(*) AS n FROM listings').get().n > 0) return;
  const jar = {};
  const call = async (who, path, body, raw) => {
    const headers = { ...(jar[who] && { cookie: jar[who] }) };
    let payload;
    if (raw) { headers['content-type'] = 'application/octet-stream'; headers['x-file-name'] = raw; payload = body; }
    else if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers, body: payload });
    const set = r.headers.get('set-cookie'); if (set) jar[who] = set.split(';')[0];
    return r.json();
  };
  const buy = async (who, id) => {
    const co = await call(who, '/api/checkout', { listing_id: id, email: `${who}@example.com`, consent: true, buyer_info: who + '_rbx' });
    await call(who, `/provider/sandbox/payment_intents/${co.payment.intent_id}/confirm`, { client_secret: co.payment.client_secret, card: { number: '4242424242424242', exp_month: '12', exp_year: '34', cvc: '123' } });
    return (await call(who, `/api/orders/${co.order.id}/sync`, {})).order.id;
  };
  for (const u of ['NovaTrades', 'PixelForge', 'kai_buys', 'zoe_plays']) await call(u, '/api/signup', { username: u, password: 'demo-password' });
  const ids = [];
  for (const [seller, game, title, description, delivers, price, rgb] of ITEMS) {
    const f = await call(seller, '/api/files', Buffer.from('Demo delivery notes for ' + title), 'delivery-notes.txt');
    const r = await call(seller, '/api/listings', { game, title, description, delivers, compatibility: 'Roblox (PC, mobile, console)', licence: 'single_use',
      price, copies: 'unlimited', file_id: f.id, usable: true, owns_rights: true, buyer_info_label: 'Your Roblox username', images: [cover(...rgb)] });
    ids.push(r.id);
  }
  await call('NovaTrades', '/api/presence', { online: true });
  for (const [who, i] of [['kai_buys', 0], ['zoe_plays', 2], ['zoe_plays', 3], ['kai_buys', 6]]) {
    const oid = await buy(who, ids[i]);
    await call(who, `/api/orders/${oid}/messages`, { body: 'hey my user is ' + who + '_rbx' });
  }
  console.log(`Demo data added: ${ids.length} listings. Demo logins: NovaTrades / PixelForge / kai_buys / zoe_plays, password "demo-password".`);
}

module.exports = { seed };
