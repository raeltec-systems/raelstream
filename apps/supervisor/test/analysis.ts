import { inImage } from './docker.js';

/** Frame-accurate output checks with ffprobe (SPEC §21 media harness). */
export async function probe(workdir: string, file: string) {
  const { stdout } = await inImage(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-of', 'json', `/work/${file}`],
    workdir,
  );
  return JSON.parse(stdout).streams as Array<Record<string, string | number>>;
}

export async function keyframeTimes(workdir: string, file: string): Promise<number[]> {
  const { stdout } = await inImage(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-skip_frame',
      'nokey',
      '-show_entries',
      'frame=pts_time',
      '-of',
      'csv=p=0',
      `/work/${file}`,
    ],
    workdir,
  );
  return stdout
    .split('\n')
    .map((l) => parseFloat(l))
    .filter((x) => Number.isFinite(x));
}

export async function videoPts(workdir: string, file: string): Promise<number[]> {
  const { stdout } = await inImage(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time',
      '-of',
      'csv=p=0',
      `/work/${file}`,
    ],
    workdir,
  );
  return stdout
    .split('\n')
    .map((l) => parseFloat(l))
    .filter((x) => Number.isFinite(x));
}

/** Times of white flash frames (mean luma > 150). */
export async function flashTimes(workdir: string, file: string): Promise<number[]> {
  const { stdout, stderr } = await inImage(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      `/work/${file}`,
      '-an',
      '-vf',
      'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
      '-f',
      'null',
      '-',
    ],
    workdir,
  );
  const text = stdout + stderr;
  const out: number[] = [];
  let t: number | null = null;
  for (const line of text.split('\n')) {
    const m = /pts_time:([\d.]+)/.exec(line);
    if (m) t = parseFloat(m[1]!);
    const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (y && t !== null && parseFloat(y[1]!) > 150) {
      if (out.length === 0 || t - out[out.length - 1]! > 0.5) out.push(t);
    }
  }
  return out;
}

/** Beep onsets = ends of silence. */
export async function beepOnsets(workdir: string, file: string): Promise<number[]> {
  const { stderr } = await inImage(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      `/work/${file}`,
      '-vn',
      '-af',
      'silencedetect=n=-30dB:d=0.3',
      '-f',
      'null',
      '-',
    ],
    workdir,
  );
  return [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => parseFloat(m[1]!));
}

/** Pair each flash with its nearest beep; returns audio−video offsets in ms. */
export function avOffsetsMs(flashes: number[], beeps: number[]): number[] {
  return flashes.flatMap((f) => {
    const b = beeps.reduce<number | null>(
      (best, x) => (best === null || Math.abs(x - f) < Math.abs(best - f) ? x : best),
      null,
    );
    return b !== null && Math.abs(b - f) < 0.5 ? [Math.round((b - f) * 1000)] : [];
  });
}
