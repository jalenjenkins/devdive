#!/usr/bin/env node
'use strict';

const { loadConfig } = require('../lib/config');
const { openStore } = require('../lib/store');
const { retier } = require('../lib/retier');

const store = openStore(loadConfig());
const { changes, unmatchedCandidates } = retier({ store });
for (const c of changes) console.log(`${c.prompt}: "${c.answer}" tier ${c.from} -> ${c.to}`);
console.log(`${changes.length} tier changes; ${unmatchedCandidates} frequent unmatched inputs written to unmatched-report.json`);
