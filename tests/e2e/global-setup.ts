import { execFileSync } from 'node:child_process';

/** Teardown for the MediaMTX container started by apps/control/test/e2e-prepare.ts. */
export default async function globalSetup(): Promise<() => void> {
  return () => {
    if (process.env.RS_E2E_KEEP || process.env.RS_E2E_EXTERNAL_MEDIAMTX) return;
    try {
      execFileSync('docker', ['rm', '-f', 'rs-e2e-mediamtx'], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  };
}
