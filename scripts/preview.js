"use strict";
const { loadConfig } = require("../lib/config");
const { openDatabase, migrate } = require("../lib/database");
const { loadCatalog, choosePrompts } = require("../lib/catalog");
const { dateKey, addDays } = require("../lib/daily");
(async () => {
  const config = loadConfig(),
    catalog = loadCatalog(config.catalogFile),
    db = await openDatabase(config);
  try {
    await migrate(db);
    const date =
      process.argv.find((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)) ||
      addDays(dateKey(new Date(), config.timezone), 1);
    const row = (
      await db.query("SELECT prompts FROM daily_puzzles WHERE puzzle_date=$1", [
        date,
      ])
    ).rows[0];
    const recent = (
      await db.query(
        "SELECT prompts FROM daily_puzzles WHERE puzzle_date >= $1 AND puzzle_date < $2",
        [addDays(date, -14), date],
      )
    ).rows.flatMap((r) => JSON.parse(r.prompts).map((p) => p.id));
    const prompts = row
      ? JSON.parse(row.prompts)
      : choosePrompts(catalog, date, config.questionsPerDay, recent);
    console.log(
      JSON.stringify(
        {
          date,
          frozen: Boolean(row),
          prompts: prompts.map((p) => ({
            id: p.id,
            text: p.text,
            category: p.category,
            source: p.sourceId,
            answers: p.answers.length,
            ...(process.argv.includes("--answers")
              ? { accepted: p.answers }
              : {}),
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
