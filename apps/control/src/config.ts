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
  /** WP0 only: dev operator login. Refused in production (SPEC §22 WP0 step 2). */
  devAuth: boolean;
  /** Shared passphrase required for dev sign-in (WP0 servers are publicly reachable). */
  devPassphrase: string;
  /** Pairing preview/claim requests per IP per minute (SPEC §14.4). */
  pairRateLimit: number;
  production: boolean;
  migrationsDir: string;
}

export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const devAuth = env.RS_DEV_AUTH === '1';
  if (production && devAuth) throw new Error('RS_DEV_AUTH must not be enabled in production');
  if (devAuth && (env.RS_DEV_PASSPHRASE ?? '').length < 12)
    throw new Error('RS_DEV_PASSPHRASE must be at least 12 characters');
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
    devAuth,
    devPassphrase: devAuth ? need('RS_DEV_PASSPHRASE') : '',
    pairRateLimit: Number(env.RS_PAIR_RATE_LIMIT ?? 10),
    production,
    migrationsDir:
      env.MIGRATIONS_DIR ?? new URL('../../../infra/migrations', import.meta.url).pathname,
  };
}
