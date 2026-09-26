import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const control = process.env.RS_CONTROL_URL ?? 'http://127.0.0.1:3000';
const mediamtx = process.env.RS_MEDIAMTX_WHIP_URL ?? 'http://127.0.0.1:8889';
const PREVIEW_PORT = 4173;

const proxy = {
  '/api': control,
  '/ws': { target: control.replace(/^http/, 'ws'), ws: true },
  '/whip': { target: mediamtx, rewrite: (p: string) => p.replace(/^\/whip/, '') },
};

/**
 * The production Content-Security-Policy, read from the Caddyfile so the preview (and the CSP e2e run)
 * can never drift from what production sends. Only the WebSocket origin is adapted.
 */
function productionCsp(): string {
  const caddy = readFileSync(new URL('../../infra/proxy/Caddyfile', import.meta.url), 'utf8');
  const m = /Content-Security-Policy "([^"]+)"/.exec(caddy);
  if (!m) throw new Error('CSP not found in infra/proxy/Caddyfile');
  return m[1]!.replace('wss://{$DOMAIN}', `ws://localhost:${PREVIEW_PORT}`);
}

export default defineConfig({
  plugins: [react()],
  // Compared with /api/health to offer a reload after a deploy (SPEC §14.3 decision).
  define: { __RS_APP_VERSION__: JSON.stringify(process.env.RS_APP_VERSION || 'dev') },
  server: { host: true, port: 5173, proxy },
  preview: {
    port: PREVIEW_PORT,
    strictPort: true,
    proxy,
    headers:
      process.env.RS_PREVIEW_CSP === '1' ? { 'Content-Security-Policy': productionCsp() } : {},
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    // Scripts, worklets and fonts must stay same-origin files: the CSP (script-src/font-src 'self')
    // blocks data: URLs. Only small images may be inlined.
    assetsInlineLimit: (file) => (/\.(js|mjs|woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
});
