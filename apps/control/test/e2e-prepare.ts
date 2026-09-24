/**
 * Prepare the e2e environment before the control server starts: fresh DB + MediaMTX container, and with
 * RS_E2E_BROADCAST=1 also two RTMP sink "platforms" and the supervisor container.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { loadConfig } from '../src/config.js';
import { AuthService } from '../src/auth.js';

const E2E_USERS_FILE = join(tmpdir(), 'rs-e2e-users.json');

const repo = new URL('../../../', import.meta.url).pathname;
const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://raelstream:dev@localhost:55432/raelstream';
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query('drop database if exists rs_e2e with (force)');
await admin.query('create database rs_e2e');
await admin.end();

// Seed accounts (SPEC §6.1). One owner per spec keeps TOTP replay protection out of the way. The
// secrets are TEST-ONLY and written next to the other e2e scratch state for the specs to read.
const db = createDb(adminUrl.replace(/\/[^/]+$/, '/rs_e2e'));
await migrate(db, new URL('../../../infra/migrations', import.meta.url).pathname);
const auth = new AuthService(db, loadConfig(process.env).totpKey);
const users: Record<string, { email: string; password: string; secret: string }> = {};
for (const key of ['spine', 'broadcast', 'invite', 'audio', 'phone', 'reconnect', 'content']) {
  const email = `${key}@e2e.test`;
  const password = 'correct horse battery staple';
  const r = await auth.createUser({ email, name: 'Chanda', role: 'owner', password });
  users[key] = { email, password, secret: r.enrolment.secret };
}
await db.destroy();
writeFileSync(E2E_USERS_FILE, JSON.stringify(users));

const docker = (args: string[]) => execFileSync('docker', args, { stdio: 'ignore' });
const rm = (...n: string[]) => {
  try {
    docker(['rm', '-f', ...n]);
  } catch {
    /* not running */
  }
};
rm('rs-e2e-mediamtx', 'rs-e2e-sink-a', 'rs-e2e-sink-b', 'rs-e2e-supervisor', 'rs-e2e-turn');

/**
 * RS_E2E_RELAY=1 reproduces the Codespaces topology: MediaMTX advertises only an unroutable host
 * address, so the contribution can only flow through a TURN relay on both sides (coturn stands in
 * for Cloudflare TURN).
 */
const relay = process.env.RS_E2E_RELAY === '1';
const relayEnv = relay
  ? [
      ['MTX_WEBRTCIPSFROMINTERFACES', 'false'],
      ['MTX_WEBRTCADDITIONALHOSTS', '192.0.2.1'],
      ['MTX_WEBRTCICESERVERS2_0_URL', 'turn:127.0.0.1:3479?transport=udp'],
      ['MTX_WEBRTCICESERVERS2_0_USERNAME', 'rs'],
      ['MTX_WEBRTCICESERVERS2_0_PASSWORD', 'rs-e2e-relay'],
    ].flatMap(([k, v]) => ['-e', `${k}=${v}`])
  : [];
if (relay) {
  docker([
    'run',
    '-d',
    '--name',
    'rs-e2e-turn',
    '--network',
    'host',
    'coturn/coturn:4.7',
    '-n',
    '--listening-ip=127.0.0.1',
    '--relay-ip=127.0.0.1',
    '--listening-port=3479',
    '--min-port=49160',
    '--max-port=49200',
    '--lt-cred-mech',
    '--user=rs:rs-e2e-relay',
    '--realm=raelstream.test',
    '--allow-loopback-peers',
    // MediaMTX's host candidates are private addresses; refusing them leaves relay ↔ relay as the only
    // route, as in a Codespace where the media node is not reachable from outside.
    '--denied-peer-ip=10.0.0.0-10.255.255.255',
    '--denied-peer-ip=172.16.0.0-172.31.255.255',
    '--denied-peer-ip=192.168.0.0-192.168.255.255',
    '--denied-peer-ip=192.0.2.0-192.0.2.255',
    '--no-tls',
    '--no-dtls',
    '--no-cli',
  ]);
}

if (!process.env.RS_E2E_EXTERNAL_MEDIAMTX) {
  const slates = mkdtempSync(join(tmpdir(), 'rs-e2e-slates-'));
  chmodSync(slates, 0o777);
  docker([
    'run',
    '-d',
    '--name',
    'rs-e2e-mediamtx',
    '--network',
    'host',
    '-v',
    `${repo}infra/media/mediamtx.yml:/mediamtx.yml:ro`,
    '-v',
    `${slates}:/var/lib/raelstream/slates:ro`,
    '-e',
    'MTX_AUTHHTTPADDRESS=http://127.0.0.1:3000/internal/mediamtx/auth',
    '-e',
    'MTX_WEBRTCLOCALTCPADDRESS=',
    ...relayEnv,
    'bluenviron/mediamtx:1.21.1-ffmpeg',
  ]);
  if (process.env.RS_E2E_BROADCAST === '1') {
    for (const [name, rtmp, api] of [
      ['rs-e2e-sink-a', 1936, 9998],
      ['rs-e2e-sink-b', 1937, 9999],
    ] as const) {
      docker([
        'run',
        '-d',
        '--name',
        name,
        '--network',
        'host',
        '-v',
        `${repo}infra/media/test-sink.yml:/mediamtx.yml:ro`,
        '-e',
        `MTX_RTMPADDRESS=:${rtmp}`,
        '-e',
        `MTX_APIADDRESS=127.0.0.1:${api}`,
        'bluenviron/mediamtx:1.21.1-ffmpeg',
      ]);
    }
    docker([
      'run',
      '-d',
      '--name',
      'rs-e2e-supervisor',
      '--network',
      'host',
      '-v',
      `${slates}:/var/lib/raelstream/slates`,
      '-e',
      `DATABASE_URL=${adminUrl.replace(/\/[^/]+$/, '/rs_e2e').replace('localhost', '127.0.0.1')}`,
      '-e',
      'NODE_ENV=test',
      '-e',
      'RS_DEST_TEST_SINKS=1',
      '-e',
      'MEDIAMTX_RTMP=rtmp://127.0.0.1:1935',
      '-e',
      `RS_SEAL_PUBLIC_KEY=${process.env.RS_SEAL_PUBLIC_KEY}`,
      '-e',
      `RS_SEAL_SECRET_KEY=${process.env.RS_E2E_SEAL_SECRET_KEY}`,
      process.env.RS_SUPERVISOR_IMAGE ?? 'rs-supervisor:dev',
    ]);
  }
}
