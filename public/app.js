const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const nav = $('#nav');
const FEE_RATE = 0.1;
const MAX_IMAGES = 4;
let me = null;
let currentView = '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

// ---------- Icons ----------
const svg = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icon = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 20),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  percent: svg('<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>', 14),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  upload: svg('<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>', 22),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>', 13),
  arrowLeft: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>', 16),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 16),
  bag: svg('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>'),
  zap: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
  wallet: svg('<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M16 13h2M2 10h20"/>', 16),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16),
  box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>', 16),
  star: (s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`,
};

// ---------- Visual helpers ----------
function hue(str) {
  let h = 0;
  for (const ch of String(str).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function avatar(name, cls = '') {
  const h = hue(name);
  return `<span class="avatar ${cls}" style="background:linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 50) % 360} 70% 40%))">${esc(String(name)[0] || '?')}</span>`;
}
// Generated cover art for listings without images.
function art(game) {
  const h = hue(game);
  const initials = String(game).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<div class="art" style="background:radial-gradient(circle at 30% 20%,hsl(${h} 80% 55% / .9),transparent 60%),linear-gradient(135deg,hsl(${h} 65% 28%),hsl(${(h + 70) % 360} 70% 18%))"><span>${esc(initials)}</span></div>`;
}
const cover = (l) => (l.images && l.images.length ? `<img src="${esc(l.images[0])}" alt="" loading="lazy">` : art(l.game));
const rating = (r, n) => (r ? `<span class="rating">★ ${r}${n != null ? ` <span class="muted">(${n})</span>` : ''}</span>` : '');

function countUp(el, to) {
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 1100);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- API ----------
async function api(path, body) {
  const res = await fetch('/api' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

async function busy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

// ---------- Toasts & modals ----------
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span class="ti">${type === 'ok' ? icon.check : icon.alert}</span><span>${esc(msg)}</span>`;
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}

function modal(html, onMount) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal glass" role="dialog" aria-modal="true">${html}</div>`;
    const onKey = (e) => e.key === 'Escape' && close(null);
    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      back.classList.add('closing');
      setTimeout(() => back.remove(), 200);
      resolve(value);
    };
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    $$('[data-close]', back).forEach((b) => (b.onclick = () => close(null)));
    document.addEventListener('keydown', onKey);
    $('#modal-root').append(back);
    if (onMount) onMount(back, close);
  });
}

