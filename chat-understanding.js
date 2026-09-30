// Works out what each chat message means using our own trained model (chat-model.js).
// Messages the model isn't confident about count as "neutral" instead of guessing.
const { predict } = require('./chat-model');
const MIN_CONFIDENCE = 0.55;
const NEGATION = /\b(no+|not|never|nvr|nothing|nthing|nothin|nuthin|nada|missing|wrong|didnt|ddnt|dnt|didn|dint|hvnt|havent|havnt|hasnt|isnt|aint|dont|doesnt|wasnt|cant|cannot)\b/;

function classifyMessage(text, from) {
  const p = predict(text, from === 'seller' ? 'seller' : 'buyer');
  let intent = p.confidence >= MIN_CONFIDENCE ? p.label : 'neutral';
  if (from === 'seller' && ['received', 'not_received'].includes(intent)) intent = 'neutral'; // only buyers can say what they received
  if (from !== 'seller' && intent === 'delivered_claim') intent = 'neutral';
  // Safety net: a buyer message with a clear "no/not/never/missing" word is never counted as "received".
  // A wrong "received" could favour a seller who didn't deliver, so it's downgraded to unclear instead.
  if (intent === 'received' && NEGATION.test(String(text).toLowerCase().replace(/[’']/g, ''))) intent = 'neutral';
  return { intent, confidence: p.confidence };
}

// Sums up a chat. The buyer's latest clear statement counts most, so "got it" then "wait it's gone" reads as not received.
function readChat(messages) {
  const read = messages.map((m) => ({ ...m, ...classifyMessage(m.text, m.from) }));
  const buyerClear = read.filter((m) => m.from === 'buyer' && ['received', 'not_received', 'scam_claim'].includes(m.intent));
  const last = buyerClear[buyerClear.length - 1];
  return {
    buyer_says: last ? last.intent : 'nothing_clear',
    buyer_quote: last ? last.text : null,
    buyer_confidence: last ? last.confidence : null,
    buyer_changed_mind: buyerClear.some((m) => m.intent === 'received') && buyerClear.some((m) => m.intent !== 'received'),
    seller_claims_delivery: read.some((m) => m.intent === 'delivered_claim'),
    seller_replied: messages.some((m) => m.from === 'seller'),
  };
}

module.exports = { classifyMessage, readChat };
