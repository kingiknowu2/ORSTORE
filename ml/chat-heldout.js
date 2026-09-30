// Messages NOT used for training, to measure how well the model handles new phrasing.
const HELD_OUT = [
  ['buyer', 'yooo got the huge thx a lot', 'received'], ['buyer', 'bet got it appreciate u', 'received'], ['buyer', 'omg tysmmm', 'received'],
  ['buyer', 'yessir its here', 'received'], ['buyer', 'W trade 🙏', 'received'], ['buyer', 'received the dragon fruit tyy', 'received'],
  ['buyer', 'perfect everything came', 'received'], ['buyer', 'legit af', 'received'], ['buyer', 'got the torpedo ty', 'received'],
  ['buyer', 'my pet never showed up', 'not_received'], ['buyer', 'bro i still dont see it', 'not_received'], ['buyer', 'yo wheres my diamonds', 'not_received'],
  ['buyer', 'it aint there', 'not_received'], ['buyer', 'nah didnt get nun', 'not_received'], ['buyer', 'waited 2 hours still nothing', 'not_received'],
  ['buyer', 'u sent the wrong brainrot', 'not_received'], ['buyer', 'inventory still empty 😭', 'not_received'], ['buyer', 'havent seen anything yet', 'not_received'],
  ['buyer', 'ur such a scammer', 'scam_claim'], ['buyer', 'gimme my money back', 'scam_claim'], ['buyer', 'this guy scammed me fr', 'scam_claim'],
  ['buyer', 'im gonna report u', 'scam_claim'], ['buyer', 'refund pls i got scammed', 'scam_claim'],
  ['buyer', 'whats ur roblox name', 'neutral'], ['buyer', 'im in game now', 'neutral'], ['buyer', 'ok one min', 'neutral'], ['buyer', 'can u do it tmrw', 'neutral'],
  ['buyer', 'he says he gave it', 'neutral'], ['buyer', 'hello?', 'neutral'],
  ['seller', 'just traded it to u', 'delivered_claim'], ['seller', 'check inv', 'delivered_claim'], ['seller', 'sent enjoy 👍', 'delivered_claim'],
  ['seller', 'trade complete', 'delivered_claim'], ['seller', 'gave u the pet', 'delivered_claim'],
  ['seller', 'will send in 10 mins', 'neutral'], ['seller', 'whats ur user', 'neutral'], ['seller', 'join my private server', 'neutral'],
].map(([from, text, label]) => ({ from, text, label }));
module.exports = { HELD_OUT };
