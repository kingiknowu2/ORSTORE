// Reads informal gamer chat (slang, typos, stretched letters, emojis, negation) and works out what each message means.
// Used by the case scorer. It's rules-based: it covers common ways people talk, not everything a person could say.

// Common chat shorthand -> plain words.
const SLANG = {
  ty: 'thanks', tysm: 'thanks', thx: 'thanks', thnx: 'thanks', thnks: 'thanks', tnx: 'thanks', tq: 'thanks', ta: 'thanks', thank: 'thanks', thankyou: 'thanks', cheers: 'thanks',
  gg: 'good', ggs: 'good', w: 'good', dub: 'good', goat: 'good', goated: 'good', legit: 'legit', lgt: 'legit', ez: 'easy',
  l: 'bad', trash: 'bad', dogwater: 'bad', mid: 'bad',
  rcvd: 'received', recieved: 'received', recived: 'received', receieved: 'received', recevied: 'received', revieved: 'received', reveived: 'received',
  gotit: 'got it', gottem: 'got it', gotem: 'got it', gotchu: 'got it',
  nvr: 'never', nevr: 'never', neva: 'never', aint: 'not', aint_: 'not', dont: 'do not', didnt: 'did not', didint: 'did not', didn: 'did not', dint: 'did not',
  havent: 'have not', havnt: 'have not', haven: 'have not', hvent: 'have not', aint: 'not', didnt_: 'did not', idk: 'unsure', wheres: 'where', whers: 'where', stuff: 'items', things: 'items', thing: 'item', hasnt: 'has not', hvnt: 'have not', wasnt: 'was not', isnt: 'is not', wont: 'will not', cant: 'can not', cannot: 'can not', doesnt: 'does not', aren: 'are not',
  nah: 'no', nope: 'no', naw: 'no', na: 'no', ye: 'yes', yea: 'yes', yeah: 'yes', yep: 'yes', yup: 'yes', ya: 'yes', ofc: 'yes',
  u: 'you', ur: 'your', r: 'are', pls: 'please', plz: 'please', plsss: 'please', bro: 'bro', bruh: 'bro', fr: 'really', frfr: 'really', ngl: 'honestly', tbh: 'honestly', rn: 'now',
  scammer: 'scam', scammed: 'scam', scamming: 'scam', scamd: 'scam', scamer: 'scam', fraud: 'scam', stole: 'scam', robbed: 'scam', finessed: 'scam', fleeced: 'scam',
  snt: 'sent', sendt: 'sent', delivred: 'delivered', delivered: 'delivered', dlvrd: 'delivered',
  itm: 'item', itms: 'items', pet: 'item', pets: 'items', fruit: 'item', fruits: 'items', brainrot: 'item', brainrots: 'items', car: 'item', gems: 'items',
  trd: 'trade', trde: 'trade', tradeing: 'trading', trded: 'traded',
};
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
const EMOJI = { good: /[👍👌🙏❤️💯✅🥳😊😁😄🔥🤝💚💙⭐]/u, bad: /[👎😡🤬😠❌🚫💀😤😭]/u };

