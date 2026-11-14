'use strict';

// Tier 1 = something nearly every developer would say, tier 6 = deep cut.
const TIERS = [
  { tier: 1, name: 'Hello World', points: 10, depth: 50, emoji: '⬜' },
  { tier: 2, name: 'Stack Overflow', points: 20, depth: 100, emoji: '🟦' },
  { tier: 3, name: 'Man Page', points: 35, depth: 200, emoji: '🟩' },
  { tier: 4, name: 'Source Dive', points: 55, depth: 400, emoji: '🟨' },
  { tier: 5, name: 'Kernel Hacker', points: 75, depth: 700, emoji: '🟧' },
  { tier: 6, name: 'Segfault', points: 100, depth: 1200, emoji: '🟥' },
];

const MISS_EMOJI = '⬛';

// Depth is measured in meters; each layer starts at its threshold.
const LAYERS = [
  { index: 0, name: 'Browser', from: 0 },
  { index: 1, name: 'Framework', from: 500 },
  { index: 2, name: 'Runtime', from: 1200 },
  { index: 3, name: 'Operating System', from: 2200 },
  { index: 4, name: 'Kernel', from: 3500 },
  { index: 5, name: 'Firmware', from: 5000 },
  { index: 6, name: 'Silicon', from: 7000 },
];

function tierInfo(tier) {
  return TIERS[tier - 1] || null;
}

function layerFor(depth) {
  let layer = LAYERS[0];
  for (const candidate of LAYERS) if (depth >= candidate.from) layer = candidate;
  return { index: layer.index, name: layer.name };
}

// Maps an LLM difficulty estimate (1-10) to a starting tier.
function difficultyToTier(difficulty) {
  const d = Number(difficulty);
  if (!Number.isFinite(d) || d <= 2) return 1;
  if (d <= 4) return 2;
  if (d <= 5) return 3;
  if (d <= 7) return 4;
  if (d <= 9) return 5;
  return 6;
}

function emojiRow(tiers) {
  return tiers.map((t) => (t ? tierInfo(t).emoji : MISS_EMOJI)).join('');
}

module.exports = { TIERS, LAYERS, MISS_EMOJI, tierInfo, layerFor, difficultyToTier, emojiRow };
