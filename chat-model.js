// Our own small neural network for reading chat messages (trained by ml/train-chat.js).
// Runs in plain JavaScript on the server: no outside service, no downloads, a fraction of a millisecond per message.
const fs = require('node:fs');
const path = require('node:path');
const { featurize } = require('./ml/features');

let M;
function reload() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'ml', 'chat-model.json'), 'utf8'));
  const f32 = (b64) => new Float32Array(Uint8Array.from(Buffer.from(b64, 'base64')).buffer);
  M = { ...raw, w1: f32(raw.w1), b1: f32(raw.b1), w2: f32(raw.w2), b2: f32(raw.b2) };
}

// Returns the most likely meaning and the model's confidence for each.
function predict(text, from = 'buyer') {
  if (!M) reload();
  const h = Float32Array.from(M.b1);
  for (const [i, v] of featurize(text, from)) for (let j = 0; j < M.hidden; j++) h[j] += v * M.w1[i * M.hidden + j];
  for (let j = 0; j < M.hidden; j++) if (h[j] < 0) h[j] = 0;
  const K = M.labels.length, z = Float32Array.from(M.b2);
  for (let k = 0; k < K; k++) for (let j = 0; j < M.hidden; j++) z[k] += h[j] * M.w2[j * K + k];
  const max = Math.max(...z), e = Array.from(z, (v) => Math.exp(v - max)), sum = e.reduce((a, b) => a + b, 0);
  const probs = Object.fromEntries(M.labels.map((l, k) => [l, e[k] / sum]));
  const label = M.labels.reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  return { label, confidence: probs[label], probs };
}

module.exports = { predict, reload };
