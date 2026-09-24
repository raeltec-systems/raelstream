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
| D-4 | Quality options 480p / 720p / 1080p | Two profiles only, 720p and 1080p; a reduced state exists as "Recovery" (§11.2) | Show **720p and 1080p**. **Owner decision (22 Sep): leave 480p out for now.** |
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

### M2: built 22 Sep 2026

| Area | State |
|---|---|
| `packages/media-node-adapter` | Done: FFmpeg argument builders (normaliser, publisher, slate), progress parser, publisher error classifier, key/URL redaction, backoff, destination allowlist + SSRF checks (A41), MediaMTX API client |
| `packages/secrets` | Done: libsodium sealed boxes. Control can only encrypt; only the supervisor holds the secret key (SPEC §14.2) |
| `apps/supervisor` | Done: reconciles desired vs observed state from PostgreSQL (LISTEN/NOTIFY + 500 ms tick). Runs the normaliser, one isolated publisher per destination with backoff 1/2/4/8/15 s, and the fallback slate through MediaMTX always-available with a bounded grace period → INTERRUPTED. Stop always wins. Derives the lifecycle (STARTING/SENDING/PARTIAL/RECOVERING). |
| Control | Done: start/stop/retry with idempotency keys, the destinations list (keys never returned), observed-state relay to studios, `norm/` paths restricted to the supervisor, an owner CLI (`keys:generate`, `destination:add` with the key read from stdin, `destination:list`) |
| Studio | Done: Go live modal (Cancel focused; Enter never confirms), the design's Stop modal (truthful per-destination state), session pill (ON AIR / Starting / Slate on · countdown / Stopping), live destination rows (Sending · rate, "publish it in YouTube Studio", Reconnecting · attempt n, Stopped · reason + Retry), compact partial/slate/ended banners that keep all four scenes visible at 1366×768 |
| Infra | Supervisor image (ADR-0002), Compose service + shared slate volume + seal secret, MediaMTX MoQ disabled, internal RTMP for the normalised programme (ADR-0003), CI `media` job |

**Verified:**
- 59 unit tests and 25 integration tests pass. Two Playwright runs pass: the M1 spine, and the new
  **broadcast** run with the real supervisor and two RTMP sinks (Go live → both sending → one
  platform lost → partial → Enter-safe stop → ended).
- **8 media-node tests** pass with real FFmpeg 8.1.2 and MediaMTX. Evidence is written to
  `test-results/m2-media-evidence.json` and uploaded by CI:
  - The output is H.264 Main 1280×720 30 fps, no B-frames, keyframes exactly 2.000 s apart,
    AAC 44.1 kHz stereo, monotonic PTS.
  - A/V offset end to end through the normaliser: 19–35 ms. The test signal alone accounts for 0–21 ms.
  - Killing one platform leaves the other on the **same RTMP connection** at 3.9 Mbit/s (A28, P-10).
  - Losing the contribution puts the matched slate on air with the **publisher connection unchanged**
    before, during and after (A36). The programme is restored about 6 s after the contribution returns (A37).
  - Stop is idempotent, ends the session and revokes tokens (A34). Stream keys and internal
    credentials never appear in supervisor logs (A40).

**Bugs found and fixed through testing:**
- Audio timing through RTSP (ADR-0003).
- The slate filter graph.
- MediaMTX 1.21's default MoQ listener collided with other instances on port 8892.
- The studio never loaded destinations, and `server.ts` never started the observed-state relay. Both
  were silently failed scripted edits, found by the broadcast e2e and an audit.
- The Stop modal claimed LIVE for a destination that was reconnecting.

