// Training examples for the chat model, written the way players actually type.
// Each base phrase is expanded with slang, fillers, emojis and typo noise to make thousands of examples.
const LABELS = ['received', 'not_received', 'scam_claim', 'delivered_claim', 'neutral'];

const BUYER = {
  received: [
    'got it', 'got it thanks', 'got it ty', 'ty got it', 'thanks got it', 'received', 'received it', 'recieved', 'i received it', 'i got it',
    'got them', 'got em', 'got the pet', 'got the pets', 'got my fruit', 'got the brainrot', 'got the car', 'got the gems', 'got the cash', 'got the diamonds',
    'it came', 'it arrived', 'items arrived', 'it worked', 'it works', 'works perfectly', 'all good', 'everything is good', 'yep got it', 'yes i got it', 'yeah got it',
    'thanks so much', 'thank you', 'ty', 'tysm', 'thx', 'thanks bro', 'ty bro', 'legit', 'legit seller', 'w seller', 'good seller', 'goated seller', 'fast delivery thanks',
    'trade went through', 'trade done thanks', 'smooth trade', 'ez trade', 'gg ty', 'perfect ty', 'amazing thanks', 'received everything', 'have it now', 'i have them now',
    'its in my inventory', 'it shows in my inventory now', 'just got it', 'finally got it ty', 'got it didnt expect it so fast', 'no problem got it', 'cant lie legit',
    'ngl w seller', 'confirmed got it', 'its here', 'its here now', 'here it is thanks', 'it showed up', 'showed up ty', 'yup its there', 'yessir', 'bet', 'bet ty', 'its in my backpack',
    'see it now', 'i can see it now', 'ok i see it', 'arrived thank u', 'yh it worked', 'thanks man it worked', 'appreciate it got it', 'got it will buy again', '10/10 seller', 'love it thanks',
  ],
  not_received: [
    'didnt get it', 'did not get it', 'i didnt receive it', 'never got it', 'never received it', 'havent got it', 'havent received it', 'still havent got it',
    'not received', 'not recieved', 'i dont have it', 'i dont have the pet', 'nothing came', 'nothing arrived', 'nothing in my inventory', 'got nothing', 'i got nothing',
    'received nothing', 'no item', 'no items yet', 'still waiting', 'still nothing', 'where is my item', 'where is it', 'wheres my stuff', 'where my pets at', 'wheres the fruit',
    'it didnt come', 'it never came', 'it never arrived', 'it doesnt work', 'its not working', 'not working', 'wrong item', 'wrong pet', 'thats the wrong one', 'it came but wrong pet',
    'u never sent it', 'you didnt send it', 'nothing yet', 'havnt got it', 'got it? no i didnt', 'thanks but i never got it', 'ty but it didnt come', 'hasnt arrived',
    'bro i dont have it', 'my inventory is empty', 'the pet isnt there', 'i checked and its not there', 'you sent the wrong thing', 'only got half', 'missing some items',
    'i got the wrong amount', 'havent seen it', 'i havent seen any trade', 'dont see anything', 'cant see it', 'not seeing it', 'it isnt here', 'its not here', 'not showing up',
    'not all of it came', 'it disappeared', 'i didnt even get a trade request', 'you never joined', 'you left the game',
  ],
  scam_claim: [
    'scam', 'scammer', 'you scammed me', 'i got scammed', 'ur a scammer', 'this is a scam', 'fake seller', 'he stole my money', 'give me my money back', 'i want a refund',
    'refund me', 'i want my money back', 'reporting you', 'im reporting you', 'report this seller', 'chargeback', 'im doing a chargeback', 'thief', 'robbed me', 'you finessed me',
    'scammed smh', 'i got scammed smh', 'dont buy from this guy scammer', 'refund now', 'money back now',
  ],
  neutral: [
    'hi', 'hello', 'hey', 'yo', 'sup', 'ok', 'okay', 'k', 'hmm ok', 'lol', 'lmao', 'bruh', 'whats your username', 'whats ur user', 'what time are you online',
    'are you online', 'when can you trade', 'can you trade now', 'im online now', 'join me', 'add me', 'my username is kidcool', 'my user is coolkid123', 'friend me',
    'which server', 'what server', 'send me the link', 'how long will it take', 'is it still available', 'ok wait', 'one sec', 'brb', 'im at school', 'can we do it later',
    'im in the game', 'in game now', 'im online in roblox', 'im in your server', 'joining now', 'im here', 'ready when you are', 'ok im ready',
    'he said he sent it', 'she says its done', 'the seller said he sent it', 'let me check', 'checking', 'i will check', 'wait', 'where do i join', 'what do i do',
  ],
};
const SELLER = {
  delivered_claim: [
    'sent', 'sent it', 'i sent it', 'just sent it', 'sent the trade', 'traded you', 'traded u', 'i traded you', 'gave it to you', 'delivered', 'delivered it', 'done',
    'done bro', 'all done', 'check your inventory', 'check ur inv', 'accept the trade', 'accept my trade request', 'trade sent', 'its in your inventory', 'you should have it now',
    'enjoy', 'sent it enjoy', 'there you go', 'completed', 'finished the trade',
  ],
  neutral: [
    'hi', 'hello', 'whats your username', 'join my server', 'add me', 'on my way', 'give me 5 mins', 'im at school', 'will send later', 'i didnt send it yet',
    'havent sent it yet', 'not yet', 'what server are you in', 'are you online', 'ok', 'wait', 'one sec', 'let me log in', 'sorry for the wait', 'can you add me',
  ],
  scam_claim: ['you are lying', 'stop lying', 'you got it already', 'you are scamming me', 'buyer is lying', 'chargeback scammer'],
};

