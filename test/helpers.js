'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../lib/config');
const { openStore } = require('../lib/store');

// Each test gets its own data directory so nothing leaks between tests.
function makeEnv(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devdive-test-'));
  const config = loadConfig({ DATA_DIR: dir, ...overrides });
  const store = openStore(config);
  return { config, store, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Plays every prompt in a started round using the real answer bank.
function answerFor(prompt, tier) {
  const found = prompt.answers.find((a) => a.tier === tier);
  return found ? found.canonical : null;
}

module.exports = { makeEnv, answerFor };
