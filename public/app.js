const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const nav = $('#nav');
const MAX_IMAGES = 4;
let CFG = { currency: 'GBP', fee_rate: 0.1, buyer_fee_cents: 0, hold_days: 7, min_payout_cents: 100, test_mode: false, test_cards: [], licences: {}, report_categories: {}, allowed_file_types: [], max_file_mb: 50 };
let me = null;
let currentView = '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: CFG.currency }).format((c || 0) / 100);
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
const toDate = (s) => (s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z') : null);
const fmtDate = (s) => (s ? toDate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDateTime = (s) => (s ? toDate(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fileSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const feeOf = (c) => Math.round(c * CFG.fee_rate);
const feePct = () => Math.round(CFG.fee_rate * 100) + '%';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---------- Icons ----------
const svg = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icon = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 20),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  percent: svg('<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  bigCheck: svg('<path d="M20 6 9 17l-5-5"/>', 38),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>', 14),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  upload: svg('<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>', 22),
  download: svg('<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/>', 20),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>', 13),
  arrowLeft: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>', 16),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 16),
  bag: svg('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>'),
  zap: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
  wallet: svg('<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M16 13h2M2 10h20"/>', 16),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16),
  box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>', 16),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 15),
  flag: svg('<path d="M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5"/>', 15),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 14),
  receipt: svg('<path d="M5 3v18l2-1.5L9 21l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3z"/><path d="M8 9h8M8 13h6"/>', 16),
  coins: svg('<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5a6 6 0 1 1-6 6"/>', 16),
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
  return `<div class="art" style="background:repeating-linear-gradient(135deg,rgba(255,255,255,.05) 0 14px,transparent 14px 28px),linear-gradient(160deg,hsl(${h} 42% 34%),hsl(${(h + 25) % 360} 45% 14%))"><span>${esc(initials)}</span></div>`;
}
const imgOf = (l) => (l.images ? l.images[0] : l.image);
const cover = (l) => (imgOf(l) ? `<img src="${esc(imgOf(l))}" alt="" loading="lazy">` : art(l.game));
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
async function request(url, body) {
  const res = await fetch(url, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || data.error || 'Something went wrong. Please try again.');
    Object.assign(err, { status: res.status, data });
    throw err;
  }
  return data;
}
const api = (path, body) => request('/api' + path, body);

async function busy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}
const needLogin = (msg) => {
  toast(msg, 'err');
  location.hash = '#/login?next=' + encodeURIComponent(location.hash || '#/');
};

// ---------- Toasts & modals ----------
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span class="ti">${type === 'ok' ? icon.check : icon.alert}</span><span>${esc(msg)}</span>`;
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3600);
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

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
const askRating = (order) => modal(`
  <h2>Confirm it works</h2>
  <p class="muted" style="margin:0">Confirm you received it. The seller is paid once you <b>and</b> <b style="color:var(--text)">${esc(order.seller)}</b> have both confirmed. How was the seller?</p>
  <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-s="${n}" aria-label="${n} stars">${icon.star(34)}</button>`).join('')}</div>
  <div class="stars-label" id="sl">Tap to rate</div>
  <div class="actions"><button class="btn ghost" data-close>Cancel</button><button class="btn success" id="go" disabled>Confirm it works</button></div>`,
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

// Modal with a text box; resolves to the text (or null if cancelled).
const askText = (title, text, { label = 'Reason', action = 'Submit', cls = 'danger', min = 0, extra = '' } = {}) => modal(`
  <h2>${title}</h2><p class="muted" style="margin:0 0 16px">${text}</p>
  <div class="field"><label for="mt">${label}</label><textarea id="mt" style="min-height:90px"></textarea></div>${extra}
  <p class="error" id="me"></p>
  <div class="actions"><button class="btn ghost" data-close>Cancel</button><button class="btn ${cls}" id="go">${action}</button></div>`,
  (el, close) => {
    $('#mt', el).focus();
    $('#go', el).onclick = () => {
      const v = $('#mt', el).value.trim();
      if (v.length < min) { $('#me', el).textContent = `Please write at least ${min} characters.`; return; }
      close({ text: v, checked: !!$('#mx', el)?.checked });
    };
  });

function reportModal(listing) {
  const cats = Object.entries(CFG.report_categories);
  return modal(`
    <h2>Report product</h2>
    <p class="muted" style="margin:0 0 16px">Tell our moderators what’s wrong with <b style="color:var(--text)">${esc(listing.title)}</b>. Reports are private.</p>
    <form id="rf">
      <div class="field"><label for="rc">Reason</label><select id="rc" name="category" required>
        <option value="">Choose a reason…</option>${cats.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="rd">Details</label><textarea id="rd" name="details" style="min-height:90px" placeholder="What did you find?"></textarea></div>
      <div id="copyright-fields" hidden>
        <div class="notice">Copyright reports need the details below. See the <a href="#/policy/copyright" style="color:inherit">Copyright &amp; IP Policy</a>.</div>
        <div class="field"><label for="rn">Your full name</label><input id="rn" name="contact_name" autocomplete="name"></div>
        <div class="field"><label for="rw">Your original work (link or description)</label><textarea id="rw" name="original_work" style="min-height:70px"></textarea></div>
        <label class="check"><input type="checkbox" name="good_faith"><span>I believe in good faith that this use isn’t authorised by the rights owner, and the information in this report is accurate.</span></label>
      </div>
      <div class="field" id="email-field" ${me ? 'hidden' : ''}><label for="re">Your email</label><input id="re" name="contact_email" type="email" autocomplete="email"></div>
      <p class="error" id="rerr"></p>
      <div class="actions" style="margin-top:8px"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn danger" id="go">Send report</button></div>
    </form>`,
  (el, close) => {
    const f = $('#rf', el);
    f.category.onchange = () => {
      const cr = f.category.value === 'copyright';
      $('#copyright-fields', el).hidden = !cr;
      $('#email-field', el).hidden = !!me && !cr;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await busy($('#go', el), () => api(`/listings/${listing.id}/report`, {
          category: f.category.value, details: f.details.value, contact_name: f.contact_name.value,
          contact_email: f.contact_email.value, original_work: f.original_work.value, good_faith: f.good_faith.checked,
        }));
        close(true);
      } catch (err) { $('#rerr', el).textContent = err.message; }
    };
  });
}

