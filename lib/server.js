'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { openStore } = require('./store');
const { Game, GameError } = require('./game');
const { ensureDay, addDays } = require('./daily');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
};
const MAX_BODY = 10 * 1024;

function createServer({ config = loadConfig(), store = openStore(config), now = () => Date.now() } = {}) {
  const game = new Game({ store, config, now });
  const hits = new Map(); // ip -> { count, resetAt }

  const sweeper = setInterval(() => {
    game.sweep();
    const t = now();
    for (const [ip, h] of hits) if (h.resetAt < t) hits.delete(ip);
  }, 10 * 60 * 1000);
  sweeper.unref();

  function send(res, status, body, headers = {}) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    });
    res.end(payload);
  }

  function clientIp(req) {
    if (config.trustProxy) {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function rateLimited(req) {
    const ip = clientIp(req);
    const t = now();
    let h = hits.get(ip);
    if (!h || h.resetAt < t) {
      h = { count: 0, resetAt: t + 60000 };
      hits.set(ip, h);
    }
    h.count += 1;
    return h.count > config.rateLimitPerMin;
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new GameError(413, 'body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (size === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new GameError(400, 'invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  function adminAllowed(req) {
    if (!config.adminToken) return false;
    const given = Buffer.from(String(req.headers['x-admin-token'] || ''));
    const wanted = Buffer.from(config.adminToken);
    return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
  }

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(PUBLIC_DIR, rel);
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'not found' });
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    });
  }

  async function handleApi(req, res, url) {
    const { pathname } = url;

    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && pathname === '/api/meta') return send(res, 200, game.meta());
    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      return send(res, 200, game.leaderboard(game.today()));
    }
    if (req.method === 'POST' && pathname === '/api/start') {
      const body = await readJson(req);
      return send(res, 200, game.start(body.playerId, body.name));
    }
    if (req.method === 'POST' && pathname === '/api/answer') {
      const body = await readJson(req);
      return send(res, 200, game.answer(body.roundToken, body.index, body.input));
    }
    if (req.method === 'POST' && pathname === '/api/next') {
      const body = await readJson(req);
      return send(res, 200, game.next(body.roundToken, body.index));
    }

    // ---- admin: preview tomorrow's set and veto prompts -----------------
    if (pathname.startsWith('/api/admin/')) {
      if (!adminAllowed(req)) return send(res, 404, { error: 'not found' });
      if (req.method === 'GET' && pathname === '/api/admin/preview') {
        const date = url.searchParams.get('date') || addDays(game.today(), 1);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GameError(400, 'bad date');
        const prompts = ensureDay(store, date, config.questionsPerDay);
        return send(res, 200, {
          date,
          prompts: prompts.map((p) => ({
            id: p.id,
            text: p.text,
            source: p.source,
            answerCount: p.answers.length,
            topAnswers: [...p.answers].sort((a, b) => b.tier - a.tier).slice(0, 5).map((a) => a.canonical),
          })),
        });
      }
      if (req.method === 'POST' && pathname === '/api/admin/reject') {
        const body = await readJson(req);
        const bank = store.bank.read();
        const prompt = bank.prompts.find((p) => p.id === body.id);
        if (!prompt) throw new GameError(404, 'unknown prompt id');
        prompt.status = 'rejected';
        store.bank.write(bank);
        return send(res, 200, { ok: true, id: prompt.id });
      }
    }

    return send(res, 404, { error: 'not found' });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    );
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (rateLimited(req)) return send(res, 429, { error: 'too many requests' });
        return await handleApi(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      if (err instanceof GameError) return send(res, err.status, { error: err.message, ...err.extra });
      console.error(err);
      return send(res, 500, { error: 'internal error' });
    }
  });

  server.game = game;
  server.store = store;
  server.on('close', () => clearInterval(sweeper));
  return server;
}

module.exports = { createServer };
