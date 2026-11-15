"use strict";
const { loadConfig } = require("../lib/config");
const { openDatabase, migrate } = require("../lib/database");
const { maintenance } = require("../lib/maintenance");
(async () => {
  const config = loadConfig(),
    db = await openDatabase(config);
  try {
    await migrate(db);
    await maintenance(db, config);
    console.log(
      "Expired rate limits and records beyond the configured retention window were removed.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