**Still open for M3 (hardware and real platforms):**
- Real Facebook/YouTube acceptance of the output profile.
- Stderr patterns for real auth rejections (a rejected key is currently classified as a network error
  unless the platform's message matches, so it retries rather than failing fast).
- Normaliser CPU headroom on the Vultr 4 vCPU instance (P-12).
- Real WebRTC contribution sync.

### M4: built 23 Sep 2026 (WP1)

| Area | State |
|---|---|
| Accounts | Done: email + password (Argon2id, m = 64 MiB, t = 3, p = 1) + authenticator code (RFC 6238, ±1 step, each step usable once) or a single-use recovery code (10 issued, stored hashed). TOTP secrets encrypted at rest with `RS_TOTP_KEY` (AES-256-GCM). Lockout after 5 failures for 15 min, the same generic error for every failure, per-IP rate limit. |
| Sessions | Done: hashed `rs_sid` cookie (HttpOnly, SameSite=Strict), 12 h idle (kept alive while live), 7 days absolute. CSRF header + Origin check on every state change. Sign-out and "sign out everywhere" on disable / MFA reset. |
| People | Done: owner CLI (`user:create-owner`, `user:reset-mfa`). One-time operator invites (link secret in the fragment, 72 h, preview doesn't consume). Enrolment shows the QR, the key and the recovery codes once, and the first code confirms the authenticator. Owner settings: list, disable/enable (not yourself), create invite. |
| Presets | Done: saved services with the rundown, audio defaults, destinations and fallback grace. Start from a preset or blank. The rundown and audio settings are saved on the server for the session (debounced), with "Save to preset". Images stay in the studio's memory for now. Asset upload is M6. |
| Studio lease | Done: 45 s lease renewed every 10 s per tab (`X-RS-Client`). Commands need the lease. A second tab is read-only. Take over is confirmed, bumps the generation, revokes the old WHIP token, fences the old tab (`lease.lost`) and tells the phone to renegotiate (`studio.changed`) without re-admission. Operators may take over only from their own other tab. The owner may take over from anyone and may Stop without the lease. |
| Media node | Done: a takeover within the same session restarts only the normaliser. The publishers keep their platform connection, and the slate covers the gap. |
| Retention | Done: daily job (events 90 d, auth sessions 30 d, MFA challenges 1 d, invites 7 d, command log 30 d, ingest tokens 7 d). |
| Dev sign-in | Removed. `RS_DEV_AUTH` now refuses to start with a pointer to `user:create-owner`. |

**Verified:**
- 67 unit and 53 integration tests pass (auth, invites, lockout, replay, leases/fencing, presets,
  pairing, MediaMTX auth hook).
- 9 media-node tests pass, including a mid-broadcast **takeover that keeps the same platform
  connection** (A/V offset 18–34 ms).
- 4 Playwright runs pass with real sign-in: the spine, the broadcast (real supervisor + 2 RTMP
  sinks), the auth-hook refusal, and a new **invite → enrol → operator runs the studio → owner
  takes over** run. In that run the operator's tab is fenced and offers no Take over.

**Bugs found and fixed through testing:**
- **Security:** a wrong authenticator code threw inside the database transaction. The rollback
  undid both the failure count and the use of the challenge, which allowed unlimited guesses.
  Now the failure is committed and the error raised afterwards (regression test added).
- **Security:** a correct password reset the failure counter, so an attacker who knew the password
  could guess codes forever. Now the counter is cleared only after a full sign-in.
- The invite page read its secret in an effect, so React's development double-mount saw an empty
  address bar and showed "no longer valid".
- Operators were offered Take over from the owner, which the server correctly refuses. The banner
  now asks them to contact the owner.
- The home screen never noticed a service started by someone else. It now checks every 5 s.

### Test environment without a server: built 23 Sep 2026

The Dell is a managed work laptop (no Docker), and paying for a server during development was ruled
out, as was Oracle Cloud. Instead:

| Area | State |
|---|---|
| TURN relay | Done: the control service mints Cloudflare TURN credentials server side (`RS_TURN_CF_KEY_ID` / `RS_TURN_CF_API_TOKEN`; or a static `RS_ICE_SERVERS`) and returns them with each WHIP contribution. Port-53 URLs are dropped (browsers time out on them). If the API fails, the contribution tries direct only rather than failing. `RS_ICE_TRANSPORT_POLICY=relay` forces the relay. MediaMTX takes its own relay credentials through `MTX_WEBRTCICESERVERS2_n_*`. This is also the production fallback for studios behind restrictive networks (SPEC §11.1). |
| Codespaces | Done: `.devcontainer/` and `infra/codespace/`. One click starts the whole stack behind GitHub's HTTPS port forwarding (Caddy on :8080, shared routes in `infra/proxy/app-routes.caddy`). Secrets are generated on first start and never committed. Includes an owner-account script with a terminal QR code and two stand-in platforms (`rs-test-platform`, HLS on `/watch/`). |
| Johannesburg check | Documented: `docs/runbooks/gcp-johannesburg.md` (Google Cloud free trial, africa-south1, sslip.io name). |

**Verified:**
- A new e2e mode (`RS_E2E_RELAY=1`, in CI) runs the spine with coturn standing in for Cloudflare.
  Private addresses are refused by the relay, so studio → MediaMTX can only flow through TURN.
  MediaMTX's WebRTC session shows a relay remote candidate and >500 KB of media.
- The Codespaces `start.sh` was rehearsed end to end on local images, with Docker Hub rate-limited here:
  - fresh secrets and the stack up;
  - owner created through the script;
  - sign-in, start service, Go live to both stand-ins, ON AIR, both rows sending;
  - HLS decoded through Caddy's `/watch/` (H.264 Main 1280×720 30 fps + AAC 44.1 kHz stereo);
  - Stop, then "This service has ended".

**Bugs found and fixed through the rehearsal:**
- **Production:** the runbook's `chmod 400` on `secrets/seal_secret` made the file unreadable by
  the non-root supervisor, which then restarted forever. Now the folder is `chmod 700` and the files
  `644`, and the runbook says so.
- Compose `!reset` on Caddy's ports removed the port entirely. It needed `!override`.
- The relay test first passed through a direct path. The test now refuses private peers, so it proves
  the relay-only route.

### Codespaces testing fixes and phone sound: 24 Sep 2026

Found by the owner in the Codespace, each with a regression test that fails on the old code:

- **Audio meters dead behind Caddy:** the CSP (`script-src 'self'`) blocks AudioWorklet modules from
  `blob:` and `data:` URLs, so the meter never loaded and audio setup hung. The worklet is now a
  same-origin file (Vite no longer inlines `.js` assets). The audio e2e applies the CSP.
- **Switching tabs cut to the slate:** Chromium stops `requestVideoFrameCallback` in a hidden tab
  while frames keep arriving (measured with a real hidden tab). Frame arrival now also uses the
  decoded-frame count (SPEC §10.2 decision).
- **Listen (headphones)** control for the existing monitor branch; scene buttons that need a rundown
  item are disabled with a note instead of silently doing nothing.
- **Phone as the sound source** (owner decision, SPEC §8.8): phone microphone or iRig, never
  automatic, mixer still the default.

### M5: built 24 Sep 2026 (WP2)

| Area | State |
|---|---|
| Reconnection (A10–A11) | Done: the phone rebuilds its peer connection by itself after 3 s disconnected, at once when failed/closed or the DataChannel drops, and retries if an answer never arrives (15 s). Same credential and slot; phone sound resumes if it was the chosen source. Android ending the camera track in the background is recovered when the page returns. |
| Studio on return | Done: the camera never goes back on programme by itself; a pulsing **Camera ready: Cut back** appears after an automatic slate cut. An automatic cut now shows in the scene buttons. |
| Capture (CAM-01, CAM-03) | Done: requested vs actual quality on the phone; camera selector when the phone reports more than one camera (`replaceTrack`, no renegotiation). Tapping Stop now returns to the Start card (it showed a blank page). |
| Framing (A13) | Done: Fit / Fill in Preparation → Devices; the programme stays 16:9. |
| Frame rate | The studio explains a low received frame rate (below 24 fps) as a lighting issue first; the owner's test showed 15–22 fps indoors. |
| Already in place from M1 | Zoom only when reported (A14), wake lock, battery, route classification, the direct-link failure panel, permission errors (A06), rotate prompt. |

**Verified:** 76 unit, 56 integration, 6 Playwright runs (new: camera drop → slate → automatic
reconnect → Cut back; it fails with the reconnect watchdog disabled).

### M6: built 24 Sep 2026 (WP3)

| Area | State |
|---|---|
| Assets (A24) | Done: `POST /api/assets`; magic bytes, full decode with sharp, no SVG/animation, ≤10 MB and ≤4096 px, EXIF/GPS stripped, sRGB, PNG only with transparency; stored in PostgreSQL (backed up with it); served same-origin, private, immutable. Rundown images are uploads now and survive a reload. |
| Church look (I-10) | Done: Settings → Church look (owner): logo, corner, size, main/name/slate colours with a live 4.5:1 contrast check (server enforces it too), three bundled fonts, optional holding image. Live preview uses the programme's own drawing code. Church-wide (SPEC §10.5 decision). |
| Rundown | Done: text cards up to 600 characters with a reference, wrapped and auto-fitted 64→36 px; a card that cannot fit is refused before it goes on air. Image framing Fit/Fill. |
| Audio (A17, A18, A21) | Done: "This is intentional" snoozes the silence warning for 5 min (never touches gain); when the lost interface reappears the operator gets "‹label› is back: Reconnect" (never automatic), which also asks for a sync recheck. |
| Lip-sync tool (SYNC-03/04) | Done: record the outgoing programme (in the browser, SPEC §11.4 decision), frame-step (`,` `.`), waveform with the detected clap, mark the clap frame, suggested delay, the 80 ms "audio late" rule, save to `sync_calibrations`; status shows Calibrated or Recheck recommended when the camera, input, routing, profile or delay changes. |
| Build | The control image installs sharp separately (native); a new CI job builds the images and checks sharp loads. |

**Verified:** 82 unit, 62 integration (6 new for assets/theme), 7 Playwright runs (new: church look →
logo in the chosen corner of the real programme; SVG refused; image survives reload; scripture card
fit; clip recorded, clap found, calibration saved).

### M7: built 24 Sep 2026 (WP4)

| Area | State |
|---|---|
| Destinations (S05, A40, A41) | Done: Settings → Destinations (owner): add/edit/remove, server from the allowlist only (stand-ins outside production), key pasted write-only and sealed at once (replace, never reveal), key mode, auto-publish, watch URL, note. **Check connection** does DNS (public addresses only) + TCP/TLS without media. |
| Facebook per-event key (I-13) | Done: pasted per service in Preparation → Destinations (lease holder; never readable), "looks like last week's key" warning, Go live refuses a destination without a key, the supervisor uses the service key, and a database trigger wipes it when the service ends or is interrupted. |
| Live | Done: "I've checked the platform playback" (stale after a reconnect), watch-page link, Fix key for a rejected Facebook key, Go live starts from Preparation's choice and disables keyless destinations. |
| Uplink test (I-04, I-05) | Done (HTTP part, SPEC §11.3 decision): 40 MB / 20 s from 4 workers, result stored with the service, 1080p/720p/insufficient offer, warning when choosing above it, refused while sending (E31). |
| Recording (I-16, I-17) | Done (local, SPEC §12.7 decision): "Record a private copy" in Go live; MediaMTX records the public output (fMP4, 10 min); the owner downloads from the ended service; deleted after 30 days. |
| CI | The broadcast e2e (real supervisor, two stand-in platforms) now runs in the media job. |

**Verified:** 82 unit, 67 integration (5 new: allowlist/SSRF refusals, keys never returned, per-event
key rules incl. the wipe trigger, uplink sink), 9 media, 9 Playwright runs (new: Settings →
Destinations → uplink test → Facebook key → Go live offers both; broadcast now records, confirms
playback and downloads a valid 720p H.264/AAC file).

**Bug found:** new destinations were not ticked for the service if the studio had already loaded the
list; and a missing Facebook key blocked opening the Studio (now a reminder: it only blocks going live).

### M8: built 24 Sep 2026 (WP5)

| Area | State |
|---|---|
| Adaptation (A39) | Done: one step controller (5 s evidence, 20 s between changes, 60 s stable to step back up) drives the programme upload (8→6→4.5→3→1.5 Mb/s; 720p 4.5→3→2→1.5), CPU relief (1.5× smaller, then 15 fps) and the phone's bitrate (8→5→3→2 Mb/s). Dim light (the phone itself at 15 fps) never lowers the camera bitrate. Audio is never touched. Each change is an event, shown in the health panel and the report. |
| Camera stall → slate (A10) | Done in M5/M6; an automatic slate cut is now logged for the report. |
| Grace / extend (A36) | Done: "Keep the slate up 5 more minutes" while RECOVERING (lease holder), at most 20 min in total; the supervisor reads it on its next tick. |
| Supervisor restart (A38, E21) | Decision recorded (SPEC §20): no adoption; a restart rebuilds from the desired state and the reconnects show in the report. A control restart does not touch media. |
| Health staleness | Done: "Media server status not updated for N s" while live; quality-step notes in the health panel. |
| Report (S06, A45) | Done: `/studio/report/:id` and JSON download: checks in words (Passed/Failed/Not tested/Inconclusive), destinations with final state, reconnects and the operator's playback check, measurements from the studio's 10 s windows (missing = "unavailable"), quality changes, recordings with expiry, timeline. Home lists recent services with their outcome. |

**Verified:** 88 unit (6 new for the controller and signals), 72 integration (5 new: report defaults,
aggregation, unknown fields refused, studio events whitelist, grace cap), 8 Playwright runs (the spine
now opens the report and checks real measurements).
