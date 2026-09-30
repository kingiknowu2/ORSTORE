// Test-only stand-in for the NSFW.js model so safety tests run fast and without explicit images.
// Solid magenta images score as explicit, solid yellow as borderline, anything else as neutral.
const Module = require('node:module');
const orig = Module._load;
Module._load = function (request) {
  if (request !== 'nsfwjs') return orig.apply(this, arguments);
  return { load: async () => ({ classify: async (t) => {
    const d = t.dataSync();
    const avg = [0, 1, 2].map((c) => { let s = 0; for (let i = c; i < d.length; i += 3) s += d[i]; return s / (d.length / 3); });
    if (avg[0] > 200 && avg[1] < 60 && avg[2] > 200) return [{ className: 'Porn', probability: 0.93 }, { className: 'Neutral', probability: 0.07 }];
    if (avg[0] > 200 && avg[1] > 200 && avg[2] < 60) return [{ className: 'Sexy', probability: 0.55 }, { className: 'Neutral', probability: 0.45 }];
    return [{ className: 'Neutral', probability: 0.97 }, { className: 'Sexy', probability: 0.03 }];
  } }) };
};
