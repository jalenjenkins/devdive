'use strict';

const { loadConfig } = require('./lib/config');
const { openStore } = require('./lib/store');
const { createServer } = require('./lib/server');
const { startScheduler } = require('./lib/scheduler');

const config = loadConfig();
const store = openStore(config);
const server = createServer({ config, store });

server.listen(config.port, () => {
  console.log(`DevDive listening on http://localhost:${config.port} (data: ${config.dataDir})`);
});

if (config.autoRefill) startScheduler({ config, store });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
