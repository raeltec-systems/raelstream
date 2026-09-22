/** Prepare the e2e environment before the control server starts: fresh DB + MediaMTX container. */
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://raelstream:dev@localhost:55432/raelstream';
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query('drop database if exists rs_e2e with (force)');
await admin.query('create database rs_e2e');
await admin.end();

if (!process.env.RS_E2E_EXTERNAL_MEDIAMTX) {
  const name = 'rs-e2e-mediamtx';
  try {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  } catch {
    /* not running */
  }
  execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      name,
      '--network',
      'host',
      '-v',
      `${new URL('../../../infra/media/mediamtx.yml', import.meta.url).pathname}:/mediamtx.yml:ro`,
      '-e',
      'MTX_AUTHHTTPADDRESS=http://127.0.0.1:3000/internal/mediamtx/auth',
      '-e',
      'MTX_WEBRTCLOCALTCPADDRESS=',
      'bluenviron/mediamtx:1.21.1-ffmpeg',
    ],
    { stdio: 'ignore' },
  );
}
