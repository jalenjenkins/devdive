"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Both adapters expose async queries and transactions. SQLite serializes access
// to its one connection; PostgreSQL leases a connection for every transaction.
async function openDatabase(config) {
  if (
    config.production &&
    !config.databaseUrl &&
    !config.allowProductionSqlite
  ) {
    throw new Error(
      "Production requires DATABASE_URL. For one instance with a persistent DATA_DIR volume, explicitly set ALLOW_SQLITE_IN_PRODUCTION=1.",
    );
  }
  if (config.databaseUrl) {
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.databasePoolSize,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
    pool.on("error", (error) =>
      console.error("Database connection error:", error.code || "unknown"),
    );
    await pool.query("SELECT 1");
    return {
      dialect: "postgres",
      query: (sql, values = []) => pool.query(sql, values),
      async transaction(work) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await work({
            query: (sql, values = []) => client.query(sql, values),
            dialect: "postgres",
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(config.dataDir, { recursive: true });
  const connection = new DatabaseSync(
    path.join(config.dataDir, "downstack.sqlite"),
  );
  connection.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  let queue = Promise.resolve();
  function exclusive(work) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  async function query(sql, values = []) {
    const bound = [];
    sql = sql
      .replace(/\$(\d+)/g, (_, n) => {
        bound.push(values[Number(n) - 1]);
        return "?";
      })
      .replace(/ FOR UPDATE\b/g, "");
    const rows = connection.prepare(sql).all(...bound);
    return { rows, rowCount: rows.length };
  }
  return {
    dialect: "sqlite",
    query: (sql, values) => exclusive(() => query(sql, values)),
    transaction: (work) =>
      exclusive(async () => {
        connection.exec("BEGIN IMMEDIATE");
        try {
          const result = await work({ query, dialect: "sqlite" });
          connection.exec("COMMIT");
          return result;
        } catch (error) {
          connection.exec("ROLLBACK");
          throw error;
        }
      }),
    close: () => exclusive(() => connection.close()),
  };
}

async function migrate(db) {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "001-core.sql"),
    "utf8",
  );
  await db.transaction(async (tx) => {
    if (tx.dialect === "postgres")
      await tx.query("SELECT pg_advisory_xact_lock(734680211)");
    for (const sql of schema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await tx.query(sql);
  });
}

module.exports = { openDatabase, migrate };
