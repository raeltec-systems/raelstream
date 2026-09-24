import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';
import { buildApp } from './app.js';
import { startObservedRelay } from './observed.js';
import { scheduleRetention } from './retention.js';
import { sweepRecordings } from './routes/recordings.js';

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
await migrate(db, cfg.migrationsDir);
const { app, hub } = await buildApp(cfg, db);
// Supervisor → studio: observed media state arrives via LISTEN/NOTIFY (SPEC §4.2).
const stopRelay = await startObservedRelay(cfg.databaseUrl, db, hub);
const stopRetention = scheduleRetention(
  db,
  (m, d) => console.log(JSON.stringify({ msg: m, ...d })),
  async () => ({ recordingSessions: await sweepRecordings(cfg) }),
);
await app.listen({ port: cfg.port, host: cfg.host });
console.log(`control listening on ${cfg.host}:${cfg.port}`);
const shutdown = async () => {
  stopRetention();
  await stopRelay();
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
