#!/usr/bin/env node
'use strict';

// Usage: node scripts/refill-queue.js [--days 14] [--max-new 7] [--backfill]
// --backfill raises --max-new to fill the whole buffer in one run (about
// days * 7 prompts). Cap spend with MAX_API_CALLS_PER_RUN (default 40).

const { loadConfig } = require('../lib/config');
const { openStore } = require('../lib/store');
const { refill } = require('../lib/refill');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]) || fallback;
}

async function main() {
  const config = loadConfig();
  const store = openStore(config);
  const daysAhead = arg('days', 14);
  const backfill = process.argv.includes('--backfill');
  const maxNew = backfill ? daysAhead * config.questionsPerDay : arg('max-new', config.questionsPerDay);
  if (backfill && !process.env.MAX_API_CALLS_PER_RUN) {
    process.env.MAX_API_CALLS_PER_RUN = String(maxNew * 3 + 10);
  }
  const report = await refill({ store, config, daysAhead, maxNew });
  console.log(JSON.stringify(report, null, 2));
  if (report.stoppedEarly) console.log(`Stopped early: ${report.stoppedEarly}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
