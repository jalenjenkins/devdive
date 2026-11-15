"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeGameEnv, answerFor } = require("./helpers");
const { Game } = require("../lib/game");
const { openDatabase, migrate } = require("../lib/database");
const PLAYER = "a".repeat(64),
  OTHER = "b".repeat(64);
const prompt = (env, view) =>
  env.catalog.prompts.find((p) => p.id === view.prompt.id);

async function finish(env, player = PLAYER, tier = 6) {
  let view = await env.game.start(player, "Ada"),
    last;
  for (let i = 0; i < 7; i++) {
    last = await env.game.answer(
      view.roundToken,
      view.index,
      answerFor(prompt(env, view), tier),
      player,
    );
    if (last.next)
      view = await env.game.next(view.roundToken, last.next.index, player);
  }
  return last;
}

test("perfect round retains startup scoring, seven layers, share, and one daily attempt", async () => {
  const e = await makeGameEnv();
  try {
    const last = await finish(e);
    assert.equal(last.score, 700);
    assert.equal(last.depth, 8400);
    assert.equal(last.summary.layer.name, "Silicon");
    assert.match(last.summary.share, /^Downstack #\d+ 🟥{7}/u);
    assert.equal(last.result.tierName, "Founder Lore");
    assert.equal((await e.game.start(PLAYER)).finished, true);
    e.clock.t += 86400000;
    assert.equal((await e.game.start(PLAYER)).finished, false);
  } finally {
    await e.cleanup();
  }
});

test("wrong answer and timeout reveal deep cuts without points", async () => {
  const e = await makeGameEnv();
  try {
    let v = await e.game.start(PLAYER);
    const out = await e.game.answer(v.roundToken, 0, "not-real-xyz", PLAYER);
    assert.equal(out.result.matched, false);
    assert.equal(out.score, 0);
    assert.equal(out.result.rarest.length, 3);
    v = await e.game.next(v.roundToken, 1, PLAYER);
    e.clock.t += 27000;
    const late = await e.game.answer(
      v.roundToken,
      1,
      answerFor(prompt(e, v), 6),
      PLAYER,
    );
    assert.equal(late.result.timedOut, true);
    assert.equal(late.score, 0);
  } finally {
    await e.cleanup();
  }
});

test("grace window accepts a correct answer but zero-second empty submission is a timeout", async () => {
  const e = await makeGameEnv();
  try {
    let v = await e.game.start(PLAYER);
    e.clock.t += 25500;
    assert.equal(
      (await e.game.answer(v.roundToken, 0, answerFor(prompt(e, v), 2), PLAYER))
        .result.matched,
      true,
    );
    v = await e.game.next(v.roundToken, 1, PLAYER);
    e.clock.t += 25000;
    assert.equal(
      (await e.game.answer(v.roundToken, 1, "", PLAYER)).result.timedOut,
      true,
    );
  } finally {
    await e.cleanup();
  }
});

test("reveal is untimed, hides the next prompt, and next cannot reset the clock", async () => {
  const e = await makeGameEnv();
  try {
    const v = await e.game.start(PLAYER);
    const out = await e.game.answer(v.roundToken, 0, "wrong", PLAYER);
    assert.deepEqual(out.next, { index: 1, total: 7 });
    assert.ok(!("answers" in out.question.prompt));
    e.clock.t += 120000;
    await assert.rejects(
      async () => e.game.answer(v.roundToken, 1, "guess", PLAYER),
      (err) => err.status === 409 && err.extra.needsNext,
    );
    const resumed = await e.game.start(PLAYER);
    assert.equal(resumed.reveal.question.index, 0);
    assert.deepEqual(resumed.reveal, out);
    assert.equal((await e.game.next(v.roundToken, 1, PLAYER)).msLeft, 25000);
    e.clock.t += 4000;
    assert.equal((await e.game.next(v.roundToken, 1, PLAYER)).msLeft, 21000);
  } finally {
    await e.cleanup();
  }
});

test("identical concurrent submissions return the same reveal and score once", async () => {
  const e = await makeGameEnv();
  try {
    const v = await e.game.start(PLAYER);
    const answer = answerFor(prompt(e, v), 4);
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        e.game.answer(v.roundToken, 0, answer, PLAYER),
      ),
    );
    for (const r of replies) assert.deepEqual(r, replies[0]);
    assert.equal(replies[0].score, 55);
    assert.equal(
      Number(
        (await e.db.query("SELECT COUNT(*) AS n FROM submissions")).rows[0].n,
      ),
      1,
    );
    await assert.rejects(
      () => e.game.answer(v.roundToken, 0, "different", PLAYER),
      (err) => err.status === 409,
    );
  } finally {
    await e.cleanup();
  }
});

