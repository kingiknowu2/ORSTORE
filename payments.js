// Built-in test payment provider, modelled on Stripe's PaymentIntents in test mode.
//
// The marketplace only talks to it through createIntent / retrieveIntent / cancelIntent / refund,
// the same shape a real processor exposes, so a live provider can replace it without touching
// order logic. Card numbers are checked in memory and never written anywhere; only the card
// brand and last 4 digits are kept. Only the published test card numbers are accepted.
const crypto = require('node:crypto');

const TEST_CARDS = {
  '4242424242424242': { outcome: 'succeeded', label: 'Payment succeeds' },
  '5555555555554444': { outcome: 'succeeded', label: 'Payment succeeds (Mastercard)' },
  '4000000000000002': { outcome: 'card_declined', label: 'Card is declined', message: 'Your card was declined. No money was taken.' },
  '4000000000009995': { outcome: 'insufficient_funds', label: 'Insufficient funds', message: 'Your card has insufficient funds. No money was taken.' },
  '4000000000000069': { outcome: 'expired_card', label: 'Card has expired', message: 'Your card has expired. No money was taken.' },
};

const digits = (v) => String(v ?? '').replace(/\D/g, '');
function luhn(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = +num[num.length - 1 - i];
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
const brandOf = (n) => (/^4/.test(n) ? 'Visa' : /^5[1-5]/.test(n) ? 'Mastercard' : /^3[47]/.test(n) ? 'American Express' : 'Card');

function validateCard(card = {}) {
  const number = digits(card.number);
  if (number.length < 12 || number.length > 19 || !luhn(number)) return { code: 'incorrect_number', message: 'Your card number is incorrect.' };
  const month = parseInt(card.exp_month, 10);
  let year = parseInt(card.exp_year, 10);
  if (year < 100) year += 2000;
  if (!(month >= 1 && month <= 12) || !(year >= 2000)) return { code: 'invalid_expiry', message: "Your card's expiry date is incomplete." };
  if (new Date(Date.UTC(year, month, 1)) <= new Date()) return { code: 'invalid_expiry', message: "Your card's expiry date is in the past." };
  if (!/^\d{3,4}$/.test(String(card.cvc ?? ''))) return { code: 'invalid_cvc', message: "Your card's security code is incomplete." };
  return null;
}

function createSandboxProvider(db, { onEvent } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_intents (
      id TEXT PRIMARY KEY, client_secret TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
      status TEXT NOT NULL, metadata TEXT NOT NULL, last_error TEXT, card_brand TEXT, card_last4 TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sandbox_refunds (
      id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL);
  `);
  const now = () => new Date().toISOString();
  const row = (id) => db.prepare('SELECT * FROM sandbox_intents WHERE id = ?').get(String(id));
  const view = (r) => r && {
    id: r.id, client_secret: r.client_secret, amount: r.amount, currency: r.currency, status: r.status,
    metadata: JSON.parse(r.metadata), last_error: r.last_error ? JSON.parse(r.last_error) : null,
    card: r.card_last4 ? { brand: r.card_brand, last4: r.card_last4 } : null,
    amount_refunded: db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM sandbox_refunds WHERE intent_id = ?').get(r.id).n,
  };
  const fail = (r, error, card) => {
    db.prepare('UPDATE sandbox_intents SET last_error = ?, card_brand = ?, card_last4 = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(error), card ? brandOf(card) : r.card_brand, card ? card.slice(-4) : r.card_last4, now(), r.id);
    const intent = view(row(r.id));
    if (onEvent) onEvent('payment_intent.payment_failed', intent);
    return { error, intent };
  };

  return {
    name: 'sandbox',
    testMode: true,
    testCards: Object.entries(TEST_CARDS).map(([number, c]) => ({ number, label: c.label })),

    createIntent({ amount, currency, metadata }) {
      if (!Number.isInteger(amount) || amount <= 0) throw new Error('Invalid amount');
      const id = 'pi_sbx_' + crypto.randomBytes(12).toString('hex');
      const secret = id + '_secret_' + crypto.randomBytes(16).toString('hex');
      db.prepare(`INSERT INTO sandbox_intents (id, client_secret, amount, currency, status, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'requires_payment_method', ?, ?, ?)`).run(id, secret, amount, currency, JSON.stringify(metadata || {}), now(), now());
      return view(row(id));
    },

    retrieveIntent: (id) => view(row(id)),

    cancelIntent(id) {
      db.prepare(`UPDATE sandbox_intents SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'requires_payment_method'`).run(now(), String(id));
      return view(row(id));
    },

    // Called by the buyer's browser with the client secret, like Stripe.js confirming a payment.
    confirmIntent(id, clientSecret, card) {
      const r = row(id);
      const secretOk = r && typeof clientSecret === 'string' && clientSecret.length === r.client_secret.length
        && crypto.timingSafeEqual(Buffer.from(clientSecret), Buffer.from(r.client_secret));
      if (!secretOk) return { error: { code: 'resource_missing', message: 'This payment session could not be found. Please start checkout again.' } };
      // A confirmed payment is never charged again, so repeated clicks are harmless.
      if (r.status === 'succeeded') return { intent: view(r) };
      if (r.status === 'canceled') return { error: { code: 'payment_intent_canceled', message: 'This checkout was cancelled because the item is no longer available. No money was taken.' } };
      const invalid = validateCard(card);
      if (invalid) return fail(r, invalid, null);
      const number = digits(card.number);
      const test = TEST_CARDS[number];
      if (!test) return fail(r, { code: 'test_mode_live_card', message: 'This store is in test mode, so real cards are not accepted. Use one of the test card numbers shown.' }, number);
      if (test.outcome !== 'succeeded') return fail(r, { code: test.outcome, message: test.message }, number);
      db.prepare(`UPDATE sandbox_intents SET status = 'succeeded', last_error = NULL, card_brand = ?, card_last4 = ?, updated_at = ?
        WHERE id = ? AND status = 'requires_payment_method'`).run(brandOf(number), number.slice(-4), now(), r.id);
      const intent = view(row(r.id));
      if (onEvent) onEvent('payment_intent.succeeded', intent);
      return { intent };
    },

    refund(intentId) {
      const r = row(intentId);
      if (!r || r.status !== 'succeeded') return { error: { code: 'charge_not_refundable', message: 'This payment was not completed, so there is nothing to refund.' } };
      const refunded = view(r).amount_refunded;
      if (refunded >= r.amount) return { refund: { already: true, amount: r.amount } };
      const id = 're_sbx_' + crypto.randomBytes(12).toString('hex');
      db.prepare('INSERT INTO sandbox_refunds (id, intent_id, amount, created_at) VALUES (?, ?, ?, ?)').run(id, r.id, r.amount - refunded, now());
      return { refund: { id, amount: r.amount - refunded } };
    },
  };
}

module.exports = { createSandboxProvider };