const confirmPurchase = (l) => modal(`
  <h2>Confirm purchase</h2>
  <p class="muted" style="margin:0">Review your order before buying.</p>
  <div class="summary"><div class="th">${cover(l)}</div>
    <div style="flex:1;min-width:0"><b>${esc(l.title)}</b><br><small class="muted">${esc(l.game)} · sold by ${esc(l.seller)}</small></div>
    <div class="price">${money(l.price_cents)}</div></div>
  <div class="protect">${icon.shield}<div><b>Your payment is held</b><p>The seller only gets paid after you confirm the item works.</p></div></div>
  <div class="actions"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="go">Buy now</button></div>`,
  (el, close) => { $('#go', el).onclick = () => close(true); });

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
const askRating = (order) => modal(`
  <h2>Confirm it works</h2>
  <p class="muted" style="margin:0">This releases ${money(order.price_cents)} to <b style="color:var(--text)">${esc(order.seller)}</b>. How was the seller?</p>
  <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-s="${n}" aria-label="${n} stars">${icon.star(34)}</button>`).join('')}</div>
  <div class="stars-label" id="sl">Tap to rate</div>
  <div class="actions"><button class="btn ghost" data-close>Cancel</button><button class="btn success" id="go" disabled>Confirm &amp; pay seller</button></div>`,
  (el, close) => {
    let chosen = 0;
    const paint = (n) => $$('.stars button', el).forEach((b) => b.classList.toggle('on', +b.dataset.s <= n));
    $$('.stars button', el).forEach((b) => {
      b.onmouseenter = () => { paint(+b.dataset.s); $('#sl', el).textContent = LABELS[b.dataset.s]; };
      b.onclick = () => { chosen = +b.dataset.s; $('#go', el).disabled = false; };
    });
    $('.stars', el).onmouseleave = () => { paint(chosen); $('#sl', el).textContent = chosen ? LABELS[chosen] : 'Tap to rate'; };
    $('#go', el).onclick = () => close(chosen);
  });

const confirmBox = (title, text, action, cls = 'danger') => modal(`
  <h2>${title}</h2><p class="muted" style="margin:0">${text}</p>
  <div class="actions"><button class="btn ghost" data-close>Cancel</button><button class="btn ${cls}" id="go">${action}</button></div>`,
  (el, close) => { $('#go', el).onclick = () => close(true); });

// ---------- Nav ----------
function renderNav() {
  const page = location.hash.replace(/^#\//, '').split(/[?/]/)[0];
  const link = (href, label, key, cls = '') => `<a class="nav-link ${cls} ${page === key ? 'active' : ''}" href="${href}">${label}</a>`;
  nav.innerHTML = me
    ? `${link('#/', 'Browse', '', 'hide-sm')}${link('#/dashboard', 'Dashboard', 'dashboard', 'hide-sm')}
       <a class="btn sm" href="#/sell">${icon.plus}<span>Sell</span></a>
       <a class="user-chip" href="#/dashboard" title="Your balance">${avatar(me.username)}
         <span class="name muted" style="font-size:.85rem">${esc(me.username)}</span><span class="bal">${money(me.balance_cents)}</span></a>
       <button class="nav-link" id="logout" title="Log out" aria-label="Log out">${icon.logout}</button>`
    : `${link('#/', 'Browse', '', 'hide-sm')}${link('#/login', 'Log in', 'login')}<a class="btn sm" href="#/signup">Get started</a>`;
  const out = $('#logout');
  if (out) out.onclick = async () => { await api('/logout', {}); me = null; toast('Logged out'); location.hash = '#/'; route(); };
}

// ---------- Home ----------
const skeletons = (n) => Array.from({ length: n }, () => `
  <div class="skeleton"><div class="sk" style="aspect-ratio:4/3;border-radius:0"></div>
  <div style="padding:16px"><div class="sk" style="height:18px;width:80%"></div>
  <div class="sk" style="height:14px;width:50%;margin-top:18px"></div></div></div>`).join('');

const card = (l, i) => `
  <a class="card reveal" style="--i:${i}" href="#/item/${l.id}">
    <div class="media">${cover(l)}<span class="badge">${esc(l.game)}</span>
      ${l.images.length > 1 ? `<span class="img-count">${icon.image}${l.images.length}</span>` : ''}</div>
    <div class="body"><h3>${esc(l.title)}</h3>
      <div class="foot"><div class="seller">${avatar(l.seller)}<span>${esc(l.seller)}</span>${rating(l.seller_rating)}</div>
        <div class="price">${money(l.price_cents)}</div></div></div>
  </a>`;

function home() {
  const p = hashParams();
  app.innerHTML = `
    <section class="hero">
      <span class="pill reveal"><span class="dot"></span>Every purchase protected until you confirm it works</span>
      <h1 class="reveal" style="--i:1">The premium marketplace for <span class="grad-text">game items</span></h1>
      <p class="lead reveal" style="--i:2">Buy and sell skins, items and codes with players you can trust. Only working items, with your money held until you're happy.</p>
      <form class="search reveal" style="--i:3" id="search">${icon.search}
        <input name="q" placeholder="Search skins, items, games…" value="${esc(p.get('q') || '')}" autocomplete="off">
        <button class="btn">Search</button></form>
      <div class="stats reveal" style="--i:4">
        <div class="stat"><b data-stat="live">0</b><span>Items live</span></div>
        <div class="stat"><b data-stat="sellers">0</b><span>Sellers</span></div>
        <div class="stat"><b data-stat="completed">0</b><span>Trades completed</span></div>
      </div>
    </section>
    <div class="section-head"><div><span class="eyebrow">Marketplace</span><h2 id="results-title">Latest drops</h2></div>
      <div class="chips" id="chips"></div></div>
    <div class="grid" id="results">${skeletons(8)}</div>
    <div class="features">
      ${[[icon.shield, 'Buyer protection', 'Payment is held until you confirm the item works. If it doesn’t, open a dispute.'],
         [icon.check, 'Usable items only', 'Every seller confirms their item works before listing it. No broken or fake loot.'],
         [icon.percent, 'Simple 10% fee', 'Listing is free. Sellers pay a flat 10% only when a sale completes.']]
        .map(([ic, t, d], i) => `<div class="feature glass reveal" style="--i:${i}"><div class="ic">${ic}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
    </div>`;

  const form = $('#search');
  let timer;
  const apply = () => {
    const q = form.q.value.trim();
    const game = hashParams().get('game') || '';
    const qs = new URLSearchParams({ ...(q && { q }), ...(game && { game }) }).toString();
    history.replaceState(null, '', '#/' + (qs ? '?' + qs : ''));
    loadResults();
  };
  form.onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); apply(); };
  form.q.oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 300); };
  return loadResults(true);
}