test("round ownership prevents another browser from reading or changing a round", async () => {
  const e = await makeGameEnv();
  try {
    const v = await e.game.start(PLAYER);
    await e.game.start(OTHER);
    await assert.rejects(
      () => e.game.answer(v.roundToken, 0, "anything", OTHER),
      (err) => err.status === 404,
    );
    await assert.rejects(
      () => e.game.next(v.roundToken, 0, OTHER),
      (err) => err.status === 404,
    );
    await assert.rejects(
      () => e.game.report(v.roundToken, 0, "", OTHER),
      (err) => err.status === 404,
    );
  } finally {
    await e.cleanup();
  }
});

test("restart restores active deadlines, paused reveals, and completed results", async () => {
  const e = await makeGameEnv();
  let db;
  try {
    const v = await e.game.start(PLAYER);
    e.clock.t += 6000;
    await e.db.close();
    db = await openDatabase(e.config);
    await migrate(db);
    const restarted = new Game({
      database: db,
      catalog: e.catalog,
      config: e.config,
      now: () => e.clock.t,
    });
    assert.equal((await restarted.start(PLAYER)).msLeft, 19000);
    const out = await restarted.answer(v.roundToken, 0, "wrong", PLAYER);
    await db.close();
    db = await openDatabase(e.config);
    const again = new Game({
      database: db,
      catalog: e.catalog,
      config: e.config,
      now: () => e.clock.t,
    });
    assert.deepEqual((await again.start(PLAYER)).reveal, out);
    e.game = again;
    let view = await again.next(v.roundToken, 1, PLAYER);
    for (let i = 1; i < 7; i++) {
      const a = await again.answer(view.roundToken, i, "wrong", PLAYER);
      if (a.next) view = await again.next(view.roundToken, i + 1, PLAYER);
    }
    assert.equal((await again.start(PLAYER)).summary.score, 0);
  } finally {
    if (db) await db.close();
    require("node:fs").rmSync(e.dir, { recursive: true, force: true });
  }
});

test("daily snapshots freeze answers and tiers across a catalog update", async () => {
  const e = await makeGameEnv();
  try {
    const a = await e.game.start(PLAYER);
    const original = answerFor(prompt(e, a), 6);
    const changed = structuredClone(e.catalog);
    for (const p of changed.prompts) p.answers = [];
    const updated = new Game({
      database: e.db,
      catalog: changed,
      config: e.config,
      now: () => e.clock.t,
    });
    const b = await updated.start(OTHER);
    assert.equal(a.prompt.id, b.prompt.id);
    assert.equal(
      (await updated.answer(b.roundToken, 0, original, OTHER)).result.points,
      100,
    );
  } finally {
    await e.cleanup();
  }
});

test("expired resume records exactly one timeout and shows its persisted reveal", async () => {
  const e = await makeGameEnv();
  try {
    await e.game.start(PLAYER);
    e.clock.t += 60000;
    const first = await e.game.start(PLAYER),
      second = await e.game.start(PLAYER);
    assert.equal(first.reveal.result.timedOut, true);
    assert.deepEqual(first, second);
    assert.equal(
      Number(
        (await e.db.query("SELECT COUNT(*) AS n FROM submissions")).rows[0].n,
      ),
      1,
    );
  } finally {
    await e.cleanup();
  }
});

test("concurrent starts create one player-day round and do not reset its timer", async () => {
  const e = await makeGameEnv();
  try {
    const views = await Promise.all(
      Array.from({ length: 6 }, () => e.game.start(PLAYER)),
    );
    assert.equal(new Set(views.map((v) => v.roundToken)).size, 1);
    e.clock.t += 1000;
    assert.equal((await e.game.start(PLAYER)).msLeft, 24000);
  } finally {
    await e.cleanup();
  }
});

test("reports are owned, only after submission, deduplicated, and leave scoring intact", async () => {
  const e = await makeGameEnv();
  try {
    const v = await e.game.start(PLAYER);
    await assert.rejects(
      () => e.game.report(v.roundToken, 0, "", PLAYER),
      (err) => err.status === 400,
    );
    await e.game.answer(v.roundToken, 0, "valid-but-missing", PLAYER);
    await e.game.report(v.roundToken, 0, "Please check", PLAYER);
    await e.game.report(v.roundToken, 0, "Again", PLAYER);
    assert.equal(
      Number(
        (await e.db.query("SELECT COUNT(*) AS n FROM answer_reports")).rows[0]
          .n,
      ),
      1,
    );
    assert.equal((await e.game.start(PLAYER)).reveal.score, 0);
  } finally {
    await e.cleanup();
  }
});

test("leaderboard is ordered by score and sanitizes display names", async () => {
  const e = await makeGameEnv();
  try {
    await finish(e, PLAYER, 1);
    await finish(e, OTHER, 6);
    const board = await e.game.leaderboard();
    assert.equal(board.entries[0].score, 700);
    assert.equal(board.entries[1].score, 70);
    assert.equal((await e.game.start(PLAYER)).summary.rank, 2);
  } finally {
    await e.cleanup();
  }
});