// ---------- Nav ----------
function renderNav() {
  const page = location.hash.replace(/^#\//, '').split(/[?/]/)[0];
  const link = (href, label, key, cls = '') => `<a class="nav-link ${cls} ${page === key ? 'active' : ''}" href="${href}">${label}</a>`;
  nav.innerHTML = me
    ? `${link('#/', 'Browse', '', 'hide-sm')}${link('#/dashboard', 'Dashboard', 'dashboard', 'hide-sm')}${me.role === 'admin' ? link('#/admin', 'Admin', 'admin', 'hide-sm') : ''}
       <a class="btn sm" href="#/sell">${icon.plus}<span>Sell</span></a>
       <a class="user-chip" href="#/dashboard" title="Available balance">${avatar(me.username)}
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
    <section class="hero hero-banner reveal">
      <div class="hero-copy">
        <span class="pill"><span class="dot"></span>Every purchase protected until you confirm it works</span>
        <h1>Buy &amp; sell <span class="grad-text">game items</span> safely</h1>
        <p class="lead">Skins, items, codes and mods from real players. Your money is held until you confirm it works.</p>
        <form class="search" id="search">${icon.search}
          <input name="q" placeholder="Search skins, items, games…" value="${esc(p.get('q') || '')}" autocomplete="off">
          <button class="btn">Search</button></form>
        <div class="stats">
          <div class="stat"><b data-stat="live">0</b><span>Items live</span></div>
          <div class="stat"><b data-stat="sellers">0</b><span>Sellers</span></div>
          <div class="stat"><b data-stat="completed">0</b><span>Trades completed</span></div>
        </div>
      </div>
      <div class="hero-art" id="hero-art" aria-hidden="true"></div>
    </section>
    <div id="feed"></div>
    <div class="section-head"><div><span class="eyebrow">Browse by game</span><h2>Popular games</h2></div></div>
    <div class="game-tiles" id="game-tiles"></div>
    <div class="section-head"><div><span class="eyebrow">Marketplace</span><h2 id="results-title">Latest drops</h2></div>
      <div class="chips" id="chips"></div></div>
    <div class="grid" id="results">${skeletons(8)}</div>
    <div class="features">
      ${[[icon.shield, 'Buyer protection', 'Payment is held until you confirm the item works. If it doesn’t, request a refund.'],
         [icon.check, 'Usable items only', 'Every seller confirms their item works and that they have the right to sell it.'],
         [icon.percent, `Simple ${feePct()} fee`, `Listing is free. Sellers pay a flat ${feePct()} only when a sale succeeds. Buyers pay no extra fees.`]]
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
  if (me) api('/feed').then(({ listings }) => {
    if (listings.length && $('#feed')) $('#feed').innerHTML = `<div class="section-head"><div><span class="eyebrow">Following</span><h2>From sellers you follow</h2></div></div>
      <div class="grid">${listings.slice(0, 8).map(card).join('')}</div>`;
  }).catch(() => {});
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
  const tiles = $('#game-tiles');
  if (tiles && first) tiles.innerHTML = data.games.slice(0, 6).map((g, i) => `<a class="game-tile reveal" style="--i:${i}" href="${chipHref(g.game)}">${art(g.game)}
    <span class="gt-name">${esc(g.game)}</span><span class="gt-count">${g.count} item${g.count === 1 ? '' : 's'}</span></a>`).join('') || '<p class="muted">Games appear here once items are listed.</p>';
  const heroArt = $('#hero-art');
  if (heroArt && first) heroArt.innerHTML = data.listings.slice(0, 3).map((l, i) => `<a class="hero-card hc-${i}" href="#/item/${l.id}">${cover(l)}
    <span class="hc-info"><b>${esc(l.title)}</b><span>${money(l.price_cents)}</span></span></a>`).join('');
  $('#results-title').textContent = q || game ? `${data.listings.length} result${data.listings.length === 1 ? '' : 's'}` : 'Latest drops';

  results.innerHTML = data.listings.map(card).join('') || `
    <div class="empty" style="grid-column:1/-1"><div class="icon">${icon.bag}</div>
      <h3>${q || game ? 'No items match your search' : 'No items listed yet'}</h3>
      <p class="muted">${q || game ? 'Try a different search or game.' : 'Be the first to list a game item.'}</p>
      <a class="btn" href="#/sell">${icon.plus}List an item</a></div>`;
}

// ---------- Item detail ----------
function specsList(l) {
  const rows = [
    ['File', l.file ? `${String(l.file.ext).toUpperCase()} · ${fileSize(l.file.size)}` : 'Not uploaded yet'],
    ['Compatibility', l.compatibility],
    ['Requirements', l.requirements],
    ['Licence', [l.licence_label, l.licence_text].filter(Boolean).join('\n')],
    ['Delivery', 'Instant download after payment' + (l.buyer_info_label ? `. Seller needs: ${l.buyer_info_label}` : '')],
    ['Copies', l.copies_left == null ? 'Unlimited' : l.copies_left ? `${l.copies_left} left` : 'Sold out'],
  ].filter(([, v]) => v);
  return `<dl class="specs">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

async function itemPage(id) {
  app.innerHTML = `<a class="back" href="#/">${icon.arrowLeft} Back to marketplace</a>
    <div class="detail"><div class="skeleton" style="aspect-ratio:4/3"><div class="sk" style="height:100%;border-radius:0"></div></div>
    <div class="skeleton" style="height:420px"></div></div>`;
  const { listing: l } = await api('/listings/' + id);
  const fee = feeOf(l.price_cents);

  let cta;
  if (l.is_owner) {
    cta = `${l.status === 'removed' ? `<div class="notice bad">Removed${l.removal_reason ? ': ' + esc(l.removal_reason) : ''}</div>` : ''}
      <div class="payout glass" style="margin:0 0 14px;box-shadow:none">
        <div class="line"><span>Price</span><span>${money(l.price_cents)}</span></div>
        <div class="line"><span>Lootrova fee (${feePct()})</span><span>−${money(fee)}</span></div>
        <div class="line total"><span>You receive</span><b>${money(l.price_cents - fee)}</b></div></div>
      ${l.status !== 'removed' ? `<div class="cta-row"><a class="btn ghost" href="#/edit/${l.id}">Edit listing</a><button class="btn danger" id="remove">Remove listing</button></div>` : ''}`;
  } else if (l.owned_order_id) {
    cta = `<div class="notice ok">You own this item.</div>
      <div class="cta-stack"><a class="btn lg block" href="/download/${l.owned_order_id}">${icon.download} Download</a>
      <a class="btn ghost block" href="#/dashboard?tab=library">View in library</a></div>`;
  } else if (l.purchasable) {
    cta = `<button class="btn lg block" id="buy">${icon.zap} Buy now</button>`;
  } else {
    cta = `<div class="sold-banner">${esc(l.unavailable_reason || 'This item isn’t available')}</div>`;
  }

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
        <div class="sold-by">${avatar(l.seller)}<span>Sold by <a href="#/u/${encodeURIComponent(l.seller)}" style="color:#fff;font-weight:700">${esc(l.seller)}</a></span>${rating(l.seller_rating, l.seller_reviews)}</div>
        <div class="price">${money(l.price_cents)}</div>
        <p class="price-note">Final price. No extra fees at checkout.</p>
        ${cta}
        <div class="protect">${icon.shield}<div><b>Lootrova Buyer Protection</b><p>Your payment is held for ${CFG.hold_days} days so you can check the item works. Not as described? <a href="#/policy/refunds" style="color:inherit">Request a refund</a>.</p></div></div>
        <div class="receive"><h3>What you receive</h3><p>${esc(l.delivers || 'See description')}</p>${specsList(l)}</div>
        <div class="desc-wrap"><div class="block-title">Description</div><p class="desc">${esc(l.description)}</p></div>
        <div class="seller-card">${avatar(l.seller, 'lg')}
          <div style="flex:1"><a href="#/u/${encodeURIComponent(l.seller)}" style="color:#fff;font-weight:700;text-decoration:none">${esc(l.seller)}</a><small class="muted">${l.seller_sales} sale${l.seller_sales === 1 ? '' : 's'} on Lootrova</small></div>
          ${rating(l.seller_rating, l.seller_reviews) || '<small class="muted">New seller</small>'}</div>
        <div class="market-note"><span>Listed by an independent seller. Lootrova takes a ${feePct()} fee from each sale.</span>
          ${l.is_owner ? '' : `<button class="link-btn" id="report">${icon.flag} Report product</button>`}</div>
      </div>
    </div>`;

  // On phones the Buy button stays reachable at the bottom of the screen.
  if (l.purchasable && !l.is_owner) {
    $('#buybar-root').innerHTML = `<div class="buybar"><div><small>Final price</small><div class="price">${money(l.price_cents)}</div></div>
      <button class="btn lg" id="buy-bar">${icon.zap} Buy now</button></div>`;
    document.body.classList.add('has-buybar');
  }

  $$('.thumbs button').forEach((b) => (b.onclick = () => {
    $$('.thumbs button').forEach((x) => x.classList.toggle('on', x === b));
    $('#main').innerHTML = `<img src="${esc(b.dataset.src)}" alt="">`;
  }));
  const goBuy = () => { location.hash = '#/checkout/' + l.id; };
  [$('#buy'), $('#buy-bar')].forEach((b) => b && (b.onclick = goBuy));
  const remove = $('#remove');
  if (remove) remove.onclick = async () => {
    if (!(await confirmBox('Remove listing?', 'Buyers will no longer be able to buy this item. Past buyers keep their downloads.', 'Remove'))) return;
    try { await api(`/listings/${l.id}/remove`, {}); toast('Listing removed'); location.hash = '#/dashboard?tab=listings'; }
    catch (err) { toast(err.message, 'err'); }
  };
  const report = $('#report');
  if (report) report.onclick = async () => { if (await reportModal(l)) toast('Thanks. Our moderators will review your report.'); };
}

// ---------- Checkout ----------
function formatCardNumber(v) { return v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '); }
function formatExpiry(v) {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + ' / ' + d.slice(2) : d;
}

async function checkoutPage(id) {
  if (!me) return needLogin('Log in to buy this item');
  app.innerHTML = `<div class="sell-layout" style="margin-top:44px"><div class="skeleton" style="height:520px"></div><div class="skeleton" style="height:360px"></div></div>`;
  let q;
  try { q = (await api('/checkout/' + id)).quote; } catch (err) {
    if (err.data?.order_id) { toast(err.message); location.hash = '#/dashboard?tab=library'; return; }
    throw err;
  }
  const sellerFee = feeOf(q.price_cents);
  const summary = (qq) => `
    <div class="summary" style="margin-top:0"><div class="th">${cover(qq)}</div>
      <div style="flex:1;min-width:0"><b>${esc(qq.product_title)}</b><br><small class="muted">${esc(qq.game)}</small></div></div>
    <div class="line"><span>Product</span><span>${esc(qq.product_title)}</span></div>
    <div class="line"><span>Seller</span><span>${esc(qq.seller)}</span></div>
    <div class="line"><span>Product price</span><span>${money(qq.price_cents)}</span></div>
    <div class="line"><span>Service fee</span><span>${money(qq.buyer_fee_cents)}</span></div>
    <div class="line total"><span>Total to pay</span><span id="sum-total">${money(qq.total_cents)}</span></div>
    <p class="fine">No other fees will be added. Lootrova’s ${feePct()} platform fee (${money(sellerFee)}) is paid by the seller from their earnings.</p>
    <div class="receive" style="margin-top:16px"><h3>What you receive</h3><p>${esc(qq.delivers)}</p></div>`;

  app.innerHTML = `
    <a class="back" href="#/item/${q.listing_id}">${icon.arrowLeft} Back to item</a>
    <div class="section-head" style="margin-top:0"><div><span class="eyebrow">Checkout</span><h2 style="font-size:2rem">Review and pay</h2></div></div>
    <div class="sell-layout">
      <form class="sell-form glass reveal" id="f" novalidate>
        <div class="field"><label for="email">Email for your receipt</label>
          <input id="email" name="email" type="email" autocomplete="email" required value="${esc(store.get('lootrova_email') || '')}">
          <span class="hint">Your receipt is also saved to your account.</span></div>
        ${q.buyer_info_label ? `<div class="field"><label for="binfo">${esc(q.buyer_info_label)}</label>
          <input id="binfo" name="binfo" required maxlength="200" placeholder="The seller needs this to deliver your item">
          <span class="hint">Only the seller of this order can see this. You can also message them after paying.</span></div>` : ''}
        <div class="block-title" style="margin-top:6px">Payment</div>
        ${CFG.test_mode ? `<div class="test-cards"><b>Test mode: no real money is taken</b>
          ${CFG.test_cards.map((c) => `<button type="button" data-card="${c.number}"><code>${formatCardNumber(c.number)}</code> — ${esc(c.label)}</button>`).join('')}
          <span class="muted">Use any future expiry date and any 3-digit CVC.</span></div>` : ''}
        <div class="card-fields">
          <div class="field full"><label for="cc">Card number</label><input id="cc" name="cc" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456" required></div>
          <div class="field"><label for="exp">Expiry</label><input id="exp" name="exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM / YY" required></div>
          <div class="field"><label for="cvc">CVC</label><input id="cvc" name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4" required></div>
        </div>
        <label class="check" id="consent-box" style="margin-top:18px"><input type="checkbox" name="consent" id="consent">
          <span>I want immediate access to this digital content. I understand that once the download is available, I lose my 14-day right to cancel. My rights for faulty or misdescribed items are not affected (<a href="#/policy/refunds" style="color:var(--violet-soft)">Refund Policy</a>).</span></label>
        <p class="error" id="err" role="alert"></p>
        <button class="btn lg block" id="pay">${icon.lock} Pay ${money(q.total_cents)} now</button>
        <div class="pay-secure">${icon.lock} Card details go straight to the payment provider. Lootrova never stores your card number.</div>
        <a class="btn ghost block" href="#/item/${q.listing_id}" style="margin-top:12px">Cancel</a>
      </form>
      <aside class="preview-col reveal" style="--i:2">
        <div class="preview-label">Order summary</div>
        <div class="summary-panel glass" id="summary">${summary(q)}</div>
      </aside>
    </div>`;

  const f = $('#f'), err = $('#err'), payBtn = $('#pay');
  f.cc.oninput = () => { f.cc.value = formatCardNumber(f.cc.value); };
  f.exp.oninput = () => { f.exp.value = formatExpiry(f.exp.value); };
  f.consent.onchange = () => { $('#consent-box').classList.toggle('invalid', false); if (f.consent.checked && /tick the box/i.test(err.textContent)) err.textContent = ''; };
  $$('[data-card]').forEach((b) => (b.onclick = () => {
    f.cc.value = formatCardNumber(b.dataset.card);
    f.exp.value = '12 / ' + String((new Date().getFullYear() + 3) % 100);
    f.cvc.value = '123';
  }));

  let paying = false;
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (paying) return;
    err.textContent = '';
    if (!f.email.checkValidity() || !f.email.value) { err.textContent = 'Enter a valid email address for your receipt.'; f.email.focus(); return; }
    if (f.binfo && !f.binfo.value.trim()) { err.textContent = `Please fill in: ${q.buyer_info_label}.`; f.binfo.focus(); return; }
    if (!f.cc.value || !f.exp.value || !f.cvc.value) { err.textContent = 'Enter your card number, expiry date and CVC.'; return; }
    if (!f.consent.checked) {
      err.textContent = 'Please tick the box to confirm you want immediate access and understand you lose your 14-day right to cancel.';
      $('#consent-box').classList.add('invalid');
      return;
    }
    paying = true;
    try {
      await busy(payBtn, async () => {
        let co;
        try {
          co = await api('/checkout', { listing_id: q.listing_id, email: f.email.value, consent: true, buyer_info: f.binfo?.value, expected_total_cents: q.total_cents });
        } catch (e2) {
          if (e2.status === 409 && e2.data?.quote) { q = e2.data.quote; $('#summary').innerHTML = summary(q); payBtn.dataset.total = q.total_cents; }
          throw e2;
        }
        store.set('lootrova_email', f.email.value);
        const [mm, yy] = f.exp.value.split('/').map((s) => s.trim());
        try {
          await request(`/provider/${co.payment.provider}/payment_intents/${co.payment.intent_id}/confirm`, {
            client_secret: co.payment.client_secret, card: { number: f.cc.value, exp_month: mm, exp_year: yy, cvc: f.cvc.value },
          });
        } catch (e3) {
          throw new Error((e3.message || 'Your payment didn’t go through.') + ' You can check your details and try again.');
        }
        // The server re-checks the payment with the provider before the order counts as paid.
        const { order } = await api(`/orders/${co.order.id}/sync`, {});
        if (['paid', 'completed'].includes(order.status)) { location.hash = '#/order/' + order.id; return; }
        if (order.status === 'cancelled') throw new Error(order.access_note || 'This item became unavailable. You have not been charged.');
        throw new Error('We couldn’t confirm your payment yet. You have not been given access. Please try again in a moment.');
      });
    } catch (e4) {
      err.textContent = e4.message;
      if (e4.data?.field === 'consent') $('#consent-box').classList.add('invalid');
    } finally { paying = false; }
    if (payBtn.dataset.total) payBtn.innerHTML = `${icon.lock} Pay ${money(+payBtn.dataset.total)} now`;
  };
}

// ---------- Order success & receipt ----------
async function orderPage(id) {
  if (!me) return needLogin('Log in to see your order');
  const { order: o } = await api('/orders/' + id);
  if (o.status === 'awaiting_payment') {
    app.innerHTML = `<div class="success-page glass reveal"><div class="empty" style="border:0;padding:0"><div class="icon">${icon.alert}</div>
      <h3>Payment not completed</h3><p class="muted">${esc(o.last_payment_error || 'This order hasn’t been paid, so no money was taken and there’s nothing to download yet.')}</p>
      <a class="btn" href="#/checkout/${o.listing_id}">Return to checkout</a></div></div>`;
    return;
  }
  app.innerHTML = `
    <div class="success-page glass reveal">
      <div class="tick">${icon.bigCheck}</div>
      <h1>${o.can_download ? 'Payment successful' : 'Order details'}</h1>
      <p class="muted" style="margin:0 0 20px">Order <b style="color:var(--text)">${esc(o.receipt_no || '#' + o.id)}</b>${o.paid_at ? ` · paid ${fmtDateTime(o.paid_at)}` : ''}. Your receipt has been saved to your account${o.email ? ` for ${esc(o.email)}` : ''}.</p>
      <div class="summary"><div class="th">${cover(o)}</div>
        <div style="flex:1;min-width:0"><b>${esc(o.product_title)}</b><br><small class="muted">Sold by ${esc(o.seller)}${o.file ? ` · ${String(o.file.ext).toUpperCase()} · ${fileSize(o.file.size)}` : ''}</small></div>
        <div class="price">${money(o.total_cents)}</div></div>
      ${o.can_download
        ? `<a class="btn xl block" href="${o.download_url}" id="download">${icon.download} Download</a>`
        : `<div class="notice bad">${esc(o.access_note || 'Downloads aren’t available for this order.')}</div>`}
      <div class="links"><a class="btn ghost sm" href="#/chat/${o.id}">${icon.chat} Message seller</a><a class="btn ghost sm" href="#/receipt/${o.id}">${icon.receipt} View receipt</a><a class="btn ghost sm" href="#/dashboard?tab=library">Go to my library</a></div>
      <p class="fine">Problem with the item? You can request a refund from your library during the ${CFG.hold_days}-day protection period.</p>
    </div>`;
}

async function receiptPage(id) {
  if (!me) return needLogin('Log in to see your receipt');
  const { order: o } = await api('/orders/' + id);
  app.innerHTML = `
    <div class="receipt glass reveal">
      <div class="receipt-head"><div class="logo"><img src="/logo.svg" alt="" width="26" height="26"><span>Loot<b>rova</b></span></div>
        <div style="text-align:right"><b>Receipt</b><div class="meta">${esc(o.receipt_no || 'Order #' + o.id)}</div></div></div>
      <div class="meta" style="margin-bottom:18px">Date: ${fmtDateTime(o.paid_at || o.created_at)}<br>Buyer: ${esc(o.buyer)}${o.email ? ` (${esc(o.email)})` : ''}<br>
        Status: ${esc(statusLabel(o.status, 'buyer'))}${o.card ? `<br>Paid with: ${esc(o.card.brand)} ending ${esc(o.card.last4)}` : ''}</div>
      <div class="line"><span>Product</span><span>${esc(o.product_title)}</span></div>
      <div class="line"><span>Seller</span><span>${esc(o.seller)}</span></div>
      <div class="line"><span>Product price</span><span>${money(o.price_cents)}</span></div>
      <div class="line"><span>Service fee</span><span>${money(o.buyer_fee_cents)}</span></div>
      <div class="line total"><span>Total paid</span><span>${money(o.total_cents)}</span></div>
      ${o.refunded_at ? `<div class="line"><span>Refunded ${fmtDate(o.refunded_at)}</span><span>−${money(o.total_cents)}</span></div>` : ''}
      <p class="fine">Sold by ${esc(o.seller)}, an independent seller on the Lootrova marketplace. ${o.licence_label ? 'Licence: ' + esc(o.licence_label) : ''}</p>
      <div class="cta-row no-print" style="margin-top:20px"><button class="btn ghost" onclick="window.print()">Print or save as PDF</button>
        ${o.can_download ? `<a class="btn" href="${o.download_url}">${icon.download} Download</a>` : ''}</div>
    </div>`;
}

function statusLabel(s, who) {
  return ({
    awaiting_payment: 'Awaiting payment', paid: who === 'buyer' ? 'Paid' : 'Pending', completed: who === 'buyer' ? 'Completed' : 'Available',
    disputed: 'Refund requested', refunded: 'Refunded', chargeback: 'Charged back', cancelled: 'Cancelled',
    requested: 'Processing', failed: 'Failed', active: 'Active', sold: 'Sold out', removed: 'Removed',
  })[s] || s;
}

// ---------- Profiles ----------
async function profilePage(name) {
  const { profile: p, listings } = await api('/profile?u=' + encodeURIComponent(name));
  document.title = `${p.username} — Lootrova`;
  app.innerHTML = `<div class="profile glass reveal">${avatar(p.username, 'xl')}
      <div class="p-main"><h1>${esc(p.username)} <span class="pres ${p.presence.online ? 'on' : ''}"><i></i>${p.presence.online ? 'Online now' : 'Offline'}</span></h1>
        <small class="muted">Member since ${fmtDate(p.joined)}${!p.presence.online && p.presence.last_seen_at ? ` · last seen ${fmtDateTime(p.presence.last_seen_at)}` : ''}</small>
        <div class="p-stats" style="margin-top:6px"><span>⏱ ${p.delivery.avg_delivery_minutes != null ? `Avg delivery <b>${p.delivery.avg_delivery_minutes < 60 ? p.delivery.avg_delivery_minutes + ' min' : (p.delivery.avg_delivery_minutes / 60).toFixed(1) + ' h'}</b>` : `Avg delivery shown after ${p.delivery.needed} sales`}</span>
          <span>🟢 Usually online <b>${p.presence.avg_online_hours_per_day} h/day</b></span></div>
        <div class="p-stats"><span><b id="fcount">${p.followers}</b> follower${p.followers === 1 ? '' : 's'}</span><span><b>${p.following}</b> following</span>
          <span><b>${p.sales}</b> sales</span><span>${p.rating.r ? `<b class="rating">★ ${p.rating.r}</b> (${p.rating.n})` : 'No ratings yet'}</span></div></div>
      ${p.is_me ? '<a class="btn ghost" href="#/dashboard">Your dashboard</a>' : `<button class="btn ${p.is_following ? 'ghost' : ''}" id="follow">${p.is_following ? 'Following ✓' : '+ Follow'}</button>`}
    </div>
    <div class="section-head"><div><span class="eyebrow">Shop</span><h2>${listings.length} item${listings.length === 1 ? '' : 's'} for sale</h2></div></div>
    <div class="grid">${listings.map(card).join('') || '<p class="muted">Nothing for sale right now.</p>'}</div>`;
  const b = $('#follow');
  if (b) b.onclick = async () => {
    if (!me) return needLogin('Log in to follow members');
    const want = !b.textContent.startsWith('Following');
    try {
      const r = await busy(b, () => api('/follow', { username: p.username, follow: want }));
      $('#fcount').textContent = r.followers;
      toast(want ? `Following ${p.username}. Their new items show on your homepage.` : `Unfollowed ${p.username}`);
      setTimeout(() => { b.textContent = want ? 'Following ✓' : '+ Follow'; b.classList.toggle('ghost', want); }, 0);
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- Order confirmations, delivery proof and cases ----------
async function uploadEvidence(file, onP) {
  const up = await uploadProductFile(file, onP);
  return up.id;
}
async function orderPanel(id) {
  const box = $('#order-panel');
  if (!box) return;
  const [{ order: o }, { case: c }] = await Promise.all([api(`/orders/${id}/messages`), api(`/orders/${id}/case`)]);
  const seller = o.role === 'seller', buyer = o.role === 'buyer';
  const step = (done, label) => `<span class="cstep ${done ? 'done' : ''}">${done ? icon.check : icon.clock} ${label}</span>`;
  const active = ['paid', 'disputed'].includes(o.status);
  box.innerHTML = `
    <div class="confirms">${step(o.seller_delivered_at, 'Seller confirmed delivery')}${step(o.buyer_confirmed_at, 'Buyer confirmed receipt')}</div>
    ${active && !(o.seller_delivered_at && o.buyer_confirmed_at) ? `<p class="fine" style="margin:8px 0 0">Both sides must confirm${o.available_at ? ` by <b>${fmtDateTime(o.available_at)}</b>` : ''}. If either side doesn’t, a case opens automatically and the evidence is reviewed.</p>` : ''}
    ${seller && active && !o.seller_delivered_at ? `
      <div class="mustread"><h3>⚠ MUST READ before you trade</h3><ol>
        <li><b>Record your screen for the whole trade</b>, from joining the buyer to the trade completing. Don’t stop recording early.</li>
        <li>Show the buyer’s username${o.buyer_info ? ` (<b>${esc(o.buyer_info)}</b>)` : ''} and the items in the trade window clearly.</li>
        <li>Only trade with the username given on this order. Never trade outside the platform or share passwords.</li>
        <li>Upload the recording below to confirm delivery. <b>No recording means you will very likely lose a case.</b></li></ol>
        <form id="deliver-form"><input type="file" id="rec-file" accept="video/mp4,video/webm,video/quicktime">
          <label class="check" style="margin:12px 0"><input type="checkbox" id="rec-ack"><span>I have read the rules above and recorded the entire trade.</span></label>
          <p class="error" id="rec-err"></p><button class="btn block" id="rec-btn">Upload recording &amp; confirm delivery</button></form></div>` : ''}
    ${buyer && active && !o.buyer_confirmed_at ? `<div class="cta-row" style="margin-top:12px"><button class="btn success" id="buyer-confirm">${icon.check} I received it</button>
      ${o.status === 'paid' ? `<button class="btn danger" id="buyer-problem">Something’s wrong</button>` : ''}</div>` : ''}
    ${c ? `<div class="casebox"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h3>Case #${c.id}</h3>
        <span class="status ${c.status === 'resolved' ? 'completed' : 'disputed'}">${c.status === 'resolved' ? 'Resolved' : 'Under review'}</span></div>
      <p class="muted" style="margin:4px 0 10px">${esc(c.reason)}</p>
      ${c.ai ? `<div class="ai"><b>AI summary</b> <span class="muted">· evidence leans towards: ${esc({ pay_seller: 'the seller', refund_buyer: 'the buyer', needs_human: 'unclear' }[c.ai.recommendation])} (${esc(c.ai.confidence)} confidence). The AI never decides; the site owner does.</span><p>${esc(c.ai.summary)}</p>
        ${c.ai.missing_evidence?.length ? `<small class="muted">Would help: ${c.ai.missing_evidence.map(esc).join(' · ')}</small>` : ''}</div>`
        : `<div class="ai"><b>AI evidence review</b><p class="muted">${c.ai_enabled ? 'Reviewing the evidence…' : 'Waiting for review. Add your evidence below.'}</p></div>`}
      ${c.resolution ? `<div class="notice ok">Decision: ${esc(c.resolution)}</div>` : ''}
      <div class="evlist">${c.evidence.map((e) => `<div class="ev"><b>${esc(e.by)}</b> <small class="muted">${fmtDateTime(e.at)}</small>
        ${e.note ? `<p>${esc(e.note)}</p>` : ''}${e.file ? (['unsafe', 'unsure'].includes(e.file.safety) ? `<span class="muted">${icon.image} ${esc(e.file.name)} · hidden by safety check</span>` : e.file.safety === 'pending' ? `<span class="muted">${icon.image} ${esc(e.file.name)} · safety check in progress…</span>` : `<a href="${e.file.url}" target="_blank" rel="noopener">${icon.image} ${esc(e.file.name)}</a>`) : ''}</div>`).join('') || '<p class="muted">No evidence yet.</p>'}</div>
      ${c.status !== 'resolved' && o.role !== 'admin' ? `<form id="ev-form" class="evform"><textarea id="ev-note" placeholder="Explain what happened" style="min-height:70px"></textarea>
        <input type="file" id="ev-file" accept="video/*,image/*"><p class="error" id="ev-err"></p><button class="btn ghost">Add evidence</button></form>` : ''}</div>` : ''}`;
  const df = $('#deliver-form');
  if (df) df.onsubmit = async (e) => {
    e.preventDefault();
    const f = $('#rec-file').files[0];
    if (!f) return ($('#rec-err').textContent = 'Choose your trade recording first.');
    if (!$('#rec-ack').checked) return ($('#rec-err').textContent = 'Tick the box to confirm you read the rules and recorded the trade.');
    try {
      await busy($('#rec-btn'), async () => {
        const fid = await uploadEvidence(f, (p) => ($('#rec-err').textContent = `Uploading… ${Math.round(p * 100)}%`));
        await api(`/orders/${id}/deliver`, { file_id: fid, recorded: true });
      });
      toast('Delivery confirmed. Waiting for the buyer.'); orderPanel(id);
    } catch (err) { $('#rec-err').textContent = err.message; }
  };
  const bc = $('#buyer-confirm');
  if (bc) bc.onclick = async () => {
    const stars = await askRating(o);
    if (!stars) return;
    try { await api(`/orders/${id}/confirm`, { stars }); toast('Thanks! You confirmed receipt.'); orderPanel(id); } catch (err) { toast(err.message, 'err'); }
  };
  const bp = $('#buyer-problem');
  if (bp) bp.onclick = async () => {
    const r = await askText('Open a case', 'Tell us what went wrong. The seller’s payment is held and the evidence is reviewed.', { label: 'What happened?', action: 'Open case', min: 10 });
    if (!r) return;
    try { await api(`/orders/${id}/refund-request`, { reason: r.text }); toast('Case opened'); orderPanel(id); } catch (err) { toast(err.message, 'err'); }
  };
  const ef = $('#ev-form');
  if (ef) ef.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const file = $('#ev-file').files[0];
      const fid = file ? await uploadEvidence(file, (p) => ($('#ev-err').textContent = `Uploading… ${Math.round(p * 100)}%`)) : undefined;
      await api(`/orders/${id}/evidence`, { note: $('#ev-note').value, file_id: fid });
      toast('Evidence added'); orderPanel(id);
    } catch (err) { $('#ev-err').textContent = err.message; }
  };
}

// ---------- Order chat ----------
let chatTimer;
async function chatPage(id) {
  if (!me) return needLogin('Log in to see your messages');
  const render = async (first) => {
    const { order: o, messages } = await api(`/orders/${id}/messages`);
    if (!$('#chat-list')) {
      const other = o.role === 'seller' ? o.buyer : o.seller;
      app.innerHTML = `<a class="back" href="#/dashboard?tab=${o.role === 'seller' ? 'sales' : 'library'}">${icon.arrowLeft} Back to dashboard</a>
        <div class="chat glass reveal">
          <div class="chat-head"><div class="th">${cover(o)}</div><div style="flex:1;min-width:0"><b>${esc(o.product_title)}</b>
            <small class="muted">${esc(o.receipt_no || '')} · chatting with ${avatar(other)} <b>${esc(other)}</b></small></div>
            <span class="status ${o.status}">${statusLabel(o.status, o.role === 'seller' ? 'seller' : 'buyer')}</span></div>
          <div id="order-panel"></div>
          ${o.buyer_info ? `<div class="notice ok" style="margin:14px 0 0">${esc(o.buyer_info_label || 'Buyer info')}: <b>${esc(o.buyer_info)}</b></div>` : ''}
          <div class="chat-list" id="chat-list"></div>
          <form class="chat-form" id="cf"><input name="body" placeholder="Write a message… (e.g. your in-game username)" autocomplete="off" maxlength="2000">
            <button class="btn">Send</button></form>
          <p class="fine">Keep trades on the platform: payment protection only covers orders paid here. Never share passwords.</p>
        </div>`;
      $('#cf').onsubmit = async (e) => {
        e.preventDefault();
        const body = e.target.body.value.trim();
        if (!body) return;
        try { await api(`/orders/${id}/messages`, { body }); e.target.body.value = ''; render(); } catch (err) { toast(err.message, 'err'); }
      };
    }
    const list = $('#chat-list');
    const n = list.children.length;
    list.innerHTML = messages.map((m) => `<div class="msg ${m.sender === me.username ? 'me' : ''} ${m.side}">
      <small>${esc(m.sender)}${m.side === 'support' ? ' · support' : ''} · ${fmtDateTime(m.created_at)}</small><p>${esc(m.body)}</p></div>`).join('')
      || '<p class="muted" style="text-align:center;margin:30px 0">No messages yet. Say hi and share anything the seller needs to deliver.</p>';
    if (first || messages.length !== n) list.scrollTop = list.scrollHeight;
  };
  await render(true);
  await orderPanel(id);
  clearInterval(chatTimer);
  chatTimer = setInterval(() => { if (!location.hash.startsWith('#/chat/')) return clearInterval(chatTimer); render().catch(() => {}); }, 4000);
}

// ---------- Auth ----------
function authPage(kind) {
  const signup = kind === 'signup';
  const next = hashParams().get('next');
  app.innerHTML = `<div class="auth-wrap"><form class="auth glass" id="f">
    <img class="logo-mark" src="/logo.svg" alt="">
    <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
    <p class="sub">${next ? 'Log in to continue.' : signup ? 'Start buying and selling game items in seconds.' : 'Log in to continue trading.'}</p>
    <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required></div>
    <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" required
      autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? '<span class="hint">At least 8 characters</span>' : ''}</div>
    <p class="error" id="err"></p>
    <button class="btn lg block">${signup ? 'Create account' : 'Log in'}</button>
    <p class="switch">${signup ? `Already have an account? <a href="#/login${next ? '?next=' + encodeURIComponent(next) : ''}">Log in</a>`
      : `New to Lootrova? <a href="#/signup${next ? '?next=' + encodeURIComponent(next) : ''}">Create an account</a>`}</p>
    ${signup ? '<p class="fine" style="text-align:center">By creating an account you agree to the <a href="#/policy/terms" style="color:var(--violet-soft)">Terms of Service</a> and <a href="#/policy/privacy" style="color:var(--violet-soft)">Privacy Policy</a>.</p>' : ''}
  </form></div>`;
  const f = $('#f');
  f.username.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await busy($('button', f), () => api('/' + kind, { username: f.username.value, password: f.password.value }));
      await loadMe();
      toast(signup ? `Welcome to Lootrova, ${me.username}!` : `Welcome back, ${me.username}`);
      if (next && /^\/download\/\d+$/.test(next)) location.href = next;
      else location.hash = next && next.startsWith('#/') ? next : '#/';
    } catch (err) {
      $('#err').textContent = err.message;
      f.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 });
    }
  };
}

// ---------- Sell / edit ----------
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
function uploadProductFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      xhr.status === 200 ? resolve(data) : reject(new Error(data.error || 'Upload failed. Please try again.'));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

async function sellPage(editId) {
  if (!me) return needLogin('Log in to start selling');
  if (me.status !== 'active') {
    app.innerHTML = `<div class="empty" style="margin-top:60px"><div class="icon">${icon.alert}</div><h3>Your seller account is suspended</h3>
      <p class="muted">Suspended sellers can’t create or edit listings. <a href="#/contact" style="color:var(--violet-soft)">Contact support</a> if you think this is a mistake.</p></div>`;
    return;
  }
  const existing = editId ? (await api('/listings/' + editId)).listing : null;
  if (existing && !existing.is_owner) throw new Error('You can only edit your own listings.');
  const images = existing ? [...existing.images] : [];
  let productFile = existing?.file ? { existing: true, ext: existing.file.ext, size: existing.file.size, name: 'Current file' } : null;
  const v = (k) => esc(existing?.[k] ?? '');
  const licenceOpts = Object.entries(CFG.licences).map(([k, label]) => `<option value="${k}" ${existing?.licence === k ? 'selected' : ''}>${esc(label.split(':')[0])}</option>`).join('');

  app.innerHTML = `
    <div class="section-head" style="margin-top:44px"><div><span class="eyebrow">${existing ? 'Edit listing' : 'New listing'}</span>
      <h2 style="font-size:2rem">${existing ? 'Edit your item' : 'Sell a game item'}</h2></div></div>
    <div class="sell-layout">
      <form class="sell-form glass reveal" id="f" novalidate>
        <div class="field"><label>Images <span class="muted" style="font-weight:400">(up to ${MAX_IMAGES})</span></label>
          <div class="dropzone" id="drop" tabindex="0" role="button">
            <div class="ic">${icon.upload}</div><b>Drop images here or click to upload</b>
            <small>JPG, PNG or WebP · first image is the cover</small>
            <input type="file" id="file" accept="image/jpeg,image/png,image/webp" multiple></div>
          <div class="previews" id="previews"></div></div>
        <div class="field"><label>Product file <span class="muted" style="font-weight:400">(what buyers download)</span></label>
          <div class="dropzone" id="pdrop" tabindex="0" role="button">
            <div class="ic">${icon.box}</div><b>Upload the file buyers will download</b>
            <small>${CFG.allowed_file_types.slice(0, 8).join(', ')}… up to ${CFG.max_file_mb} MB · programs and scripts aren’t allowed</small>
            <input type="file" id="pfile"></div>
          <div id="pchip"></div></div>
        <div class="field"><label for="game">Roblox game</label><select id="game" name="game" required><option value="">Choose a game…</option>
          ${(CFG.games || []).map((g) => `<option ${existing?.game === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
        <div class="field"><label for="title">Item name</label><input id="title" name="title" placeholder="e.g. AK-47 | Redline (Field-Tested)" maxlength="100" required value="${v('title')}"></div>
        <div class="field"><label for="delivers">What the buyer receives</label>
          <textarea id="delivers" name="delivers" style="min-height:70px" placeholder="e.g. One ZIP with 12 skin files and an install guide" maxlength="500" required>${v('delivers')}</textarea></div>
        <div class="field"><label for="description">Description</label>
          <textarea id="description" name="description" placeholder="Condition, rarity, and anything the buyer should know" maxlength="3000" required>${v('description')}</textarea></div>
        <div class="field"><label for="compatibility">Compatibility / platform</label>
          <input id="compatibility" name="compatibility" placeholder="e.g. PC (Windows), Minecraft Java 1.20+" maxlength="300" required value="${v('compatibility')}"></div>
        <div class="field"><label for="requirements">Requirements <span class="muted" style="font-weight:400">(optional)</span></label>
          <input id="requirements" name="requirements" placeholder="e.g. Requires the base game and Forge" maxlength="500" value="${v('requirements')}"></div>
        <div class="field"><label for="buyer_info_label">Ask the buyer for <span class="muted" style="font-weight:400">(optional)</span></label>
          <input id="buyer_info_label" name="buyer_info_label" maxlength="80" placeholder="e.g. Your Roblox username" value="${v('buyer_info_label')}">
          <span class="hint">If the game needs it to deliver (like a username or friend code), the buyer must enter it at checkout.</span></div>
        <div class="field"><label for="licence">Licence</label><select id="licence" name="licence" required>
          <option value="">Choose a licence…</option>${licenceOpts}</select><span class="hint" id="licence-hint"></span></div>
        <div class="field" id="custom-licence" hidden><label for="licence_text">Custom licence terms</label>
          <textarea id="licence_text" name="licence_text" style="min-height:70px" maxlength="1500">${v('licence_text')}</textarea></div>
        <div class="field"><label>Copies</label><div class="radio-group">
          <label class="check"><input type="radio" name="copies" value="unlimited" ${existing?.stock != null ? '' : 'checked'}><span><b>Unlimited</b>: every buyer gets the same downloadable file.</span></label>
          <label class="check"><input type="radio" name="copies" value="single" ${existing?.stock != null ? 'checked' : ''}><span><b>One buyer only</b>: a single-use code or unique item.</span></label></div></div>
        <div class="field"><label for="price">Price</label><div class="input-prefix"><span>${money(0).replace(/[\d.,\s]/g, '')}</span>
          <input id="price" name="price" type="number" min="0.5" max="10000" step="0.01" placeholder="0.00" required value="${existing ? (existing.price_cents / 100).toFixed(2) : ''}"></div></div>
        <label class="check"><input type="checkbox" name="usable">
          <span>I confirm this item works and the buyer can use it. Items that don’t work can be refunded to the buyer.</span></label>
        <label class="check"><input type="checkbox" name="owns_rights">
          <span>I own this content or have permission to sell and distribute it. It isn’t pirated, stolen, malware, illegal, infringing or misleading (<a href="#/policy/prohibited" style="color:var(--violet-soft)">Prohibited Products</a>, <a href="#/policy/seller-terms" style="color:var(--violet-soft)">Seller Terms</a>).</span></label>
        <p class="error" id="err" role="alert"></p>
        <button class="btn lg block" id="publish">${existing ? 'Save changes' : 'Publish listing'}</button>
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
    const fee = feeOf(cents);
    $('#preview').innerHTML = card({
      id: 0, game: f.game.value.trim() || 'Game', title: f.title.value.trim() || 'Your item name',
      seller: me.username, price_cents: cents, images,
    }, 0).replace('reveal', '');
    $('#payout').innerHTML = `
      <div class="line"><span>Listing price (buyer pays)</span><span>${money(cents)}</span></div>
      <div class="line"><span>Lootrova platform fee (${feePct()})</span><span>−${money(fee)}</span></div>
      <div class="line total"><span>You receive per sale</span><b>${money(cents - fee)}</b></div>
      <p class="fine">Earnings become available ${CFG.hold_days} days after each sale, or sooner when the buyer confirms the item works.</p>`;
    const lic = CFG.licences[f.licence.value];
    $('#licence-hint').textContent = lic && f.licence.value !== 'custom' ? lic : '';
    $('#custom-licence').hidden = f.licence.value !== 'custom';
  };
  const renderThumbs = () => {
    $('#previews').innerHTML = images.map((src, i) => `<div class="thumb"><img src="${esc(src)}" alt="">
      ${i === 0 ? '<span class="cover">Cover</span>' : ''}<button type="button" class="x" data-i="${i}" aria-label="Remove image">${icon.x}</button></div>`).join('');
    $$('#previews .x').forEach((b) => (b.onclick = () => { images.splice(+b.dataset.i, 1); renderThumbs(); }));
    renderPreview();
  };
  const renderFile = (progress) => {
    $('#pchip').innerHTML = productFile ? `<div class="file-chip"><span class="ic">${esc(productFile.ext || '…')}</span>
      <div class="main"><b>${esc(productFile.name)}</b><small class="muted">${productFile.size ? fileSize(productFile.size) : 'Uploading…'}</small>
      ${progress != null ? `<div class="progress"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ''}</div>
      ${progress == null ? '<button type="button" class="btn ghost sm" id="replace">Replace</button>' : ''}</div>` : '';
    const r = $('#replace');
    if (r) r.onclick = () => $('#pfile').click();
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
  const addProductFile = async (file) => {
    if (!file) return;
    const previous = productFile;
    productFile = { name: file.name, ext: file.name.split('.').pop(), size: 0 };
    renderFile(0);
    try {
      const up = await uploadProductFile(file, (p) => renderFile(p));
      productFile = { id: up.id, name: up.name, ext: up.ext, size: up.size };
      toast('File uploaded');
    } catch (err) { productFile = previous; toast(err.message, 'err'); }
    renderFile();
  };

  const wireDrop = (zone, input, onFiles) => {
    zone.onclick = (e) => { if (e.target === zone || zone.contains(e.target)) input.click(); };
    zone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => onFiles(e.dataTransfer.files));
  };
  wireDrop(drop, fileInput, addFiles);
  fileInput.onclick = (e) => e.stopPropagation();
  fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };
  const pfile = $('#pfile');
  wireDrop($('#pdrop'), pfile, (files) => addProductFile(files[0]));
  pfile.onclick = (e) => e.stopPropagation();
  pfile.onchange = () => { addProductFile(pfile.files[0]); pfile.value = ''; };
  f.oninput = renderPreview;
  f.onchange = renderPreview;
  renderThumbs();
  renderFile();

  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err');
    err.textContent = '';
    const missing = [];
    if (!productFile?.id && !productFile?.existing) missing.push('product file');
    for (const [name, label] of [['game', 'game'], ['title', 'item name'], ['delivers', 'what the buyer receives'], ['description', 'description'],
      ['compatibility', 'compatibility / platform'], ['licence', 'licence'], ['price', 'price']]) if (!f[name].value.trim()) missing.push(label);
    if (f.licence.value === 'custom' && !f.licence_text.value.trim()) missing.push('custom licence terms');
    if (missing.length) { err.textContent = 'Please complete: ' + missing.join(', ') + '.'; return; }
    if (!f.usable.checked || !f.owns_rights.checked) { err.textContent = 'Please tick both confirmation boxes before publishing.'; return; }
    try {
      const body = {
        game: f.game.value, title: f.title.value, description: f.description.value, delivers: f.delivers.value,
        compatibility: f.compatibility.value, requirements: f.requirements.value, buyer_info_label: f.buyer_info_label.value, licence: f.licence.value, licence_text: f.licence_text.value,
        price: f.price.value, copies: f.copies.value, usable: f.usable.checked, owns_rights: f.owns_rights.checked, images,
        file_id: productFile?.id ?? null,
      };
      const { id } = await busy($('#publish'), () => (existing ? api(`/listings/${existing.id}/edit`, body) : api('/listings', body)));
      toast(existing ? 'Changes saved' : 'Your item is live!');
      location.hash = '#/item/' + id;
    } catch (e2) { err.textContent = e2.message; }
  };
}

// ---------- Dashboard ----------
async function dashboard() {
  if (!me) return needLogin('Log in to see your dashboard');
  app.innerHTML = `<div class="dash-head"><div><span class="eyebrow">Dashboard</span><h1>Hey, ${esc(me.username)}</h1></div></div>
    <div class="tiles">${'<div class="skeleton" style="height:100px"></div>'.repeat(6)}</div>`;
  const d = await api('/dashboard');
  me = d.user;
  renderNav();

  const tabs = [['library', 'Library', d.library.length], ['sales', 'Sales', d.sales.length], ['listings', 'Listings', d.listings.length], ['payouts', 'Payouts', d.payouts.length]];
  // Money tiles only matter once someone has started selling.
  const isSeller = d.sales.length || d.listings.length || d.payouts.length || d.balances.available_cents || d.balances.pending_cents;
  let tab = hashParams().get('tab');
  if (tab === 'purchases') tab = 'library';
  if (!tabs.some(([k]) => k === tab)) tab = d.library.length || !d.sales.length ? 'library' : 'sales';

  app.innerHTML = `
    <div class="dash-head"><div><span class="eyebrow">Dashboard</span><h1>Hey, ${esc(me.username)}</h1></div>
      <span style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="presence-toggle ${me.presence?.online ? 'on' : ''}" id="presence"><i></i>${me.presence?.online ? 'Online' : 'Offline'}</button><a class="btn ghost" href="#/u/${encodeURIComponent(me.username)}">My profile</a><a class="btn" href="#/sell">${icon.plus} New listing</a></span></div>
    ${me.status !== 'active' ? '<div class="notice bad">Your seller account is suspended. You can still download your purchases, but you can’t list items or request payouts. <a href="#/contact" style="color:inherit">Contact support</a>.</div>' : ''}
    ${isSeller ? `<div class="tiles">
      <div class="tile glass hl reveal"><div class="label">${icon.wallet} Available balance</div><div class="value">${money(d.balances.available_cents)}</div><div class="sub">Ready to pay out</div></div>
      <div class="tile glass reveal" style="--i:1"><div class="label">${icon.clock} Pending balance</div><div class="value">${money(d.balances.pending_cents)}</div>
        <div class="sub">${d.next_release_at ? 'Next release ' + fmtDate(d.next_release_at) : `Held ${CFG.hold_days} days after each sale`}</div></div>
      <div class="tile glass reveal" style="--i:2"><div class="label">${icon.coins} Gross sales</div><div class="value">${money(d.totals.gross_cents)}</div><div class="sub">What buyers paid</div></div>
      <div class="tile glass reveal" style="--i:3"><div class="label">${icon.percent} Platform fees</div><div class="value">${d.totals.fee_cents ? '−' : ''}${money(d.totals.fee_cents)}</div><div class="sub">${feePct()} of each sale</div></div>
      <div class="tile glass reveal" style="--i:4"><div class="label">${icon.check} Seller earnings</div><div class="value">${money(d.totals.net_cents)}</div>
        <div class="sub">${d.totals.refunded_cents ? `After ${money(d.totals.refunded_cents)} refunded` : 'Gross sales minus fees'}</div></div>
    </div>` : ''}
    <div class="tabs" role="tablist">
      ${tabs.map(([k, label, n]) => `<button class="tab" data-tab="${k}" role="tab">${label}<span class="n">${n}</span></button>`).join('')}
    </div>
    <div class="list" id="list"></div>`;

  const th = (o) => `<div class="th">${cover(o)}</div>`;
  const empty = (text, cta) => `<div class="empty"><div class="icon">${icon.bag}</div><h3>${text}</h3>${cta}</div>`;
  const libraryRow = (o, i) => `<div class="row reveal" style="--i:${i}">${th(o)}
    <div class="main"><b>${esc(o.product_title)}</b><small>${esc(o.game)} · from ${esc(o.seller)} · ${money(o.total_cents)} · ${fmtDate(o.paid_at || o.created_at)}</small>
      ${o.status === 'paid' ? `<span class="when">Buyer protection until ${fmtDate(o.available_at)}</span>` : ''}
      ${!o.can_download && o.access_note ? `<span class="when">${esc(o.access_note)}</span>` : ''}</div>
    <div class="side"><span class="status ${o.status}">${statusLabel(o.status, 'buyer')}</span>
      ${o.can_download ? `<a class="btn sm" href="${o.download_url}">${icon.download} Download</a>` : ''}
      <a class="btn ghost sm" href="#/receipt/${o.id}">Receipt</a>
      ${o.status !== 'cancelled' ? `<a class="btn ghost sm" href="#/chat/${o.id}">${icon.chat} Order &amp; chat${o.messages ? ` (${o.messages})` : ''}</a>` : ''}
      ${o.status === 'paid' ? `<button class="btn success sm" data-confirm="${o.id}">It works</button><button class="btn danger sm" data-refund-req="${o.id}">Request refund</button>` : ''}
      ${o.status === 'disputed' ? `<button class="btn success sm" data-confirm="${o.id}">It works now</button>` : ''}</div></div>`;
  const saleRow = (o, i) => `<div class="row reveal" style="--i:${i}">${th(o)}
    <div class="main"><b>${esc(o.product_title)}</b><small>${esc(o.game)} · to ${esc(o.buyer)} · ${fmtDate(o.paid_at)} · ${esc(o.receipt_no || '')}</small>
      ${o.buyer_info ? `<div class="money"><span>${esc(o.buyer_info_label || 'Buyer info')}: <b>${esc(o.buyer_info)}</b></span></div>` : ''}
      <div class="money"><span>Sale <b>${money(o.price_cents)}</b></span><span>Platform fee <b>−${money(o.fee_cents)}</b></span>${['refunded', 'chargeback'].includes(o.status) ? `<span class="reversed">Earnings reversed <b>${money(o.net_cents)}</b></span>` : `<span class="earn">Your earnings <b>${money(o.net_cents)}</b></span>`}</div>
      <span class="when">${o.status === 'paid' ? `Pending: available on ${fmtDate(o.available_at)}, or sooner if the buyer confirms`
        : o.status === 'completed' ? `Available since ${fmtDate(o.released_at)}`
        : o.status === 'disputed' ? `On hold: buyer asked for a refund (“${esc(o.dispute_reason)}”)`
        : o.status === 'refunded' ? `Refunded ${fmtDate(o.refunded_at)}: earnings reversed`
        : o.status === 'chargeback' ? `Charged back ${fmtDate(o.refunded_at)}: earnings reversed` : ''}</span></div>
    <div class="side"><span class="status ${o.status}">${statusLabel(o.status, 'seller')}</span>
      <a class="btn ${o.status === 'paid' && !o.seller_delivered_at ? '' : 'ghost'} sm" href="#/chat/${o.id}">${o.status === 'paid' && !o.seller_delivered_at ? 'Open order · must read' : `${icon.chat} Order &amp; chat`}${o.messages ? ` (${o.messages})` : ''}</a>
      ${o.status === 'disputed' ? `<button class="btn danger sm" data-refund="${o.id}">Refund buyer</button>` : ''}</div></div>`;
  const listingRow = (l, i) => `<div class="row reveal" style="--i:${i}">${th(l)}
    <div class="main"><a href="#/item/${l.id}" style="text-decoration:none"><b>${esc(l.title)}</b></a><small>${esc(l.game)} · ${money(l.price_cents)} · ${l.sold_count} sold${l.stock != null ? ` of ${l.stock}` : ''}</small>
      ${l.status === 'removed' ? `<span class="when">Removed by Lootrova: ${esc(l.removal_reason || 'breaks marketplace rules')}</span>` : ''}
      ${!l.has_file && l.status !== 'removed' ? '<span class="when">Add a product file so buyers can purchase this item.</span>' : ''}</div>
    <div class="side"><span class="status ${l.status}">${statusLabel(l.status)}</span>
      ${l.status !== 'removed' ? `<a class="btn ghost sm" href="#/edit/${l.id}">Edit</a><button class="btn danger sm" data-remove="${l.id}">Remove</button>` : ''}</div></div>`;
  const payoutsView = () => `
    <div class="payout-panel glass"><div><div class="label muted">${icon.wallet} Available to pay out</div>
      <div class="price" style="font-size:1.8rem">${money(d.balances.available_cents)}</div>
      <p>Earnings become available ${CFG.hold_days} days after each sale, or sooner when the buyer confirms the item works. Payout requests are usually processed within 3 business days.</p></div>
      <button class="btn" id="payout" ${d.balances.available_cents < CFG.min_payout_cents || me.status !== 'active' ? 'disabled' : ''}>Request payout</button></div>
    ${d.payouts.map((p, i) => `<div class="row reveal" style="--i:${i}"><div class="main"><b>${money(p.amount_cents)}</b>
      <small>Requested ${fmtDateTime(p.created_at)}${p.processed_at ? ` · ${p.status === 'paid' ? 'paid' : 'updated'} ${fmtDateTime(p.processed_at)}` : ' · expected within 3 business days'}${p.reference ? ` · Ref ${esc(p.reference)}` : ''}</small>
      ${p.status === 'failed' ? '<span class="when">This payout failed and the money was returned to your available balance.</span>' : ''}</div>
      <div class="side"><span class="status ${p.status === 'paid' ? 'completed' : p.status}">${statusLabel(p.status)}${p.status === 'paid' ? '' : ''}</span></div></div>`).join('')
      || '<p class="muted">No payouts yet.</p>'}`;

  const renderTab = () => {
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const list = $('#list');
    if (tab === 'library') list.innerHTML = d.library.map(libraryRow).join('')
      || empty('Your library is empty', '<p class="muted">Items you buy appear here so you can download them any time.</p><a class="btn" href="#/">Browse items</a>');
    if (tab === 'sales') list.innerHTML = d.sales.map(saleRow).join('')
      || empty('No sales yet', `<p class="muted">Your sales will show here with the sale amount, the ${feePct()} platform fee and your earnings.</p>`);
    if (tab === 'listings') list.innerHTML = d.listings.map(listingRow).join('')
      || empty('Nothing listed', `<p class="muted">List your first game item. It only takes a minute.</p><a class="btn" href="#/sell">${icon.plus} Sell an item</a>`);
    if (tab === 'payouts') list.innerHTML = payoutsView();
    bindActions();
  };

  const act = (sel, fn) => $$(sel).forEach((b) => (b.onclick = async () => {
    try { if (await fn(b)) dashboard(); } catch (err) { toast(err.message, 'err'); }
  }));
  const bindActions = () => {
    act('[data-confirm]', async (b) => {
      const order = d.library.find((o) => o.id === +b.dataset.confirm);
      const stars = await askRating(order);
      if (!stars) return false;
      await api(`/orders/${order.id}/confirm`, { stars });
      toast('Thanks! You confirmed receipt.');
      return true;
    });
    act('[data-refund-req]', async (b) => {
      const r = await askText('Request a refund', 'Tell the seller what’s wrong. Their earnings are held while your request is reviewed, and Lootrova support steps in if needed.',
        { label: 'What went wrong?', action: 'Request refund', min: 10 });
      if (!r) return false;
      await api(`/orders/${b.dataset.refundReq}/refund-request`, { reason: r.text });
      toast('Refund requested');
      return true;
    });
    act('[data-refund]', async (b) => {
      const o = d.sales.find((x) => x.id === +b.dataset.refund);
      if (!(await confirmBox('Refund the buyer?', `The buyer gets ${money(o.price_cents)} back, your ${money(o.net_cents)} earnings for this sale are reversed and their download access ends.`, 'Refund buyer'))) return false;
      await api(`/orders/${o.id}/refund`, {});
      toast('Buyer refunded');
      return true;
    });
    act('[data-remove]', async (b) => {
      if (!(await confirmBox('Remove listing?', 'Buyers will no longer be able to buy this item. Past buyers keep their downloads.', 'Remove'))) return false;
      await api(`/listings/${b.dataset.remove}/remove`, {});
      toast('Listing removed');
      return true;
    });
    act('#payout', async () => {
      if (!(await confirmBox('Request payout?', `We’ll pay out ${money(d.balances.available_cents)}. Payouts are usually processed within 3 business days.`, 'Request payout', ''))) return false;
      await api('/payouts', {});
      toast('Payout requested');
      history.replaceState(null, '', '#/dashboard?tab=payouts');
      return true;
    });
  };

  const pt = $('#presence');
  if (pt) pt.onclick = async () => {
    const r = await api('/presence', { online: !pt.classList.contains('on') });
    me.presence = r.presence; pt.classList.toggle('on', r.presence.online); pt.innerHTML = `<i></i>${r.presence.online ? 'Online' : 'Offline'}`;
    toast(r.presence.online ? 'You’re online. Buyers can see you’re available.' : 'You’re offline.');
  };
  $$('.tab').forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    history.replaceState(null, '', '#/dashboard?tab=' + tab);
    renderTab();
  }));
  renderTab();
}

