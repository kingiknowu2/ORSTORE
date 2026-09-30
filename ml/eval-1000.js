// Scores the chat model on 1000 unseen test messages and prints accuracy, a confusion table and sample mistakes.
const { build } = require('./chat-test1000');
const { classifyMessage } = require('../chat-understanding');
const rows = build(1000);
const labels = ['received', 'not_received', 'scam_claim', 'delivered_claim', 'neutral'];
const conf = Object.fromEntries(labels.map((a) => [a, Object.fromEntries(labels.map((b) => [b, 0]))]));
const misses = [];
for (const r of rows) { const got = classifyMessage(r.text, r.from).intent; conf[r.label][got]++; if (got !== r.label) misses.push({ ...r, got }); }
const right = rows.length - misses.length;
console.log(`OVERALL: ${right}/${rows.length} correct (${(right / rows.length * 100).toFixed(1)}%)\n`);
for (const l of labels) { const tot = Object.values(conf[l]).reduce((a, b) => a + b, 0); console.log(`${l.padEnd(16)} ${String(conf[l][l]).padStart(4)}/${String(tot).padEnd(4)} ${(conf[l][l] / tot * 100).toFixed(1)}%   wrong as: ${labels.filter((x) => x !== l && conf[l][x]).map((x) => x + ' ' + conf[l][x]).join(', ') || '-'}`); }
const dangerous = misses.filter((m) => (m.label === 'not_received' || m.label === 'scam_claim') && m.got === 'received').length;
console.log(`\nDangerous mistakes (buyer complaint read as "received"): ${dangerous}`);
console.log('\nSample mistakes:'); misses.slice(0, 25).forEach((m) => console.log(`  [${m.from}] "${m.text}" -> ${m.got} (should be ${m.label})`));
