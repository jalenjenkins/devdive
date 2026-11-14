'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./helpers');
const { ensureDay, dateKey, addDays, puzzleNumber } = require('../lib/daily');

test('dateKey respects the configured timezone', () => {
  const instant = new Date('2026-11-15T03:30:00Z');
  assert.equal(dateKey(instant, 'UTC'), '2026-11-15');
  assert.equal(dateKey(instant, 'America/New_York'), '2026-11-14');
});

test('addDays and puzzleNumber work across month boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(puzzleNumber('2026-11-15', '2026-11-15'), 1);
  assert.equal(puzzleNumber('2026-11-20', '2026-11-15'), 6);
});

test('the same date always yields the same set, and it is persisted', () => {
  const a = makeEnv();
  const b = makeEnv();
  try {
    const first = ensureDay(a.store, '2026-12-01', 7).map((p) => p.id);
    const again = ensureDay(a.store, '2026-12-01', 7).map((p) => p.id);
    const other = ensureDay(b.store, '2026-12-01', 7).map((p) => p.id);
    assert.deepEqual(first, again);
    assert.deepEqual(first, other); // same bank + date = same shuffle
    assert.equal(first.length, 7);
    assert.equal(new Set(first).size, 7);
    assert.deepEqual(a.store.schedule.read()['2026-12-01'], first);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('a day prefers one prompt per category', () => {
  const env = makeEnv();
  try {
    const set = ensureDay(env.store, '2026-12-02', 7);
    assert.equal(new Set(set.map((p) => p.category)).size, 7);
  } finally {
    env.cleanup();
  }
});

test('consecutive days use unseen prompts before repeating any', () => {
  const env = makeEnv();
  try {
    const day1 = ensureDay(env.store, '2026-12-03', 7).map((p) => p.id);
    const day2 = ensureDay(env.store, '2026-12-04', 7).map((p) => p.id);
    const overlap = day1.filter((id) => day2.includes(id));
    // 13 seed prompts: day 2 gets the 6 unseen ones first, then exactly 1 repeat.
    assert.equal(overlap.length, 1);
  } finally {
    env.cleanup();
  }
});

test('rejected prompts are swapped out of an already-built day', () => {
  const env = makeEnv();
  try {
    const before = ensureDay(env.store, '2026-12-05', 7).map((p) => p.id);
    const bank = env.store.bank.read();
    bank.prompts.find((p) => p.id === before[0]).status = 'rejected';
    env.store.bank.write(bank);
    const after = ensureDay(env.store, '2026-12-05', 7).map((p) => p.id);
    assert.equal(after.length, 7);
    assert.ok(!after.includes(before[0]));
    assert.deepEqual(after.slice(0, 6).sort(), before.slice(1).sort());
  } finally {
    env.cleanup();
  }
});
