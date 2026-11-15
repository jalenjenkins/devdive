"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { makeGameEnv, answerFor } = require("./helpers");
const { createServer } = require("../lib/server");
const { openDatabase } = require("../lib/database");
const { loadConfig } = require("../lib/config");

test("production cannot silently use an ephemeral SQLite fallback", async () => {
  await assert.rejects(
    () => openDatabase(loadConfig({ NODE_ENV: "production" })),
    /Production requires DATABASE_URL/,
  );
});

async function boot(overrides = {}) {
  const env = await makeGameEnv({
    ADMIN_TOKEN: "test-admin-token",
    ...overrides,
  });
  const server = await createServer({
    config: env.config,
    database: env.db,
    catalog: env.catalog,
    now: () => env.clock.t,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  const call = async (
    path,
    { method = "GET", body, headers = {}, useCookie = true } = {},
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie && useCookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get("set-cookie") && useCookie)
      cookie = response.headers.get("set-cookie").split(";")[0];
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json, text, headers: response.headers };
  };
  return {
    env,
    server,
    base,
    call,
    getCookie: () => cookie,
    stop: async () => {
      await server.shutdown();
      fs.rmSync(env.dir, { recursive: true, force: true });
    },
  };
}

test("serves local assets, HEAD, cache validation, and security headers", async () => {
  const s = await boot();
  try {
    const page = await s.call("/");
    assert.equal(page.status, 200);
    assert.match(page.text, /Downstack/);
    assert.match(
      page.headers.get("content-security-policy"),
      /base-uri 'none'/,
    );
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.ok(page.headers.get("x-request-id"));
    assert.equal((await s.call("/ui.js")).status, 200);
    const font = await fetch(s.base + "/fonts/press-start-2p.ttf");
    assert.equal(font.headers.get("content-type"), "font/ttf");
    const art = await fetch(s.base + "/assets/shaft.png");
    assert.equal(art.headers.get("content-type"), "image/png");
    const head = await fetch(s.base + "/", { method: "HEAD" });
    assert.equal(await head.text(), "");
    assert.ok(Number(head.headers.get("content-length")) > 0);
    assert.equal(
      (
        await s.call("/", {
          headers: { "if-none-match": page.headers.get("etag") },
        })
      ).status,
      304,
    );
    assert.equal((await s.call("/..%2f..%2fpackage.json")).status, 404);
    assert.equal((await s.call("/data/catalog.json")).status, 404);
    assert.equal((await s.call("/api/health")).json.ok, true);
    assert.equal((await s.call("/api/ready")).json.storage, "sqlite");
  } finally {
    await s.stop();
  }
});

test("plays a complete HTTP round with a server cookie, stable retry, and replay", async () => {
  const s = await boot();
  try {
    const meta = await s.call("/api/meta");
    assert.equal(meta.json.tiers.length, 6);
    assert.equal(meta.json.layers.length, 7);
    const cookie = meta.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    let view = (
      await s.call("/api/start", {
        method: "POST",
        body: { name: "Grace", playerId: "client-id-is-ignored" },
      })
    ).json;
    assert.ok(!("answers" in view.prompt));
    let last;
    for (let i = 0; i < 7; i++) {
      const prompt = s.env.catalog.prompts.find((p) => p.id === view.prompt.id);
      const payload = {
        roundToken: view.roundToken,
        index: view.index,
        input: answerFor(prompt, 4),
      };
      last = await s.call("/api/answer", { method: "POST", body: payload });
      assert.equal(last.status, 200);
      assert.deepEqual(
        (await s.call("/api/answer", { method: "POST", body: payload })).json,
        last.json,
      );
      if (last.json.next) {
        assert.ok(!("prompt" in last.json.next));
        view = (
          await s.call("/api/next", {
            method: "POST",
            body: { roundToken: view.roundToken, index: last.json.next.index },
          })
        ).json;
      }
    }
    assert.equal(last.json.score, 385);
    assert.equal(last.json.depth, 2800);
    assert.equal(
      (await s.call("/api/start", { method: "POST", body: {} })).json.finished,
      true,
    );
    assert.equal(
      (await s.call("/api/leaderboard")).json.entries[0].name,
      "Grace",
    );
  } finally {
    await s.stop();
  }
});

test("client-supplied identity cannot select another player and foreign sessions cannot use tokens", async () => {
  const s = await boot();
  try {
    await s.call("/api/meta");
    const a = (
      await s.call("/api/start", { method: "POST", body: { playerId: "a" } })
    ).json;
    const same = (
      await s.call("/api/start", { method: "POST", body: { playerId: "b" } })
    ).json;
    assert.equal(a.roundToken, same.roundToken);
    const stolen = await s.call("/api/answer", {
      method: "POST",
      body: { roundToken: a.roundToken, index: 0, input: "anything" },
      useCookie: false,
    });
    assert.equal(stolen.status, 404);
  } finally {
    await s.stop();
  }
});

test("validates body types, size, origin, input length and content type", async () => {
  const s = await boot();
  try {
    assert.equal(
      (await s.call("/api/start", { method: "POST", body: { name: {} } }))
        .status,
      400,
    );
    assert.equal(
      (
        await s.call("/api/answer", {
          method: "POST",
          body: { roundToken: "bad", index: 0, input: "x".repeat(81) },
        })
      ).status,
      400,
    );
    assert.equal(
      (await s.call("/api/start", { method: "POST", body: [] })).status,
      400,
    );
    assert.equal(
      (
        await s.call("/api/start", {
          method: "POST",
          body: {},
          headers: { origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await s.call("/api/start", {
          method: "POST",
          body: {},
          headers: { "content-type": "text/plain" },
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await fetch(s.base + "/api/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{not json",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await s.call("/api/start", {
          method: "POST",
          body: { name: "x".repeat(20000) },
        })
      ).status,
      413,
    );
    assert.equal((await s.call("/", { method: "POST", body: {} })).status, 405);
  } finally {
    await s.stop();
  }
});

test("rate limit persists in storage and ignores spoofed leftmost forwarded IP", async () => {
  const s = await boot({ RATE_LIMIT_PER_MIN: "3", TRUST_PROXY_HOPS: "1" });
  try {
    for (let i = 0; i < 3; i++)
      assert.equal(
        (
          await s.call("/api/meta", {
            headers: { "x-forwarded-for": "1.2.3." + i + ", 10.0.0.1" },
          })
        ).status,
        200,
      );
    const blocked = await s.call("/api/meta", {
      headers: { "x-forwarded-for": "8.8.8.8, 10.0.0.1" },
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.equal((await s.call("/api/health")).status, 200);
  } finally {
    await s.stop();
  }
});

test("reports can be submitted and admin access is hidden without its token", async () => {
  const s = await boot();
  try {
    const v = (await s.call("/api/start", { method: "POST", body: {} })).json;
    await s.call("/api/answer", {
      method: "POST",
      body: { roundToken: v.roundToken, index: 0, input: "missing-answer-xyz" },
    });
    assert.equal(
      (
        await s.call("/api/report", {
          method: "POST",
          body: { roundToken: v.roundToken, index: 0, note: "Please check" },
        })
      ).status,
      200,
    );
    assert.equal((await s.call("/api/admin/reports")).status, 404);
    const reports = await s.call("/api/admin/reports", {
      headers: { "x-admin-token": "test-admin-token" },
    });
    assert.equal(reports.json.reports.length, 1);
    assert.equal(reports.json.reports[0].input, "missing-answer-xyz");
  } finally {
    await s.stop();
  }
});