async function loadResults(first) {
  const p = hashParams();
  const q = p.get('q') || '', game = p.get('game') || '';
  const data = await api(`/listings?q=${encodeURIComponent(q)}&game=${encodeURIComponent(game)}`);
  const results = $('#results');
  if (!results) return;
  if (first) Object.entries(data.stats).forEach(([k, v]) => { const el = $(`[data-stat="${k}"]`); if (el) countUp(el, v); });

  const chipHref = (g) => {
    const qs = new URLSearchParams({ ...(q && { q }), ...(g && { game: g }) }).toString();
    return '#/' + (qs ? '?' + qs : '');
  };
  $('#chips').innerHTML = [`<a class="chip ${!game ? 'active' : ''}" href="${chipHref('')}">All games</a>`,
    ...data.games.map((g) => `<a class="chip ${g.game.toLowerCase() === game.toLowerCase() ? 'active' : ''}" href="${chipHref(g.game)}">${esc(g.game)}<small>${g.count}</small></a>`)].join('');
  $('#results-title').textContent = q || game ? `${data.listings.length} result${data.listings.length === 1 ? '' : 's'}` : 'Latest drops';

  results.innerHTML = data.listings.map(card).join('') || `
    <div class="empty" style="grid-column:1/-1"><div class="icon">${icon.bag}</div>
      <h3>${q || game ? 'No items match your search' : 'No items listed yet'}</h3>
      <p class="muted">${q || game ? 'Try a different search or game.' : 'Be the first to list a game item.'}</p>
      <a class="btn" href="#/sell">${icon.plus}List an item</a></div>`;
}