function normalise(text) {
  let t = String(text || '').toLowerCase();
  const emojiGood = EMOJI.good.test(t), emojiBad = EMOJI.bad.test(t);
  t = t.replace(/[’']/g, '');
  // Leetspeak inside words (l3git -> legit), but keep plain numbers.
  t = t.replace(/\b\w*[a-z]\w*\b/g, (w) => w.replace(/[013457@$]/g, (c) => LEET[c] || c));
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  // Stretched letters: thxxx -> thx, gottt -> got, sooo -> so.
  t = t.replace(/([a-z])\1{2,}/g, '$1');
  const words = t.split(/\s+/).filter(Boolean).flatMap((w) => {
    const mapped = SLANG[w] ?? SLANG[w.replace(/([a-z])\1+/g, '$1')] ?? w;
    return mapped.split(' ');
  });
  return { words, text: ' ' + words.join(' ') + ' ', emojiGood, emojiBad };
}

// Phrases that mean the buyer has the item, and phrases that mean they don't.
const HAVE_IT = [
  / (got|received|have|recieved) (it|them|the item|the items|item|items|my item|my items|everything|all|the trade|trade|em|ur item) /,
  / (got|received|have) (it|them) (now|thanks|bro|yes|good|legit) /, / received /, / got it /, / it (came|arrived|worked|works) /, / (item|items) (came|arrived|received) /,
  / all good /, / (trade|it) (went|was) (through|good|fine) /, / (legit|good) (seller|trade|guy|person) /, / (thanks|good) (seller|trade|bro|man|dude) /, / (thanks|good) /,
  / yes /, / easy trade /, / w trade /, / legit /, / confirmed /, / (it|they|that) worked /,
];
const DONT_HAVE_IT = [
  / not (get|got|receive|received|recieve|have|see|seen) /, / never (got|received|came|arrived|sent|showed|traded|gave) /,
  / (did|have|has|does|was|is|are) not (get|got|receive|received|have|come|came|arrive|arrived|work|worked|show|showed|send|sent|trade|traded) /,
  / (no|still no) (item|items|trade|pets|pet|nothing) /, / (did|have) not (got|gotten) /, / nothing (came|arrived|received|showed|in my|yet) /,
  / (still|havent|not) (waiting|here) /, / where (is |are |r )?(it|my|the|item|items|pet|pets) /, / (empty|missing) /,
  / (got|received|get|have|seen) nothing /, / nothing (yet|at all|bro|man) /, / no i did not /, / did not $/, / (i|we) did not /,
  / (it|item|items) (did not|never) (come|came|arrive|arrived|show|work) /, / not (working|work|legit) /, / does not work /, / wrong (item|items|pet|one) /,
];
const SCAM = [/ scam /, / (stole|robbed|finessed|fake) /, / (report|reporting) (you|him|u|them) /, / chargeback /, / (give|want) (me )?(my )?(money|refund) (back)? /, / refund /];
const SELLER_DELIVERED = [/ (sent|delivered|traded|gave|given) (it|them|you|u|the item|items|your|ur) /, / (sent|delivered|traded|done) /, / check (your|ur|you) (inventory|inv|mail|trades) /, / accept (the )?(trade|request|friend) /];
const SAYS_OTHER_SENT = / (he|she|they|seller|buyer) (said|says|claims|claimed) /; // reported speech isn't proof

// Returns what a message means: 'received', 'not_received', 'scam_claim', 'delivered_claim' or 'neutral'.
function classifyMessage(text, from) {
  const n = normalise(text);
  const hit = (list) => list.some((r) => r.test(n.text));
  const negative = hit(DONT_HAVE_IT);
  const scam = hit(SCAM);
  if (from === 'buyer') {
    if (scam) return { intent: 'scam_claim', words: n.words };
    if (negative) return { intent: 'not_received', words: n.words };
    if (SAYS_OTHER_SENT.test(n.text)) return { intent: 'neutral', words: n.words };
    if (hit(HAVE_IT) || (n.emojiGood && !n.emojiBad && n.words.length <= 3)) return { intent: 'received', words: n.words };
    if (n.emojiBad) return { intent: 'not_received', words: n.words };
    return { intent: 'neutral', words: n.words };
  }
  if (from === 'seller' && !negative && hit(SELLER_DELIVERED)) return { intent: 'delivered_claim', words: n.words };
  return { intent: 'neutral', words: n.words };
}

// Sums up a chat. The buyer's latest clear statement counts most, so "got it" then "wait it's gone" reads as not received.
function readChat(messages) {
  const read = messages.map((m) => ({ ...m, ...classifyMessage(m.text, m.from) }));
  const buyerClear = read.filter((m) => m.from === 'buyer' && ['received', 'not_received', 'scam_claim'].includes(m.intent));
  const last = buyerClear[buyerClear.length - 1];
  return {
    buyer_says: last ? last.intent : 'nothing_clear',
    buyer_quote: last ? last.text : null,
    buyer_changed_mind: buyerClear.some((m) => m.intent === 'received') && buyerClear.some((m) => m.intent !== 'received'),
    seller_claims_delivery: read.some((m) => m.intent === 'delivered_claim'),
    seller_replied: messages.some((m) => m.from === 'seller'),
  };
}

module.exports = { normalise, classifyMessage, readChat };
