import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
await migrate(db, cfg.migrationsDir);
const { app } = await buildApp(cfg, db);
await app.listen({ port: cfg.port, host: cfg.host });
console.log(
  `control listening on ${cfg.host}:${cfg.port}${cfg.devAuth ? ' (DEV AUTH ENABLED)' : ''}`,
);
const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
