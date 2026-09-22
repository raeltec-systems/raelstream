# Raelstream: Implementation Plan

**Inputs:**
- [`SPEC.md`](SPEC.md), the build spec
- [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md)
- The Claude Design handoff, stored at [`docs/design/`](docs/design/): README, tokens and the HTML reference

**Date:** 22 September 2026

The order of work follows the spec's gates. **WP0 (the feasibility spine) comes first.** Everything built before the WP0 go/no-go decision is either part of that spine, or a foundation that every outcome needs anyway: repo, contracts, design system, CI.

---

## 1. Design handoff: how it maps onto the spec

The design is high-fidelity and final for **look, copy and layout**. SPEC.md is still final for **behaviour and truthfulness rules**. The table below covers every place where they differ and how I resolved it.

| # | Design says | Spec says | Resolution |
|---|---|---|---|
| D-1 | Load the fonts from Google Fonts (`@import`) | The CSP only allows fonts from our own server, and no third-party requests (§14.1) | Serve the **same three fonts** (Bricolage Grotesque, Atkinson Hyperlegible, IBM Plex Mono) ourselves, using the `@fontsource` packages. |
| D-2 | Health row "Laptop CPU 54%", "CPU 86%" | Browsers can't measure machine CPU, and the brief forbids inventing it (B§24.2) | The row reads "Laptop · keeping up" / "Laptop is working hard", **inferred** from WebRTC's `qualityLimitationReason = cpu` and the encode rate. There is no percentage, and the row is labelled "inferred". |
| D-3 | Phone status "Phone is warm · 64%" | No thermal readings (B§9.4) | Show "Battery 64%" (or "Battery information unavailable"). Remove "warm". |
| D-4 | Quality options 480p / 720p / 1080p | Two profiles only, 720p and 1080p; a reduced state exists as "Recovery" (§11.2) | Show **720p and 1080p**. 480p is omitted. **Owner question:** do you want a 480p profile for very weak uplinks? |
| D-5 | 4 scenes on keys 1–4, and **Take next** on Space | 5 scene types, keys 1,2,3,4,0, and draft → Apply | Use the design's model. The scenes are Camera + lower third, Camera only, Text card, and Be right back slate. Images are rundown items. **Take next** puts the next *prepared* rundown item on air. Live edits still go through Edit → Apply. Space fires only when no button or field has focus, so it never clashes with a button's own Space activation. |
| D-6 | No blinking | The spec had an amber blinking "Reconnecting" tally | Follow the design: no blinking. Colour and word change only. |
| D-7 | Session pill: Off air / Ready / ON AIR / Reconnecting / Slate on | 10 lifecycle states | The spec states map onto the design pills: DRAFT/PREPARING → Off air, READY → Ready, SENDING/PARTIAL → ON AIR (PARTIAL also shows the failed destination row), a camera reconnecting while live → Reconnecting camera…, RECOVERING → Slate on · countdown. |
| D-8 | "Connected to Studio · 4 ms" | A ping time must not be called latency (B§24.2) | Show "Connected to Studio · 4 ms round trip". |
| D-9 | Preparation steps: Devices, Uplink, Destinations, Rundown, Audio | Lip-sync calibration is required (SYNC-01..05) | Add a **Lip-sync** section at the bottom of the Audio step, styled with the existing card, meter and segmented components. There is no sixth step. |
| D-10 | Product name "raelstream" | "Raeltec Stream" | Use **raelstream**, as in the design. |
| D-11 | Destination panel includes "Private recording" | Opt-in recording (I-17) | Matches the spec. |
| D-12 | Stop modal copy and behaviour | I-11 | Matches the spec. The design's copy is used as written. |

Each church sets its own accent colour in its preset theme (I-10). A dark variant of the accent is **derived** automatically, and the 4.5:1 contrast check for text on the accent runs in the preset editor.

---

## 2. Milestones

| M | Work package | Contents | Exit evidence |
|---|---|---|---|
| **M1** | WP0 spine (code) + foundations | Monorepo, CI, contracts, i18n, design-system `ui` package, a control service with dev-only session auth, pairing and WS signalling, the phone camera client, and the studio. The studio covers the direct camera link, audio engine, compositor and WHIP to MediaMTX (private ingest test mode). Compose stack, plus unit, integration and browser e2e tests using synthetic media. | Tests green. An e2e run in which a fake-camera phone pairs, the studio receives frames, composes the programme and publishes it to a real MediaMTX, and the MediaMTX API shows video+audio tracks on the contribution path. |
| M2 | WP0 spine (media node) | Supervisor, FFmpeg normaliser, two publishers (checked against local RTMP sinks in CI), the fallback-slate always-available check, and a measurement harness (the frame-marked clip, ffprobe checks). | CI media tests, and the ADR on fallback behaviour. |
| M3 | WP0 hardware run *(owner)* | The real A26, Dell and UMC on the production LAN, sending to private FB/YT test events. The steps are in `docs/runbooks/wp0-hardware-run.md`. | The G1–G5 preliminary evidence pack and the **go/no-go ADR**. |
| M4 | WP1 | Auth (Argon2id + TOTP), operator invites, presets, full sessions and lifecycle, leases and fencing, idempotency, event replay, retention. | The WP1 test list, and the security tests A03–A05, A12, A42. |
| M5 | WP2 | Full camera UI states, zoom, wake lock, reconnection, route classification, the direct-link failure panel. | A02, A06–A14. |
| M6 | WP3 | Full audio (HPF, compressor, silence/clip/loss), all rundown types, the theme editor, assets, the lip-sync clip tool. | A13, A15–A25. |
| M7 | WP4 | Destinations (sealed-box keys, allowlist, SSRF), the FB per-event key, YT auto-publish, Start/Stop, partial publication, uplink test, R2 recording. | A22, A27–A31, A40–A41, A48. |
| M8 | WP5 | Adaptation controllers, camera stall → slate, grace/extend, supervisor adoption, health staleness, the report. | A08, A32–A39, A45. |
| M9 | WP6 | CSP/SW deferral, `deploy.yml` + the deploy guard, backups/restore, runbooks, soak, and 2 real services. | A26, A43, A46, A47, and the acceptance statement. |

