// In-house moderation: runs entirely on this server, with no outside AI service.
//  - checkImage: NSFW screening with the open-source NSFW.js model (bundled, works offline).
//  - reviewCase: a transparent points-based scorer that summarises which side the evidence favours.
// Both are advisory. Unsafe images are hidden automatically; case outcomes are always decided by the site owner.
const jpeg = require('jpeg-js');
const { readChat } = require('./chat-understanding');
const { PNG } = require('pngjs');

const enabled = () => process.env.NSFW_DISABLED !== '1';

// ---------- NSFW image screening ----------
let modelPromise;
function loadModel() {
  if (!modelPromise) {
    const tf = require('@tensorflow/tfjs');
    tf.enableProdMode();
    modelPromise = require('nsfwjs').load('MobileNetV2Mid').then((model) => ({ tf, model }));
  }
  return modelPromise;
}
const warmUp = () => { if (enabled()) loadModel().catch((e) => console.error('NSFW model failed to load', e.message)); };

function decode(buffer, mediaType) {
  if (mediaType === 'image/jpeg') {
    const img = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 256 });
    return { width: img.width, height: img.height, data: img.data };
  }
  if (mediaType === 'image/png') {
    const img = PNG.sync.read(buffer);
    return { width: img.width, height: img.height, data: img.data };
  }
  return null; // WebP/GIF can't be decoded here, so they go to a person.
}

// Scores the whole image plus a centre crop and keeps the worst result, so small or partly hidden content isn't missed.
// Low-quality images are upscaled by the model to its input size; the thresholds are strict so doubtful images go to review.
async function checkImage(buffer, mediaType) {
  const img = decode(buffer, mediaType);
  if (!img) return { verdict: 'unsure', category: 'other', reason: 'This image format can’t be checked automatically, so a moderator will look.' };
  const { tf, model } = await loadModel();
  const rgb = new Uint8Array(img.width * img.height * 3);
  for (let i = 0, j = 0; i < img.data.length; i += 4) { rgb[j++] = img.data[i]; rgb[j++] = img.data[i + 1]; rgb[j++] = img.data[i + 2]; }
  const full = tf.tensor3d(rgb, [img.height, img.width, 3]);
  const views = [full];
  if (img.width >= 64 && img.height >= 64) {
    const w = Math.floor(img.width * 0.6), h = Math.floor(img.height * 0.6);
    views.push(tf.slice(full, [Math.floor((img.height - h) / 2), Math.floor((img.width - w) / 2), 0], [h, w, 3]));
  }
  let worst = { porn: 0, sexy: 0 };
  try {
    for (const v of views) {
      const p = Object.fromEntries((await model.classify(v, 5)).map((c) => [c.className, c.probability]));
      const porn = (p.Porn || 0) + (p.Hentai || 0);
      if (porn > worst.porn) worst.porn = porn;
      if ((p.Sexy || 0) > worst.sexy) worst.sexy = p.Sexy || 0;
    }
  } finally { views.forEach((v) => v.dispose()); }
  const pct = (n) => Math.round(n * 100) + '%';
  if (worst.porn >= 0.6 || worst.sexy >= 0.85) {
    return { verdict: 'unsafe', category: worst.porn >= 0.6 ? 'sexual' : 'nudity', reason: `Model found explicit content (${pct(Math.max(worst.porn, worst.sexy))}).` };
  }
  if (worst.porn >= 0.2 || worst.sexy >= 0.45) {
    return { verdict: 'unsure', category: 'other', reason: `Possible explicit or suggestive content (${pct(Math.max(worst.porn, worst.sexy))}); needs a person to look.` };
  }
  return { verdict: 'safe', category: 'none', reason: 'No explicit content detected.' };
}

