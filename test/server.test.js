'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, answerFor } = require('./helpers');
const { createServer } = require('../lib/server');

async function boot(overrides) {
  const env = makeEnv({ ADMIN_TOKEN: 'secret-token', RATE_LIMIT_PER_MIN: '1000', ...overrides });
  const server = createServer({ config: env.config, store: env.store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    env.cleanup();
  };
  return { env, server, call, stop, base };
}

test('serves the front end with security headers', async () => {
  const s = await boot();
  try {
    const page = await s.call('/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Downstack/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await s.call('/app.js')).status, 200);
    assert.equal((await s.call('/style.css')).status, 200);
    assert.equal((await s.call('/ui.js')).status, 200);
    const font = await fetch(s.base + '/fonts/press-start-2p.ttf');
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/ttf');
    const art = await fetch(s.base + '/assets/shaft.png');
    assert.equal(art.status, 200);
    assert.equal(art.headers.get('content-type'), 'image/png');
  } finally {
    await s.stop();
  }
});

test('blocks path traversal', async () => {
  const s = await boot();
  try {
    const res = await s.call('/..%2f..%2fpackage.json');
    assert.equal(res.status, 404);
    assert.ok(!/devdive/.test(res.text) || !res.text.includes('"scripts"'));
  } finally {
    await s.stop();
  }
});

test('plays a full round over HTTP without ever seeing the answer bank early', async () => {
  const s = await boot();
  try {
    const meta = await s.call('/api/meta');
    assert.equal(meta.json.tiers.length, 6);
    assert.equal(meta.json.layers.length, 7);

    const start = await s.call('/api/start', { method: 'POST', body: { playerId: 'http-player-0001', name: 'Grace' } });
    assert.equal(start.status, 200);
    assert.equal(start.json.finished, false);
    assert.ok(!('answers' in start.json.prompt));

    const bank = s.env.store.bank.read();
    let view = start.json;
    let last;
    for (let i = 0; i < 7; i++) {
      const prompt = bank.prompts.find((p) => p.id === view.prompt.id);
      last = await s.call('/api/answer', {
        method: 'POST',
        body: { roundToken: view.roundToken, index: view.index, input: answerFor(prompt, 4) },
      });
      assert.equal(last.status, 200);
      assert.equal(last.json.result.points, 55);
      if (last.json.next) {
        assert.ok(!('prompt' in last.json.next));
        const next = await s.call('/api/next', { method: 'POST', body: { roundToken: view.roundToken, index: last.json.next.index } });
        assert.equal(next.status, 200);
        view = next.json;
      }
    }
    assert.equal(last.json.score, 385);
    assert.equal(last.json.summary.depth, 2800);
    assert.equal(last.json.summary.layer.name, 'Operating System');

    const replay = await s.call('/api/start', { method: 'POST', body: { playerId: 'http-player-0001' } });
    assert.equal(replay.json.finished, true);

    const board = await s.call('/api/leaderboard');
    assert.equal(board.json.entries[0].name, 'Grace');
    assert.equal(board.json.entries[0].score, 385);
  } finally {
    await s.stop();
  }
});

test('rejects bad input cleanly', async () => {
  const s = await boot();
  try {
    assert.equal((await s.call('/api/start', { method: 'POST', body: { playerId: 'x' } })).status, 400);
    assert.equal((await s.call('/api/answer', { method: 'POST', body: { roundToken: 'nope', index: 0, input: 'a' } })).status, 404);
    const bad = await fetch(`${s.base}/api/start`, { method: 'POST', body: '{not json', headers: { 'content-type': 'application/json' } });
    assert.equal(bad.status, 400);
    const big = await fetch(`${s.base}/api/start`, { method: 'POST', body: 'x'.repeat(50000) }).catch(() => null);
    assert.ok(big === null || big.status === 413);
    assert.equal((await s.call('/api/nothing')).status, 404);
    assert.equal((await s.call('/', { method: 'POST', body: {} })).status, 405);
  } finally {
    await s.stop();
  }
});

test('rate limiting returns 429', async () => {
  const s = await boot({ RATE_LIMIT_PER_MIN: '5' });
  try {
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await s.call('/api/health')).status;
    assert.equal(last, 429);
  } finally {
    await s.stop();
  }
});

test('admin routes are hidden without the token and work with it', async () => {
  const s = await boot();
  try {
    assert.equal((await s.call('/api/admin/preview')).status, 404);
    assert.equal((await s.call('/api/admin/preview', { headers: { 'x-admin-token': 'wrong' } })).status, 404);

    const ok = { 'x-admin-token': 'secret-token' };
    const preview = await s.call('/api/admin/preview?date=2027-01-01', { headers: ok });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.prompts.length, 7);

    const id = preview.json.prompts[0].id;
    const reject = await s.call('/api/admin/reject', { method: 'POST', body: { id }, headers: ok });
    assert.equal(reject.status, 200);
    const after = await s.call('/api/admin/preview?date=2027-01-01', { headers: ok });
    assert.ok(!after.json.prompts.some((p) => p.id === id));
    assert.equal(after.json.prompts.length, 7);
  } finally {
    await s.stop();
  }
});

test('admin routes stay off when no token is configured', async () => {
  const s = await boot({ ADMIN_TOKEN: '' });
  try {
    const res = await s.call('/api/admin/preview', { headers: { 'x-admin-token': '' } });
    assert.equal(res.status, 404);
  } finally {
    await s.stop();
  }
});