// ---------- Item detail ----------
async function itemPage(id) {
  app.innerHTML = `<a class="back" href="#/">${icon.arrowLeft} Back to marketplace</a>
    <div class="detail"><div class="skeleton" style="aspect-ratio:4/3"><div class="sk" style="height:100%;border-radius:0"></div></div>
    <div class="skeleton" style="height:420px"></div></div>`;
  const { listing: l } = await api('/listings/' + id);
  const mine = me && me.id === l.seller_id;
  const fee = Math.round(l.price_cents * FEE_RATE);

  app.innerHTML = `<a class="back" href="#/">${icon.arrowLeft} Back to marketplace</a>
    <div class="detail">
      <div class="gallery reveal">
        <div class="main" id="main">${cover(l)}</div>
        ${l.images.length > 1 ? `<div class="thumbs">${l.images.map((src, i) =>
          `<button class="${i ? '' : 'on'}" data-src="${esc(src)}" aria-label="Image ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
      </div>
      <div class="info glass reveal" style="--i:1">
        <span class="eyebrow">${esc(l.game)}</span>
        <h1>${esc(l.title)}</h1>
        <div class="price">${money(l.price_cents)}</div>
        <p class="desc">${esc(l.description)}</p>
        ${l.status === 'sold' ? '<div class="sold-banner">This item has been sold</div>'
          : mine ? `<div class="payout glass" style="margin:0 0 14px;box-shadow:none">
                <div class="line"><span>Price</span><span>${money(l.price_cents)}</span></div>
                <div class="line"><span>Lootrova fee (10%)</span><span>−${money(fee)}</span></div>
                <div class="line total"><span>You receive</span><b>${money(l.price_cents - fee)}</b></div></div>
              <button class="btn danger block" id="remove">Remove listing</button>`
          : `<button class="btn lg block" id="buy">${icon.zap} Buy now</button>`}
        <div class="protect">${icon.shield}<div><b>Lootrova Buyer Protection</b><p>Your payment is held until you confirm the item works. Not as described? Open a dispute.</p></div></div>
        <div class="seller-card">${avatar(l.seller, 'lg')}
          <div style="flex:1"><b>${esc(l.seller)}</b><small class="muted">${l.seller_sales} completed sale${l.seller_sales === 1 ? '' : 's'}</small></div>
          ${rating(l.seller_rating, l.seller_reviews) || '<small class="muted">New seller</small>'}</div>
      </div>
    </div>`;

  $$('.thumbs button').forEach((b) => (b.onclick = () => {
    $$('.thumbs button').forEach((x) => x.classList.toggle('on', x === b));
    $('#main').innerHTML = `<img src="${esc(b.dataset.src)}" alt="">`;
  }));
  const buy = $('#buy');
  if (buy) buy.onclick = async () => {
    if (!me) { toast('Log in to buy this item', 'err'); return (location.hash = '#/login'); }
    if (!(await confirmPurchase(l))) return;
    try {
      await busy(buy, () => api(`/listings/${l.id}/buy`, {}));
      toast('Purchase complete — your payment is held safely');
      location.hash = '#/dashboard?tab=purchases';
    } catch (err) { toast(err.message, 'err'); }
  };
  const remove = $('#remove');
  if (remove) remove.onclick = async () => {
    if (!(await confirmBox('Remove listing?', 'Buyers will no longer see this item.', 'Remove'))) return;
    try { await api(`/listings/${l.id}/remove`, {}); toast('Listing removed'); location.hash = '#/dashboard?tab=listings'; }
    catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- Auth ----------
function authPage(kind) {
  const signup = kind === 'signup';
  app.innerHTML = `<div class="auth-wrap"><form class="auth glass" id="f">
    <img class="logo-mark" src="/logo.svg" alt="">
    <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
    <p class="sub">${signup ? 'Start buying and selling game items in seconds.' : 'Log in to continue trading.'}</p>
    <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required></div>
    <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" required
      autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? '<span class="hint">At least 8 characters</span>' : ''}</div>
    <p class="error" id="err"></p>
    <button class="btn lg block">${signup ? 'Create account' : 'Log in'}</button>
    <p class="switch">${signup ? 'Already have an account? <a href="#/login">Log in</a>' : 'New to Lootrova? <a href="#/signup">Create an account</a>'}</p>
  </form></div>`;
  const f = $('#f');
  f.username.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await busy($('button', f), () => api('/' + kind, { username: f.username.value, password: f.password.value }));
      await loadMe();
      toast(signup ? `Welcome to Lootrova, ${me.username}!` : `Welcome back, ${me.username}`);
      location.hash = '#/';
    } catch (err) {
      $('#err').textContent = err.message;
      f.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 });
    }
  };
}

