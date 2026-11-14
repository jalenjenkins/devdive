'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expandSeed } = require('../lib/seed');
const { validateBank } = require('../lib/validate');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seed.json'), 'utf8'));
const bank = expandSeed(seed);

test('seed bank has no alias collisions or malformed answers', () => {
  assert.deepEqual(validateBank(bank, { minAnswers: 20 }), []);
});

test('every seed prompt spans all six tiers', () => {
  for (const p of bank.prompts) {
    const tiers = new Set(p.answers.map((a) => a.tier));
    assert.ok(tiers.size >= 5, `${p.id} only spans ${tiers.size} tiers`);
  }
});

test('top-tier answers are pinned so re-tiering never moves them', () => {
  for (const p of bank.prompts) {
    for (const a of p.answers) assert.equal(Boolean(a.pin), a.tier === 6);
  }
});

test('a canonical answer never appears in two tiers of the same prompt', () => {
  for (const p of bank.prompts) {
    const seen = new Set();
    for (const a of p.answers) {
      assert.ok(!seen.has(a.canonical.toLowerCase()), `${p.id} repeats "${a.canonical}"`);
      seen.add(a.canonical.toLowerCase());
    }
  }
});

test('dropSuffix adds the bare name for sorting algorithms', () => {
  const sorting = bank.prompts.find((p) => p.id === 'sorting-algorithms');
  const bubble = sorting.answers.find((a) => a.canonical === 'Bubble Sort');
  assert.ok(bubble.aliases.includes('Bubble'));
});
