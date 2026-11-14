'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, answerFor } = require('./helpers');
const { Game, GameError } = require('../lib/game');

const PLAYER = 'player-0001-aaaa';

function setup(overrides) {
  const env = makeEnv(overrides);
  const clock = { t: Date.parse('2026-12-01T12:00:00Z') };
  const game = new Game({ store: env.store, config: env.config, now: () => clock.t });
  return { ...env, game, clock };
}

// Looks up the real prompt (with answers) for a served question.
function promptOf(env, view) {
  return env.store.bank.read().prompts.find((p) => p.id === view.prompt.id);
}

test('a perfect-tier round scores and deepens as specified', () => {
  const env = setup();
  try {
    let view = env.game.start(PLAYER, 'Ada');
    assert.equal(view.finished, false);
    assert.equal(view.total, 7);
    assert.equal(view.layer.name, 'Browser');

    let last;
    for (let i = 0; i < 7; i++) {
      const prompt = promptOf(env, view);
      last = env.game.answer(view.roundToken, view.index, answerFor(prompt, 6));
      assert.equal(last.result.tier, 6);
      assert.equal(last.result.points, 100);
      if (last.next) view = last.next;
    }
    assert.equal(last.score, 700);
    assert.equal(last.depth, 8400);
    assert.equal(last.summary.layer.name, 'Silicon');
    assert.equal(last.summary.rank, 1);
    assert.equal(last.summary.emojiRow, '🟥'.repeat(7));
    assert.match(last.summary.share, /^DevDive #\d+ 🟥{7}/u);
  } finally {
    env.cleanup();
  }
});

test('wrong answers score zero and show deep cuts', () => {
  const env = setup();
  try {
    const view = env.game.start(PLAYER);
    const out = env.game.answer(view.roundToken, 0, 'definitely not a real answer xyz');
    assert.equal(out.result.matched, false);
    assert.equal(out.result.points, 0);
    assert.equal(out.result.rarest.length, 3);
    assert.equal(out.score, 0);
  } finally {
    env.cleanup();
  }
});

test('answering after the deadline counts as a timeout even with a correct answer', () => {
  const env = setup();
  try {
    const view = env.game.start(PLAYER);
    const prompt = promptOf(env, view);
    env.clock.t += (env.config.questionSeconds * 1000) + env.config.graceMs + 1;
    const out = env.game.answer(view.roundToken, 0, answerFor(prompt, 1));
    assert.equal(out.result.timedOut, true);
    assert.equal(out.result.matched, false);
    assert.equal(out.score, 0);
  } finally {
    env.cleanup();
  }
});

test('answering inside the grace window still counts', () => {
  const env = setup();
  try {
    const view = env.game.start(PLAYER);
    const prompt = promptOf(env, view);
    env.clock.t += env.config.questionSeconds * 1000 + 500;
    const out = env.game.answer(view.roundToken, 0, answerFor(prompt, 2));
    assert.equal(out.result.matched, true);
  } finally {
    env.cleanup();
  }
});

test('leaving mid-question forfeits it on return, and the clock cannot be reset', () => {
  const env = setup();
  try {
    const first = env.game.start(PLAYER);
    env.clock.t += 60 * 1000;
    const back = env.game.start(PLAYER);
    assert.equal(back.roundToken, first.roundToken);
    assert.equal(back.index, 1); // question 0 was forfeited
    assert.equal(back.tiers.length, 1);
    assert.equal(back.tiers[0], 0);
  } finally {
    env.cleanup();
  }
});

test('resuming mid-round keeps the same question and score', () => {
  const env = setup();
  try {
    const view = env.game.start(PLAYER);
    const prompt = promptOf(env, view);
    env.game.answer(view.roundToken, 0, answerFor(prompt, 3));
    const resumed = env.game.start(PLAYER);
    assert.equal(resumed.index, 1);
    assert.equal(resumed.score, 35);
  } finally {
    env.cleanup();
  }
});

test('one attempt per day: finishing blocks a replay but not tomorrow', () => {
  const env = setup();
  try {
    let view = env.game.start(PLAYER);
    for (let i = 0; i < 7; i++) {
      const out = env.game.answer(view.roundToken, view.index, 'nope');
      if (out.next) view = out.next;
    }
    const again = env.game.start(PLAYER);
    assert.equal(again.finished, true);
    env.clock.t += 24 * 3600 * 1000;
    const tomorrow = env.game.start(PLAYER);
    assert.equal(tomorrow.finished, false);
  } finally {
    env.cleanup();
  }
});

test('out-of-sync and unknown tokens are rejected', () => {
  const env = setup();
  try {
    const view = env.game.start(PLAYER);
    assert.throws(() => env.game.answer(view.roundToken, 3, 'x'), (e) => e instanceof GameError && e.status === 409);
    assert.throws(() => env.game.answer('nope', 0, 'x'), (e) => e instanceof GameError && e.status === 404);
    assert.throws(() => env.game.start('short'), (e) => e instanceof GameError && e.status === 400);
  } finally {
    env.cleanup();
  }
});

test('the question view never leaks answers', () => {
  const env = setup();
  try {
    const view = env.game.start(PLAYER);
    const text = JSON.stringify(view);
    const prompt = promptOf(env, view);
    for (const a of prompt.answers.filter((x) => x.canonical.length > 6)) {
      assert.ok(!text.includes(a.canonical), `view leaked "${a.canonical}"`);
    }
  } finally {
    env.cleanup();
  }
});

test('leaderboard orders by score then depth, and names are sanitized', () => {
  const env = setup();
  try {
    const play = (id, name, tier) => {
      let view = env.game.start(id, name);
      for (let i = 0; i < 7; i++) {
        const out = env.game.answer(view.roundToken, view.index, answerFor(promptOf(env, view), tier));
        if (out.next) view = out.next;
      }
    };
    play('player-low-0001', 'Low', 1);
    play('player-high-001', '<b>High</b>', 6);
    const board = env.game.leaderboard().entries;
    assert.equal(board[0].name, 'bHighb');
    assert.equal(board[0].rank, 1);
    assert.equal(board[1].name, 'Low');
  } finally {
    env.cleanup();
  }
});

test('answers are logged for the feedback loop', () => {
  const env = setup();
  try {
    const view = env.game.start(PLAYER);
    env.game.answer(view.roundToken, 0, 'some unmatched guess');
    const log = env.store.readLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].input, 'some unmatched guess');
    assert.equal(log[0].canonical, null);
  } finally {
    env.cleanup();
  }
});