// ---------- Admin ----------
async function adminPage() {
  if (!me) return needLogin('Log in first');
  if (me.role !== 'admin') throw new Error('Admins only.');
  const d = await api('/admin/overview');
  d.cases = (await api('/admin/cases')).cases;
  d.images = await api('/admin/image-checks');
  const openReports = d.reports.filter((r) => r.status === 'open').length;
  const toPay = d.payouts.filter((p) => p.status === 'requested').length;
  const tabs = [['reports', 'Reports', openReports], ['disputes', 'Refund requests', d.disputes.length], ['orders', 'Orders', d.orders.length],
    ['listings', 'Listings', d.listings.length], ['users', 'Sellers', d.users.length], ['payouts', 'Payouts', toPay],
    ['images', 'Image safety', (d.images.checks || []).filter((c) => !c.review_decision).length], ['cases', 'Cases', (d.cases || []).filter((c) => c.status !== 'resolved').length], ['transactions', 'Transactions', d.transactions.length], ['support', 'Support', d.support.length]];
  let tab = hashParams().get('tab') || 'reports';

  app.innerHTML = `
    <div class="dash-head"><div><span class="eyebrow">Moderation</span><h1>Admin</h1></div></div>
    <div class="tiles">
      <div class="tile glass hl reveal"><div class="label">${icon.flag} Open reports</div><div class="value">${openReports}</div></div>
      <div class="tile glass reveal" style="--i:1"><div class="label">${icon.alert} Refund requests</div><div class="value">${d.disputes.length}</div></div>
      <div class="tile glass reveal" style="--i:2"><div class="label">${icon.wallet} Payouts to process</div><div class="value">${toPay}</div></div>
      <div class="tile glass reveal" style="--i:3"><div class="label">${icon.percent} Platform fees earned</div><div class="value">${money(d.platform_fees_cents)}</div></div>
    </div>
    <div class="tabs" role="tablist">${tabs.map(([k, label, n]) => `<button class="tab" data-tab="${k}">${label}<span class="n">${n}</span></button>`).join('')}</div>
    <div class="list" id="list"></div>`;

  const orderRow = (o, i, actions) => `<div class="row reveal" style="--i:${i}"><div class="th">${cover(o)}</div>
    <div class="main"><b>${esc(o.product_title)}</b><small>${esc(o.receipt_no || '#' + o.id)} · ${esc(o.buyer)} bought from ${esc(o.seller)} · ${money(o.total_cents)} (fee ${money(o.fee_cents)}) · ${fmtDate(o.paid_at || o.created_at)}</small>
      ${o.dispute_reason ? `<div class="detail-text">Buyer: “${esc(o.dispute_reason)}”</div>` : ''}</div>
    <div class="side"><span class="status ${o.status}">${statusLabel(o.status, 'buyer')}</span>${actions}</div></div>`;
  const views = {
    reports: () => d.reports.map((r, i) => `<div class="row reveal" style="--i:${i}"><div class="main">
        <a href="#/item/${r.listing_id}" style="text-decoration:none"><b>${esc(r.title)}</b></a>
        <small>${esc(r.category_label)} · seller ${esc(r.seller)} · reported by ${esc(r.reporter || r.contact_email || 'guest')} · ${fmtDateTime(r.created_at)}</small>
        <div class="detail-text">${esc(r.details)}</div>
        ${r.category === 'copyright' ? `<div class="detail-text">Rights holder: ${esc(r.contact_name)} (${esc(r.contact_email)})\nOriginal work: ${esc(r.original_work)}</div>` : ''}
        ${r.resolution_note ? `<span class="when">${esc(r.resolution_note)}</span>` : ''}</div>
      <div class="side"><span class="status ${r.status === 'open' ? 'pending' : 'completed'}">${esc(r.status)}</span>
        ${r.status === 'open' ? `${r.listing_status !== 'removed' ? `<button class="btn danger sm" data-remove-listing="${r.listing_id}">Remove listing</button>` : ''}
          <button class="btn ghost sm" data-suspend="${r.seller_id}">Suspend seller</button>
          <button class="btn ghost sm" data-dismiss="${r.id}">Dismiss</button>` : ''}</div></div>`).join('') || '<p class="muted">No reports.</p>',
    disputes: () => d.disputes.map((o, i) => orderRow(o, i, `<button class="btn danger sm" data-admin-refund="${o.id}">Refund buyer</button>
      <button class="btn ghost sm" data-reject="${o.id}">Decline</button>`)).join('') || '<p class="muted">No open refund requests.</p>',
    orders: () => d.orders.map((o, i) => orderRow(o, i, ['paid', 'completed', 'disputed'].includes(o.status)
      ? `<button class="btn ghost sm" data-admin-refund="${o.id}">Refund</button><button class="btn ghost sm" data-chargeback="${o.id}">Record chargeback</button>` : '')).join('') || '<p class="muted">No orders yet.</p>',
    listings: () => d.listings.map((l, i) => `<div class="row reveal" style="--i:${i}"><div class="main"><a href="#/item/${l.id}" style="text-decoration:none"><b>${esc(l.title)}</b></a>
        <small>by ${esc(l.seller)}${l.removed_by ? ` · removed by ${esc(l.removed_by)}${l.removal_reason ? ': ' + esc(l.removal_reason) : ''}` : ''}</small></div>
      <div class="side"><span class="status ${l.status}">${statusLabel(l.status)}</span>${l.status !== 'removed' ? `<button class="btn danger sm" data-remove-listing="${l.id}">Remove</button>` : ''}</div></div>`).join(''),
    users: () => d.users.map((u, i) => `<div class="row reveal" style="--i:${i}">${avatar(u.username, 'lg')}<div class="main"><b>${esc(u.username)}</b>
        <small>${u.role === 'admin' ? 'Admin · ' : ''}${u.active_listings} active listing${u.active_listings === 1 ? '' : 's'} · joined ${fmtDate(u.created_at)}</small>
        ${u.suspended_reason ? `<span class="when">Suspended: ${esc(u.suspended_reason)}</span>` : ''}</div>
      <div class="side"><span class="status ${u.status === 'active' ? 'completed' : 'disputed'}">${esc(u.status)}</span>
        ${u.id === me.id ? '' : u.status === 'active' ? `<button class="btn danger sm" data-suspend="${u.id}">Suspend</button>` : `<button class="btn ghost sm" data-unsuspend="${u.id}">Unsuspend</button>`}</div></div>`).join(''),
    payouts: () => d.payouts.map((p, i) => `<div class="row reveal" style="--i:${i}"><div class="main"><b>${money(p.amount_cents)} to ${esc(p.seller)}</b>
        <small>Requested ${fmtDateTime(p.created_at)}${p.reference ? ' · Ref ' + esc(p.reference) : ''}</small></div>
      <div class="side"><span class="status ${p.status === 'paid' ? 'completed' : p.status}">${statusLabel(p.status)}</span>
        ${p.status === 'requested' ? `<button class="btn success sm" data-paid="${p.id}">Mark paid</button><button class="btn ghost sm" data-failed="${p.id}">Mark failed</button>` : ''}</div></div>`).join('') || '<p class="muted">No payout requests.</p>',
    images: () => (d.images.ai_enabled ? '' : '<div class="notice">Image safety checks are off. Set ANTHROPIC_API_KEY on the server to screen every uploaded image.</div>')
      + (d.images.checks.map((c, i) => `<div class="row reveal" style="--i:${i}"><div class="th" style="filter:blur(14px)">${c.kind === 'listing' ? `<img src="${esc(c.image)}" alt="">` : ''}</div>
        <div class="main"><b>${c.kind === 'listing' ? `Listing: <a href="#/item/${c.ref_id}" style="color:inherit">${esc(c.listing_title || '#' + c.ref_id)}</a>` : `Uploaded file: ${esc(c.image)}`}</b>
          <small>${esc(c.verdict)} · ${esc(c.category || '')} · ${fmtDateTime(c.created_at)}</small><div class="detail-text">${esc(c.reason || '')}</div></div>
        <div class="side">${c.review_decision ? `<span class="status ${c.review_decision === 'approved' ? 'completed' : 'refunded'}">${esc(c.review_decision)}</span>`
          : `<button class="btn ghost sm" data-img-ok="${c.id}">Approve</button><button class="btn danger sm" data-img-rm="${c.id}">Remove</button>`}</div></div>`).join('') || '<p class="muted">No flagged images.</p>'),
    cases: () => d.cases.map((c, i) => `<div class="row reveal" style="--i:${i}"><div class="main"><a href="#/chat/${c.order.id}" style="text-decoration:none"><b>Case #${c.id} · ${esc(c.order.product_title)}</b></a>
        <small>${esc(c.order.buyer)} ↔ ${esc(c.order.seller)} · ${money(c.order.total_cents)} · opened by ${esc(c.opened_by)} ${fmtDateTime(c.created_at)}</small>
        <div class="detail-text">${esc(c.reason)}</div>
        ${c.ai ? `<div class="detail-text"><b>AI summary (advice only)</b>, leans ${esc({ pay_seller: 'seller', refund_buyer: 'buyer', needs_human: 'unclear' }[c.ai.recommendation])}, ${esc(c.ai.confidence)} confidence: ${esc(c.ai.summary)}</div>` : ''}
        <span class="when">${c.evidence.length} evidence item${c.evidence.length === 1 ? '' : 's'}${c.resolution ? ' · ' + esc(c.resolution) : ''}</span></div>
      <div class="side"><span class="status ${c.status === 'resolved' ? 'completed' : 'disputed'}">${esc(c.status)}</span>
        ${c.status !== 'resolved' ? `<button class="btn ghost sm" data-ai="${c.id}">Run AI review</button><button class="btn success sm" data-pay="${c.id}">Pay seller</button><button class="btn danger sm" data-cref="${c.id}">Refund buyer</button>` : ''}</div></div>`).join('') || '<p class="muted">No cases.</p>',
    transactions: () => `<div class="table-wrap"><table class="ledger-table"><thead><tr><th>Date</th><th>Type</th><th>Account</th><th>Balance</th><th>Amount</th><th>Order</th><th>Note</th></tr></thead><tbody>
      ${d.transactions.map((t) => `<tr><td>${fmtDateTime(t.created_at)}</td><td>${esc(t.type.replace(/_/g, ' '))}</td><td>${esc(t.user)}</td><td>${esc(t.bucket)}</td>
        <td class="${t.amount_cents < 0 ? 'neg' : ''}">${money(t.amount_cents)}</td><td>${t.order_id ? '#' + t.order_id : t.payout_id ? 'payout #' + t.payout_id : ''}</td><td>${esc(t.memo || '')}</td></tr>`).join('')}
      </tbody></table></div><p class="fine">Transaction records are append-only and can’t be edited.</p>`,
    support: () => d.support.map((m, i) => `<div class="row reveal" style="--i:${i}"><div class="main"><b>${esc(m.subject)}</b>
        <small>${esc(m.name)} · <a href="mailto:${esc(m.email)}" style="color:inherit">${esc(m.email)}</a> · ${fmtDateTime(m.created_at)}</small>
        <div class="detail-text">${esc(m.message)}</div></div></div>`).join('') || '<p class="muted">No messages.</p>',
  };
  const renderTab = () => {
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#list').innerHTML = views[tab]();
    bindActions();
  };
  const act = (sel, fn) => $$(sel).forEach((b) => (b.onclick = async () => {
    try { if (await fn(b)) { toast('Done'); adminPage(); } } catch (err) { toast(err.message, 'err'); }
  }));
  const bindActions = () => {
    act('[data-remove-listing]', async (b) => {
      const r = await askText('Remove listing', 'New purchases stop immediately. Existing orders and transaction records are kept.', {
        label: 'Reason (shown to the seller)', action: 'Remove listing', min: 3,
        extra: '<label class="check"><input type="checkbox" id="mx"><span>Also disable downloads for past buyers (only for malware, illegal or pirated content)</span></label>' });
      if (!r) return false;
      return api(`/admin/listings/${b.dataset.removeListing}/remove`, { reason: r.text, revoke_access: r.checked });
    });
    act('[data-img-ok]', async (b) => (await confirmBox('Approve this image?', 'It becomes visible again.', 'Approve', 'success')) && api(`/admin/image-checks/${b.dataset.imgOk}/decide`, { decision: 'approve' }));
    act('[data-img-rm]', async (b) => (await confirmBox('Remove this image?', 'The listing is taken down, or the file stays hidden.', 'Remove')) && api(`/admin/image-checks/${b.dataset.imgRm}/decide`, { decision: 'remove' }));
    act('[data-ai]', async (b) => api(`/admin/cases/${b.dataset.ai}/ai-review`, {}));
    act('[data-pay]', async (b) => (await confirmBox('Pay the seller?', 'Closes the case and releases the seller’s earnings.', 'Pay seller', 'success')) && api(`/admin/cases/${b.dataset.pay}/resolve`, { decision: 'pay_seller' }));
    act('[data-cref]', async (b) => (await confirmBox('Refund the buyer?', 'Closes the case, refunds the buyer in full and reverses the seller’s earnings.', 'Refund buyer')) && api(`/admin/cases/${b.dataset.cref}/resolve`, { decision: 'refund_buyer' }));
    act('[data-dismiss]', async (b) => api(`/admin/reports/${b.dataset.dismiss}/resolve`, { action: 'dismiss', note: 'Reviewed: no action needed' }));
    act('[data-suspend]', async (b) => {
      const r = await askText('Suspend seller', 'They won’t be able to list, sell or request payouts. Buyers keep their past purchases.', { action: 'Suspend', min: 3 });
      return r && api(`/admin/users/${b.dataset.suspend}/suspend`, { reason: r.text });
    });
    act('[data-unsuspend]', async (b) => api(`/admin/users/${b.dataset.unsuspend}/unsuspend`, {}));
    act('[data-admin-refund]', async (b) => (await confirmBox('Refund this order?', 'The buyer is refunded in full, download access ends and the seller’s earnings are reversed.', 'Refund'))
      && api(`/orders/${b.dataset.adminRefund}/refund`, {}));
    act('[data-reject]', async (b) => (await confirmBox('Decline refund request?', 'The order goes back to paid and the seller’s earnings are released on schedule.', 'Decline', ''))
      && api(`/admin/orders/${b.dataset.reject}/reject-dispute`, {}));
    act('[data-chargeback]', async (b) => (await confirmBox('Record chargeback?', 'Use this when the payment provider reports a chargeback. The seller’s earnings for this order are reversed.', 'Record chargeback'))
      && api(`/admin/orders/${b.dataset.chargeback}/chargeback`, {}));
    act('[data-paid]', async (b) => {
      const r = await askText('Mark payout as paid', 'Add the bank or provider reference for this transfer.', { label: 'Reference', action: 'Mark paid', cls: 'success' });
      return r && api(`/admin/payouts/${b.dataset.paid}/paid`, { reference: r.text });
    });
    act('[data-failed]', async (b) => (await confirmBox('Mark payout as failed?', 'The amount goes back to the seller’s available balance.', 'Mark failed'))
      && api(`/admin/payouts/${b.dataset.failed}/failed`, {}));
  };
  $$('.tab').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', '#/admin?tab=' + tab); renderTab(); }));
  renderTab();
}

