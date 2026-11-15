"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase, migrate } = require("../lib/database");
const { loadConfig } = require("../lib/config");
const { loadCatalog } = require("../lib/catalog");
const { Game } = require("../lib/game");
const { maintenance } = require("../lib/maintenance");

test(
  "real PostgreSQL: concurrent instances, retry safety, restart, shared snapshots and retention",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    if (!/_test$/.test(url.pathname))
      throw new Error(
        "TEST_DATABASE_URL must point to a disposable database ending in _test",
      );
    const config = loadConfig({
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      RETENTION_DAYS: "1",
    });
    const a = await openDatabase(config),
      b = await openDatabase(config);
    let reopened;
    try {
      await Promise.all([migrate(a), migrate(b)]);
      await a.query("TRUNCATE TABLE players,daily_puzzles,rate_limits CASCADE");
      const catalog = loadCatalog(),
        clock = { t: Date.parse("2026-12-01T12:00:00Z") };
      const ga = new Game({ database: a, catalog, config, now: () => clock.t });
      const gb = new Game({ database: b, catalog, config, now: () => clock.t });
      const player = "d".repeat(64);
      const starts = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 ? ga : gb).start(player, "Postgres Test"),
        ),
      );
      assert.equal(new Set(starts.map((r) => r.roundToken)).size, 1);
      let view = starts[0];
      const answer = catalog.prompts.find((p) => p.id === view.prompt.id)
        .answers[0].canonical;
      const replies = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 ? ga : gb).answer(view.roundToken, 0, answer, player),
        ),
      );
      for (const reply of replies) assert.deepEqual(reply, replies[0]);
      assert.equal(
        Number((await a.query("SELECT COUNT(*) n FROM submissions")).rows[0].n),
        1,
      );
      const token = view.roundToken;
      await a.close();
      reopened = await openDatabase(config);
      const restored = new Game({
        database: reopened,
        catalog,
        config,
        now: () => clock.t,
      });
      assert.deepEqual((await restored.start(player)).reveal, replies[0]);
      clock.t += 60000;
      for (let i = 1; i < 7; i++) {
        view = await gb.next(token, i, player);
        assert.equal(view.msLeft, 25000);
        const p = catalog.prompts.find((p) => p.id === view.prompt.id);
        await restored.answer(token, i, p.answers[0].canonical, player);
      }
      const done = await gb.start(player);
      assert.equal(done.finished, true);
      assert.equal(
        Number((await b.query("SELECT COUNT(*) n FROM results")).rows[0].n),
        1,
      );
      assert.equal(
        (await restored.leaderboard()).entries[0].name,
        "Postgres Test",
      );
      const other = await restored.start("e".repeat(64));
      assert.equal(other.prompt.id, starts[0].prompt.id);
      await maintenance(b, config, clock.t + 2 * 86400000);
      assert.equal(
        Number((await b.query("SELECT COUNT(*) n FROM rounds")).rows[0].n),
        0,
      );
      assert.equal(
        Number((await b.query("SELECT COUNT(*) n FROM results")).rows[0].n),
        0,
      );
    } finally {
      await b.close();
      if (reopened) await reopened.close();
      else await a.close();
    }
  },
);
