'use strict';

// Blends the original tier guess with how often players actually submit each
// answer. Rare answers drift up, popular ones drift down. Pinned answers
// (the hand-curated top tier) are never moved.
//
// Also writes data/unmatched-report.json: strings players typed often that
// matched nothing, i.e. candidate aliases or missing answers to review.

const fs = require('node:fs');
const path = require('node:path');
const { norm } = require('./matcher');

// Share of distinct submitted answers that land in each tier, most common first.
const FREQUENCY_BANDS = [
  { tier: 1, upTo: 0.3 },
  { tier: 2, upTo: 0.55 },
  { tier: 3, upTo: 0.75 },
  { tier: 4, upTo: 0.9 },
  { tier: 5, upTo: 1.0 },
];

// `share` is the fraction of distinct submitted answers that are MORE common
// than this one, so the most common answer is always 0 (tier 1), even when it
// is the only answer anyone submitted.
function frequencyTier(rank, distinct) {
  const share = rank / distinct;
  return FREQUENCY_BANDS.find((b) => share < b.upTo).tier;
}

function retier({ store, minMatched = 200, blend = 0.4, minUnmatched = 5 }) {
  const log = store.readLog();
  const bank = store.bank.read();
  const changes = [];

  for (const prompt of bank.prompts) {
    const entries = log.filter((e) => e.promptId === prompt.id);
    const matched = entries.filter((e) => e.canonical);
    if (matched.length < minMatched) continue;

    const counts = new Map();
    for (const e of matched) counts.set(e.canonical, (counts.get(e.canonical) || 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    ranked.forEach(([canonical], rank) => {
      const answer = prompt.answers.find((a) => a.canonical === canonical);
      if (!answer || answer.pin) return;
      const observed = frequencyTier(rank, ranked.length);
      const next = Math.min(5, Math.max(1, Math.round((1 - blend) * answer.tier + blend * observed)));
      if (next !== answer.tier) {
        changes.push({ prompt: prompt.id, answer: canonical, from: answer.tier, to: next });
        answer.tier = next;
      }
    });
  }

  // Frequent unmatched inputs per prompt.
  const unmatched = new Map();
  for (const e of log) {
    if (e.canonical || e.timedOut || !e.input) continue;
    const key = `${e.promptId}\u0000${norm(e.input)}`;
    const cur = unmatched.get(key) || { promptId: e.promptId, input: e.input, count: 0 };
    cur.count += 1;
    unmatched.set(key, cur);
  }
  const report = [...unmatched.values()].filter((u) => u.count >= minUnmatched).sort((a, b) => b.count - a.count).slice(0, 100);

  if (changes.length) store.bank.write(bank);
  fs.writeFileSync(path.join(store.dir, 'unmatched-report.json'), JSON.stringify(report, null, 2));
  return { changes, unmatchedCandidates: report.length };
}

module.exports = { retier, frequencyTier };
