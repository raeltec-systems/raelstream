import { loadTotpKey } from './sealing.js';
import { transportPolicy, turnConfigFromEnv, type TurnConfig } from './turn.js';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Public origin of the app (used for pairing URLs and Origin/CSRF checks). */
  publicOrigin: string;
  /** Public base for WHIP, e.g. https://stream.example.org/whip */
  whipPublicBase: string;
  /** Shared secret MediaMTX's internal readers (supervisor) present. */
  mediamtxInternalUser: string;
  mediamtxInternalPass: string;
  /** AES-256-GCM key for TOTP secrets at rest (RS_TOTP_KEY, 32 bytes base64). */
  totpKey: Buffer;
  /** Login attempts per IP per 10 minutes (SPEC §6.1). */
  loginRateLimit: number;
  /** Sealed-box public key for stream keys (control can encrypt, never decrypt). */
  sealPublicKey: string | null;
  /** Relay for the WHIP contribution: Cloudflare TURN, a static list, or none (SPEC §11.1). */
  turn: TurnConfig;
  iceTransportPolicy: 'all' | 'relay';
  /** Pairing preview/claim requests per IP per minute (SPEC §14.4). */
  pairRateLimit: number;
  production: boolean;
  migrationsDir: string;
}

export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  if (env.RS_DEV_AUTH)
    throw new Error(
      'RS_DEV_AUTH was removed in M4; create an owner with `cli.js user:create-owner`',
    );
  const need = (k: string, fallback?: string) => {
    const v = env[k] ?? fallback;
    if (v === undefined || v === '') throw new Error(`missing env ${k}`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: need('DATABASE_URL'),
    publicOrigin: need('PUBLIC_ORIGIN').replace(/\/$/, ''),
    whipPublicBase: need('WHIP_PUBLIC_BASE').replace(/\/$/, ''),
    mediamtxInternalUser: need('MEDIAMTX_INTERNAL_USER', production ? undefined : 'supervisor'),
    mediamtxInternalPass: need('MEDIAMTX_INTERNAL_PASS', production ? undefined : 'dev-internal'),
    totpKey: loadTotpKey(env.RS_TOTP_KEY, production),
    loginRateLimit: Number(env.RS_LOGIN_RATE_LIMIT ?? 20),
    pairRateLimit: Number(env.RS_PAIR_RATE_LIMIT ?? 10),
    sealPublicKey: env.RS_SEAL_PUBLIC_KEY || null,
    turn: turnConfigFromEnv(env),
    iceTransportPolicy: transportPolicy(env, turnConfigFromEnv(env)),
    production,
    migrationsDir:
      env.MIGRATIONS_DIR ?? new URL('../../../infra/migrations', import.meta.url).pathname,
  };
}
