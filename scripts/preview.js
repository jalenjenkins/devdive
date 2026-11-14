#!/usr/bin/env node
'use strict';

// Prints a day's set with answer counts and the rarest answers, for the
// two-minute review before it goes live. Usage: node scripts/preview.js [YYYY-MM-DD]

const { loadConfig } = require('../lib/config');
const { openStore } = require('../lib/store');
const { ensureDay, addDays, dateKey } = require('../lib/daily');

const config = loadConfig();
const store = openStore(config);
const date = process.argv[2] || addDays(dateKey(new Date(), config.timezone), 1);

console.log(`Set for ${date}`);
for (const p of ensureDay(store, date, config.questionsPerDay)) {
  const top = [...p.answers].sort((a, b) => b.tier - a.tier).slice(0, 5).map((a) => a.canonical);
  console.log(`- ${p.id} [${p.source}] ${p.text} (${p.answers.length} answers)`);
  console.log(`    rarest: ${top.join(', ')}`);
}
