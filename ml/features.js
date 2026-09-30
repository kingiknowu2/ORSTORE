// Turns a chat message into numbers the model can read: hashed character and word pieces.
// Character pieces let the model cope with typos and slang it has never seen exactly.
const DIM = 4096;
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % DIM; }
const EMOJI_GOOD = /[👍👌🙏❤💯✅🥳😊😁😄🔥🤝💚💙⭐]/u, EMOJI_BAD = /[👎😡🤬😠❌🚫💀😤😭🙄]/u;

function clean(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/([a-z])\1{2,}/g, '$1$1')
    .replace(/[013457@$](?=[a-z])|(?<=[a-z])[013457@$]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' }[c]));
}

// Returns a sparse vector as a Map(index -> value).
function featurize(text, from = 'buyer') {
  const t = clean(text);
  const words = t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const f = new Map();
  const add = (k, w = 1) => { const i = hash(k); f.set(i, (f.get(i) || 0) + w); };
  add('from:' + from, 2);
  const padded = ' ' + words.join(' ') + ' ';
  for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= padded.length; i++) add('c' + n + ':' + padded.slice(i, i + n));
  words.forEach((w, i) => { add('w:' + w, 2); if (i) add('b:' + words[i - 1] + '_' + w, 2); });
  if (EMOJI_GOOD.test(text)) add('emoji:good', 3);
  if (EMOJI_BAD.test(text)) add('emoji:bad', 3);
  if (/\?/.test(text)) add('has:question');
  add('len:' + Math.min(words.length, 12));
  // Normalise so long and short messages are comparable.
  let norm = 0; for (const v of f.values()) norm += v * v; norm = Math.sqrt(norm) || 1;
  for (const [k, v] of f) f.set(k, v / norm);
  return f;
}

module.exports = { DIM, featurize, clean };
