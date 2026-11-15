"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("../lib/config");
const { openStore } = require("../lib/store");

// Each test gets its own data directory so nothing leaks between tests.
function makeEnv(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devdive-test-"));
  const config = loadConfig({ DATA_DIR: dir, ...overrides });
  const store = openStore(config);
  return {
    config,
    store,
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// Plays every prompt in a started round using the real answer bank.
function answerFor(prompt, tier) {
  const found = prompt.answers.find((a) => a.tier === tier);
  return found ? found.canonical : null;
}

async function makeGameEnv(overrides = {}) {
  const { openDatabase, migrate } = require("../lib/database");
  const { expandSeed } = require("../lib/seed");
  const { Game } = require("../lib/game");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downstack-db-test-"));
  const config = loadConfig({
    DATA_DIR: dir,
    RATE_LIMIT_PER_MIN: "1000",
    ...overrides,
  });
  const db = await openDatabase(config);
  await migrate(db);
  const catalog = {
    version: "a".repeat(24),
    sources: [
      {
        id: "fixture",
        name: "Test fixture",
        version: "1",
        url: "https://example.com",
      },
    ],
    rarityPolicy: "Editorial test tiers",
    prompts: expandSeed(require("../data/seed.json")).prompts.map((p) => ({
      ...p,
      sourceId: "fixture",
    })),
  };
  const clock = { t: Date.parse("2026-12-01T12:00:00Z") };
  const game = new Game({ database: db, catalog, config, now: () => clock.t });
  return {
    dir,
    config,
    db,
    catalog,
    clock,
    game,
    cleanup: async () => {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { makeEnv, makeGameEnv, answerFor };
