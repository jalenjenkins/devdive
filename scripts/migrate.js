"use strict";
const { loadConfig } = require("../lib/config");
const { openDatabase, migrate } = require("../lib/database");
(async () => {
  const db = await openDatabase(loadConfig());
  try {
    await migrate(db);
    console.log("Schema is ready:", db.dialect);
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
