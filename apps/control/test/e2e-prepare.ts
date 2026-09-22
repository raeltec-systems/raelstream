/**
 * Prepare the e2e environment before the control server starts: fresh DB + MediaMTX container, and with
 * RS_E2E_BROADCAST=1 also two RTMP sink "platforms" and the supervisor container.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const repo = new URL('../../../', import.meta.url).pathname;
const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://raelstream:dev@localhost:55432/raelstream';
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query('drop database if exists rs_e2e with (force)');
await admin.query('create database rs_e2e');
await admin.end();

const docker = (args: string[]) => execFileSync('docker', args, { stdio: 'ignore' });
const rm = (...n: string[]) => {
  try {
    docker(['rm', '-f', ...n]);
  } catch {
    /* not running */
  }
};
rm('rs-e2e-mediamtx', 'rs-e2e-sink-a', 'rs-e2e-sink-b', 'rs-e2e-supervisor');

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
