"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadCatalog,
  validateCatalog,
  choosePrompts,
} = require("../lib/catalog");
const { csv } = require("../scripts/refresh-content");
const { match } = require("../lib/matcher");

test("shipped reference catalog has provenance, broad coverage and collision-free answers", () => {
  const c = loadCatalog();
  assert.ok(c.prompts.length >= 60);
  assert.ok(c.prompts.reduce((n, p) => n + p.answers.length, 0) > 3000);
  assert.equal(new Set(c.prompts.map((p) => p.category)).size, 9);
  for (const source of c.sources) {
    assert.ok(source.license && source.version);
    assert.match(source.url, /^https:\/\//);
  }
  for (const p of c.prompts)
    for (const a of p.answers)
      assert.equal(match(a.canonical, p.answers).answer.canonical, a.canonical);
});

test("source filters exclude private modules, deprecated HTML, and unassigned status codes", () => {
  const c = loadCatalog(),
    get = (id) =>
      c.prompts.find((p) => p.id === id).answers.map((a) => a.canonical);
  assert.ok(!get("node-modules").some((a) => a.startsWith("_")));
  assert.ok(get("node-modules").includes("fs"));
  assert.ok(!get("html-elements").includes("font"));
  assert.ok(get("html-elements").includes("dialog"));
  assert.ok(!get("http-status").includes("999"));
  assert.ok(get("http-status").includes("404"));
  assert.ok(get("python-keywords").includes("yield"));
});

test("daily selection is deterministic, category-balanced and avoids recent prompts", () => {
  const c = loadCatalog();
  const a = choosePrompts(c, "2026-12-01", 7),
    b = choosePrompts(c, "2026-12-01", 7);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((p) => p.category)).size, 7);
  const next = choosePrompts(
    c,
    "2026-12-02",
    7,
    a.map((p) => p.id),
  );
  assert.ok(next.filter((p) => a.some((q) => q.id === p.id)).length < 3);
});

test("catalog rejects a conflicting alias instead of silently accepting it", () => {
  const c = structuredClone(loadCatalog());
  const p = c.prompts[0];
  p.answers[0].aliases.push(p.answers[1].canonical);
  assert.throws(() => validateCatalog(c), /collision/);
});

test("CSV importer handles quoted commas, multiline fields and escaped quotes", () => {
  assert.deepEqual(
    csv('Name,Note\r\nA,"hello, world"\r\nB,"one\ntwo ""quoted"""\r\n'),
    [
      { Name: "A", Note: "hello, world" },
      { Name: "B", Note: 'one\ntwo "quoted"' },
    ],
  );
});
