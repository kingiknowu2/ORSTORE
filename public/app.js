const app = document.getElementById('app');
const nav = document.getElementById('nav');
let me = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => '$' + (c / 100).toFixed(2);

async function api(path, body) {
  const res = await fetch('/api' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function renderNav() {
  nav.innerHTML = me
    ? `<a href="#/sell">Sell an item</a><a href="#/dashboard">Dashboard</a>
       <span class="muted">${esc(me.username)} · ${money(me.balance_cents)}</span><button id="logout">Log out</button>`
    : `<a href="#/login">Log in</a><a href="#/signup">Sign up</a>`;
  const out = document.getElementById('logout');
  if (out) out.onclick = async () => { await api('/logout', {}); me = null; location.hash = '#/'; route(); };
}

async function home() {
  const q = new URLSearchParams(location.hash.split('?')[1]).get('q') || '';
  const { listings } = await api('/listings?q=' + encodeURIComponent(q));
  app.innerHTML = `
    <div class="hero"><h1>Buy and sell game items</h1>
      <p>Your money is held until you confirm the item works. Sellers are paid after that.</p>
      <form id="search"><input name="q" placeholder="Search by game or item…" value="${esc(q)}"></form></div>
    <div class="grid">${listings.map((l) => `
      <div class="card">
        <div class="game">${esc(l.game)}</div>
        <h3>${esc(l.title)}</h3>
        <p>${esc(l.description)}</p>
        <div class="row"><span class="price">${money(l.price_cents)}</span>
          <button class="btn" data-buy="${l.id}">Buy</button></div>
        <div class="muted">Seller: ${esc(l.seller)} ${l.seller_rating ? '· ★ ' + l.seller_rating : '· no ratings yet'}</div>
      </div>`).join('') || '<p class="muted">No items listed yet. Be the first to sell!</p>'}</div>`;
  document.getElementById('search').onsubmit = (e) => {
    e.preventDefault();
    location.hash = '#/?q=' + encodeURIComponent(e.target.q.value);
  };
  app.querySelectorAll('[data-buy]').forEach((b) => b.onclick = async () => {
    if (!me) return (location.hash = '#/login');
    if (!confirm('Buy this item? Your money is held until you confirm it works.')) return;
    try { await api(`/listings/${b.dataset.buy}/buy`, {}); location.hash = '#/dashboard'; }
    catch (err) { alert(err.message); }
  });
}

function authForm(kind) {
  app.innerHTML = `<form class="form card" id="f">
    <h2>${kind === 'signup' ? 'Create an account' : 'Log in'}</h2>
    <input name="username" placeholder="Username" autocomplete="username" required>
    <input name="password" type="password" placeholder="Password" required
      autocomplete="${kind === 'signup' ? 'new-password' : 'current-password'}">
    <p class="error" id="err"></p>
    <button class="btn">${kind === 'signup' ? 'Sign up' : 'Log in'}</button></form>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/' + kind, { username: e.target.username.value, password: e.target.password.value });
      await loadMe(); location.hash = '#/';
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

function sell() {
  if (!me) return (location.hash = '#/login');
  app.innerHTML = `<form class="form card" id="f">
    <h2>List a game item</h2>
    <input name="game" placeholder="Game (e.g. Fortnite, CS2, Roblox)" required>
    <input name="title" placeholder="Item name" required>
    <textarea name="description" placeholder="Describe the item and how it will be delivered" required></textarea>
    <input name="price" type="number" min="0.5" step="0.01" placeholder="Price (USD)" required>
    <p class="muted" id="payout"></p>
    <label class="check"><input type="checkbox" name="usable">
      <span>I confirm this item works and can be used by the buyer. Items that don't work get disputed and aren't paid out.</span></label>
    <p class="error" id="err"></p>
    <button class="btn">Publish listing</button></form>`;
  const f = document.getElementById('f');
  f.price.oninput = () => {
    const c = Math.round(Number(f.price.value) * 100) || 0;
    document.getElementById('payout').textContent = c ? `You get ${money(c - Math.round(c * 0.1))} after Lootrova's 10% fee.` : '';
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/listings', { game: f.game.value, title: f.title.value, description: f.description.value,
        price: f.price.value, usable: f.usable.checked });
      location.hash = '#/dashboard';
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

async function dashboard() {
  if (!me) return (location.hash = '#/login');
  const d = await api('/dashboard');
  me = d.user; renderNav();
  const order = (o, asBuyer) => `<div class="row">
    <div><strong>${esc(o.title)}</strong> <span class="muted">(${esc(o.game)})</span><br>
      <span class="muted">${asBuyer ? 'from ' + esc(o.seller) : 'to ' + esc(o.buyer)} · ${money(o.price_cents)}
      ${asBuyer ? '' : ' · you get ' + money(o.price_cents - o.fee_cents)}</span></div>
    <div><span class="tag ${o.status}">${o.status}</span>
      ${asBuyer && o.status !== 'completed' ? `
        <button class="btn" data-confirm="${o.id}">It works</button>
        ${o.status === 'pending' ? `<button class="btn bad" data-dispute="${o.id}">Doesn't work</button>` : ''}` : ''}</div></div>`;
  app.innerHTML = `
    <h1>Dashboard</h1>
    <p class="muted">Available balance: <strong>${money(me.balance_cents)}</strong></p>
    <section><h2>My purchases</h2>${d.purchases.map((o) => order(o, true)).join('') || '<p class="muted">No purchases yet.</p>'}</section>
    <section><h2>My sales</h2>${d.sales.map((o) => order(o, false)).join('') || '<p class="muted">No sales yet.</p>'}</section>
    <section><h2>My active listings</h2>${d.listings.map((l) => `<div class="row">
      <div><strong>${esc(l.title)}</strong> <span class="muted">(${esc(l.game)}) · ${money(l.price_cents)}</span></div>
      <button class="btn ghost" data-remove="${l.id}">Remove</button></div>`).join('') || '<p class="muted">Nothing listed. <a href="#/sell">Sell an item</a></p>'}</section>`;
  const act = (sel, fn) => app.querySelectorAll(sel).forEach((b) => b.onclick = async () => {
    try { await fn(b); dashboard(); } catch (err) { alert(err.message); }
  });
  act('[data-confirm]', (b) => {
    const stars = prompt('Rate the seller from 1 to 5 stars:', '5');
    if (stars === null) throw new Error('Cancelled');
    return api(`/orders/${b.dataset.confirm}/confirm`, { stars });
  });
  act('[data-dispute]', (b) => api(`/orders/${b.dataset.dispute}/dispute`, {}));
  act('[data-remove]', (b) => api(`/listings/${b.dataset.remove}/remove`, {}));
}

async function loadMe() { me = (await api('/me')).user; renderNav(); }

async function route() {
  const page = location.hash.replace(/^#\//, '').split('?')[0];
  try {
    if (page === 'login') authForm('login');
    else if (page === 'signup') authForm('signup');
    else if (page === 'sell') sell();
    else if (page === 'dashboard') await dashboard();
    else await home();
  } catch (err) { app.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

window.onhashchange = route;
loadMe().then(route);
