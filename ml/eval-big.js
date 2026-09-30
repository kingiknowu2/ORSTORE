// Scores the chat model on a large number of unseen test messages: node ml/eval-big.js 50000
const { build } = require('./chat-test1000');
const { classifyMessage } = require('../chat-understanding');
const N = Number(process.argv[2] || 50000);
const t0 = Date.now();
const rows = build(N, 12345);
const labels = ['received', 'not_received', 'scam_claim', 'delivered_claim', 'neutral'];
const conf = Object.fromEntries(labels.map((a) => [a, Object.fromEntries(labels.map((b) => [b, 0]))]));
let right = 0, dangerous = 0; const t1 = Date.now();
for (const r of rows) {
  const got = classifyMessage(r.text, r.from).intent; conf[r.label][got]++;
  if (got === r.label) right++; else if (got === 'received' && ['not_received', 'scam_claim'].includes(r.label)) dangerous++;
}
console.log(`${rows.length} unique messages, classified in ${((Date.now() - t1) / 1000).toFixed(1)}s (${((Date.now() - t1) / rows.length).toFixed(3)} ms each)`);
console.log(`OVERALL: ${right}/${rows.length} correct (${(right / rows.length * 100).toFixed(2)}%)`);
for (const l of labels) { const tot = Object.values(conf[l]).reduce((a, b) => a + b, 0); console.log(`${l.padEnd(16)} ${(conf[l][l] / tot * 100).toFixed(1).padStart(5)}% of ${tot}   wrong as: ${labels.filter((x) => x !== l && conf[l][x]).map((x) => x + ' ' + conf[l][x]).join(', ') || '-'}`); }
console.log(`Dangerous mistakes (complaint read as "received"): ${dangerous} (${(dangerous / rows.length * 100).toFixed(3)}%)`);
