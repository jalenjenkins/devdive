"use strict";
// A bounded local integration check, not a production capacity benchmark.
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { createServer } = require("../lib/server");
const { loadConfig } = require("../lib/config");
(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test$/.test(new URL(url).pathname))
    throw new Error(
      "Use a disposable PostgreSQL TEST_DATABASE_URL ending in _test",
    );
  const config = loadConfig({
    DATABASE_URL: url,
    RATE_LIMIT_PER_MIN: "10000",
    DB_POOL_SIZE: "10",
  });
  const servers = await Promise.all([
    createServer({ config }),
    createServer({ config }),
  ]);
  try {
    for (const s of servers)
      await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
    const bases = servers.map((s) => "http://127.0.0.1:" + s.address().port),
      durations = [];
    async function call(base, route, body, cookie) {
      const begin = performance.now();
      const r = await fetch(base + route, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json();
      durations.push(performance.now() - begin);
      assert.equal(r.status, 200, JSON.stringify(data));
      return {
        data,
        cookie: r.headers.get("set-cookie")?.split(";")[0] || cookie,
      };
    }
    const begin = performance.now();
    await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        const base = bases[i % 2],
          other = bases[(i + 1) % 2];
        const meta = await call(base, "/api/meta");
        const { data: view, cookie } = await call(
          base,
          "/api/start",
          { name: "Load test" },
          meta.cookie,
        );
        const input = servers[0].catalog.prompts.find(
          (p) => p.id === view.prompt.id,
        ).answers[0].canonical;
        const body = { roundToken: view.roundToken, index: 0, input };
        const results = await Promise.all([
          call(base, "/api/answer", body, cookie),
          call(other, "/api/answer", body, cookie),
        ]);
        assert.deepEqual(results[0].data, results[1].data);
        const next = await call(
          other,
          "/api/next",
          { roundToken: view.roundToken, index: 1 },
          cookie,
        );
        assert.equal(next.data.index, 1);
      }),
    );
    durations.sort((a, b) => a - b);
    console.log(
      JSON.stringify(
        {
          clients: 30,
          instances: 2,
          requests: durations.length,
          elapsedMs: Math.round(performance.now() - begin),
          p50Ms: Math.round(durations[Math.floor(durations.length * 0.5)]),
          p95Ms: Math.round(durations[Math.floor(durations.length * 0.95)]),
          note: "Local smoke test; not a hosting capacity guarantee.",
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(servers.map((s) => s.shutdown()));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
