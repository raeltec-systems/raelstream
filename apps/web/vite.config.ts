import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const control = process.env.RS_CONTROL_URL ?? 'http://127.0.0.1:3000';
const mediamtx = process.env.RS_MEDIAMTX_WHIP_URL ?? 'http://127.0.0.1:8889';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': control,
      '/ws': { target: control.replace(/^http/, 'ws'), ws: true },
      '/whip': { target: mediamtx, rewrite: (p) => p.replace(/^\/whip/, '') },
    },
  },
  build: { target: 'es2023', sourcemap: true },
});
