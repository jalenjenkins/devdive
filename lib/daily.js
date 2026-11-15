"use strict";

const MS_PER_DAY = 86400000;

function dateKey(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY,
  );
}

function puzzleNumber(key, launchDate) {
  return Math.max(1, daysBetween(launchDate, key) + 1); // pre-launch days show #1
}

// FNV-1a hash -> seed for a small deterministic PRNG, so the same date and
// the same bank always produce the same shuffle.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, rand) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Returns the prompts for `date`, creating and persisting the day's set the
// first time it is asked for. Rejected prompts are swapped out automatically.
function ensureDay(store, date, count) {
  const bank = store.bank.read();
  const schedule = store.schedule.read();
  const byId = new Map(bank.prompts.map((p) => [p.id, p]));
  const usable = (id) => byId.has(id) && byId.get(id).status !== "rejected";

  let ids = (schedule[date] || []).filter(usable).slice(0, count);

  if (ids.length < count) {
    const eligible = bank.prompts.filter(
      (p) => p.status !== "rejected" && !ids.includes(p.id),
    );
    const everUsed = new Set();
    const recentlyUsed = new Set();
    for (const [d, list] of Object.entries(schedule)) {
      if (d === date) continue;
      for (const id of list) {
        everUsed.add(id);
        if (Math.abs(daysBetween(d, date)) <= 14) recentlyUsed.add(id);
      }
    }
    const rand = mulberry32(hash32(date));
    const fresh = shuffled(
      eligible.filter((p) => !everUsed.has(p.id)),
      rand,
    );
    const rested = shuffled(
      eligible.filter((p) => everUsed.has(p.id) && !recentlyUsed.has(p.id)),
      rand,
    );
    const rest = shuffled(
      eligible.filter((p) => recentlyUsed.has(p.id)),
      rand,
    );
    const pool = [...fresh, ...rested, ...rest];

    // Prefer one prompt per category for variety, then fill with anything.
    const categories = new Set(ids.map((id) => byId.get(id).category));
    const chosen = [...ids];
    for (const p of pool) {
      if (chosen.length >= count) break;
      if (!categories.has(p.category)) {
        categories.add(p.category);
        chosen.push(p.id);
      }
    }
    for (const p of pool) {
      if (chosen.length >= count) break;
      if (!chosen.includes(p.id)) chosen.push(p.id);
    }
    ids = chosen;
  }

  if (JSON.stringify(schedule[date]) !== JSON.stringify(ids)) {
    schedule[date] = ids;
    store.schedule.write(schedule);
  }
  return ids.map((id) => byId.get(id));
}

module.exports = {
  dateKey,
  addDays,
  daysBetween,
  puzzleNumber,
  hash32,
  mulberry32,
  shuffled,
  ensureDay,
};