// ---------- Sell ----------
// Downscale in the browser so uploads stay small; WebP where supported, JPEG otherwise.
async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const webp = c.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.85);
}

function sellPage() {
  if (!me) { toast('Log in to start selling', 'err'); return (location.hash = '#/login'); }
  const images = [];
  app.innerHTML = `
    <div class="section-head" style="margin-top:44px"><div><span class="eyebrow">New listing</span><h2 style="font-size:2rem">Sell a game item</h2></div></div>
    <div class="sell-layout">
      <form class="sell-form glass reveal" id="f">
        <div class="field"><label>Images <span class="muted" style="font-weight:400">(up to ${MAX_IMAGES})</span></label>
          <div class="dropzone" id="drop" tabindex="0" role="button">
            <div class="ic">${icon.upload}</div><b>Drop images here or click to upload</b>
            <small>JPG, PNG or WebP · first image is the cover</small>
            <input type="file" id="file" accept="image/jpeg,image/png,image/webp" multiple></div>
          <div class="previews" id="previews"></div></div>
        <div class="field"><label for="game">Game</label><input id="game" name="game" placeholder="e.g. Fortnite, CS2, Roblox" maxlength="60" required></div>
        <div class="field"><label for="title">Item name</label><input id="title" name="title" placeholder="e.g. AK-47 | Redline (Field-Tested)" maxlength="100" required></div>
        <div class="field"><label for="description">Description</label>
          <textarea id="description" name="description" placeholder="Condition, rarity, and how the item will be delivered to the buyer" maxlength="2000" required></textarea></div>
        <div class="field"><label for="price">Price</label><div class="input-prefix"><span>$</span>
          <input id="price" name="price" type="number" min="0.5" max="10000" step="0.01" placeholder="0.00" required></div></div>
        <label class="check"><input type="checkbox" name="usable">
          <span>I confirm this item works and the buyer can use it. Items that don't work get disputed and aren't paid out.</span></label>
        <p class="error" id="err"></p>
        <button class="btn lg block">Publish listing</button>
      </form>
      <aside class="preview-col reveal" style="--i:2">
        <div class="preview-label">Live preview</div>
        <div id="preview"></div>
        <div class="payout glass" id="payout"></div>
      </aside>
    </div>`;

  const f = $('#f'), drop = $('#drop'), fileInput = $('#file');

  const renderPreview = () => {
    const cents = Math.round(Number(f.price.value) * 100) || 0;
    const fee = Math.round(cents * FEE_RATE);
    $('#preview').innerHTML = card({
      id: 0, game: f.game.value.trim() || 'Game', title: f.title.value.trim() || 'Your item name',
      seller: me.username, price_cents: cents, images,
    }, 0).replace('reveal', '');
    $('#payout').innerHTML = `
      <div class="line"><span>Listing price</span><span>${money(cents)}</span></div>
      <div class="line"><span>Lootrova fee (10%)</span><span>−${money(fee)}</span></div>
      <div class="line total"><span>You receive</span><b>${money(cents - fee)}</b></div>`;
  };
  const renderThumbs = () => {
    $('#previews').innerHTML = images.map((src, i) => `<div class="thumb"><img src="${src}" alt="">
      ${i === 0 ? '<span class="cover">Cover</span>' : ''}<button type="button" class="x" data-i="${i}" aria-label="Remove image">${icon.x}</button></div>`).join('');
    $$('#previews .x').forEach((b) => (b.onclick = () => { images.splice(+b.dataset.i, 1); renderThumbs(); }));
    renderPreview();
  };
  const addFiles = async (files) => {
    const list = [...files].filter((file) => /^image\/(jpeg|png|webp)$/.test(file.type));
    if (list.length < files.length) toast('Only JPG, PNG or WebP images are allowed', 'err');
    const room = MAX_IMAGES - images.length;
    if (list.length > room) toast(`You can add up to ${MAX_IMAGES} images`, 'err');
    for (const file of list.slice(0, room)) {
      try { images.push(await resizeImage(file)); renderThumbs(); }
      catch { toast(`Couldn't read ${file.name}`, 'err'); }
    }
  };

  drop.onclick = () => fileInput.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
  fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  f.oninput = renderPreview;
  renderPreview();

  f.onsubmit = async (e) => {
    e.preventDefault();
    $('#err').textContent = '';
    try {
      const { id } = await busy($('button.btn.lg', f), () => api('/listings', {
        game: f.game.value, title: f.title.value, description: f.description.value,
        price: f.price.value, usable: f.usable.checked, images,
      }));
      toast('Your item is live!');
      location.hash = '#/item/' + id;
    } catch (err) { $('#err').textContent = err.message; }
  };
}