// ---------- Case scorer ----------
// Positive points favour the seller, negative points favour the buyer. Every factor is listed in the summary.
async function reviewCase(c) {
  const factors = [];
  const add = (pts, text, key) => { factors.push({ pts, text, key }); };
  const o = c.order;
  const recording = c.evidence.find((e) => e.by === 'seller' && e.file && ['mp4', 'webm', 'mov'].includes(e.file.ext));
  if (recording) {
    add(3, 'Seller uploaded a trade recording', 'recording');
    const mins = (new Date(o.seller_delivered_at) - new Date(o.paid_at)) / 60000;
    if (mins >= 0 && mins <= 60) add(1, `Seller confirmed delivery ${Math.max(1, Math.round(mins))} min after payment`, 'fast_delivery');
  } else add(-3, 'No trade recording from the seller', 'no_recording');
  if (o.buyer_confirmed_at && c.case.opened_by === 'buyer') add(3, 'Buyer confirmed receipt before opening the case', 'buyer_confirmed_then_disputed');
  if (c.case.opened_by === 'system' && o.seller_delivered_at && !o.buyer_confirmed_at) add(1, 'Seller confirmed; the buyer did not respond before the deadline', 'buyer_silent');
  if (c.case.opened_by === 'system' && !o.seller_delivered_at && o.buyer_confirmed_at) add(-2, 'Buyer confirmed; the seller did not confirm delivery', 'seller_silent');
  const buyerFiles = c.evidence.filter((e) => e.by === 'buyer' && e.file && !e.file.unsafe).length;
  const sellerExtra = c.evidence.filter((e) => e.by === 'seller' && e !== recording).length;
  if (buyerFiles) add(-Math.min(2, buyerFiles), `Buyer added ${buyerFiles} evidence file${buyerFiles === 1 ? '' : 's'}`, 'buyer_evidence');
  if (sellerExtra) add(Math.min(2, sellerExtra), `Seller added ${sellerExtra} more piece${sellerExtra === 1 ? '' : 's'} of evidence`, 'seller_evidence');
  // Chat is read for meaning, including slang, typos, emojis and negation ("didnt get it", "tysm got em").
  const chat = readChat(c.messages);
  const q = chat.buyer_quote ? ` (“${chat.buyer_quote.slice(0, 60)}”)` : '';
  if (chat.buyer_says === 'received') add(chat.buyer_changed_mind ? 1 : 3, `Buyer said in chat they received it${q}`, 'chat_received');
  if (chat.buyer_says === 'not_received') add(-2, `Buyer said in chat they didn’t get it${q}`, 'chat_not_received');
  if (chat.buyer_says === 'scam_claim') add(-1, `Buyer accused the seller of scamming or asked for a refund${q}`, 'chat_scam');
  if (chat.buyer_changed_mind) add(0, 'Buyer changed their story in chat; a moderator should read it', 'chat_changed');
  if (chat.seller_claims_delivery && !recording) add(0, 'Seller said in chat they sent it, but there’s no recording to prove it', 'claim_no_proof');
  if (!chat.seller_replied) add(-1, 'Seller never replied in the order chat', 'seller_no_reply');
  const s = c.seller_stats || {};
  if (s.completed >= 10 && s.dispute_rate < 0.05) add(1, `Seller has ${s.completed} completed sales with few disputes`, 'seller_good_history');
  if (s.completed >= 5 && s.dispute_rate > 0.2) add(-1, `Seller has a high dispute rate (${Math.round(s.dispute_rate * 100)}%)`, 'seller_bad_history');
  const b = c.buyer_stats || {};
  if (b.cases_90d >= 3) add(1, `Buyer opened ${b.cases_90d} cases in the last 90 days`, 'buyer_many_cases');

  const score = factors.reduce((t, f) => t + f.pts, 0);
  const features = Object.fromEntries(factors.filter((f) => f.key).map((f) => [f.key, 1]));
  const learned = learnFromOwner(c.training || [], features);
  const recommendation = score >= 3 ? 'pay_seller' : score <= -3 ? 'refund_buyer' : 'needs_human';
  const confidence = Math.abs(score) >= 6 ? 'high' : Math.abs(score) >= 3 ? 'medium' : 'low';
  const lean = { pay_seller: 'the seller', refund_buyer: 'the buyer', needs_human: 'neither side clearly' }[recommendation];
  const missing = [];
  if (!recording) missing.push('The seller’s full trade recording');
  if (!buyerFiles && c.case.opened_by === 'buyer') missing.push('A screenshot from the buyer (e.g. their inventory)');
  return {
    recommendation, confidence, score,
    summary: `Evidence favours ${lean} (score ${score > 0 ? '+' : ''}${score}). ` + factors.map((f) => `${f.text} (${f.pts > 0 ? '+' : ''}${f.pts})`).join('; ') + '.'
      + (learned ? ` Based on ${learned.decisions} of your past decisions, similar cases went to ${learned.p_seller >= 0.5 ? 'the seller' : 'the buyer'} ${Math.round(Math.max(learned.p_seller, 1 - learned.p_seller) * 100)}% of the time.` : ''),
    features, learned,
    key_evidence: factors.map((f) => f.text),
    missing_evidence: missing,
  };
}

// ---------- Learning from the owner's decisions ----------
// A small logistic-regression model trained on the cases the owner has already decided.
// It starts once there are 10 decisions with at least 2 of each outcome, and retrains every time.
const MIN_DECISIONS = 10;
function learnFromOwner(training, features) {
  const rows = training.filter((t) => t.label === 'pay_seller' || t.label === 'refund_buyer');
  const sellers = rows.filter((r) => r.label === 'pay_seller').length;
  if (rows.length < MIN_DECISIONS || sellers < 2 || rows.length - sellers < 2) return null;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.features)).concat(Object.keys(features)))];
  const vec = (f) => keys.map((k) => (f[k] ? 1 : 0));
  const X = rows.map((r) => vec(r.features)), Y = rows.map((r) => (r.label === 'pay_seller' ? 1 : 0));
  const w = new Array(keys.length).fill(0); let b = 0;
  const sig = (z) => 1 / (1 + Math.exp(-z));
  for (let it = 0; it < 400; it++) {
    const gw = new Array(keys.length).fill(0); let gb = 0;
    X.forEach((x, i) => { const e = sig(x.reduce((t, v, j) => t + v * w[j], b)) - Y[i]; x.forEach((v, j) => (gw[j] += e * v)); gb += e; });
    for (let j = 0; j < w.length; j++) w[j] -= 0.3 * (gw[j] / X.length + 0.01 * w[j]);
    b -= 0.3 * gb / X.length;
  }
  const p = sig(vec(features).reduce((t, v, j) => t + v * w[j], b));
  return { p_seller: Math.round(p * 100) / 100, decisions: rows.length };
}

module.exports = { enabled, warmUp, checkImage, reviewCase, learnFromOwner };
