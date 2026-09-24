# Pinned versions (SPEC §4.3.1)

Recorded 22 Sep 2026 when M1 started. Upgrade only between services, through CI. A combination that has
passed the gate evidence is the qualified release.

| Component | Pinned | Notes |
|---|---|---|
| Node.js | 24.21.0 (LTS) | `.nvmrc` = 24; Docker base `node:24-bookworm-slim` |
| pnpm | 12.5.1 | `packageManager` in package.json |
| TypeScript | 6.0.3 | **Not 7.x:** typescript-eslint 8.70 supports `<6.1`. This is the fallback §4.3.1 allows. Revisit when typescript-eslint supports 7. |
| React / React DOM | 19.x (lockfile) | |
| sharp | 0.35.4 | Image checks and re-encoding for uploads (SPEC §10.6). Native; installed separately in `control.Dockerfile` (`SHARP_VERSION`): keep in step with `apps/control/package.json`. |
| Vite | 8.x (lockfile) | |
| Fastify | 5.12.x | |
| Kysely | 0.29.x | |
| Zod | 4.6.x | |
| Vitest | 5.0.x | |
| Playwright | 1.63.0 | Local runs use preinstalled Chromium 141 (`/opt/pw-browsers`). CI installs the matching build. |
| ESLint | 10.x | |
| PostgreSQL | 18 (image `postgres:18`, observed 18.6) | Pin the digest at deploy time |
| MediaMTX | 1.21.1 (`bluenviron/mediamtx:1.21.1-ffmpeg`) | Pin the digest at deploy time |
| cloudflared (Codespaces only) | 2026.9.1 (`cloudflare/cloudflared:2026.9.1`) | Quick tunnel for the Codespace's public address |
| coturn (tests only) | 4.7 (`coturn/coturn:4.7`) | Stands in for Cloudflare TURN in the relay-only e2e run |
| Codespaces base | `mcr.microsoft.com/devcontainers/base:ubuntu-24.04` + Node 24 + docker-in-docker features | `.devcontainer/devcontainer.json` |
| Caddy | 2.11 (`caddy:2.11`) | Pin the digest at deploy time |
| Supervisor image | `bluenviron/mediamtx:1.21.1-ffmpeg` + Node from `node:24-alpine` (both Alpine 3.24.2) | `infra/compose/supervisor.Dockerfile` |
| libsodium-wrappers | 0.8.x | Sealed boxes for stream keys |
| hash-wasm | 4.12.x | Argon2id password hashing (m = 64 MiB, t = 3, p = 1), WebAssembly so the control image needs no native build |
| FFmpeg | **8.1.2** (from the pinned MediaMTX image) | ADR-0002: one FFmpeg build across the media node. 9.0 needs a new image source plus a media-suite pass. |

Exact npm versions are in `pnpm-lock.yaml`.