// ---------- Dashboard ----------
async function dashboard() {
  if (!me) { toast('Log in to see your dashboard', 'err'); return (location.hash = '#/login'); }
  app.innerHTML = `<div class="dash-head"><div><span class="eyebrow">Dashboard</span><h1>Hey, ${esc(me.username)}</h1></div></div>
    <div class="tiles">${'<div class="skeleton" style="height:100px"></div>'.repeat(4)}</div>`;
  const d = await api('/dashboard');
  me = d.user;
  renderNav();

  const held = d.sales.filter((o) => o.status !== 'completed').reduce((s, o) => s + o.price_cents - o.fee_cents, 0);
  const completed = d.sales.filter((o) => o.status === 'completed').length;
  let tab = hashParams().get('tab') || (d.purchases.some((o) => o.status !== 'completed') ? 'purchases' : 'listings');

  app.innerHTML = `
    <div class="dash-head"><div><span class="eyebrow">Dashboard</span><h1>Hey, ${esc(me.username)}</h1></div>
      <a class="btn" href="#/sell">${icon.plus} New listing</a></div>
    <div class="tiles">
      <div class="tile glass hl reveal"><div class="label">${icon.wallet} Available balance</div><div class="value">${money(me.balance_cents)}</div></div>
      <div class="tile glass reveal" style="--i:1"><div class="label">${icon.clock} Pending payouts</div><div class="value">${money(held)}</div></div>
      <div class="tile glass reveal" style="--i:2"><div class="label">${icon.check} Completed sales</div><div class="value">${completed}</div></div>
      <div class="tile glass reveal" style="--i:3"><div class="label">${icon.box} Active listings</div><div class="value">${d.listings.length}</div></div>
    </div>
    <div class="tabs" role="tablist">
      ${[['purchases', 'Purchases', d.purchases.length], ['sales', 'Sales', d.sales.length], ['listings', 'Listings', d.listings.length]]
        .map(([k, label, n]) => `<button class="tab" data-tab="${k}" role="tab">${label}<span class="n">${n}</span></button>`).join('')}
    </div>
    <div class="list" id="list"></div>`;

  const th = (o) => `<div class="th">${cover(o)}</div>`;
  const orderRow = (o, i, asBuyer) => `<div class="row reveal" style="--i:${i}">${th(o)}
    <div class="main"><b>${esc(o.title)}</b><small>${esc(o.game)} · ${asBuyer ? 'from ' + esc(o.seller) : 'to ' + esc(o.buyer)} · ${money(o.price_cents)}
      ${asBuyer ? '' : ` · you get <b style="display:inline;color:var(--text)">${money(o.price_cents - o.fee_cents)}</b>`}</small></div>
    <div class="side"><span class="status ${o.status}">${o.status === 'pending' ? (asBuyer ? 'Awaiting your check' : 'Payment held') : o.status}</span>
      ${asBuyer && o.status !== 'completed' ? `<button class="btn success sm" data-confirm="${o.id}">${icon.check} It works</button>
        ${o.status === 'pending' ? `<button class="btn danger sm" data-dispute="${o.id}">Doesn't work</button>` : ''}` : ''}</div></div>`;
  const empty = (text, cta) => `<div class="empty"><div class="icon">${icon.bag}</div><h3>${text}</h3>${cta}</div>`;

  const renderTab = () => {
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const list = $('#list');
    if (tab === 'purchases') list.innerHTML = d.purchases.map((o, i) => orderRow(o, i, true)).join('')
      || empty('No purchases yet', '<p class="muted">Find something you like on the marketplace.</p><a class="btn" href="#/">Browse items</a>');
    if (tab === 'sales') list.innerHTML = d.sales.map((o, i) => orderRow(o, i, false)).join('')
      || empty('No sales yet', '<p class="muted">Your sold items will show up here.</p>');
    if (tab === 'listings') list.innerHTML = d.listings.map((l, i) => `<div class="row reveal" style="--i:${i}">${th(l)}
        <div class="main"><a href="#/item/${l.id}" style="text-decoration:none"><b>${esc(l.title)}</b></a><small>${esc(l.game)} · ${money(l.price_cents)}</small></div>
        <div class="side"><a class="btn ghost sm" href="#/item/${l.id}">View</a><button class="btn danger sm" data-remove="${l.id}">Remove</button></div></div>`).join('')
      || empty('Nothing listed', `<p class="muted">List your first game item. It only takes a minute.</p><a class="btn" href="#/sell">${icon.plus} Sell an item</a>`);
    bindActions();
  };

  const act = (sel, fn) => $$(sel).forEach((b) => (b.onclick = async () => {
    try { if (await fn(b)) dashboard(); } catch (err) { toast(err.message, 'err'); }
  }));
  const bindActions = () => {
    act('[data-confirm]', async (b) => {
      const order = d.purchases.find((o) => o.id === +b.dataset.confirm);
      const stars = await askRating(order);
      if (!stars) return false;
      await api(`/orders/${order.id}/confirm`, { stars });
      toast(`Thanks! ${order.seller} has been paid`);
      return true;
    });
    act('[data-dispute]', async (b) => {
      if (!(await confirmBox('Report a problem?', "The seller won't be paid while the order is disputed.", 'Open dispute'))) return false;
      await api(`/orders/${b.dataset.dispute}/dispute`, {});
      toast('Dispute opened');
      return true;
    });
    act('[data-remove]', async (b) => {
      if (!(await confirmBox('Remove listing?', 'Buyers will no longer see this item.', 'Remove'))) return false;
      await api(`/listings/${b.dataset.remove}/remove`, {});
      toast('Listing removed');
      return true;
    });
  };

  $$('.tab').forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    history.replaceState(null, '', '#/dashboard?tab=' + tab);
    renderTab();
  }));
  renderTab();
}

// ---------- Router ----------
async function loadMe() { me = (await api('/me')).user; renderNav(); }

async function route() {
  const [page, id] = location.hash.replace(/^#\//, '').split('?')[0].split('/');
  const view = page || 'home';
  renderNav();
  // Changing the search or game filter on the home page only refreshes the results.
  if (view === 'home' && currentView === 'home' && $('#results')) return loadResults().catch((e) => toast(e.message, 'err'));
  currentView = view;
  app.classList.remove('page');
  void app.offsetWidth; // restart the page-enter animation
  app.classList.add('page');
  window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    if (view === 'login' || view === 'signup') authPage(view);
    else if (view === 'sell') sellPage();
    else if (view === 'dashboard') await dashboard();
    else if (view === 'item') await itemPage(Number(id));
    else await home();
  } catch (err) {
    app.innerHTML = `<div class="empty" style="margin-top:60px"><div class="icon">${icon.alert}</div><h3>${esc(err.message)}</h3>
      <a class="btn" href="#/">Back to marketplace</a></div>`;
  }
}

window.addEventListener('hashchange', route);
loadMe().then(route);
