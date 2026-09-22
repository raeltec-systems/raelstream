/**
 * Owner CLI (run on the server): key generation and destination setup until the WP4 destination UI.
 *   keys:generate
 *   destination:add --platform youtube --label "YouTube church channel" --server rtmps://a.rtmps.youtube.com/live2 [--auto-publish yes|no|unknown] [--per-event]
 *     (the stream key is read from stdin so it never appears in shell history or process lists)
 *   destination:list
 */
import { parseArgs } from 'node:util';
import { generateKeypair, last4, seal } from '@raelstream/secrets';
import {
  validateServerUrl,
  validateStreamKey,
  type Platform,
} from '@raelstream/media-node-adapter';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'keys:generate') {
  const kp = await generateKeypair();
  console.log(`RS_SEAL_PUBLIC_KEY=${kp.publicKey}`);
  console.log(
    `# Secret key: store ONLY in the supervisor's secret file (RS_SEAL_SECRET_KEY_FILE), never in the repo or backups:`,
  );
  console.log(kp.secretKey);
  process.exit(0);
}

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
await migrate(db, cfg.migrationsDir);

if (cmd === 'destination:add') {
  const { values } = parseArgs({
    args: rest,
    options: {
      platform: { type: 'string' },
      label: { type: 'string' },
      server: { type: 'string' },
      'auto-publish': { type: 'string', default: 'unknown' },
      'per-event': { type: 'boolean', default: false },
      'watch-url': { type: 'string' },
    },
  });
  if (!cfg.sealPublicKey) throw new Error('RS_SEAL_PUBLIC_KEY is not set');
  const platform = values.platform as Platform;
  if (platform !== 'facebook' && platform !== 'youtube')
    throw new Error('--platform must be facebook or youtube');
  validateServerUrl(
    platform,
    values.server ?? '',
    undefined,
    process.env.RS_DEST_TEST_SINKS === '1' && !cfg.production,
  );
  const key = validateStreamKey(await readStdin());
  const row = await db
    .insertInto('destinations')
    .values({
      platform,
      label: values.label ?? platform,
      server_url: values.server!,
      key_enc: await seal(cfg.sealPublicKey, key),
      key_last4: last4(key),
      key_updated_at: new Date(),
      key_mode: values['per-event'] ? 'per_event' : 'persistent',
      auto_publishes_on_ingest: values['auto-publish'] as string,
      watch_url: values['watch-url'] ?? null,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  console.log(`added destination ${row.id} (${platform}, key ••••${last4(key)})`);
} else if (cmd === 'destination:list') {
  const rows = await db
    .selectFrom('destinations')
    .select(['id', 'platform', 'label', 'server_url', 'key_last4', 'enabled'])
    .where('archived_at', 'is', null)
    .execute();
  for (const r of rows)
    console.log(
      `${r.id}  ${r.platform.padEnd(9)} ${r.label}  ${r.server_url}  key ••••${r.key_last4 ?? '----'}${r.enabled ? '' : '  (disabled)'}`,
    );
} else {
  console.error('usage: cli.js keys:generate | destination:add ... | destination:list');
  process.exitCode = 2;
}
await db.destroy();
