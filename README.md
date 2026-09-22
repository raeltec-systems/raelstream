# raelstream

A browser-based broadcast studio for one church. A phone is the camera, a laptop composes the programme,
and one stream goes to Facebook and YouTube.

- **Product and engineering spec:** [SPEC.md](SPEC.md) (source brief in `docs/brief/`)
- **Implementation plan and progress:** [PLAN.md](PLAN.md)
- **Design handoff:** `docs/design/` and [DESIGN_BRIEF.md](DESIGN_BRIEF.md)

## Status

- **M1 (WP0 spine, browser side):** pairing, the direct camera link, mixer audio, the compositor and WHIP ingest.
- **M2 (media node):** supervisor, FFmpeg normaliser, isolated Facebook/YouTube publishers, fallback
  slate, and Go live / Stop in the studio.

Both are built and tested with synthetic media and local RTMP sinks. Next is **M3**, the owner's
hardware run on the real devices and real platform test events (`docs/runbooks/wp0-hardware-run.md`).
Real accounts (M4) and the remaining work packages follow. See PLAN.md.

## Layout

```text
apps/control      Fastify API + WebSocket hub + MediaMTX auth hook + owner CLI (Node 24, PostgreSQL 18)
apps/supervisor   Media-node reconciler: FFmpeg normaliser, publishers, fallback slate
apps/web          Studio (/studio) and phone camera (/cam), React 19 + Vite
packages/*        contracts (Zod), i18n, ui (design system), media-runtime, camera-client,
                  media-node-adapter (FFmpeg/MediaMTX), secrets (sealed boxes)
infra/            migrations, MediaMTX config, Compose stack, Caddy
tests/e2e         Playwright end-to-end run with fake media devices + real MediaMTX
```

## Develop

Requirements: Node 24, pnpm 12 (`corepack enable`), Docker.

```sh
pnpm install
docker run -d --name rs-pg -e POSTGRES_USER=raelstream -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=raelstream -p 55432:5432 postgres:18

pnpm ci:local          # format, lint, typecheck, unit, integration, build, e2e
pnpm test              # unit
pnpm test:integration  # needs the Postgres container
pnpm test:e2e          # starts control, Vite and a MediaMTX container
pnpm test:media        # builds the supervisor image; real FFmpeg + MediaMTX + RTMP sinks
RS_E2E_BROADCAST=1 pnpm exec playwright test tests/e2e/broadcast.spec.ts  # studio Go live flow
```

To run by hand, start MediaMTX with `infra/media/mediamtx.yml`, then run
`pnpm dev:control` (with the env vars from `playwright.config.ts`) and `pnpm dev:web`.
