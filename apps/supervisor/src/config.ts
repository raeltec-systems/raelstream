import { readFileSync } from 'node:fs';

export interface SupervisorConfig {
  databaseUrl: string;
  ffmpegPath: string;
  mediamtxApi: string;
  mediamtxRtsp: string;
  /** Internal RTMP listener for the normalised programme (never published to the internet). */
  mediamtxRtmp: string;
  internalUser: string;
  internalPass: string;
  sealPublicKey: string;
  sealSecretKey: string;
  slateDir: string;
  slateFont: string;
  /** Permit rtmp://127.0.0.1 sinks: automated tests only, refused in production. */
  testSinks: boolean;
  tickMs: number;
}

export function loadConfig(env = process.env): SupervisorConfig {
  const need = (k: string, d?: string) => {
    const v = env[k] ?? d;
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  const production = env.NODE_ENV === 'production';
  const testSinks = env.RS_DEST_TEST_SINKS === '1';
  if (production && testSinks)
    throw new Error('RS_DEST_TEST_SINKS must not be enabled in production');
  const secret = env.RS_SEAL_SECRET_KEY_FILE
    ? readFileSync(env.RS_SEAL_SECRET_KEY_FILE, 'utf8').trim()
    : need('RS_SEAL_SECRET_KEY');
  return {
    databaseUrl: need('DATABASE_URL'),
    ffmpegPath: env.FFMPEG_PATH ?? 'ffmpeg',
    mediamtxApi: need('MEDIAMTX_API', 'http://127.0.0.1:9997'),
    mediamtxRtsp: need('MEDIAMTX_RTSP', 'rtsp://127.0.0.1:8554'),
    mediamtxRtmp: need('MEDIAMTX_RTMP', 'rtmp://127.0.0.1:1935'),
    internalUser: need('MEDIAMTX_INTERNAL_USER', production ? undefined : 'supervisor'),
    internalPass: need('MEDIAMTX_INTERNAL_PASS', production ? undefined : 'dev-internal'),
    sealPublicKey: need('RS_SEAL_PUBLIC_KEY'),
    sealSecretKey: secret,
    slateDir: need('SLATE_DIR', '/var/lib/raelstream/slates'),
    slateFont: need('SLATE_FONT', '/usr/share/fonts/raelstream/slate.ttf'),
    testSinks,
    tickMs: Number(env.RS_SUPERVISOR_TICK_MS ?? 500),
  };
}
