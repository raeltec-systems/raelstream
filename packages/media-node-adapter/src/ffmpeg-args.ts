import type { OutputProfile } from './profiles.js';

/**
 * FFmpeg argument builders. Always argument arrays: nothing is ever passed through a shell (B§23.3).
 * `-progress pipe:3` reports machine-readable progress on fd 3.
 */
const COMMON = ['-hide_banner', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:3'];

/** x264 output settings shared by the normaliser and the slate renderer so they are codec-compatible. */
export function videoEncodeArgs(p: OutputProfile): string[] {
  const kbps = Math.round(p.videoBitrate / 1000);
  const gop = p.fps * p.keyframeSeconds;
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-profile:v',
    'main',
    '-level:v',
    p.height >= 1080 ? '4.1' : '3.1',
    '-bf',
    '0',
    '-b:v',
    `${kbps}k`,
    '-maxrate',
    `${kbps}k`,
    '-bufsize',
    `${kbps * 2}k`,
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-sc_threshold',
    '0',
    '-force_key_frames',
    `expr:gte(t,n_forced*${p.keyframeSeconds})`,
    '-pix_fmt',
    'yuv420p',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
  ];
}

export function audioEncodeArgs(p: OutputProfile): string[] {
  return [
    '-c:a',
    'aac',
    '-b:a',
    `${Math.round(p.audioBitrate / 1000)}k`,
    '-ar',
    String(p.audioRate),
    '-ac',
    '2',
  ];
}

export function scaleFilter(p: OutputProfile): string {
  return `scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${p.fps},format=yuv420p`;
}

function inputArgs(url: string): string[] {
  return url.startsWith('rtsp')
    ? ['-rtsp_transport', 'tcp', '-timeout', '5000000', '-i', url]
    : ['-rw_timeout', '5000000', '-i', url];
}

/**
 * Normaliser: contribution (WebRTC H.264/VP8 + Opus, read via RTSP) → one shared H.264/AAC programme
 * (SPEC §12.3). Output goes to MediaMTX over RTMP: measured A/V offset 2–6 ms, versus 38–121 ms when
 * republishing AAC over RTSP (ADR-0003). Audio is resampled without timestamp warping.
 */
export function normaliserArgs(p: OutputProfile, inputUrl: string, outputUrl: string): string[] {
  return [
    ...COMMON,
    ...inputArgs(inputUrl),
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-vf',
    scaleFilter(p),
    ...videoEncodeArgs(p),
    '-af',
    `aresample=${p.audioRate}`,
    ...audioEncodeArgs(p),
    '-f',
    'flv',
    '-flvflags',
    'no_duration_filesize',
    outputUrl,
  ];
}

/** Publisher: copy/remux the shared normalised stream to one destination (SPEC §12.4). */
export function publisherArgs(inputUrl: string, destinationUrl: string): string[] {
  return [
    ...COMMON,
    ...inputArgs(inputUrl),
    '-map',
    '0',
    '-c',
    'copy',
    '-f',
    'flv',
    '-flvflags',
    'no_duration_filesize',
    '-rw_timeout',
    '10000000',
    destinationUrl,
  ];
}

/** Escape text for the drawtext filter (used only for the slate; content is operator-supplied). */
export function drawtextEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,');
}

/**
 * Fallback slate clip matching the output profile exactly, so MediaMTX's always-available switch is
 * codec-compatible (SPEC §12.5). Background colour + optional image + text, silent AAC track.
 */
export function slateArgs(
  p: OutputProfile,
  o: {
    outFile: string;
    fontFile: string;
    text: string;
    subtext: string;
    background: string;
    accent: string;
    imageFile?: string;
    seconds?: number;
  },
): string[] {
  const secs = o.seconds ?? 10;
  const bg = o.background.replace('#', '0x');
  const accent = o.accent.replace('#', '0x');
  const big = Math.round(p.height * 0.115);
  const small = Math.round(p.height * 0.04);
  const bar = Math.max(6, Math.round(p.height * 0.017));
  const inputs = [
    '-f',
    'lavfi',
    '-i',
    `color=c=${bg}:s=${p.width}x${p.height}:r=${p.fps}:d=${secs}`,
  ];
  let head = '[0:v]';
  if (o.imageFile) {
    inputs.push('-loop', '1', '-t', String(secs), '-i', o.imageFile);
    const box = Math.round(p.height * 0.2);
    head = `[1:v]scale=${box}:${box}:force_original_aspect_ratio=decrease[logo];[0:v][logo]overlay=(W-w)/2:H*0.23,`;
  }
  const font = o.fontFile.replace(/:/g, '\\:');
  const filter =
    `${head}drawtext=fontfile='${font}':text='${drawtextEscape(o.text)}':fontcolor=0xF7F6F0:fontsize=${big}:x=(w-text_w)/2:y=h*0.53-text_h/2` +
    (o.subtext
      ? `,drawtext=fontfile='${font}':text='${drawtextEscape(o.subtext)}':fontcolor=0xB9BFB9:fontsize=${small}:x=(w-text_w)/2:y=h*0.64`
      : '') +
    `,drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=${accent}:t=fill,format=yuv420p[v]`;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputs,
    '-f',
    'lavfi',
    '-i',
    `anullsrc=channel_layout=stereo:sample_rate=${p.audioRate}`,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    `${o.imageFile ? 2 : 1}:a`,
    '-t',
    String(secs),
    ...videoEncodeArgs(p),
    ...audioEncodeArgs(p),
    '-movflags',
    '+faststart',
    o.outFile,
  ];
}