// ---------- Policies & contact ----------
function policyPage(slug) {
  const p = window.POLICIES?.[slug];
  if (!p) throw new Error('Page not found');
  document.title = `${p.title} — Lootrova`;
  app.innerHTML = `<article class="policy glass reveal"><span class="eyebrow">Lootrova policies</span><h1>${p.title}</h1>${p.body}
    <p class="fine" style="margin-top:28px">Questions about this policy? <a href="#/contact">Contact support</a>.</p></article>`;
}

function contactPage() {
  document.title = 'Contact & Support — Lootrova';
  app.innerHTML = `<div class="policy glass reveal"><span class="eyebrow">Help</span><h1>Contact &amp; Support</h1>
    <p>Problem with an order? The quickest fix is usually in your <a href="#/dashboard?tab=library">Library</a>, where you can download again, see receipts or request a refund. For anything else, send us a message and we’ll reply by email, usually within 2 business days.</p>
    ${CFG.support_email ? `<p>Email: <a href="mailto:${esc(CFG.support_email)}">${esc(CFG.support_email)}</a></p>` : ''}
    <form id="f" style="margin-top:22px">
      <div class="card-fields"><div class="field"><label for="n">Your name</label><input id="n" name="name" autocomplete="name" value="${esc(me?.username || '')}"></div>
      <div class="field"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" value="${esc(store.get('lootrova_email') || '')}"></div></div>
      <div class="field" style="margin-top:14px"><label for="s">Subject</label><input id="s" name="subject" placeholder="e.g. Order LR-2026-000012"></div>
      <div class="field"><label for="m">Message</label><textarea id="m" name="message"></textarea></div>
      <p class="error" id="err"></p><button class="btn">Send message</button></form>
    <p class="fine" style="margin-top:22px">Reporting a product? Use <b>Report product</b> on its page. Rights holders: see the <a href="#/policy/copyright">Copyright &amp; IP Policy</a>.</p></div>`;
  const f = $('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await busy($('button', f), () => api('/support', { name: f.name.value, email: f.email.value, subject: f.subject.value, message: f.message.value }));
      f.innerHTML = '<div class="notice ok">Thanks, your message has been sent. We’ll reply by email.</div>';
    } catch (err) { $('#err').textContent = err.message; }
  };
}

