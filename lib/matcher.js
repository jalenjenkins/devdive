'use strict';

// Leading "git " / "git-" and "node:" are ignored so "git cherry-pick" and
// "node:fs" match "cherry-pick" and "fs".
const STRIP_PREFIX = /^(?:git[\s-]+|node:)/;

function norm(input) {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(STRIP_PREFIX, '')
    .replace(/[\s\-_.'’!`"]+/g, '');
}

// Optimal string alignment distance: insert, delete, substitute and
// adjacent transposition each cost 1.
function distance(a, b) {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d = Array.from({ length: al + 1 }, (_, i) => {
    const row = new Array(bl + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

const indexCache = new WeakMap();

function buildIndex(answers) {
  let index = indexCache.get(answers);
  if (index) return index;
  index = new Map(); // normalized key -> answer
  for (const answer of answers) {
    for (const form of [answer.canonical, ...(answer.aliases || [])]) {
      const key = norm(form);
      if (key && !index.has(key)) index.set(key, answer);
    }
  }
  indexCache.set(answers, index);
  return index;
}

const MAX_INPUT_LENGTH = 80;
const FUZZY_MIN_LENGTH = 5;

// Returns { answer, fuzzy } or null.
function match(input, answers) {
  const raw = String(input ?? '');
  if (!raw.trim() || raw.length > MAX_INPUT_LENGTH) return null;
  const q = norm(raw);
  if (!q) return null;

  const index = buildIndex(answers);
  const exact = index.get(q);
  if (exact) return { answer: exact, fuzzy: false };

  // One typo allowed, but only for longer inputs and never for pure numbers
  // (short strings like "ls"/"cd" would otherwise match each other).
  if (q.length < FUZZY_MIN_LENGTH || /^\d+$/.test(q)) return null;
  let best = Infinity;
  let candidates = new Set();
  for (const [key, answer] of index) {
    if (key.length < FUZZY_MIN_LENGTH) continue;
    const dist = distance(q, key);
    if (dist > 1) continue;
    if (dist < best) {
      best = dist;
      candidates = new Set([answer]);
    } else if (dist === best) {
      candidates.add(answer);
    }
  }
  // Ambiguous typos (equally close to two different answers) score nothing.
  if (candidates.size === 1) return { answer: [...candidates][0], fuzzy: true };
  return null;
}

module.exports = { norm, distance, match };
