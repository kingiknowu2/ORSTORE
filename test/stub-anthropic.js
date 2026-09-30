// Test-only stand-in for the Anthropic SDK so AI features can be tested without network or a key.
// Images containing the bytes NSFWTEST are "unsafe", UNSURETEST "unsure", everything else "safe".
const Module = require('node:module');
const orig = Module.prototype.require;
Module.prototype.require = function (name) {
  if (name !== '@anthropic-ai/sdk') return orig.apply(this, arguments);
  return { default: class {
    constructor() {
      this.beta = { messages: { parse: async (req) => {
        const img = req.messages[0].content.find((b) => b.type === 'image');
        if (req.system.includes('screen images')) {
          const raw = Buffer.from(img.source.data, 'base64').toString('latin1');
          const verdict = raw.includes('NSFWTEST') ? 'unsafe' : raw.includes('UNSURETEST') ? 'unsure' : 'safe';
          return { stop_reason: 'end_turn', parsed_output: { verdict, category: verdict === 'safe' ? 'none' : 'nudity', reason: 'test verdict' } };
        }
        return { stop_reason: 'end_turn', parsed_output: { recommendation: 'needs_human', confidence: 'low', summary: 'Stub summary.', key_evidence: [], missing_evidence: [] } };
      } } };
    }
  } };
};