M1 and M2 can be built and tested entirely in CI and this dev container. **M3 needs you**, with the real phone, laptop, interface and venue network. Whatever M3 finds decides whether M4 onward goes ahead unchanged.

---

## 3. M1 build breakdown (this session)

1. **Repo foundations:** a pnpm 12 workspace, Node 24 (`.nvmrc`), TypeScript 6.0 (TS 7 is blocked by typescript-eslint support, per the §4.3.1 fallback rule), ESLint 10, Prettier, Vitest 5, Playwright 1.63, `infra/VERSIONS.md`, and CI in `.github/workflows/ci.yml`.
2. **`packages/contracts`:** Zod schemas for WS messages (hello/welcome/signal/tally/admission), DataChannel messages, error codes and the event envelope.
3. **`packages/i18n`:** `en.json` and a typed `t()`.
4. **`packages/ui`:** `tokens.css` (from the handoff, with self-hosted fonts) and the components: Logo, Button, KeyChip, StatusDot, Pill, Toggle, Segmented, TextField, SecretField, Modal + StopModal, BlockerBanner, Meter, Card.
5. **`packages/media-runtime`:**
   - Pure logic, unit-tested: stats deltas, route classification, channel-routing gains, delay clamping.
   - Browser controllers: CameraReceiver, AudioEngine (routing, gain, HPF, compressor, crossfaded delay, AudioWorklet meter), Compositor (worker clock, `rVFC`, the four scenes, the design's lower third), WhipPublisher.
6. **`packages/camera-client`:** capture with constraint fallback and a check that no audio track is sent, a peer connection with no ICE servers, the `ctl` DataChannel, wake lock, battery.
7. **`apps/control`:** Fastify 5, Kysely + PostgreSQL 18, the migration runner and `0001_init.sql` (the WP0 subset of §5), and the pairing endpoints (create/preview/claim/admit/reject/revoke) with an atomic claim. Also the WS hub (studio and camera roles, signalling relay, size and rate limits), the MediaMTX HTTP auth hook, and the ingest endpoint (a scoped WHIP bearer). Auth is a **dev-only** single-operator token that is refused when `NODE_ENV=production` (spec WP0 step 2).
8. **`apps/web`:**
   - `/studio`: Preparation Devices (pair QR, pending admission with the verification phrase, camera card) and Audio (device, routing, meters, delay).
   - `/studio/live`: the dark Studio layout with programme canvas, scenes, audio, and a private-ingest health panel.
   - `/cam`: the join → waiting → start → live tally flow.
9. **Infra:** `infra/compose/docker-compose.yml` (postgres 18, mediamtx 1.21.1, control, caddy) and the dev MediaMTX config with `authMethod: http`.
10. **Tests:** unit (contracts, pairing token/phrase, audio maths, route classification, stats), integration against a real Postgres (the double-claim race, admit/revoke), and a Playwright e2e run (fake media, two browser contexts, a MediaMTX container).

---

## 4. Progress log

### M1: built 22 Sep 2026

| Area | State |
|---|---|
| Repo foundations, CI workflow, version pins | Done (`.github/workflows/ci.yml`, `infra/VERSIONS.md`) |
| contracts / i18n / ui design system | Done. All UI copy is in `en.json` (220+ strings). An ESLint rule rejects hard-coded JSX text. |
| Control: dev sign-in (passphrase), sessions, pairing, admission, revocation, WS hub, ingest, MediaMTX auth hook | Done |
| Phone camera client | Done: join → verification words → admission → capture → tally, battery, wake lock, zoom where reported |
| Studio: Preparation (Devices, Rundown, Audio with lip-sync delay) and Live (scenes 1–4, Take next, meters, private test) | Done. The Uplink and Destinations steps are honest "not built yet" pages. |
| Compose stack, Caddy, Dockerfiles | Written. **Image build not verified here:** Docker Hub rate-limited the base image pull. CI will build it. |

**Verified locally:**
- format, lint and typecheck are clean
- **34 unit tests** pass
- **17 integration tests** pass against PostgreSQL 18: the claim race (A04), non-consuming preview (A05), expiry (A03), second-camera refusal (E04), revocation (A12), WHIP path scoping and generation fencing (A42), CSRF/origin checks, rate limits, and WS signalling relay, flood and origin checks
- **2 Playwright end-to-end tests** pass. The first runs the whole spine: fake phone pairs → verification words match → admission → direct peer link ("Direct link, location not verified") → tally LIVE on the phone → fake mixer audio detected → delay clamps to 2000 ms → lower third taken on air → the programme canvas really draws the camera → private WHIP publish accepted by MediaMTX through the auth hook, with H.264/VP8 + Opus tracks. The second checks that an unauthenticated WHIP publish is refused.

**Not yet proven (needs M2/M3):** mDNS host candidates between the real A26 and Dell (the tests use raw IPs),
real UMC channel mapping, laptop CPU/memory, any Facebook or YouTube output.
