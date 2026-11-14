'use strict';

// In-process daily refill for single-instance deployments (Fly.io, Railway,
// a VPS) where the data directory is a persistent volume. Checks hourly and
// runs the refill when it has been 22+ hours since the last one.

const { refill } = require('./refill');
const { retier } = require('./retier');

const CHECK_EVERY_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 22 * 60 * 60 * 1000;

function startScheduler({ config, store, env = process.env, log = console.log }) {
  if (!env.ANTHROPIC_API_KEY) {
    log('AUTO_REFILL is on but ANTHROPIC_API_KEY is not set; scheduler disabled');
    return null;
  }
  let running = false;

  async function maybeRun() {
    if (running) return;
    const last = Date.parse(store.meta.read().lastRefill || 0);
    if (Date.now() - last < MIN_GAP_MS) return;
    running = true;
    try {
      log('[refill] starting');
      const report = await refill({ store, config, env, log });
      const tiers = retier({ store });
      log(`[refill] done: ${JSON.stringify({ ...report, retiered: tiers.changes.length })}`);
    } catch (err) {
      log(`[refill] failed: ${err.message}`);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(maybeRun, CHECK_EVERY_MS);
  timer.unref();
  maybeRun();
  return timer;
}

module.exports = { startScheduler };
