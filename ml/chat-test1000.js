// 1000 test messages built from different sentence parts than the training data, for measuring real accuracy.
// Any message that also appears in the training data is dropped.
const { dataset } = require('./chat-data');

const ITEMS = ['golden dragon', 'rainbow pet', 'the shark', 'my 5m cash', 'the arrow', 'dough fruit', 'the orca', 'the volt', 'huge pixel cat', 'the tung tung', 'huge cat', 'titanic hippo', 'the dragon fruit', 'leopard', 'kitsune', 'torpedo', 'the bugatti', 'tralalero', 'la vacca', 'the brainrot', 'my diamonds', 'the 10b gems', 'the pets', 'my fruit', 'the cash', 'the huge', 'the dominus', 'my order', 'the stuff', 'the items'];
const NAMES = ['bro', 'man', 'dude', 'fam', 'g', 'boss', 'mate', 'king', 'sir', '', 'bruh', 'homie', 'my guy', 'chief', 'buddy', 'lad', 'twin', 'gang'];
const T = {
  received: [
    (i, n) => `just got ${i} ${n}`, (i, n) => `${i} is in my inventory now`, (i) => `finally received ${i}`, (i, n) => `yep ${i} came through ${n}`,
    (i) => `can confirm i got ${i}`, (i, n) => `appreciate it ${n} got ${i}`, (i) => `${i} arrived thank u`, (i, n) => `it all went smooth ${n} thanks`,
    (i, n) => `nice ${n} i have ${i} now`, (i) => `ty for ${i} got it`, (i, n) => `lets go got ${i} ${n}`, (i) => `received ${i} safe and sound`,
    (i, n) => `great trade ${n} got everything`, (i) => `thx for the fast trade, ${i} showed up`, (i, n) => `yessir got ${i} ${n} 🙏`,
  ],
  not_received: [
    (i, n) => `${n} i still dont have ${i}`, (i) => `${i} never came`, (i) => `where is ${i}??`, (i, n) => `i havent gotten ${i} yet ${n}`,
    (i) => `${i} isnt in my inventory`, (i, n) => `nothing showed up ${n}`, (i) => `you sent the wrong thing, i wanted ${i}`, (i, n) => `bro its been an hour no ${i}`,
    (i) => `didnt receive ${i}`, (i, n) => `i never got ${i} ${n}`, (i) => `still missing ${i}`, (i, n) => `${n} u didnt trade me ${i}`,
    (i) => `waiting on ${i} still`, (i) => `checked twice, no ${i}`, (i, n) => `nah ${n} nothing came through`,
  ],
  scam_claim: [
    (i, n) => `${n} you scammed me for ${i}`, (i) => `scammer took my money for ${i}`, (i, n) => `im reporting you ${n}`, (i) => `i want a refund for ${i}`,
    (i, n) => `give my money back ${n}`, (i) => `this seller is a scam dont buy ${i}`, (i, n) => `bro stole my money ${n}`, (i) => `fraud, refund me now`,
    (i, n) => `im filing a chargeback ${n}`, (i) => `scammed me outta ${i}`,
  ],
  neutral: [
    (i, n) => `whats your username ${n}`, (i, n) => `im online now ${n}`, (i) => `can we trade ${i} later`, (i, n) => `ok ${n} give me a sec`,
    (i) => `is ${i} still in stock`, (i, n) => `what server are u in ${n}`, (i, n) => `add me first ${n}`, (i) => `how long for ${i}`,
    (i, n) => `im joining now ${n}`, (i) => `do you have more ${i}`, (i, n) => `brb ${n}`, (i, n) => `hello ${n}`, (i) => `my username is xx_${i.replace(/\W/g, '')}_xx`,
  ],
};
const SELLER_T = {
  delivered_claim: [
    (i, n) => `sent ${i} ${n}`, (i) => `just traded ${i} to you`, (i, n) => `${i} should be in your inventory ${n}`, (i) => `gave you ${i}, check it`,
    (i, n) => `trade done ${n} enjoy ${i}`, (i) => `delivered ${i}`, (i, n) => `all sent ${n}`, (i) => `accept my trade for ${i}`,
  ],
  neutral: [
    (i, n) => `joining you now ${n}`, (i) => `ill send ${i} in 5`, (i, n) => `whats ur user ${n}`, (i) => `sorry ${i} will take a bit`,
    (i, n) => `im at school, later ${n}`, (i) => `do you want ${i} or something else`,
  ],
};
const NOISE = [(s) => s, (s) => s, (s) => s.toUpperCase(), (s) => s.replace(/o/, 'ooo'), (s) => s.replace(/you/g, 'u').replace(/your/g, 'ur'),
  (s) => s.replace(/the /, ''), (s) => s + ' lol', (s) => s + '!!', (s) => s.replace(/[aeiou]/, '')];

function build(n = 1000, seed = 7) {
  let x = seed; const rnd = () => ((x = (x * 48271) % 2147483647) / 2147483647); const pick = (a) => a[Math.floor(rnd() * a.length)];
  const train = new Set(dataset().map((d) => d.text.toLowerCase()));
  const pools = [...Object.entries(T).map(([l, t]) => ['buyer', l, t]), ...Object.entries(SELLER_T).map(([l, t]) => ['seller', l, t])];
  const weights = { received: 0.26, not_received: 0.26, scam_claim: 0.12, neutral: 0.2, delivered_claim: 0.12, seller_neutral: 0.04 };
  const out = []; const seen = new Set();
  while (out.length < n) {
    const r = rnd(); let acc = 0; let chosen = pools[0];
    for (const p of pools) { acc += weights[p[0] === 'seller' && p[1] === 'neutral' ? 'seller_neutral' : p[1]]; if (r <= acc) { chosen = p; break; } }
    const [from, label, temps] = chosen;
    const text = pick(NOISE)(pick(temps)(pick(ITEMS), pick(NAMES)).replace(/\s+/g, ' ').trim());
    if (train.has(text.toLowerCase()) || seen.has(from + text)) continue;
    seen.add(from + text); out.push({ from, text, label });
  }
  return out;
}
module.exports = { build };
