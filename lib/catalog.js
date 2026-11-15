"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { norm } = require("./matcher");
const { hash32, mulberry32, shuffled } = require("./daily");

function validateCatalog(catalog) {
  if (
    catalog.schemaVersion !== 1 ||
    !/^[a-f0-9]{24}$/.test(catalog.version || "") ||
    !Array.isArray(catalog.prompts)
  )
    throw new Error("Invalid catalog header");
  const ids = new Set();
  if (!Array.isArray(catalog.sources) || !catalog.sources.length)
    throw new Error("Catalog sources are missing");
  for (const source of catalog.sources) {
    if (
      !source.id ||
      !source.name ||
      !source.version ||
      !source.license ||
      new URL(source.url).protocol !== "https:"
    )
      throw new Error("Invalid source provenance");
  }
  const sourceIds = new Set(catalog.sources.map((s) => s.id));
  for (const prompt of catalog.prompts) {
    if (
      ids.has(prompt.id) ||
      !prompt.text ||
      !prompt.category ||
      !sourceIds.has(prompt.sourceId) ||
      prompt.answers.length < 8
    )
      throw new Error("Invalid prompt: " + prompt.id);
    ids.add(prompt.id);
    const forms = new Map();
    for (const answer of prompt.answers) {
      if (
        !answer.canonical ||
        answer.canonical.length > 80 ||
        !Number.isInteger(answer.tier) ||
        answer.tier < 1 ||
        answer.tier > 6
      )
        throw new Error("Invalid answer in " + prompt.id);
      for (const value of [answer.canonical, ...answer.aliases]) {
        const key = norm(value);
        if (!key || (forms.has(key) && forms.get(key) !== answer.canonical))
          throw new Error("Alias collision in " + prompt.id + ": " + value);
        forms.set(key, answer.canonical);
      }
    }
  }
  if (ids.size < 30 || new Set(catalog.prompts.map((p) => p.category)).size < 7)
    throw new Error("Catalog needs at least 30 prompts across 7 categories");
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({ sources: catalog.sources, prompts: catalog.prompts }),
    )
    .digest("hex")
    .slice(0, 24);
  if (digest !== catalog.version)
    throw new Error(
      "Catalog version does not match its content; run content:refresh",
    );
  return catalog;
}

function loadCatalog(
  file = path.join(__dirname, "..", "data", "catalog.json"),
) {
  return validateCatalog(JSON.parse(fs.readFileSync(file, "utf8")));
}

function choosePrompts(catalog, date, count, recentIds = []) {
  const recent = new Set(recentIds);
  const random = mulberry32(hash32(date + ":" + catalog.version));
  const pool = shuffled(catalog.prompts, random).sort(
    (a, b) => Number(recent.has(a.id)) - Number(recent.has(b.id)),
  );
  const selected = [],
    categories = new Set();
  for (const p of pool)
    if (!categories.has(p.category) && selected.length < count) {
      selected.push(p);
      categories.add(p.category);
    }
  for (const p of pool)
    if (selected.length < count && !selected.includes(p)) selected.push(p);
  return selected.map((p) => ({
    ...p,
    sourceDetails: catalog.sources.find((s) => s.id === p.sourceId),
  }));
}

module.exports = { loadCatalog, validateCatalog, choosePrompts };
