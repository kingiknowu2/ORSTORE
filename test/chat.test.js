// How the case scorer reads informal chat.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyMessage, readChat } = require('../chat-understanding');

const BUYER = {
  received: [
    'got it ty', 'GOT ITTTT', 'tysm bro 🙏', 'recieved thx', 'reciveddd', 'w seller fr', 'legit seller 100%', 'l3git ty',
    'yh got it', 'yea i have them now', 'ez trade gg', 'it came thanks', 'all good bro', 'thank u so much', 'got em ty ty',
    'items arrived', 'trade went through', '👍', '✅✅', 'got the pets thx', 'received everything', 'goated seller', 'yes got it', 'ty ❤️',
    'got my fruit', 'thx man it worked', 'cheers mate got it',
  ],
  not_received: [
    'didnt get it', 'i didnt get anything', 'still havent got it', 'nvr got it', 'never received', 'i aint got nothing', 'where is my item??',
    'no item yet', 'nothing came', 'havent recieved', 'it didnt come', 'its not working', 'wrong pet bro', 'nothing in my inventory',
    'still waiting', 'bro i dont have it', 'u never sent it', 'where my pets at', 'did not recieve it', 'doesnt work', 'hasnt arrived yet',
    'thanks but i never got it', 'ty but it didnt come', 'i got scammed', 'ur a scammer', 'this is a scam', 'give me my money back', 'i want a refund',
    'reporting u', '😡😡', 'i havent gotten it',
  ],
};

test('understands buyers saying they got it (slang, typos, emojis)', () => {
  const miss = BUYER.received.filter((m) => classifyMessage(m, 'buyer').intent !== 'received');
  assert.deepEqual(miss, []);
});

test('understands buyers saying they did not get it, including negation and scam claims', () => {
  const miss = BUYER.not_received.filter((m) => !['not_received', 'scam_claim'].includes(classifyMessage(m, 'buyer').intent));
  assert.deepEqual(miss, []);
});

test('reported speech and small talk are not treated as proof', () => {
  for (const m of ['he said he sent it', 'hi', 'ok', 'whats ur username', 'what time u online', 'lol']) {
    assert.equal(classifyMessage(m, 'buyer').intent, 'neutral', m);
  }
});

test('seller delivery claims', () => {
  for (const m of ['sent it', 'sent', 'traded u', 'check ur inventory', 'accept the trade', 'done bro']) assert.equal(classifyMessage(m, 'seller').intent, 'delivered_claim', m);
  assert.equal(classifyMessage('i didnt send it yet', 'seller').intent, 'neutral');
});

test('the buyer’s latest clear message counts; changing their mind is noticed', () => {
  const r = readChat([{ from: 'seller', text: 'sent' }, { from: 'buyer', text: 'got it ty' }, { from: 'buyer', text: 'wait nvm its not in my inventory, never got it' }]);
  assert.equal(r.buyer_says, 'not_received');
  assert.equal(r.buyer_changed_mind, true);
  assert.equal(r.seller_claims_delivery, true);
});

test('tricky phrasings', () => {
  const cases = [['ngl w seller', 'received'], ['cant lie legit', 'received'], ['no problem got it', 'received'], ['got it? no i didnt', 'not_received'],
    ['i got nothing', 'not_received'], ['havnt got it', 'not_received'], ['nothing yet', 'not_received'], ['yh it worked', 'received'],
    ['it came but wrong pet', 'not_received'], ['recieved nothing', 'not_received'], ['bro wheres my stuff', 'not_received'],
    ['got it didnt expect it so fast ty', 'received'], ['hmm ok', 'neutral'], ['i got scammed smh', 'scam_claim']];
  assert.deepEqual(cases.filter(([m, want]) => classifyMessage(m, 'buyer').intent !== want).map(([m]) => m), []);
});

test('case model learns the owner’s habits once there are 10 decisions', () => {
  const { learnFromOwner } = require('../moderation');
  const mk = (features, label) => ({ features, label });
  assert.equal(learnFromOwner([mk({ recording: 1 }, 'pay_seller')], { recording: 1 }), null, 'needs 10 decisions first');
  const history = [
    ...Array(6).fill(mk({ recording: 1, chat_received: 1 }, 'pay_seller')),
    ...Array(6).fill(mk({ no_recording: 1, chat_not_received: 1 }, 'refund_buyer')),
  ];
  const likeSeller = learnFromOwner(history, { recording: 1, chat_received: 1 });
  const likeBuyer = learnFromOwner(history, { no_recording: 1, chat_not_received: 1 });
  assert.equal(likeSeller.decisions, 12);
  assert.ok(likeSeller.p_seller > 0.8, JSON.stringify(likeSeller));
  assert.ok(likeBuyer.p_seller < 0.2, JSON.stringify(likeBuyer));
});

test('our chat model handles messages it never trained on', () => {
  const { predict } = require('../chat-model');
  const { HELD_OUT } = require('../ml/chat-heldout');
  const right = HELD_OUT.filter((h) => predict(h.text, h.from).label === h.label).length;
  assert.ok(right / HELD_OUT.length >= 0.9, `${right}/${HELD_OUT.length}`);
});

test('1000 unseen messages: at least 95% right and no complaint read as "received"', () => {
  const { build } = require('../ml/chat-test1000');
  const rows = build(1000);
  let right = 0, dangerous = 0;
  for (const r of rows) { const g = classifyMessage(r.text, r.from).intent; if (g === r.label) right++; else if (g === 'received' && r.label !== 'neutral') dangerous++; }
  assert.ok(right >= 950, `${right}/1000`);
  assert.equal(dangerous, 0);
});
