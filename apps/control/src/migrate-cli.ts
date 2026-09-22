import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
const ran = await migrate(db, cfg.migrationsDir);
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'up to date');
await db.destroy();
