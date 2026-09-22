import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { Supervisor } from './supervisor.js';

const cfg = loadConfig();
const { db, pool } = createDb(cfg.databaseUrl);
const log = (level: string, msg: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...data }));
const sup = new Supervisor(cfg, db, log);

// LISTEN for desired-state changes; the timer covers missed notifications (SPEC §4.2).
const listener = await pool.connect();
await listener.query('listen desired_changed');
listener.on('notification', () => void sup.tick());

const timer = setInterval(() => void sup.tick(), cfg.tickMs);
log('info', 'supervisor started', { testSinks: cfg.testSinks, ffmpeg: cfg.ffmpegPath });

async function shutdown() {
  clearInterval(timer);
  await sup.shutdown();
  listener.release();
  await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
