"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { loadConfig } = require("./config");
const { openDatabase, migrate } = require("./database");
const { loadCatalog } = require("./catalog");
const { Game, GameError } = require("./game");

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function createServer({
  config = loadConfig(),
  database,
  catalog,
  now = () => Date.now(),
} = {}) {
  const db = database || (await openDatabase(config));
  try {
    await migrate(db);
    catalog ||= loadCatalog(config.catalogFile);
  } catch (error) {
    if (!database) await db.close();
    throw error;
  }
  const game = new Game({ database: db, catalog, config, now });

  function send(res, status, body, extra = {}) {
    if (res.destroyed || res.headersSent) return;
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    });
    res.end(JSON.stringify(body));
  }

  function clientIp(req) {
    const remote = req.socket.remoteAddress || "unknown";
    if (!config.proxyHops) return remote;
    const chain = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const candidate = [...chain, remote].at(-1 - config.proxyHops);
    return candidate && net.isIP(candidate) ? candidate : remote;
  }

  function identity(req, res) {
    const value = /(?:^|;\s*)downstack\.sid=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
      req.headers.cookie || "",
    )?.[1];
    const token = value || crypto.randomBytes(32).toString("base64url");
    if (!value) {
      const secure =
        config.production ||
        req.socket.encrypted ||
        (config.proxyHops && req.headers["x-forwarded-proto"] === "https");
      res.setHeader(
        "set-cookie",
        "downstack.sid=" +
          token +
          "; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000" +
          (secure ? "; Secure" : ""),
      );
    }
    return hash(token);
  }

  async function rate(key, limit) {
    const start = Math.floor(now() / 60000) * 60000;
    const row = (
      await db.query(
        "INSERT INTO rate_limits(bucket_key,window_start,hits) VALUES($1,$2,1) ON CONFLICT(bucket_key,window_start) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits",
        [hash(key), start],
      )
    ).rows[0];
    if (Number(row.hits) > limit)
      throw new GameError(429, "Too many requests. Please wait a minute.");
  }

  async function json(req) {
    if (
      !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")
    )
      throw new GameError(415, "use application/json");
    const expected =
      config.publicOrigin ||
      (config.production ? "https://" : "http://") + req.headers.host;
    if (req.headers.origin && req.headers.origin !== expected)
      throw new GameError(403, "request origin is not allowed");
    if (Number(req.headers["content-length"] || 0) > 10240)
      throw new GameError(413, "request is too large");
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 10240) throw new GameError(413, "request is too large");
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new GameError(400, "invalid JSON");
    }
    if (!body || Array.isArray(body) || typeof body !== "object")
      throw new GameError(400, "JSON body must be an object");
    return body;
  }

  function admin(req) {
    const wanted = Buffer.from(config.adminToken || ""),
      given = Buffer.from(String(req.headers["x-admin-token"] || ""));
    if (
      !wanted.length ||
      wanted.length !== given.length ||
      !crypto.timingSafeEqual(wanted, given)
    )
      throw new GameError(404, "not found");
  }

  async function api(req, res, url) {
    const route = url.pathname;
    if (req.method === "GET" && route === "/api/health")
      return send(res, 200, { ok: true });
    if (req.method === "GET" && route === "/api/ready") {
      await db.query("SELECT 1");
      return send(res, 200, {
        ok: true,
        storage: db.dialect,
        catalogVersion: catalog.version,
      });
    }
    await rate("ip:" + clientIp(req), config.rateLimitPerMin);
    if (route.startsWith("/api/admin/")) {
      admin(req);
      if (req.method === "GET" && route === "/api/admin/reports") {
        const reports = (
          await db.query(
            "SELECT id,round_id,question_index,input,note,created_at FROM answer_reports ORDER BY created_at DESC LIMIT 100",
          )
        ).rows;
        return send(res, 200, { reports });
      }
      throw new GameError(404, "not found");
    }
    const player = identity(req, res);
    if (req.method === "GET" && route === "/api/meta")
      return send(res, 200, game.meta());
    if (req.method === "GET" && route === "/api/leaderboard")
      return send(res, 200, await game.leaderboard());
    if (req.method !== "POST") throw new GameError(404, "not found");
    const body = await json(req);
    if (route === "/api/start") {
      await rate("start:" + player, 12);
      return send(res, 200, await game.start(player, body.name ?? ""));
    }
    if (route === "/api/next")
      return send(
        res,
        200,
        await game.next(body.roundToken, body.index, player),
      );
    if (route === "/api/answer")
      return send(
        res,
        200,
        await game.answer(body.roundToken, body.index, body.input, player),
      );
    if (route === "/api/report") {
      await rate("report:" + player, 5);
      return send(
        res,
        200,
        await game.report(body.roundToken, body.index, body.note ?? "", player),
      );
    }
    throw new GameError(404, "not found");
  }

  async function serveStatic(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new GameError(400, "invalid URL");
    }
    if (decoded.includes("\0")) throw new GameError(404, "not found");
    const file = path.resolve(
      PUBLIC_DIR,
      decoded === "/" ? "index.html" : decoded.slice(1),
    );
    if (!file.startsWith(PUBLIC_DIR + path.sep))
      throw new GameError(404, "not found");
    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      throw new GameError(404, "not found");
    }
    if (!stat.isFile()) throw new GameError(404, "not found");
    const etag =
      '"' +
      stat.size.toString(16) +
      "-" +
      Math.trunc(stat.mtimeMs).toString(16) +
      '"';
    const headers = {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": /\.(png|svg|ttf)$/.test(file)
        ? "public, max-age=3600"
        : "no-cache",
      etag,
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, { ...headers, "content-length": stat.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  }

  const server = http.createServer(
    { maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 },
    async (req, res) => {
      const requestId = crypto.randomUUID();
      res.setHeader("x-request-id", requestId);
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader(
        "content-security-policy",
        "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      res.setHeader(
        "permissions-policy",
        "camera=(), microphone=(), geolocation=()",
      );
      if (config.production)
        res.setHeader("strict-transport-security", "max-age=31536000");
      try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname.startsWith("/api/")) return await api(req, res, url);
        if (!["GET", "HEAD"].includes(req.method))
          throw new GameError(405, "method not allowed");
        return await serveStatic(req, res, url.pathname);
      } catch (error) {
        if (error instanceof GameError)
          return send(
            res,
            error.status,
            { error: error.message, ...error.extra },
            error.status === 429 ? { "retry-after": "60" } : {},
          );
        console.error(
          JSON.stringify({
            event: "request_error",
            requestId,
            code: error.code || "internal",
          }),
        );
        send(res, 503, {
          error: "The game is temporarily unavailable. Please retry.",
          requestId,
        });
      }
    },
  );
  server.game = game;
  server.database = db;
  server.catalog = catalog;
  server.shutdown = async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await db.close();
  };
  return server;
}

module.exports = { createServer };
