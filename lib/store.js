'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expandSeed } = require('./seed');

class JsonFile {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return structuredClone(this.fallback);
      throw err;
    }
  }

  // Write to a temp file and rename so a crash never leaves half a file.
  write(data) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

function openStore(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const dir = config.dataDir;
  const bank = new JsonFile(path.join(dir, 'bank.json'), { version: 1, prompts: [] });
  const schedule = new JsonFile(path.join(dir, 'schedule.json'), {});
  const results = new JsonFile(path.join(dir, 'results.json'), []);
  const meta = new JsonFile(path.join(dir, 'meta.json'), {});
  const logFile = path.join(dir, 'answers-log.jsonl');

  // First run: build the live bank from the shipped seed.
  if (!fs.existsSync(bank.file)) {
    const seed = JSON.parse(fs.readFileSync(path.join(config.root, 'data', 'seed.json'), 'utf8'));
    bank.write(expandSeed(seed));
  }

  return {
    dir,
    bank,
    schedule,
    results,
    meta,
    logFile,
    appendLog(entry) {
      fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
    },
    readLog() {
      try {
        return fs
          .readFileSync(logFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
    },
  };
}

module.exports = { JsonFile, openStore };
