// Trains our own chat model and saves its weights to ml/chat-model.json. Run: npm run train
const fs = require('node:fs');
const path = require('node:path');
const tf = require('@tensorflow/tfjs');
const { DIM, featurize } = require('./features');
const { LABELS, dataset } = require('./chat-data');
const { HELD_OUT } = require('./chat-heldout');
tf.enableProdMode();

// Owner corrections saved from the admin area are added to training when present.
const extraPath = path.join(__dirname, 'corrections.json');
const extra = fs.existsSync(extraPath) ? JSON.parse(fs.readFileSync(extraPath, 'utf8')) : [];
const data = [...dataset(), ...extra.flatMap((e) => Array(8).fill(e))];

function toTensors(rows) {
  const xs = new Float32Array(rows.length * DIM), ys = new Float32Array(rows.length * LABELS.length);
  rows.forEach((r, i) => { for (const [k, v] of featurize(r.text, r.from)) xs[i * DIM + k] = v; ys[i * LABELS.length + LABELS.indexOf(r.label)] = 1; });
  return { x: tf.tensor2d(xs, [rows.length, DIM]), y: tf.tensor2d(ys, [rows.length, LABELS.length]) };
}

(async () => {
  tf.util.shuffle(data);
  const { x, y } = toTensors(data);
  const model = tf.sequential({ layers: [
    tf.layers.dense({ inputShape: [DIM], units: 48, activation: 'relu', kernelRegularizer: tf.regularizers.l2({ l2: 1e-5 }) }),
    tf.layers.dropout({ rate: 0.3 }),
    tf.layers.dense({ units: LABELS.length, activation: 'softmax' }),
  ] });
  model.compile({ optimizer: tf.train.adam(0.003), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  await model.fit(x, y, { epochs: 14, batchSize: 64, validationSplit: 0.1, verbose: 0,
    callbacks: { onEpochEnd: (e, l) => { if (e % 4 === 3 || e === 13) console.log(`epoch ${e + 1}: accuracy ${(l.acc * 100).toFixed(1)}%, validation ${(l.val_acc * 100).toFixed(1)}%`); } } });

  const [w1, b1, w2, b2] = model.getWeights().map((t) => Buffer.from(t.dataSync().buffer).toString('base64'));
  const out = { version: 1, labels: LABELS, dim: DIM, hidden: 48, trained_at: new Date().toISOString(), examples: data.length, w1, b1, w2, b2 };
  fs.writeFileSync(path.join(__dirname, 'chat-model.json'), JSON.stringify(out));

  // Honest check on messages the model never trained on.
  const { predict, reload } = require('../chat-model');
  reload();
  const wrong = HELD_OUT.filter((h) => predict(h.text, h.from).label !== h.label);
  console.log(`held-out accuracy: ${HELD_OUT.length - wrong.length}/${HELD_OUT.length}`);
  wrong.forEach((w) => console.log('  missed:', JSON.stringify(w.text), 'expected', w.label, 'got', predict(w.text, w.from).label));
})();
