"use strict";

const { loadConfig } = require("./lib/config");
const { createServer } = require("./lib/server");
const { maintenance } = require("./lib/maintenance");

async function main() {
  const config = loadConfig();
  const server = await createServer({ config });
  await new Promise((resolve) =>
    server.listen(config.port, "0.0.0.0", resolve),
  );
  console.log(
    JSON.stringify({
      event: "listening",
      port: config.port,
      storage: server.database.dialect,
      catalogVersion: server.catalog.version,
      prompts: server.catalog.prompts.length,
    }),
  );
  if (config.production && !config.databaseUrl)
    console.warn(
      "SQLite requires a persistent DATA_DIR volume and a single app instance. Set DATABASE_URL to use shared PostgreSQL storage.",
    );
  const clean = () =>
    maintenance(server.database, config).catch((error) =>
      console.error("Maintenance failed:", error.code || "database error"),
    );
  const cleaner = setInterval(clean, 3600000);
  cleaner.unref();
  await clean();
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      clearInterval(cleaner);
      const timeout = setTimeout(() => {
        server.closeAllConnections();
      }, 10000);
      timeout.unref();
      await server.shutdown();
      clearTimeout(timeout);
    });
}
main().catch((error) => {
  console.error("Startup failed:", error.code || error.message);
  process.exitCode = 1;
});
