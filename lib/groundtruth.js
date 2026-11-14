'use strict';

// Ground-truth lists we can build mechanically on the machine running the
// refill job. They are only used as a strict filter when they are large
// enough to be trusted; otherwise the LLM verifier decides.

const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { builtinModules } = require('node:module');
const { norm } = require('./matcher');

const MIN_TRUSTED_SIZE = 20;

const SOURCES = {
  // `git help -a` lists porcelain and plumbing commands in indented lines.
  git() {
    const out = execFileSync('git', ['help', '-a'], { encoding: 'utf8', timeout: 10000 });
    const names = [];
    for (const line of out.split('\n')) {
      const m = /^\s{2,}([a-z][a-z0-9-]+)\s{2,}\S/.exec(line);
      if (m) names.push(m[1]);
    }
    return names;
  },
  node() {
    return builtinModules.filter((m) => !m.startsWith('_'));
  },
  signals() {
    return Object.keys(os.constants.signals).flatMap((s) => [s, s.replace(/^SIG/, '')]);
  },
  python() {
    const out = execFileSync('python3', ['-c', 'import sys; print("\\n".join(sys.stdlib_module_names))'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    return out.split('\n').filter(Boolean);
  },
};

// category -> source name. Only categories listed here are filtered.
const CATEGORY_SOURCE = { git: 'git', node: 'node', linux: 'signals', python: 'python' };

// Returns a Set of normalized names, or null when no trusted source exists.
function loadGroundTruth(category) {
  const source = SOURCES[CATEGORY_SOURCE[category]];
  if (!source) return null;
  try {
    const names = source();
    if (names.length < MIN_TRUSTED_SIZE) return null;
    return new Set(names.map(norm));
  } catch {
    return null; // tool not installed: fall back to the LLM verifier alone
  }
}

module.exports = { loadGroundTruth };
