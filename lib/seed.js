'use strict';

// Converts the compact seed format into the bank format used at runtime.
//
// Compact answer: "canonical|alias|alias" listed under a tier number.
// Top-tier (6) answers are hand-curated, so they are pinned and the
// frequency-based re-tiering script leaves them alone.

function expandAnswer(item, tier, options) {
  const [canonical, ...aliases] = item.split('|').map((s) => s.trim()).filter(Boolean);
  if (options.dropSuffix) {
    const suffix = new RegExp(`\\s+${options.dropSuffix}$`, 'i');
    for (const form of [canonical, ...aliases]) {
      if (suffix.test(form)) aliases.push(form.replace(suffix, ''));
    }
  }
  const answer = { canonical, aliases: [...new Set(aliases)], tier };
  if (tier === 6) answer.pin = true;
  return answer;
}

function expandSeed(seed) {
  const prompts = seed.prompts.map((p) => {
    const answers = [];
    for (const [tier, items] of Object.entries(p.tiers)) {
      for (const item of items) answers.push(expandAnswer(item, Number(tier), p));
    }
    return {
      id: p.id,
      text: p.text,
      category: p.category,
      fact: p.fact || '',
      status: 'ready',
      source: 'seed',
      answers,
    };
  });
  return { version: 1, prompts };
}

module.exports = { expandSeed };