// ---------- Router ----------
// Header: search box and game links.
$('#top-search').onsubmit = (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  location.hash = '#/' + (q ? '?q=' + encodeURIComponent(q) : '');
};
async function loadGameBar() {
  const cur = hashParams().get('game') || '';
  $('#gamebar').innerHTML = `<span class="gb-platform">Roblox</span><a href="#/" class="${!cur ? 'on' : ''}">All</a>` + (CFG.games || []).map((g) =>
    `<a href="#/?game=${encodeURIComponent(g)}" class="${g.toLowerCase() === cur.toLowerCase() ? 'on' : ''}">${esc(g)}</a>`).join('')
    + '<a href="#/sell" class="gb-sell">+ Sell an item</a>';
}
window.addEventListener('hashchange', () => loadGameBar().catch(() => {}));
setInterval(() => { if (me) api('/me').catch(() => {}); }, 60000); // keeps online status fresh

async function loadMe() { me = (await api('/me')).user; renderNav(); }

async function route() {
  const [page, id] = location.hash.replace(/^#\//, '').split('?')[0].split('/');
  const view = page || 'home';
  renderNav();
  $('#buybar-root').innerHTML = '';
  document.body.classList.remove('has-buybar');
  // Changing the search or game filter on the home page only refreshes the results.
  if (view === 'home' && currentView === 'home' && $('#results')) return loadResults().catch((e) => toast(e.message, 'err'));
  currentView = view;
  document.title = 'Lootrova — The Premium Game Item Marketplace';
  app.classList.remove('page');
  void app.offsetWidth; // restart the page-enter animation
  app.classList.add('page');
  window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    if (view === 'login' || view === 'signup') authPage(view);
    else if (view === 'sell') await sellPage();
    else if (view === 'edit') await sellPage(Number(id));
    else if (view === 'dashboard' || view === 'library') await dashboard();
    else if (view === 'item') await itemPage(Number(id));
    else if (view === 'checkout') await checkoutPage(Number(id));
    else if (view === 'order') await orderPage(Number(id));
    else if (view === 'receipt') await receiptPage(Number(id));
    else if (view === 'chat') await chatPage(Number(id));
    else if (view === 'u') await profilePage(decodeURIComponent(id || ''));
    else if (view === 'admin') await adminPage();
    else if (view === 'policy') policyPage(id);
    else if (view === 'contact') contactPage();
    else await home();
  } catch (err) {
    app.innerHTML = `<div class="empty" style="margin-top:60px"><div class="icon">${icon.alert}</div><h3>${esc(err.message)}</h3>
      <a class="btn" href="#/">Back to marketplace</a></div>`;
  }
}

window.addEventListener('hashchange', route);
Promise.all([api('/config').then((c) => { CFG = c; }), loadMe()]).then(() => { route(); loadGameBar().catch(() => {}); });
