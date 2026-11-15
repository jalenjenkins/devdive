"use strict";

const path = require("node:path");

function loadConfig(env = process.env) {
  const root = path.resolve(__dirname, "..");
  const int = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    root,
    databaseUrl: env.DATABASE_URL || "",
    databasePoolSize: Math.min(50, int(env.DB_POOL_SIZE, 10)),
    catalogFile: path.resolve(
      env.CATALOG_FILE || path.join(root, "data", "catalog.json"),
    ),
    publicOrigin: env.PUBLIC_ORIGIN || "",
    proxyHops: Math.min(
      5,
      int(env.TRUST_PROXY_HOPS, env.TRUST_PROXY === "1" ? 1 : 0),
    ),
    retentionDays: int(env.RETENTION_DAYS, 90),
    production: env.NODE_ENV === "production",
    allowProductionSqlite: env.ALLOW_SQLITE_IN_PRODUCTION === "1",
    port: int(env.PORT, 3000),
    dataDir: path.resolve(env.DATA_DIR || path.join(root, "data")),
    timezone: env.TIMEZONE || "UTC",
    questionSeconds: int(env.QUESTION_SECONDS, 25),
    questionsPerDay: Math.min(10, int(env.QUESTIONS_PER_DAY, 7)),
    graceMs: int(env.GRACE_MS, 1500),
    launchDate: env.LAUNCH_DATE || "2026-11-15",
    adminToken: env.ADMIN_TOKEN || "",
    trustProxy: env.TRUST_PROXY === "1",
    rateLimitPerMin: int(env.RATE_LIMIT_PER_MIN, 120),
    autoRefill: env.AUTO_REFILL === "1",
  };
}

module.exports = { loadConfig };
