"use strict";
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createServer } = require("../lib/server");
const { loadConfig } = require("../lib/config");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downstack-browser-"));
  const config = loadConfig({ DATA_DIR: dir, RATE_LIMIT_PER_MIN: "10000" });
  const server = await createServer({ config });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
    args: process.env.CI ? ["--no-sandbox"] : [],
  });
  const base = "http://127.0.0.1:" + server.address().port;
  fs.mkdirSync(path.join(__dirname, "..", "test-results"), { recursive: true });
  const capture = (page, name) =>
    page.screenshot({
      path: path.join(__dirname, "..", "test-results", name + ".png"),
      fullPage: true,
    });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(
      () => !document.querySelector("#start").disabled,
    );
    await page.evaluate(() => document.fonts.ready);
    assert.match(
      await page.locator("#content-count").textContent(),
      /source-backed prompts/,
    );
    await capture(page, "intro");
    let pending = page.waitForResponse((r) => r.url().endsWith("/api/start"));
    await page.locator("#name").fill("Browser QA");
    await page.locator("#start").click();
    let view = await (await pending).json();
    await page.locator("#screen-question").waitFor({ state: "visible" });
    assert.match(
      await page
        .locator("#q-text")
        .evaluate((e) => getComputedStyle(e).fontFamily),
      /Press Start 2P/,
    );
    await capture(page, "desktop");
    for (let i = 0; i < 7; i++) {
      const prompt = server.catalog.prompts.find(
        (p) => p.id === view.prompt.id,
      );
      const answer =
        i === 0
          ? "not-a-real-answer-xyz"
          : prompt.answers.find((a) => a.tier === 6)?.canonical ||
            prompt.answers[0].canonical;
      await page.locator("#answer").fill(answer);
      pending = page.waitForResponse((r) => r.url().endsWith("/api/answer"));
      await page.locator("#answer").press("Enter");
      const reply = await (await pending).json();
      await page.locator("#screen-reveal").waitFor({ state: "visible" });
      assert.ok(reply.result.source.url.startsWith("https://"));
      if (i === 0) {
        await page.locator("#report-answer").click();
        await page.waitForFunction(() =>
          document
            .querySelector("#report-status")
            .textContent.includes("Reported"),
        );
        await page.reload();
        await page.waitForFunction(
          () => !document.querySelector("#start").disabled,
        );
        await page.locator("#start").click();
        await page.locator("#screen-reveal").waitFor({ state: "visible" });
        assert.equal(
          await page.locator("#reveal-rank").textContent(),
          "Launch failed",
        );
        await capture(page, "reveal");
      }
      if (reply.next) {
        pending = page.waitForResponse((r) => r.url().endsWith("/api/next"));
        await page.locator("#next").click();
        view = await (await pending).json();
        await page.locator("#screen-question").waitFor({ state: "visible" });
      } else {
        await page.locator("#next").click();
        await page.locator("#screen-results").waitFor({ state: "visible" });
      }
    }
    assert.equal(await page.locator("#res-row li").count(), 7);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("blocked")) },
      }),
    );
    await page.locator("#copy").click();
    await page.locator("#share-text").waitFor({ state: "visible" });
    assert.match(await page.locator("#share-text").inputValue(), /^Downstack/);
    await capture(page, "results");
    for (const width of [320, 390, 760, 1024, 1280]) {
      const context = await browser.newContext({
          viewport: { width, height: 844 },
          reducedMotion: "reduce",
        }),
        mobile = await context.newPage();
      mobile.on("pageerror", (e) => errors.push(e.message));
      await mobile.goto(base);
      await mobile.waitForFunction(
        () => !document.querySelector("#start").disabled,
      );
      await mobile.locator("#start").click();
      await mobile.locator("#screen-question").waitFor({ state: "visible" });
      assert.ok(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      if (width === 390) await capture(mobile, "mobile");
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Browser checks passed: real catalog round, report, saved reveal after reload, pixel prompt, source links, clipboard fallback, 320–1440px.",
    );
  } finally {
    await browser.close();
    await server.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
