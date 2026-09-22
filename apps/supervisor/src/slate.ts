import { createHash } from 'node:crypto';
import { access, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { PROFILES, slateArgs, type ProfileId } from '@raelstream/media-node-adapter';
import { runOnce } from './process.js';

export interface SlateSpec {
  profile: ProfileId;
  text: string;
  subtext: string;
  background: string;
  accent: string;
}

/**
 * Render (or reuse) the fallback slate clip for a profile (SPEC §12.5). Cached by content hash; written
 * to a temp file first so MediaMTX never sees a partial file.
 */
export async function ensureSlate(
  ffmpegPath: string,
  dir: string,
  font: string,
  spec: SlateSpec,
): Promise<string> {
  const hash = createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16);
  const file = join(dir, `slate-${spec.profile}-${hash}.mp4`);
  try {
    await access(file);
    return file;
  } catch {
    /* render */
  }
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp.mp4`;
  const r = await runOnce(
    ffmpegPath,
    slateArgs(PROFILES[spec.profile], { outFile: tmp, fontFile: font, ...spec }),
  );
  if (r.code !== 0) throw new Error(`slate render failed: ${r.stderr.slice(-500)}`);
  await rename(tmp, file);
  return file;
}