const FILLERS = ['', '', '', ' bro', ' fr', ' lol', ' man', ' dude', ' tbh', ' ngl', ' rn', ' pls', ' mate', ' fam'];
const PREFIX = ['', '', '', 'yo ', 'bro ', 'ok ', 'yeah ', 'hey ', 'ngl ', 'tbh '];
const EMOJI = { received: ['', '', ' 🙏', ' 👍', ' ❤️', ' 🔥', ' ✅', ' 😁'], not_received: ['', '', ' 😡', ' ❌', ' 😭', ' ??', ' !!'], scam_claim: ['', ' 😡', ' 🤬', ' !!!'], delivered_claim: ['', ' 👍', ' ✅'], neutral: ['', '', ' ?', ' 😊'] };
const SWAPS = [[/\bthanks\b/, ['ty', 'thx', 'tysm', 'thank u', 'thnx']], [/\byou\b/, ['u', 'ya']], [/\byour\b/, ['ur', 'yur']], [/\bdidnt\b/, ['didn\'t', 'didint', 'dint', 'didn']],
  [/\bhavent\b/, ['haven\'t', 'havnt', 'hvnt']], [/\breceived\b/, ['recieved', 'recived', 'rcvd', 'reciveddd']], [/\bnever\b/, ['nvr', 'neva']], [/\bgot\b/, ['gott', 'got']],
  [/\bdont\b/, ['don\'t', 'dnt']], [/\bitem\b/, ['itm', 'thing', 'stuff']], [/\bscammer\b/, ['scamer', 'scammerrr']], [/\bsent\b/, ['sent', 'snt']]];

function mutate(s, rnd) {
  for (const [re, opts] of SWAPS) if (re.test(s) && rnd() < 0.5) s = s.replace(re, opts[Math.floor(rnd() * opts.length)]);
  if (rnd() < 0.15) s = s.replace(/[aeiou](?=[a-z])/, (c) => c + c + c);       // stretched letters
  if (rnd() < 0.1) { const i = Math.floor(rnd() * s.length); s = s.slice(0, i) + s.slice(i + 1); } // dropped letter
  if (rnd() < 0.15) s = s.toUpperCase();
  return s;
}

function dataset(copies = 12, seed = 1) {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const out = [];
  for (const [from, table] of [['buyer', BUYER], ['seller', SELLER]]) {
    for (const [label, phrases] of Object.entries(table)) {
      for (const p of phrases) {
        out.push({ text: p, from, label });
        for (let k = 0; k < copies; k++) out.push({ text: mutate(pick(PREFIX) + p + pick(FILLERS), rnd) + pick(EMOJI[label]), from, label });
      }
    }
  }
  return out;
}

module.exports = { LABELS, dataset };
