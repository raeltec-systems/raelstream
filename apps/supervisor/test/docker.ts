import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const SUPERVISOR_IMAGE = process.env.RS_SUPERVISOR_IMAGE ?? 'rs-supervisor:dev';
export const MEDIAMTX_IMAGE = 'bluenviron/mediamtx:1.21.1-ffmpeg';

export async function docker(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return exec('docker', args, { timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 });
}

export async function rm(...names: string[]): Promise<void> {
  await docker(['rm', '-f', ...names]).catch(() => undefined);
}

/** Run a one-off FFmpeg/ffprobe command in the supervisor image (same FFmpeg build as production). */
export async function inImage(
  entrypoint: 'ffmpeg' | 'ffprobe',
  args: string[],
  workdir: string,
  timeoutMs = 120_000,
) {
  return docker(
    [
      'run',
      '--rm',
      '--network',
      'host',
      '-v',
      `${workdir}:/work`,
      '--entrypoint',
      entrypoint,
      SUPERVISOR_IMAGE,
      ...args,
    ],
    { timeoutMs },
  );
}

export async function logs(name: string): Promise<string> {
  const r = await docker(['logs', '--tail', '80', name]).catch((e) => ({
    stdout: '',
    stderr: String(e),
  }));
  return r.stdout + r.stderr;
}
