'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { makeEnv } = require('./helpers');
const { refill, extractJson } = require('../lib/refill');
const { retier, frequencyTier } = require('../lib/retier');
const { validatePrompt } = require('../lib/validate');

// A fake Messages API: the generator returns 44 answers (one of them bogus),
// the verifier approves everything except lines containing "bogus".
function fakeApi({ rejectAll = false, tooFew = false } = {}) {
  const seen = { generate: 0, verify: 0, keys: new Set() };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.keys.add(req.headers['x-api-key']);
      const body = JSON.parse(raw);
      const prompt = body.messages[0].content;
      let text;
      if (body.model.includes('haiku')) {
        seen.verify += 1;
        const lines = prompt.split('\n').filter((l) => /^\d+\. /.test(l));
        const results = lines.map((l, i) => ({ n: i + 1, valid: !rejectAll && !l.includes('bogus'), reason: 'ok' }));
        text = JSON.stringify({ results });
      } else {
        seen.generate += 1;
        const count = tooFew ? 8 : 44;
        const answers = Array.from({ length: count }, (_, i) => ({
          canonical: `item-${i}`,
          aliases: i === 3 ? ['item-0'] : [`it${i}`], // item-3's alias collides with item-0
          difficulty: 1 + (i % 10),
          evidence: 'spec',
        }));
        answers.push({ canonical: 'bogus-thing', aliases: [], difficulty: 9, evidence: 'made up' });
        text = `Here you go:\n${JSON.stringify({ answers })}`;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 2000 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

const silent = () => {};

test('refill generates verified prompts, drops bogus answers, and schedules days', async () => {
  const env = makeEnv();
  const api = await fakeApi();
  try {
    const report = await refill({
      store: env.store,
      config: env.config,
      env: { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: api.url },
      log: silent,
      maxNew: 2,
    });
    assert.equal(report.generated.length, 2);
    assert.equal(report.rejected.length, 0);
    assert.equal(report.calls, 4); // 2 prompts x (generate + verify)
    assert.ok(report.estimatedUsd > 0);
    assert.equal(report.scheduledDays.length, 2); // 15 unseen prompts -> two full days
    assert.deepEqual([...api.seen.keys], ['test-key']);

    const bank = env.store.bank.read();
    const made = bank.prompts.filter((p) => p.source === 'llm');
    assert.equal(made.length, 2);
    for (const p of made) {
      assert.equal(p.status, 'ready');
      assert.ok(!p.answers.some((a) => a.canonical === 'bogus-thing'));
      assert.equal(p.answers.length, 44);
      assert.deepEqual(validatePrompt(p, { minAnswers: 25 }), []);
      // the colliding alias must have been stripped from item-3
      assert.ok(!p.answers.find((a) => a.canonical === 'item-3').aliases.includes('item-0'));
    }
    assert.ok(env.store.meta.read().lastRefill);
  } finally {
    api.server.close();
    env.cleanup();
  }
});

test('refill stops at the API call budget instead of looping', async () => {
  const env = makeEnv();
  const api = await fakeApi();
  try {
    const report = await refill({
      store: env.store,
      config: env.config,
      env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: api.url, MAX_API_CALLS_PER_RUN: '3' },
      log: silent,
      maxNew: 5,
    });
    assert.equal(report.calls, 3);
    assert.match(report.stoppedEarly, /budget/);
    assert.equal(report.generated.length, 1);
  } finally {
    api.server.close();
    env.cleanup();
  }
});

test('refill rejects drafts that fail verification and gives up after repeated rejections', async () => {
  const env = makeEnv();
  const api = await fakeApi({ rejectAll: true });
  try {
    const report = await refill({
      store: env.store,
      config: env.config,
      env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: api.url },
      log: silent,
      maxNew: 3,
    });
    assert.equal(report.generated.length, 0);
    assert.equal(report.rejected.length, 5);
    assert.equal(report.stoppedEarly, 'too many rejected drafts');
    assert.equal(env.store.bank.read().prompts.filter((p) => p.source === 'llm').length, 0);
  } finally {
    api.server.close();
    env.cleanup();
  }
});

test('refill rejects drafts with too few answers', async () => {
  const env = makeEnv();
  const api = await fakeApi({ tooFew: true });
  try {
    const report = await refill({
      store: env.store,
      config: env.config,
      env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: api.url },
      log: silent,
      maxNew: 1,
    });
    assert.equal(report.generated.length, 0);
    assert.match(report.rejected[0].reason, /verified answers/);
  } finally {
    api.server.close();
    env.cleanup();
  }
});

test('refill refuses to run without an API key', async () => {
  const env = makeEnv();
  try {
    await assert.rejects(() => refill({ store: env.store, config: env.config, env: {}, log: silent }), /ANTHROPIC_API_KEY/);
  } finally {
    env.cleanup();
  }
});

test('extractJson tolerates prose and code fences around the object', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('no json here'));
});

test('retier moves answers toward observed frequency, never touches pinned ones', () => {
  const env = makeEnv();
  try {
    const bank = env.store.bank.read();
    const prompt = bank.prompts.find((p) => p.id === 'git-subcommands');
    const rare = prompt.answers.find((a) => a.canonical === 'cat-file'); // tier 5
    const pinned = prompt.answers.find((a) => a.canonical === 'replace'); // tier 6, pinned
    // Everyone answers "cat-file"; nobody answers anything else.
    for (let i = 0; i < 250; i++) {
      env.store.appendLog({ promptId: prompt.id, input: 'cat-file', canonical: 'cat-file', tier: 5 });
    }
    for (let i = 0; i < 6; i++) {
      env.store.appendLog({ promptId: prompt.id, input: 'git frobnicate', canonical: null, tier: null });
    }
    const result = retier({ store: env.store });
    const after = env.store.bank.read().prompts.find((p) => p.id === prompt.id);
    assert.ok(after.answers.find((a) => a.canonical === 'cat-file').tier < rare.tier);
    assert.equal(after.answers.find((a) => a.canonical === 'replace').tier, pinned.tier);
    assert.equal(result.changes.length, 1);
    assert.equal(result.unmatchedCandidates, 1);
  } finally {
    env.cleanup();
  }
});

test('retier does nothing until a prompt has enough plays', () => {
  const env = makeEnv();
  try {
    env.store.appendLog({ promptId: 'git-subcommands', input: 'commit', canonical: 'commit', tier: 1 });
    assert.equal(retier({ store: env.store }).changes.length, 0);
    assert.equal(frequencyTier(0, 10), 1);
    assert.equal(frequencyTier(9, 10), 5);
  } finally {
    env.cleanup();
  }
});
