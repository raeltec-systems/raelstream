# Raeltec Stream: Release 1 Implementation Specification

**Version:** 1.1 (implementation spec; stack versions updated, Cloudflare R2/TURN adopted)
**Date:** 22 September 2026
**Owner:** Israel Muyoba, Raeltec Systems Limited
**Source brief:** [`docs/brief/raeltec-stream-brief-v1.0.md`](docs/brief/raeltec-stream-brief-v1.0.md) (Product and Engineering Specification v1.0, 20 Sep 2026). Cited below as **B§n**.

This document turns the brief into a buildable plan for all of Release 1. It records the decisions made in the owner interview, fills the gaps the brief left open, and specifies components, data, protocols, UX, edge cases and delivery tasks.

**Precedence:** The brief's binding constraints (B§2.2, C-01 to C-08), MUST requirements, acceptance thresholds (B§25), proof gates (B§26) and acceptance scenarios (B Appendix A) still apply in full. This spec only narrows or extends them, and it marks every change as **[DECISION]**. If this spec and the brief conflict with no marked decision, the brief wins and this spec has a bug.

Keywords: **MUST**, **SHOULD** and **MAY** mean what they mean in B§1.

---

## 0. Interview decisions (summary)

| # | Topic | Decision | Consequence in this spec |
|---|---|---|---|
| I-01 | Spec scope | Full Release 1 in detail. WP0 still runs first as a gate. | §22 has a task breakdown for every work package. §23 lists what WP0 may invalidate. |
| I-02 | Hosting | One cloud Linux VM running Docker Compose, with public UDP. | §15. No PaaS, because WebRTC ingest needs UDP. |
| I-03 | Region | **Vultr Johannesburg (JNB)**. | Lowest RTT from Zambia. WP0 records the measured RTT and loss. |
| I-04 | Venue uplink | Unknown or variable (Zambia). | A pre-service uplink test chooses the profile (§11.3). |
| I-05 | Default profile | The uplink test decides. The operator may pick a lower profile, and picking a higher one than the test supports needs acknowledgement. | §11.3 |
| I-06 | Auth | Email + password (Argon2id) + mandatory TOTP. | §6.1 |
| I-07 | Operators | The owner, plus 1–3 volunteer operator accounts. The UX must be safe for volunteers. | §6, §9 |
| I-08 | Camera signalling | Cloud WSS for the initial offer/answer. After connecting, a direct RTCDataChannel carries tally, controls and ICE restarts. | §8.3 |
| I-09 | Content prep | Mostly prepared beforehand as a **rundown**, with occasional live edits. | §10.3 |
| I-10 | Branding | One theme per preset: logo, 2 colours, 1 bundled font, fixed layouts. | §10.5 |
| I-11 | Stop UX | A modal that names each destination. The confirm button is not focused by default, and Enter does not confirm. | §9.6 |
| I-12 | Fallback slate | A church-branded "We'll be right back" slate, rendered server-side into a clip that matches the profile. | §12.5 |
| I-13 | Facebook | Page destination, **per-event stream key** pasted in Preparation. | §13.3 |
| I-14 | YouTube | Either mode is possible. A per-destination flag records whether media arriving auto-publishes. | §13.2 |
| I-15 | Fallback grace | 2 min default, configurable 1–10 min per preset. | §12.5 |
| I-16 | Optional features included | High-pass filter and gentle compressor (with bypass); **opt-in private recording**; keyboard scene shortcuts; camera zoom where the browser reports it. | §10.4, §12.7, §9.7, §7.4 |
| I-17 | Recording storage | Opt-in per session and uploaded to **Cloudflare R2** (I-24). **30-day retention.** | §12.7. [DECISION] This changes B§3.3/B§20.3/D08 ("no routine recording"). Recording is still never on by default. |
| I-18 | Budget | Flexible, sized from WP0 benchmarks. | §15.4 |
| I-19 | Direct link failure | Show a clear blocker plus diagnostics. **No relay**, not even an opt-in one, in R1. | §8.5 |
| I-20 | Dell blocked at G1 | A second, **personally owned laptop** may be qualified as the studio device. | §3.2 |
| I-21 | Language | English only, with every string in one message catalogue. | §9.9 |
| I-22 | CI/CD | GitHub Actions CI, plus a manual-dispatch deploy workflow that refuses to run while a session is active. | §16 |
| I-23 | Versions | Use the latest stable release of every component (LTS for Node), pinned at WP0 start. | §4.3.1 |
| I-24 | Cloudflare | Evaluated (§15.7). **Adopted:** R2 for recordings and backups, and Cloudflare TURN as the optional contribution fallback. **Rejected for media processing:** Stream Live cannot restream WHIP inputs, and Containers only take HTTP via Workers. The media node stays on the Vultr JNB VM. | §15.7 |

---

## 1. Product summary

One church runs one weekly broadcast:

- **Camera:** a Samsung Galaxy A26 running Chrome, carried by a roaming operator on a dedicated production Wi-Fi network. It sends video only.
- **Studio:** a Dell 14 laptop running Chrome or Edge, connected to the same router by Ethernet. It receives the camera directly over the LAN, captures mixer audio from a Behringer UMC204HD, composes the programme on a canvas, and sends **one** WebRTC (WHIP) contribution to the media node.
- **Media node:** Vultr JNB VM. MediaMTX ingests, FFmpeg normalises once to H.264/AAC, then two isolated FFmpeg publishers push to **Facebook Page** and **YouTube** over RTMPS. An optional recorder uploads to Cloudflare R2.
- **Control plane:** a Node.js service on the same VM handles auth, pairing, sessions, leases, destinations, events and reports. A separate **supervisor** process owns every media process and is the only process that can decrypt stream keys.

Out of scope for R1: everything in B§3.3 "Excluded", except private recording, which I-17 now includes.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| Preset | A reusable service template: name, profile preference, theme, scenes, rundown, audio defaults, destination selection, grace period. |
| Session | One run of a preset: DRAFT → … → ENDED. Holds everything live. |
| Rundown | An ordered list of prepared content items (lower thirds, text cards, images) in a preset or session. |
| Programme | The composed output of the studio canvas plus the processed audio. |
| Contribution | The studio→media-node WHIP stream. |
| Normalised path | The internal MediaMTX path that carries the single H.264/AAC output. |
| Generation | A monotonically increasing fencing integer for session control and the contribution. |
| Supervisor | The server process that reconciles the desired media state with running FFmpeg processes. |

---

## 3. Qualified environment

### 3.1 Reference devices (first qualification matrix, B§6.1)

| Role | Device | Browser | Notes |
|---|---|---|---|
| Camera | Samsung Galaxy A26 | Chrome for Android, current stable | Record the Android version, Chrome version, and the lens actually selected. |
| Studio (primary) | Dell 14, managed work laptop | Employer-approved Chrome or Edge | Record the CPU, GPU, OS build, policies, and whether hardware acceleration is on. |
| Studio (alternate) **[DECISION I-20]** | A personally owned Windows laptop | Chrome stable | Qualified only if the Dell fails G1. It must pass the same gates. Reports name the device that was actually used. |
| Audio | Behringer UMC204HD | Windows class driver or Behringer driver, whichever is already installed | Record the driver and the channel mapping as the browser sees it. |
| Network | Dedicated production router/AP, 5 GHz SSID, laptop on Ethernet | — | Client isolation off. See B§7.1. |
| Server | Vultr JNB, Ubuntu LTS, Docker Engine + Compose | — | Record the image digests. |

### 3.2 If the Dell is blocked

If G1 fails on the Dell because of policy (camera, UDP, WebRTC, audio-device access, or the Local Network Access prompt behaviour), record the exact symptom as a compatibility blocker (B§6.2). Then qualify the alternate laptop. Never tell anyone to weaken the Dell's policy. The product promise ("an ordinary authorised laptop") holds for the alternate device. The acceptance statement names whichever device passed.

### 3.3 Browser capability probe

The studio and camera pages both run a capability probe on load. Results appear in the Preparation screen and go into the report.

- Secure context, `getUserMedia`, `enumerateDevices`, `RTCPeerConnection`, `RTCRtpSender.getCapabilities('video')` (whether H.264 is present), `HTMLCanvasElement.captureStream`, `AudioWorklet`, `requestVideoFrameCallback`, `navigator.wakeLock` (camera only), `navigator.getBattery` (camera only), and whether the `MediaStreamTrack` capabilities include `zoom` (camera only).
- A missing **critical** capability blocks the flow. The critical capabilities are: studio `getUserMedia`, `RTCPeerConnection`, `captureStream`, `AudioWorklet`; camera `getUserMedia`, `RTCPeerConnection`.
- An unqualified browser or device combination produces a warning, not a block (B§18.1).

---

## 4. Architecture

### 4.1 Topology

```text
Galaxy A26 (Chrome)                         Dell / alt laptop (Chrome/Edge)
 camera page  ──WSS (pair/offer/answer)──┐   studio page
   │                                     │     │
   └──── direct WebRTC (LAN, H.264) ─────┼────►│ receive + compose + audio + WHIP
         + RTCDataChannel "ctl"          │     │
                                         ▼     ▼ HTTPS/WSS (control)  WHIP + UDP media
                          ┌──────────── Vultr JNB VM (Docker Compose) ─────────────┐
                          │ caddy (TLS, :443) ─► control (Node: API, WSS, auth)      │
                          │                  └► mediamtx WHIP endpoint (/whip/...)   │
                          │ mediamtx (WebRTC UDP :8189, RTSP 127.0.0.1:8554, API)    │
                          │ supervisor (Node) ─ spawns ffmpeg: normaliser,           │
                          │     publisher-fb, publisher-yt, slate-render, recorder-up │
                          │ postgres (private)                                       │
                          └───────────────┬────────────────────┬────────────────────┘
                                          ▼ RTMPS              ▼ RTMPS       ▼ S3 API
                                     Facebook Page          YouTube     Cloudflare R2
```

### 4.2 Processes and ownership

| Process | Language | Owns | Must not |
|---|---|---|---|
| `web` (static SPA, served by Caddy) | TypeScript/React/Vite | Studio UI, camera UI, media runtime in the browser | Hold stream keys; recreate media objects on React renders. |
| `control` | TypeScript/Node 24 LTS | HTTP API, WSS hub, auth, pairing, sessions, leases, desired-state writes, events, reports, MediaMTX auth hook | Spawn FFmpeg; decrypt stream keys. |
| `supervisor` | TypeScript/Node 24 LTS | Reconciling desired vs observed media state; spawning and supervising FFmpeg; the MediaMTX path config API; decrypting keys (the only process holding the sealed-box private key, §14.2); uploading recordings | Serve public HTTP. |
| `mediamtx` | Pinned MediaMTX image | WHIP ingest, internal RTSP, always-available offline file, per-path recording | Be reachable on RTSP/API from outside the host. |
| `postgres` | Pinned PostgreSQL 18 image | Durable state; LISTEN/NOTIFY between control and supervisor | Expose a port publicly. |
| `caddy` | Pinned Caddy image | Automatic TLS; routes `/` → web, `/api` + `/ws` → control, `/whip` → mediamtx | Proxy WebRTC UDP (it cannot). |

`control` and `supervisor` communicate **only through PostgreSQL**. Control writes `desired_state` rows and `NOTIFY desired_changed`. Supervisor writes `observed_state` and `NOTIFY observed_changed`. This gives restart reconciliation for free (B§19.2) without Redis or a broker (B§22.1).

### 4.3 Technology choices

| Concern | Choice | Reason |
|---|---|---|
| Package manager | pnpm workspaces, committed `pnpm-lock.yaml` | One manager (B§22.1). |
| Runtime | Node 24 LTS (Active LTS), pinned via `.nvmrc` and the Docker base digest | Production should run an LTS line. Node 26 is still "Current" until it enters LTS in October 2026. |
| HTTP | Fastify | Schema-first; small. |
| WebSocket | `ws` via `@fastify/websocket` | |
| Validation / contracts | Zod in `packages/contracts`, shared by browser and server | Runtime schemas (B§22.2). |
| DB access | Kysely + plain SQL migrations (run by a small migration runner in `control`) | Typed queries, no ORM magic. |
| Passwords | Argon2id (`@node-rs/argon2`), m=64 MiB, t=3, p=1 | |
| TOTP | RFC 6238, SHA-1, 6 digits, 30 s, ±1 step window (`otpauth`) | Works with standard authenticator apps. |
| Secret encryption | libsodium sealed boxes (X25519). `control` holds only the public key and can encrypt. Only `supervisor` holds the private key and can decrypt (see §14.2) | Decryption limited to the supervisor (B§23.2). |
| UI | React 19 + Vite; plain CSS modules. No component framework dependency | Small; volunteer-legible styling. |
| QR | `qrcode` (render only) | |
| Tests | Vitest (unit/integration), Playwright (browser; uses `/opt/pw-browsers` Chromium in CI images), a custom media harness (FFmpeg + ffprobe) | |
| Object storage | **Cloudflare R2** via its S3-compatible API (`@aws-sdk/client-s3`) | Free egress, 10 GB-month free tier, lifecycle rules and presigned URLs (§15.7). |

Pin every image by digest and every npm dependency through the lockfile (B§22.1).

#### 4.3.1 Version policy and baseline (I-23)

**Policy:** use the newest **stable** release of each component, and for Node the newest **Active LTS** line. Do not use betas, release candidates or "Current" Node lines. Pin exact versions and image digests at WP0 start in `infra/VERSIONS.md`. After that, upgrade only between services, through CI, and never mid-work-package without a reason (B§28.3).

Baseline observed on 22 Sep 2026 (from npm, GitHub tags and the official project pages). WP0 re-checks it and pins the patch versions:

| Component | Version line | Note |
|---|---|---|
| Node.js | 24.x LTS | 22.x is in maintenance. 26.x is Current and becomes LTS in Oct 2026, so upgrade to it only after it reaches LTS and passes CI. |
| PostgreSQL | 18.x | Newest major (18.6). Supported to Nov 2030. |
| TypeScript | 7.x | The native compiler line. If a tool in the chain doesn't support 7 yet, fall back to 6.x and record the reason. |
| React | 19.x | |
| Vite | 8.x | |
| Fastify | 5.x | |
| Kysely | 0.29.x | |
| Zod | 4.x | |
| Vitest | 5.x | |
| Playwright | 1.63.x | CI uses the preinstalled Chromium where the versions match. |
| pnpm | 12.x | |
| MediaMTX | 1.21.x | Verify the always-available and WHIP behaviour on this exact version (§12.5). |
| FFmpeg | 9.0.x | Newest stable. If WP0 finds a regression, pin 8.1.x and record an ADR. |
| Caddy | 2.11.x | |

"Latest" is where each component starts, not a rule to chase it. Once a combination passes the G1–G8 evidence, that exact combination is the qualified release. Any later upgrade reruns the relevant gates.

### 4.4 Repository layout

```text
apps/
  web/                    React SPA: /studio/*, /cam/*, /login, /setup/*
  control/                Fastify API + WSS + migrations runner + CLI (user:create-owner)
  supervisor/             Media reconciler, FFmpeg process manager, recorder uploader
packages/
  contracts/              Zod schemas: commands, events, WS messages, error codes, config
  media-runtime/          Studio: camera receiver, compositor, audio graph, WHIP client, stats
  camera-client/          Phone: capture, capabilities, peer + datachannel controller, wake lock
  media-node-adapter/     MediaMTX API client, FFmpeg arg builders, ffprobe checks
  ui/                     Accessible shared controls (Button, ConfirmModal, Meter, StatusPill)
  i18n/                   en.json message catalogue + typed `t()`
infra/
  compose/                docker-compose.yml, .env.example, dev overrides
  proxy/                  Caddyfile
  media/                  mediamtx.yml template, slate font, default holding assets
  migrations/             0001_init.sql …
  scripts/                deploy.sh, backup.sh, restore.sh, deploy-guard check
  VERSIONS.md             Pinned versions and digests (written in WP0)
tests/
  unit/ integration/ browser/ media/ acceptance/
docs/
  brief/ architecture/ (ADRs) runbooks/ evidence/
.github/workflows/        ci.yml, deploy.yml
```

---

## 5. Data model

PostgreSQL 18. All ids are UUIDv7. All timestamps are `timestamptz`. The first migration is `infra/migrations/0001_init.sql`.

```sql
create type user_role as enum ('owner','operator');
create table users (
  id uuid primary key, email citext unique not null, display_name text not null,
  role user_role not null, password_hash text not null,
  totp_secret_enc bytea, totp_confirmed_at timestamptz,
  recovery_codes_hash text[] not null default '{}',
  failed_logins int not null default 0, locked_until timestamptz,
  disabled_at timestamptz, created_at timestamptz not null default now()
);
create table auth_sessions (          -- browser login sessions (cookie)
  id_hash bytea primary key, user_id uuid not null references users,
  created_at timestamptz not null, last_seen_at timestamptz not null,
  expires_at timestamptz not null, revoked_at timestamptz, user_agent text
);
create table operator_invites (
  id uuid primary key, token_hash bytea unique not null, created_by uuid references users,
  expires_at timestamptz not null, consumed_at timestamptz
);
create table assets (
  id uuid primary key, owner_id uuid not null references users,
  kind text not null check (kind in ('logo','image','holding','slate')),
  object_key text not null, mime text not null, width int not null, height int not null,
  bytes int not null, sha256 bytea not null, created_at timestamptz not null default now()
);
create table presets (
  id uuid primary key, owner_id uuid not null references users, name text not null,
  profile_preference text not null check (profile_preference in ('auto','full_hd','reliable_hd')),
  adaptation_mode text not null default 'auto' check (adaptation_mode in ('auto','fixed')),
  theme jsonb not null,            -- §10.5
  scenes jsonb not null,           -- §10.2, max 12 entries
  rundown jsonb not null,          -- §10.3, max 40 items
  audio_defaults jsonb not null,   -- mapping, gain, hpf, compressor, delay_ms
  destination_ids uuid[] not null default '{}',
  fallback_grace_s int not null default 120 check (fallback_grace_s between 60 and 600),
  record_default boolean not null default false,
  updated_at timestamptz not null default now(), archived_at timestamptz
);
create type session_lifecycle as enum
  ('DRAFT','PREPARING','READY','STARTING','SENDING','PARTIAL','RECOVERING','STOPPING','ENDED','INTERRUPTED');
create table stream_sessions (
  id uuid primary key, preset_id uuid references presets, name text not null,
  lifecycle session_lifecycle not null, generation int not null default 1,
  mode text not null default 'rehearsal' check (mode in ('rehearsal','ingest_test','live')),
  profile text,                            -- chosen at Start; immutable after
  config_snapshot jsonb not null,          -- copied non-secret preset config
  desired_state jsonb not null,            -- §12.1
  observed_state jsonb not null default '{}',
  recording_enabled boolean not null default false,
  uplink_test jsonb,                       -- §11.3 latest result
  created_by uuid references users, created_at timestamptz not null default now(),
  started_at timestamptz, ended_at timestamptz, end_reason text
);
create unique index one_active_session on stream_sessions ((true))
  where lifecycle not in ('ENDED','INTERRUPTED');   -- max_concurrent_sessions: 1
create table studio_leases (
  session_id uuid primary key references stream_sessions, holder_user_id uuid not null,
  holder_client_id uuid not null, generation int not null, expires_at timestamptz not null
);
create table command_log (             -- idempotency
  idempotency_key uuid primary key, session_id uuid, command text not null,
  actor uuid, result jsonb not null, created_at timestamptz not null default now()
);
create table camera_invitations (
  id uuid primary key, session_id uuid not null references stream_sessions,
  token_hash bytea unique not null, slot int not null default 1,
  expires_at timestamptz not null, consumed_at timestamptz, created_by uuid references users
);
create table camera_sources (
  id uuid primary key, session_id uuid not null references stream_sessions,
  invitation_id uuid references camera_invitations, slot int not null,
  label text not null, verification_phrase text not null,
  device_fingerprint bytea not null,       -- hash of a random per-device id stored on the phone
  status text not null check (status in ('pending','admitted','rejected','revoked')),
  admitted_at timestamptz, revoked_at timestamptz, capability_snapshot jsonb,
  credential_hash bytea, credential_expires_at timestamptz
);
create unique index one_admitted_per_slot on camera_sources (session_id, slot)
  where status in ('pending','admitted');
create table destinations (
  id uuid primary key, owner_id uuid not null references users,
  platform text not null check (platform in ('facebook','youtube')),
  label text not null, server_url text not null,
  key_enc bytea, key_last4 text, key_updated_at timestamptz,
  key_mode text not null check (key_mode in ('persistent','per_event')),
  auto_publishes_on_ingest text not null check (auto_publishes_on_ingest in ('yes','no','unknown')),
  watch_url text, event_reference text, enabled boolean not null default true,
  last_verified_at timestamptz, last_verification jsonb, archived_at timestamptz
);
create table session_destinations (
  session_id uuid references stream_sessions, destination_id uuid references destinations,
  session_key_enc bytea, session_key_last4 text,   -- per-event key (FB), wiped at ENDED
  desired_state text not null, observed_state text not null default 'READY_UNVERIFIED',
  failure_code text, attempts int not null default 0,
  live_confirmation jsonb,                          -- {source:'operator',at,by} §13.4
  primary key (session_id, destination_id)
);
create table sync_calibrations (
  id uuid primary key, source_fingerprint bytea not null, audio_mapping text not null,
  audio_device_label text not null, profile text not null, app_version text not null,
  offset_ms int not null check (offset_ms between 0 and 2000),
  measured_at timestamptz not null, measured_by uuid references users, method text not null
);
create table session_events (
  id uuid primary key, session_id uuid not null references stream_sessions,
  sequence bigint not null, generation int not null, kind text not null, severity text not null,
  actor text not null, occurred_at timestamptz not null, payload jsonb not null,
  unique (session_id, sequence)
);
create table diagnostic_summaries (
  session_id uuid references stream_sessions, window_start timestamptz, window_s int,
  metrics jsonb not null, primary key (session_id, window_start)
);
create table recordings (
  id uuid primary key, session_id uuid references stream_sessions,
  object_prefix text not null, segments int not null default 0, bytes bigint not null default 0,
  status text not null check (status in ('recording','uploading','complete','failed','deleted')),
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
```

Invariants (B§20.1), enforced in the database where possible:

- A single active session (partial unique index).
- A single pending or admitted camera per slot (partial unique index).
- An invitation claim is `UPDATE … SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING …`, executed in one transaction with the `camera_sources` insert.
- `session_events.sequence` comes from `SELECT … FOR UPDATE` on the session row, which makes it gap-free within a session.
- No table stores raw invitation tokens, raw contributor credentials, stream keys in plaintext, SDP, or ICE candidates.

Retention job (daily, in `control`):

| Data | Retention |
|---|---|
| Service summaries and events | 90 d |
| `diagnostic_summaries` | 30 d |
| Consumed or expired invitations | 7 d |
| Expired `auth_sessions` | 30 d |
| Recordings | 30 d, enforced by the object lifecycle rule **and** a DB sweep |
| Diagnostic captures | 24 h (B§20.3) |

---

## 6. Identity, roles and authorisation

### 6.1 Accounts

- **Bootstrap:** `docker compose exec control node dist/cli.js user:create-owner --email …` prompts for the password on the server and prints a TOTP enrolment URI and QR in the terminal. There is no public signup (B§23.1).
- **Operators:** the owner creates an invite in Settings, which is a one-time link valid for 72 h that the owner copies. The operator sets a display name and password and enrols TOTP. TOTP is **mandatory for everyone**.
- **Recovery codes:** 10 single-use codes, shown once at enrolment and stored hashed. If the owner loses everything, recovery is the server CLI `user:reset-mfa`.
- **Login:** email + password → TOTP. After 5 failures the account locks for 15 min. There is also a per-IP rate limit of 20 per 10 min. Error messages never reveal whether an email exists.
- **Browser session:** an opaque 256-bit cookie `rs_sid` with `Secure; HttpOnly; SameSite=Strict; Path=/`, stored hashed. Idle timeout 12 h. Absolute timeout 7 d. **An active live session keeps the operator's login alive**, so no logout happens mid-service. Expiry is deferred until the session reaches ENDED.
- **CSRF:** state-changing requests need `Origin` to equal the app origin **and** the header `X-RS-CSRF`, which must match a token from `/api/auth/me`. The WSS upgrade checks `Origin`.

### 6.2 Permission matrix

| Action | Owner | Operator | Camera contributor |
|---|---|---|---|
| Manage users, destinations (persistent keys), theme assets | ✓ | – | – |
| Create/edit presets | ✓ | ✓ (cannot change destinations list's underlying config) | – |
| Create session, pair camera, admit/revoke, run preflight | ✓ | ✓ | – |
| Paste the per-event key for a selected destination (write-only) | ✓ | ✓ | – |
| Start/stop sending, apply scenes, audio | ✓ (with lease) | ✓ (with lease) | – |
| Take over the studio lease | ✓ | ✓ only from their own other tab/device; taking over from someone else needs the owner | – |
| Enable recording, download recordings | ✓ | enable only | – |
| Camera: send video, receive tally, stop own camera | – | – | ✓ (own slot, own session) |

The server enforces this on every route and every WS message type. The UI hides controls as a convenience only.

---

## 7. Phone camera client (`/cam`)

### 7.1 Pairing flow (B§8.2, with details)

1. Studio: **Pair camera** calls `POST /api/sessions/{id}/pairings`. The server generates 32 random bytes, stores the SHA-256 hash, TTL 120 s, slot 1, and returns `https://{host}/cam#t={base64url}`. The studio renders it as a QR code with a 2-minute countdown and a **New code** button. Creating a new invitation invalidates any older unconsumed invitation for the same slot.
2. Phone: scan the QR code. The page reads `location.hash` and immediately runs `history.replaceState` to strip it. Stripping first means reloads, screenshots and history never show the token. Then the page `POST /api/pairings/preview {token}` and gets back the service name and the studio operator's display name. **Preview does not consume** the invitation (B§8.2 PAIR-03).
3. Phone shows: service name, a "Camera only" role badge, the explanation "This phone will send video only. Sound comes from the church mixer.", a label field (default `Camera 1`), and a **Join as camera** button.
4. **Join** runs `POST /api/pairings/claim {token, deviceId, label}`. This is an atomic consume. `deviceId` is a random 128-bit value kept in the phone's `localStorage` so a reconnecting phone can be recognised. The server creates a `camera_sources` row with status `pending`, generates a **verification phrase** (two words from a curated 256-word list plus a two-digit number, e.g. `river-lamp-42`), and returns a pending credential that can only open the pending WS channel.
5. Studio: a pending card shows the label, the phrase, and a device hint (user-agent summary, e.g. "Android · Chrome"). The operator compares the phrase with the one on the phone, then clicks **Admit** or **Reject**.
6. Admit issues a contributor credential: an opaque token with a 15-min TTL, renewed every 5 min over WS while the source is admitted (B§8.2 PAIR-05). The phone shows **Start camera**.
7. **Start camera** is a user gesture that calls `getUserMedia({audio:false, video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30, max:30}}})`.

Expiry and misuse cases (A03–A05): an expired, consumed or unknown token gets the same generic message, "This code is no longer valid. Ask the studio for a new one." A second concurrent claim loses the race and gets the same message.

### 7.2 Capture

- Inspect `track.getSettings()`. Show requested vs actual in diagnostics (CAM-01).
- If the actual size is below 1280×720, show a warning and let the operator try the fallback.
- Fallback: if the 1080p request fails with `OverconstrainedError`, retry with `{width:{ideal:1280},height:{ideal:720}}`.
- **Camera selector:** after permission is granted, `enumerateDevices()` lists video inputs. If there is more than one, show a selector labelled with the device labels exactly as the browser reports them. It never shows invented "Wide/Normal/Close" labels.
- **Assert no audio:** before adding tracks, check `stream.getAudioTracks().length===0` (CAM-02). **[DECISION, owner, 24 Sep 2026]** The peer connection carries one `sendonly` audio transceiver **with no track**, used only when the operator picks the phone as the sound source (§8.8). No microphone is opened until then; the browser test counts microphone opens on the phone and requires zero before that choice.
- **Errors mapped to plain messages (CAM-04):**

| Error | Message |
|---|---|
| `NotAllowedError` | "Camera permission was blocked. Tap the lock icon in the address bar → Permissions → Camera → Allow, then tap Try again." |
| `NotReadableError` | "The camera is being used by another app. Close other camera apps and try again." |
| `NotFoundError` | "No camera found." |
| `OverconstrainedError` | Automatic retry with the fallback. |

- **Stop camera** (CAM-05) stops tracks, releases the wake lock, closes the peer connection, and tells the studio.

### 7.3 Orientation

- A landscape guide overlay appears whenever `screen.orientation.type` starts with `portrait` (or, as a fallback, whenever `innerHeight>innerWidth`).
- If rotation happens anyway, the studio compositor keeps the output at 16:9 and applies the preset's framing policy: `contain` (the default) or `fill`. Output dimensions are never renegotiated (B§9.3).
- The phone self-preview is not mirrored for the rear camera.

### 7.4 Camera controls (I-16)

- **Zoom:** shown only if `track.getCapabilities().zoom` exists. The slider uses the reported min/max/step. After each `applyConstraints({advanced:[{zoom}]})`, the app reads `getSettings().zoom` back. If the read-back value differs from the request, it shows "Zoom not applied".
- The label is **"Zoom (browser-reported)"**. Chrome does not expose whether zoom is optical or digital, so the label never claims optical zoom. If WP2 observes that the A26 zoom is plainly a digital crop (visible pixelation compared with lens switching), label it "Digital zoom".
- The **studio operator** can also drive zoom remotely over the DataChannel (`cam.setZoom`). The camera operator's slider shows the same value. Last write wins, and a 300 ms indicator shows "Zoom changed by studio".
- Torch, focus and exposure: **not in R1** (B§9.2 allows auto-only). They are shown absent, not greyed out.

### 7.5 Wake lock, visibility, power

- `navigator.wakeLock.request('screen')` after capture starts. The UI shows a "Screen kept on" or "Screen may turn off. Keep tapping or change display timeout" indicator. The lock is re-requested on `visibilitychange` → visible.
- The phone always shows the banner "Keep this page open and the screen unlocked".
- On `visibilitychange` → hidden, the phone makes a best-effort attempt to send `cam.state {backgrounded:true}` over the DataChannel. The studio does not depend on this and detects frame starvation on its own (§9.8).
- **Battery:** shown only if `getBattery` exists, as "Battery 64% · charging". Otherwise "Battery information unavailable". No temperature is ever shown.

### 7.6 Phone UI (states)

| State | Main display |
|---|---|
| Preview | Service name, Join button |
| Pending | "Waiting for the studio to admit this phone", with the verification phrase in large type |
| Admitted/idle | Start camera button |
| Live | A full-screen preview, plus a tally bar across the top (see below) |
| Rejected / Revoked | "The studio removed this camera." Camera and credential released. |

Tally bar values:

| Tally | Colour | Text |
|---|---|---|
| `Connected, not on programme` | grey | shown as written |
| `On programme` | red | shown as written |
| `Reconnecting` | amber, blinking | shown as written |
| `Stopped` | — | shown as written |

- The platform state is shown separately and in small type: "Broadcast: sending to 2 platforms" or "Broadcast: not live".
- Network quality (`Good`, `Reduced quality`, `Unstable`, `Disconnected`) comes from studio-side receive stats relayed over the DataChannel. It shows one action, e.g. "Move closer to the router".
- Controls: **Stop camera** (with a confirm), camera selector, zoom (if available), **Rename** (the operator can rename from the studio too).
- No raw SDP, IP addresses or UUIDs appear anywhere.

---

## 8. Camera link (phone → studio)

### 8.1 Peer connection config

- `iceServers: []`. **No STUN, no TURN** on the camera connection (NET-02). Host candidates, including mDNS `.local` names, are all that is needed on one LAN. Leaving out STUN also stops the camera link from ever producing an srflx pair that crosses the internet.
- `bundlePolicy: 'max-bundle'`, `rtcpMuxPolicy: 'require'`.
- Video transceiver `sendonly` on the phone. `setCodecPreferences` puts H.264 (constrained baseline or high, whichever the phone supports; prefer `profile-level-id` 42e01f/640c1f variants) first and VP8 second.
- `degradationPreference: 'maintain-framerate'` on the sender.
- Initial `maxBitrate`: 1080p gets **8 Mbps**, 720p gets **4 Mbps**. The LAN has plenty of capacity. The cap limits phone heat and encoder load. WP2 tunes it.
- DataChannel `ctl`: ordered, reliable, created by the phone before the offer.

### 8.2 Signalling over WSS (initial)

`/ws?role=camera` authenticates with the contributor credential in the first message, never in the URL. Messages are listed in §17.2. The studio side is the answerer. SDP is relayed through `control` verbatim, never logged, and never persisted. Maximum message size is 64 KB. Rate limit: 50 msgs/10 s per socket.

### 8.3 DataChannel control (I-08)

After `connectionState==='connected'`, both sides use `ctl` for:

- `tally` (studio→cam)
- `quality` (studio→cam: a summary of received fps, resolution and loss, plus the network label)
- `cam.setBitrate` / `cam.setResolution` / `cam.setZoom` (studio→cam, each with `ack`)
- `cam.state` (cam→studio: capture settings, wake lock, battery, backgrounded)
- `ice.restart` offer/answer (either direction)
- `ping`/`pong` every 2 s

Every message carries `{v:1, seq, gen}`. `gen` is the session generation, and a receiver drops any message whose `gen` is lower than its own. If the WAN is down but the LAN is up, tally, controls and ICE restarts keep working (A08). The WSS reconnects in the background, and the server's copy of tally/state is reconciled when it comes back.

### 8.4 Route classification (NET-01, NET-03)

Every 1 s, the studio reads `getStats()` → the selected `candidate-pair` → local and remote `candidate` stats.

| Evidence | Label |
|---|---|
| Both candidates are `host` type, **and** the venue has a recorded WAN-block test pass in `venue_profile.wan_block_test_passed_at` (a settings record written by the installation runbook, A08), **and** the pair has stayed the same since connect | `Direct/local verified` |
| Both candidates are `host`, but there is no WAN-block test on record | `Direct/location unverified` |
| Either candidate is `relay` | `Relayed`. Should never happen with no TURN configured; treated as a critical bug. |
| Either candidate is `srflx`/`prflx`, or the stats are unavailable | `Unknown` |

The label shows in the Camera health group. Addresses are never shown. The report records the label timeline.

### 8.5 Direct-link failure (I-19, NET-04, A09)

- If ICE reaches `failed`, or is not `connected` within 15 s of the answer, the studio shows the **Camera can't connect directly** panel:
  1. "Is the phone on the production Wi-Fi `‹SSID from venue profile›`?" The SSID is stored as a plain label in the venue profile and is not detected.
  2. "Is the laptop plugged into the same router by Ethernet?"
  3. "Client/AP isolation must be off on the router. See runbook `camera-cannot-connect`."
  4. "Your laptop's browser policy may block local connections. Note the error code `CAM_ICE_FAILED` for the owner."
  - A **Try again** button performs an ICE restart. **Re-pair** creates a new invitation.
- The phone shows "Can't reach the studio laptop. Check you're on ‹SSID›."
- **There is no relay fallback in R1.** The spec keeps no configuration switch for one either. A future relay mode needs a new decision record.
- WP0 must prove that mDNS host candidates resolve between the A26 and the Dell (or the alternate laptop) on the production LAN. If they don't, that is a G2 stop condition (B§27.2).

### 8.6 Camera reconnection (B§8.3, A10–A11)

- **Phone side:** on `connectionState` `disconnected` it waits 3 s, then attempts an ICE restart over the DataChannel. If the DataChannel is down, it tries over WSS. On `failed`, or when the page returns from the background, it creates a new peer connection with the **same credential and `deviceId`**. The server accepts that only for the same `camera_sources` row. A different `deviceId` cannot take an admitted slot (B§8.3).
- **Studio side:** when frames return, the source becomes **Available**. It does **not** go back on programme automatically (`automatic_camera_return_to_programme: false`). The scene strip shows a pulsing **Camera ready: Cut back** hint.
- **Sync:** a reconnect marks the sync calibration `Recheck recommended` (SYNC-04) only if the received resolution, codec or frame rate changed, or if the outage lasted longer than 30 s. Rationale: a short ICE restart with the same parameters does not change the capture path, and flagging it every time would teach volunteers to ignore the warning.

### 8.7 Revocation

`DELETE /api/sessions/{id}/sources/{src}` does the following:

- Sets the status to `revoked` and invalidates the credential.
- Sends `revoke` over WSS **and** over the DataChannel.
- Makes the studio close the peer connection locally at once.

The phone stops its tracks when it receives `revoke`. The studio closing the connection and dropping the receiver makes termination take effect within 5 s even if the phone ignores the message (B§8.3, A12).

---

### 8.8 Phone as the sound source **[DECISION, owner, 24 Sep 2026]**

The owner asked for the phone to be usable as the sound source when the audio interface is not available: the phone's own microphone, or an iRig or similar input plugged into the phone. This narrows C-04 and CAM-02 as follows. The rest of C-04 stands.

- **Default unchanged:** the mixer through the laptop's interface is the programme sound. The phone sends no sound unless the operator picks **Phone sound** in Preparation → Audio.
- **Never automatic:** nothing switches to the phone (or from it) by itself. If the interface disconnects, the programme goes silent as before (A17). If the phone link drops while it is the source, the programme goes silent until the **same phone** reconnects; a different phone never inherits the choice.
- **Transport:** the empty audio transceiver from §7.2 carries the track (`replaceTrack`, no renegotiation). The phone opens the microphone with echo cancellation, noise suppression and auto gain off, ideal 2 channels at 48 kHz, and reports its label, channel count and any processing it could not turn off in `cam.state.audio`. Opus at up to 128 kb/s; the studio's answer sets `stereo=1` so a stereo input stays stereo.
- **Studio:** the remote track feeds the same graph as the interface (routing, gain, HPF, compressor, delay, meters). Chrome only feeds a remote WebRTC track to Web Audio while a (muted) media element plays it, so the receiver keeps one.
- **Trade-offs shown to the operator:** the sound shares the phone's Wi-Fi link with the picture; lip-sync still uses the delay control.

## 9. Studio UI (`/studio`)

### 9.1 Screens (B§10.1 mapped to routes)

| Route | Screen | Notes |
|---|---|---|
| `/studio` | S01 Service home | Presets list, **New service**, **Duplicate last**, and the last outcome (from its report). No auto-broadcast. |
| `/studio/presets/:id` | Preset editor | Theme, scenes, rundown, audio defaults, destinations selection, grace, record default. |
| `/studio/session/:id/prepare` | S02 Preparation | Devices, routing, sync, uplink test, destination keys, readiness. |
| `/studio/session/:id/live` | S03 Live studio | See §9.2. |
| `/studio/destinations` | S05 Destination setup | Owner only. |
| `/studio/session/:id/report` | S06 Service report | |
| `/studio/settings` | Users, venue profile (SSID label, WAN-block test record), storage | Owner only. |
| `/cam` | S04 Camera client | §7 |

Preparation and Live share one persistent **media runtime** instance. Moving between the two routes never recreates the camera connection, the audio graph or the WHIP connection (B§11.1).

### 9.2 Live layout at 1366×768 (B§10.2)

```text
┌──────────────────────────────────────────────────────────────┬────────────────────┐
│ [Sunday service ▾]  ● SENDING 00:42:13   Mode: LIVE   [?]    │  [■ Stop sending]  │  ← top bar 44px
├──────────────────────────────────────────────────────────────┼────────────────────┤
│ Critical banner (persistent, only when present)              │ HEALTH             │
├──────────────────────────────────────────────────────────────┤ Camera link   ●    │
│ Programme preview - before platform delay                    │ Mixer audio   ●    │
│ ┌──────────────────────────────────────────────────────────┐ │ Programme up  ●    │
│ │                                                          │ │ Destinations       │
│ │               960×540 programme preview                  │ │  Facebook  SENDING │
│ │                                                          │ │  YouTube   LIVE ✓  │
│ └──────────────────────────────────────────────────────────┘ │ ─────────────────  │
│ Draft: [Lower third ▾ "Pastor John – Sermon"] [Edit] [Apply] │ AUDIO  ▮▮▮▮▯ -12dB │
│                                                              │ [Mute programme]   │
├──────────────────────────────────────────────────────────────┤ Delay 120 ms       │
│ SCENES  [1 Camera][2 Cam+LT][3 Text][4 Image][0 Holding]     │ Timeline ▸         │
│ RUNDOWN ◂ Prev  3/14 "Reading – John 3:16"  Next ▸          │ [Privacy: Hold+Mute]│
└──────────────────────────────────────────────────────────────┴────────────────────┘
```

- The preview is the **actual programme canvas** scaled with CSS (`object-fit: contain`). It is not a second render (B§10.2).
- The right panel is 300 px wide. The whole layout fits 1366×768 at 100 % zoom with no horizontal scroll (A44).
- **Stop sending** is always top-right, and neither toasts nor modals other than its own confirm ever cover it. Toasts appear bottom-left.

### 9.3 Health groups (B§24.3)

Four groups: Camera link, Mixer audio, Programme upload, Destinations. Each has:

- A status of `ok` / `warn` / `critical` / `unknown`, shown with an icon and a word, not just colour.
- A one-line plain-language summary.
- A last-updated age, which turns "stale" after 5 s without an update.
- A click-through to details.

The **dominant issue** is the single highest-severity item. It is the one-click "open dominant issue" action (B§10.3). Overall readiness never shows ok while any group is critical or unknown.

Example summaries:

- "Camera good · 1080p30 received · Direct/location unverified"
- "Mixer audio silent for 20 s (you can mark this as intentional)"
- "Programme reaching server · 7.8 Mbps · 1080p30"
- "YouTube sending · Facebook rejected key"

### 9.4 Operator actions in one click (B§10.3)

Each of these is one action from Live:

- Cut to camera
- Show the current rundown text card
- Show holding
- Hide lower third (cuts from Cam+LT to Camera)
- Mute/unmute programme audio
- Open dominant issue
- Stop sending (which opens the confirm modal)
- **Privacy: Hold + Mute**, the emergency action. It is styled in red outline, is visually distinct from the scene buttons, and needs no confirmation. Undoing it takes two separate actions.

### 9.5 Preparation screen (S02)

Checklist cards in a single column, each with a status:

1. **Camera:** Pair (QR), pending admission, admitted, capture settings, route label, a short **movement test** checkbox ("Walk the route while watching the preview"), and a framing policy toggle (Contain / Fill).
2. **Audio:** device selector (from `enumerateDevices`, labels only), the applied-constraints report (echoCancellation, AGC and noise suppression all off, or a warning), the channel count the browser reports, routing mode, gain, an HPF toggle, a compressor toggle, input and programme meters, and a **channel identification test**: "Play something into Input 1 only. Which meter moved?" (A15/A16).
3. **Sync:** delay control (§10.4.3), calibration status, and a **Private test clip** button (§11.4).
4. **Upload:** **Run uplink test** (§11.3), the result, and the profile choice.
5. **Destinations:** each selected destination, its key status (per-event key paste, §13.3), its `auto publishes` flag, a watch link, and a deselect option.
6. **Content:** the rundown loaded, all assets decoded (the count of ready assets), and the starting scene.
7. **Readiness:** a `POST /preflight` result grouped into Blocking / Warnings / Info. Each warning has an **Acknowledge** action with an optional reason, which is recorded. Blocking checks cannot be acknowledged.

Mode switch at the top: **Local rehearsal** (the default) | **Private ingest test** | **Go live…**. Each mode has a full-width coloured banner: grey "REHEARSAL: nothing leaves this laptop", blue "PRIVATE TEST: sending to Raeltec server only", red "LIVE" (B§18.3). A **Platform test** is just Go live with destinations the owner has set to test or unlisted events. The Start modal restates the auto-publish risk.

### 9.6 Start and stop confirmation (B§16.4–16.5, I-11)

**Start sending** modal:

- Lists each destination as `Label · platform · auto-publishes: yes/no/unknown`, with a warning when the answer is yes or unknown: "Viewers may see this immediately".
- Shows the starting scene (with a thumbnail), audio source and mapping, profile, recording on/off, and all unresolved acknowledged warnings.
- The buttons are **Cancel** (focused) and **Start sending to 2 destinations**.
- Enter activates the focused button, so Enter cancels.

**Stop sending** modal:

- "Stop sending to: Facebook church page, YouTube church channel. The platforms may take a moment to end the broadcast. Check them afterwards."
- Buttons **Keep sending** (focused) and **Stop sending**. Enter does not confirm, and Esc cancels.
- After confirmation the modal shows server acknowledgement progress per destination.
- If the control connection is lost, it shows: "We couldn't confirm the stop. Open Facebook/YouTube and end the broadcast there." It includes the watch-page links.

### 9.7 Keyboard shortcuts (I-16, B§10.3)

Enabled by default. Owners can turn them off in the preset.

| Key | Action |
|---|---|
| `1` | Camera |
| `2` | Camera + current lower third |
| `3` | Current text card |
| `4` | Current image |
| `0` | Holding |
| `←` / `→` | Previous/next rundown item. Selects the **draft** only; never applies it. |
| `Enter` | Apply draft, **only** while focus is on the Apply button |
| `Shift+M` | Mute toggle |
| `Shift+H` | Privacy Hold + Mute |

- **Stop has no shortcut.**
- Shortcuts are ignored whenever `document.activeElement` is an input, textarea, select, `contenteditable` or a slider, and whenever a modal is open.
- Key auto-repeat (`event.repeat`) is ignored. This prevents the accidental two-second key press (B§10.3).
- A `?` overlay lists the shortcuts.

### 9.8 Critical banners and the timeline

- Critical issues show as a persistent banner under the top bar, one line per active issue, each with **Details** and **Acknowledge**. Acknowledging dims the banner but keeps the health group red while the condition lasts (B§17.2).
- The **Timeline** drawer lists `session_events` in plain language, for example "10:42 Camera stopped sending; holding slide applied".

### 9.9 Accessibility and copy

- All text comes from `packages/i18n/en.json` (I-21). No copy is hard-coded in components. A CI lint rule forbids JSX string literals except in tests.
- WCAG 2.2 AA contrast. Every control has a visible focus ring and a label. Status is always icon + word + colour.
- A dark studio theme is the default, because churches are dim. A light theme is optional.

### 9.10 Second tab / takeover (B§8.4, A33)

- A studio tab opened while another client holds the lease opens **read-only**. It shows a grey "Viewing only. ‹Name› is running the studio on another tab/device" banner and a **Take over** button.
- Takeover asks for a confirmation, then runs `POST /takeover`: the generation increments, the old WHIP session is deleted (the old client's contribution dies and the server fallback slate covers the gap), and the new client re-creates the media runtime and WHIP publish.
- Takeover does **not** carry the camera peer connection across. The camera reconnects to the new studio client: the server tells the phone to renegotiate with the new client, using the same slot and no re-admission.
- The old tab becomes read-only as soon as it receives `lease.lost` or its next command gets `409 STALE_GENERATION`.

---

## 10. Programme compositor, scenes, rundown, audio

### 10.1 Media runtime (`packages/media-runtime`)

The runtime is a plain TypeScript singleton created once per studio page load and exposed to React through a small store adapter (`useSyncExternalStore`). It owns these controllers, each of which has `start`, `stop`, `dispose` and observable state:

- `CameraReceiver`: the peer connection, `ctl` channel, a hidden `<video>` element, a `requestVideoFrameCallback` frame counter, and stats.
- `AudioEngine`: one AudioContext at 48 kHz (`latencyHint:'interactive'`) and the graph from §10.4.
- `Compositor`: the programme canvas, scene renderer and asset cache.
- `ProgrammePublisher`: the WHIP client, the programme peer connection, and the contribution adaptation logic.
- `StatsCollector`: 1 Hz `getStats` on both peer connections, computes deltas, produces health, and uploads 10 s aggregates.

Browser media objects never enter React state (B§22.2). A test runs a mount/unmount loop 50 times and checks that the counts of tracks, AudioNodes and peer connections return to baseline.

### 10.2 Compositor

- **Canvas:** an `HTMLCanvasElement` sized to the profile: 1920×1080 or 1280×720. It uses a Canvas 2D context with `{alpha:false, desynchronized:true}`. `captureStream(30)` is called **once**, producing one long-lived track (B§11.1).
- **Clock:** a dedicated Web Worker posts ticks every 33.33 ms, which drifts less than `setInterval` in a throttled tab. On each tick the compositor draws the current scene. The camera `<video>` is drawn only if a new frame arrived since the last tick. Otherwise the tick redraws the last frame, and the 2 s stall timer (§12.6) runs. **[DECISION]** Frame arrival is detected from `requestVideoFrameCallback` **or** a rise in `getVideoPlaybackQuality().totalVideoFrames`, checked on every tick. Chromium stops `requestVideoFrameCallback` in a hidden tab while frames keep arriving and drawing (measured, Chromium 1194), so relying on it alone cut the programme to the slate whenever the operator switched tabs. Overlays are pre-rendered to `OffscreenCanvas`/`ImageBitmap` whenever their content is applied, so each tick is at most 3 `drawImage` calls.
- **Framing:**
  - `contain` letterboxes or pillarboxes on the theme's background colour (default black).
  - `fill` centre-crops.
  - A rotated phone (portrait frames) is handled by the same policy: contain gives pillarboxing.
- **Transitions:** cuts only in R1. The optional 250 ms fade is behind a flag that stays off until P-07 passes with it on (B§11.3).
- **Apply acknowledgement:** `applyScene(version)` resolves only after the first tick that drew the new version. The runtime then emits `scene.applied {version, drawnAt}`, the UI shows the scene as applied, and the server records the event (B§11.3). If an asset is not decoded, `applyScene` rejects with `ASSET_NOT_READY`, the programme stays as it was, and a toast explains why.
- **Scene types (B§11.2), stored in `preset.scenes`:** `camera`, `camera_lower_third`, `text`, `image`, `holding`.
  - Maximum 12 scene entries (B§11.4). Typically 1 camera, 1 camera+LT, 1 text, up to 8 images, 1 holding.
  - Each scene has `audio: 'continue' | 'mute'`. The default is `continue`. `holding` also defaults to `continue`. Only the privacy action mutes.
- **Layers:** at most one video, one logo, one LT/text layer and one background (B§11.4).
- **Quality label (B§11.5):** the health panel shows "Camera received at ‹WxH›; programme output ‹WxH›", with "(upscaled)" when the received height is below the output height.

### 10.3 Rundown (I-09)

- `preset.rundown` is an ordered list, maximum 40 items. **[DECISION]** The brief's 12-entry limit (B§11.4) applies to scenes, and rundown items are content for those scenes. Each item is one of:
  - `{type:'lower_third', line1 (≤48 chars), line2 (≤64 chars)}`
  - `{type:'text', title?, body (≤600 chars, ≤10 lines after wrap), reference?}`
  - `{type:'image', assetId, fit:'contain'|'fill'}`
- The **rundown cursor** is in session state. Next and Prev move the cursor and load the item into the **draft panel**. Nothing reaches the programme until **Apply to programme** (B§10.2, A23).
- If the current scene already shows that content type, Apply swaps the content in place. If not, Apply updates the draft only, and the operator then presses the scene button. Scene buttons always show the **applied** rundown item.
- **Live edits:** the draft panel edits the current item. **Save to rundown** persists it to the session copy (and optionally **Also save to preset**). Adding a new item inserts it after the cursor.
- Text layout: fixed layouts auto-fit by measuring and shrinking the font in steps from 64 px down to 36 px at 1080p. If the text still doesn't fit, Apply is blocked with "Text too long for the card. Shorten it or split it into two cards".
- The draft thumbnail is a 320×180 static render made on edit, debounced to 150 ms. It is not a second live canvas (B§10.2).

### 10.4 Audio engine (B§12)

1. **Capture:**

   ```js
   getUserMedia({audio:{deviceId:{exact:id}, echoCancellation:false, autoGainControl:false,
   noiseSuppression:false, channelCount:{ideal:2}, sampleRate:{ideal:48000}}, video:false})
   ```

   The app reads `getSettings()` and shows a warning for any processing that could not be turned off. If `channelCount` is 1, the stereo routing modes are disabled with the explanation "The browser is giving us one channel from this device." The preferred device is remembered by **label** in the preset, because device ids can change (B§12.1). On a label mismatch, the app asks the operator to pick a device.
2. **Graph:** `MediaStreamSource → ChannelSplitter(2) → routing matrix (GainNodes) → ChannelMerger(2) → input meter tap → user gain (−24 to +12 dB) → [HPF: BiquadFilter highpass 80 Hz, Q 0.707, bypassable] → [Compressor: DynamicsCompressor threshold −18 dB, knee 6, ratio 2.5, attack 10 ms, release 250 ms, bypassable, labelled "Gentle compressor", never "limiter"] → programme mute gain → delay stage → programme meter tap → MediaStreamDestination (programme track)`. An optional monitor branch comes off after the delay: `→ monitor gain → ctx.destination`. It is off by default, turned on by a user gesture, and labelled "Headphones recommended" (B§12.5). The monitor branch never connects back into the destination.
   - **[DECISION]** No limiter in R1. B§12.3 allows one only if qualified. The HPF and compressor are the I-16 extras.
3. **Delay stage (SYNC-01):** two `DelayNode(maxDelayTime=2.1)` in parallel with crossfade gains.
   - A new value is set on the idle delay line, which then fades in over 40 ms while the other fades out. This avoids the pitch-bend or zipper artefacts you get from changing `delayTime` on a live line.
   - Input is 0–2000 ms in 10 ms steps, with numeric entry, ±10 and ±50 buttons, and Reset. The value is clamped and the applied value is shown.
   - The sign text reads: "Increase audio delay when sound happens before the matching movement."
4. **Routing modes (B§12.2):** `in1_both` (the default), `in2_both`, `stereo_12`, `mono_blend` with `(L+R)×0.5`. The labels show "dual-mono" for the first two and the last.
5. **Meters:** an `AudioWorkletProcessor` computes peak and RMS per 128-sample block and posts them at 30 Hz. The UI shows dBFS with ballistics (peak hold 1.5 s). Any sample |x| ≥ 0.999 on the input tap lights **CLIP** for 2 s and increments a counter.
6. **Silence detection:** input RMS below −60 dBFS for 15 s while unmuted raises `AUDIO_SILENT` (warn). Actions: **This is intentional (mute warning for 5 min)** or **Details**. Never auto-gain or auto-stop (B§12.4, A21).
7. **Device loss:** on track `ended`, or on `devicechange` where the device label disappears:
   - The source node is disconnected. The graph continues and outputs digital silence, so the programme track stays alive.
   - **`AUDIO_DEVICE_LOST`** is raised as critical.
   - No other device is selected automatically (C-04, A17).
   - When the device comes back (by label), the operator sees "Behringer USB audio is back: Reconnect". Reconnecting reselects the device and marks sync `Recheck recommended` (A18).

### 10.5 Theme (I-10)

**[DECISION, M6]** One **church-wide** theme (stored on `venue_profile.theme`, edited by the owner in Settings → Church look) instead of one per preset. There is one church and one brand, and a service started without a preset must still carry the logo. Schema: `packages/contracts/src/theme.ts`. The on-air drawing code (`packages/media-runtime/src/overlays.ts`) also renders the Settings preview. A bottom-left logo lifts the lower third above it.

`preset.theme`:

- `logoAssetId`, `logoCorner` (tl, tr, bl, br), `logoScale` (0.06–0.15 of the width)
- `primaryColor`, `secondaryColor` (hex, with a contrast check against white text ≥ 4.5:1)
- `font`, chosen from 3 bundled fonts: Inter, Source Serif 4, Atkinson Hyperlegible. The fonts are served same-origin as `woff2` and loaded via `FontFace` before the first render.
- `holdingAssetId`, `slateAssetId`, `backgroundColor`

Fixed layouts:

- **Lower third:** a bar in the bottom 18 % of the frame with a 64 px safe margin. line1 is bold at 44 px and line2 is regular at 32 px (1080p values; 720p scales them).
- **Text card:** full-frame primaryColor background, title, body and reference. Auto-fit as in §10.3.
- Logo safe margin: 48 px.

### 10.6 Assets (B§11.4)

**[DECISION, M6]** Upload is `POST /api/assets` with the raw image as the body (not multipart), CSRF-checked like every change. Re-encoded images are stored **in PostgreSQL** (`assets.data`), not on a volume: they are small, and the database backup then covers them (§M9). Everything else below stands: magic bytes, full decode with `sharp`, no animation or SVG, ≤10 MB and ≤4096 px, metadata stripped, sRGB, PNG only when there is transparency.

- Upload is `POST /api/assets` (multipart). The limits are 10 MB and ≤4096 px on each side. Accepted types are PNG, JPEG and WebP, detected by **magic bytes** and a full decode with `sharp`. Animated images and SVG are rejected.
- `sharp` re-encodes the image, which strips metadata, and normalises it to sRGB. Output:
  - PNG if the image has alpha, otherwise JPEG quality 90.
  - Stored under `data/assets/{sha256}.{ext}` on a persistent volume. Assets are small, so object storage is not needed (B§20.2).
  - Served same-origin with `Cache-Control: private, max-age=31536000, immutable` and `Cross-Origin-Resource-Policy: same-origin`.
- The compositor preloads every asset referenced by the session into `ImageBitmap`s during Preparation. The readiness check "Content" counts decoded assets.

---

## 11. Contribution (studio → media node)

### 11.1 WHIP

- `POST /api/sessions/{id}/ingest` (lease holder only) returns the following. Destination keys are never included.
  - `whipUrl`: `https://{host}/whip/live/{sessionId}/g{generation}/contrib/whip`
  - `bearer`: a 256-bit ingest token scoped to that path, TTL 30 min, renewed every 10 min over WSS
  - optional `iceServers` for the contribution: **TURN/TLS only if enabled** in deployment config, off by default (§15.3)
- MediaMTX uses `authMethod: http` with `authHTTPAddress: http://control:3000/internal/mediamtx/auth`. Control allows `publish` only for the exact path, the current generation, and a valid token. It allows `read` only for `127.0.0.1` supervisor processes that present an internal secret. Everything else is denied (A42).
- The client does a standard WHIP POST of the SDP offer, receives `201` + `Location`, supports PATCH for ICE restart, and DELETEs on stop or dispose. Failure codes (B§15.1):

| HTTP / condition | Error code | Action |
|---|---|---|
| 401/403 | `INGEST_AUTH` | Stop. Do not retry. |
| 415/400 | `INGEST_MEDIA_UNSUPPORTED` | Stop. Do not retry. |
| Timeout | `INGEST_TIMEOUT` | Retry with backoff. |
| 409 (stale generation) | `STALE_GENERATION` | The tab becomes read-only. |

- One WHIP session per generation. Reconnect attempts reuse the resource via PATCH/ICE restart first, and create a new session only after `failed`. The old resource is always deleted first (best-effort DELETE with a 2 s timeout, since MediaMTX also reaps sessions on timeout).
- **Programme transceivers:**
  - Video: `sendonly`, H.264 preferred and VP8 as fallback. The supervisor normaliser accepts both.
  - Audio: Opus, stereo (`sprop-stereo=1; stereo=1`), `maxaveragebitrate=192000`, no DTX, no FEC changes beyond the default. The Opus → AAC conversion happens in the normaliser (B§15.2).
  - `maxBitrate` comes from the profile ceiling, and `degradationPreference: 'maintain-framerate'`.

### 11.2 Profiles (B§14.2)

| Profile | Canvas | Contribution ceiling | Public output |
|---|---|---|---|
| `full_hd` | 1920×1080 | 8 Mbps | 1080p30 H.264 Main 6 Mbps CBR-ish, keyframe 2 s, AAC-LC 128k 44.1 kHz stereo |
| `reliable_hd` | 1280×720 | 4.5 Mbps | 720p30 H.264 Main 3.8 Mbps, keyframe 2 s, same audio |
| Recovery (state, not a profile) | unchanged | 1.5–3 Mbps, frame rate may drop to 15 | unchanged envelope; the normaliser duplicates frames to hold 30 fps |

The profile is fixed at Start (B§14.3). Changing it means Stop, then Start with the other profile. That is a deliberate operator action with a warning that viewers will see a break.

### 11.3 Uplink test and profile choice (I-04, I-05)

**[DECISION, M7]** R1 runs the HTTP throughput part only (2 MB uploads from 4 parallel workers, up to 40 MB or 20 s, bytes counted by control as they arrive). The private test already exercises the WebRTC media path and shows its sending rate; the 15 s synthetic WHIP probe below is deferred. The offer thresholds are unchanged.

**Run uplink test** runs only in Preparation and never during SENDING (B§18.1).

1. **HTTP throughput:** the browser streams 40 MB of random bytes as `POST /api/uplink-test/sink` to the VM in 4 parallel fetches, for up to 20 s. Control counts the bytes received and reports Mbps over the middle 10 s.
2. **UDP media path:** a 15 s WHIP publish to the private `test/{sessionId}` path, carrying a synthetic high-motion canvas (a moving noise pattern) with `maxBitrate` 10 Mbps. The test records the achieved `bytesSent` rate, `packetsLost`/`retransmittedPacketsSent` and RTT, plus server-side bytes from the MediaMTX API.

Result:

- `sustainedMbps = min(http, webrtc)`
- `offer = full_hd` if ≥ 12 Mbps and loss < 2 %; `reliable_hd` if ≥ 7 Mbps; otherwise `insufficient`

Rules:

- `profile_preference: auto` selects the offer.
- The operator can always choose a lower profile.
- Choosing higher than the offer is a **warning that needs acknowledgement with a reason**.
- `insufficient` makes Reliable HD available only with that warning.
- No test result → a warning, "Upload not measured".

The result is stored in `stream_sessions.uplink_test` and shown in the report. The data uses about 40 MB plus ~20 MB per test, and the UI says so.

### 11.4 Private ingest test and sync calibration (SYNC-03, SYNC-05, B§18.3)

**[DECISION, M6]** The test clip is recorded **in the studio browser** from the outgoing programme tracks (canvas video + delayed programme audio, `MediaRecorder`), not by the supervisor. It is exactly what is sent, it needs no consent for storage because it never leaves the browser, and it works in any test environment. The media node's own A/V offset is measured separately (2–6 ms, ADR-0003). The frame-step player, waveform strip, automatic clap suggestion (operator-confirmed), the 80 ms "audio late" rule and `sync_calibrations` are as below. A calibration is valid for the camera label + received height + codec, the audio input, routing, profile and the delay; any change shows **Recheck recommended**.

- **Private ingest test** mode creates a real contribution and a normaliser but **no publishers**. The operator can press **Record a 20 s test clip**, which requires explicit consent. The supervisor records the normalised output to `data/diag/{sessionId}/{ts}.mp4` and serves it back through `GET /api/sessions/{id}/diag/{clip}` for in-browser playback, with frame-stepping controls (`,` and `.` step one frame at 30 fps).
- Calibration procedure (shown in-app):
  1. Someone claps or uses a clapperboard in front of the camera, close to a mixer-fed mic.
  2. Record the clip.
  3. Frame-step to the clap frame and read the audio waveform strip, which the page renders under the video from the decoded clip audio.
  4. Adjust the delay.
  5. Repeat until the result is within ±1 frame (33 ms).

  The app shows the **measured offset**, computed from the frame the operator marks as the visual event and the audio onset the app detects automatically (the first peak ≥ −20 dBFS after silence, **shown as a suggestion the operator confirms**). This is operator-confirmed measurement, not automatic sync (B§13.2).
- **Save calibration** writes `sync_calibrations` with the fingerprint (camera `deviceId` hash + received resolution/codec), mapping, device label, profile, app version and `method: 'clap_clip'`.
- If the audio arrives **later** than the video by more than 80 ms even at 0 ms delay, the app shows: "Audio is arriving later than video. Audio delay cannot fix this configuration." It is recorded as a failed check (B§13.2).
- Clips auto-delete after 24 h. **Export** downloads a clip for the evidence pack.

### 11.5 Contribution adaptation (B§14)

**[DECISION, M8]** Built as one `StepController` rule set (`packages/media-runtime/src/adaptation.ts`) used by both controllers. Upload congestion = `qualityLimitationReason` bandwidth, or `availableOutgoingBitrate` below 90 % of the current ceiling. The camera controller acts on loss > 2 %, freezes, or received fps below 80 % of what the phone reports capturing, so a dim room (the phone itself at 15 fps) never lowers the camera bitrate. `cam.setResolution` is not built; the bitrate steps stop at 2 Mb/s. Each change is a session event and appears in the report.

The camera controller and contribution controller are independent state machines, each evaluated at 1 Hz.

**Contribution controller signals:**
- `availableOutgoingBitrate`
- the ratio of `bytesSent` to target
- `qualityLimitationReason` (cpu | bandwidth)
- the RTT trend
- `framesEncoded` delta vs 30

**Contribution controller actions:**
- *Bandwidth:* ceiling steps down 8 → 6 → 4.5 → 3 → 1.5 Mbps (720p: 4.5 → 3 → 2 → 1.5).
- *CPU:* first reduce the preview (the right panel's meters drop to 10 Hz, and the draft thumbnail rendering pauses). Then fall back to `scaleResolutionDownBy` 1.5. As a last resort, set `maxFramerate` 15. When the public output is not affected, the UI shows "Recovery quality (source)".

**Camera controller signals:**
- received fps
- `framesDropped`
- `jitterBufferDelay` per emitted
- `packetsLost` delta
- `freezeCount`

**Camera controller actions:** send `cam.setBitrate` steps 8 → 5 → 3 → 2 Mbps, then `cam.setResolution` 720p.

**Rules for both controllers:**
- Degrade after 5 s of sustained evidence.
- At least 20 s between automatic changes.
- Upgrade after 60 s of stability, one step at a time.
- In `fixed` mode, report only (B§14.4).
- **Audio is never muted** as a quality measure.

Every change emits an event, e.g. "Upload congested: programme source quality reduced to 4.5 Mbps".

---

## 12. Media node: supervisor, normaliser, publishers, fallback, recording

### 12.1 Desired and observed state

`stream_sessions.desired_state`:

```json
{ "generation": 3, "mode": "live", "profile": "full_hd",
  "normaliser": "running",
  "publishers": { "<destId>": "running" },
  "recording": "running",
  "fallbackGraceS": 120, "stopRequestedAt": null }
```

- The supervisor loop reacts to `NOTIFY desired_changed` and also runs every 2 s.
- It compares desired state with the processes and MediaMTX paths it observes.
- It writes `observed_state` together with per-component `{state, since, detail, lastProgressAt}`.
- **Stop wins:** once `stopRequestedAt` is set, no reconnect or restart timer can start a process (A34).
- **Fencing:** every process is spawned tagged with its generation, and the supervisor kills any process whose generation is below the desired generation.

### 12.2 MediaMTX paths (created per session through the MediaMTX config API; static config holds only defaults)

| Path | Source | Readers | Notes |
|---|---|---|---|
| `live/{sid}/g{gen}/contrib` | WHIP from the studio | normaliser (RTSP, localhost) | Publish auth via control. |
| `norm/{sid}/{rand128}` | normaliser (RTSP publish, localhost) | publishers, recorder | `alwaysAvailable: yes`, `alwaysAvailableFile: slate-{sid}-{profile}.mp4` (§12.5). `record` is toggled via the API when recording is on. |
| `test/{sid}` | uplink-test WHIP | none | Deleted after the test. |

MediaMTX's RTSP (8554) and API (9997) listeners bind to the Docker internal network or loopback only.

### 12.3 Normaliser

The supervisor spawns FFmpeg with an argument array (no shell, B§23.3) and an empty environment apart from `PATH`:

```text
ffmpeg -hide_banner -loglevel warning -nostats -progress pipe:3
  -rtsp_transport tcp -timeout 5000000 -i rtsp://127.0.0.1:8554/live/{sid}/g{gen}/contrib
  -map 0:v:0 -map 0:a:0
  -vf "scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"
  -c:v libx264 -preset veryfast -tune zerolatency -profile:v main -bf 0
  -b:v {6M|3.8M} -maxrate {6M|3.8M} -bufsize {12M|7.6M}
  -g 60 -keyint_min 60 -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*2)"
  -color_primaries bt709 -color_trc bt709 -colorspace bt709
  -af "aresample=async=1:first_pts=0" -c:a aac -b:a 128k -ar 44100 -ac 2
  -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/norm/{sid}/{rand}
```

- `-bf 0` and `zerolatency` are used provided that both platforms accept them in G5 (B§15.2). Otherwise drop `-tune zerolatency`, allow `-bf 2`, and record an ADR.
- `aresample=async=1` keeps the audio continuous across small timestamp gaps. Monotonic output is verified by the media test harness (ffprobe on recorded output, which must show PTS strictly increasing) (B§13.3).
- **Health:**
  - The `-progress` pipe gives `out_time_us`, `fps`, `speed` and `bitrate`.
  - The normaliser is `stalled` if `out_time_us` has not advanced in 3 s.
  - It is `slow` if `speed < 0.97` for 10 s. That raises a warning, and P-12 headroom is tracked.
- If the chosen versions cannot hold timing or the fallback behaviour, replace the normaliser with GStreamer behind `media-node-adapter` (B§5.3). That needs an ADR.

### 12.4 Publishers (B§15.4)

One FFmpeg process per destination:

```text
ffmpeg -hide_banner -loglevel warning -nostats -progress pipe:3
  -rtsp_transport tcp -i rtsp://127.0.0.1:8554/norm/{sid}/{rand}
  -map 0 -c copy -f flv -flvflags no_duration_filesize
  -rw_timeout 10000000 "{rtmps_url}/{key}"
```

- **Isolation:** each publisher is a separate OS process with its own restart timer. Each reads the normalised path independently from MediaMTX, which fans out to readers. One stalled destination therefore cannot stall another (A28, P-10).
- **Queue bound:** MediaMTX keeps a per-reader write queue. Set `writeQueueSize` so that a reader more than about 2 s behind is dropped. The publisher then exits and restarts at the next keyframe (B§15.4). WP4 verifies this with a throttled test sink.
- **Progress:** `SENDING` when `total_size` is advancing and the process has been up more than 3 s. `stalled` when there has been no size progress for 10 s. In that case the supervisor kills the process and treats it as a network failure.
- **Error classification** from stderr (redacted before storage):

| stderr | Classification |
|---|---|
| `401`, `403`, `Unauthorized`, or connection closed immediately after `connect` with `NetStream.Publish.BadName` or equivalent | `DEST_AUTH_REJECTED`, non-retryable |
| `Connection refused`, `timed out`, `Broken pipe`, or I/O error | `DEST_NETWORK`, retryable |
| `Invalid data`, or codec/format errors | `DEST_MEDIA_REJECTED`, non-retryable |

WP4 builds the stderr pattern table from real rejections and stores it in `media-node-adapter/src/classify.ts` with fixtures.
- **Retry:** backoff 1, 2, 4, 8, then 15, 15, … seconds with ±20 % jitter, while the session is SENDING/PARTIAL/RECOVERING. There is no attempt limit for network errors, but the operator sees the attempt count. Auth and media errors stop after the **first** occurrence, set FAILED, and prompt the operator to fix the key (B§17.1).
- **Stream key handling:**
  - The key is decrypted in the supervisor immediately before spawn and passed as part of the output URL argument.
  - **Mitigations** for key exposure through `/proc/*/cmdline`: the supervisor container runs as a dedicated non-root user with `hidepid=2` on `/proc` in the container, no other workloads share the container, and diagnostics never capture process lists. The supervisor's logger redacts any string matching the stored keys (exact match) or the pattern `rtmps?://[^ ]+/[^ ]+`.
  - A test greps every log and report output for the test keys (A40).
- **Endpoint allowlist (B§16.2, B§23.3)** in `infra/media/destinations-allowlist.yml`:
  - `facebook`: `rtmps://live-api-s.facebook.com:443/rtmp/`
  - `youtube`: `rtmps://a.rtmps.youtube.com/live2`, `rtmps://b.rtmps.youtube.com/live2?backup=1`
  - WP4 verifies these values against each platform's current UI.
  - Validation: the scheme is `rtmps` only, the host must match exactly, there is no userinfo, and redirects are not followed. At spawn time the supervisor resolves DNS and rejects private, loopback, link-local, CGNAT and metadata ranges (169.254.169.254, fd00::/8, etc.) (A41).

### 12.5 Fallback slate (I-12, I-15, B§15.5)

- **Rendering:** when a preset is saved with `slateAssetId`, or at session Start if it is missing, the supervisor renders `slate-{sid}-{profile}.mp4`. The source is the church image, scaled with `contain` on the theme background, plus a text strip "We'll be right back" drawn with FFmpeg `drawtext` in the bundled font. The clip is 10 s long, 30 fps, and uses the **same codec parameters** as the normaliser output (so the path's always-available switch is codec-compatible), with a silent AAC track (`anullsrc`) at 44.1 kHz stereo. The rendered file is cached by hash.
- **Default slate:** a neutral built-in image with the same text, used if the church has not uploaded one.
- **Trigger:** the contribution is considered lost when the MediaMTX `contrib` path reports no publisher, **or** the normaliser `out_time_us` stalls for 3 s. The supervisor then kills the normaliser, and MediaMTX's always-available feature serves the slate file to the existing readers. Publishers stay connected (A36).
- **WP0 must verify** that the pinned MediaMTX:
  1. keeps RTSP readers attached across the switch,
  2. includes the audio track from the offline file, and
  3. keeps timestamps monotonic for the readers.

  If any of these fails, the fallback moves into the normaliser. A GStreamer `input-selector` pipeline or an FFmpeg-based switcher replaces this mechanism, and an ADR records it.
- **Grace:** the session goes to RECOVERING, and the grace timer starts at the preset's `fallback_grace_s` (60–600 s). The UI shows a countdown in the critical banner: "Viewers are seeing the 'We'll be right back' slate. Publishing stops in 1:42 unless the studio reconnects."
- **Recovery:** the studio WHIP reconnects (same generation), and the supervisor sees a publisher on `contrib`. It waits for **both** tracks to deliver for 2 s, then restarts the normaliser, which forces a keyframe first. MediaMTX switches the readers back (A37).
- **Expiry:** when the timer runs out, the publishers are stopped, the session becomes INTERRUPTED, and the reason is recorded.
- **After a studio tab crash:** reopening the studio shows **Resume this service** if the session is RECOVERING and within grace. Resume re-takes the lease with a new generation, fencing the old one (B§17, A33). It never creates a duplicate session.

### 12.6 Studio-side camera stall (B§17)

When no new camera frame arrives for 2 s, the camera health turns critical with "Camera stopped sending". If the camera is **on programme**, the last frame is held for 1 more second, then the scene automatically cuts to **Holding**. The audio continues and the event is logged. When the camera returns, the source becomes available, but the scene does not change back automatically.

### 12.7 Recording (I-16, I-17)

**[DECISION, M7]** R1 keeps recordings on the media node's `recordings` volume and the owner downloads them from the ended service (`GET /api/sessions/{id}/recordings`, owner only); there is no S3/R2 upload yet, so no bucket credentials are needed. MediaMTX records the `norm/…` path itself (fMP4, 10-minute segments, slate periods included); the supervisor turns recording on for the path when `desired.record` is set, including when a private test becomes a recorded broadcast. Control mounts the volume read-only and deletes a service's recordings after 30 days (I-17). The rest of this section (uploader, presigned links, disk guard) is deferred.

- The Start modal has a **Record a private copy** checkbox (the preset default is `record_default`). The owner can enable recording in any preset. Operators can tick it but cannot download.
- **Mechanism:** the supervisor enables MediaMTX path recording on `norm/…` with `recordFormat: fmp4` and `recordSegmentDuration: 10m`, written to the volume `data/recordings/{sid}/`. The recording is the **normalised public output**, including slate periods.
- **Uploader:** a supervisor task uploads each completed segment to `s3://{bucket}/recordings/{sid}/{segment}` with a multipart upload, verifies size and ETag, then deletes the local copy. A local disk cap of 20 GB is reserved for recordings. If free disk space drops below 5 GB, recording stops with the warning `RECORDING_DISK_LOW`. **The live stream never stops because of recording.**
- **Retention (I-17):** a bucket lifecycle rule expires `recordings/` after 30 days, and a DB sweep marks the rows `deleted`. The report shows the expiry date.
- **Access:** the owner gets `GET /api/recordings/{id}`, which returns time-limited (15 min) presigned download URLs per segment, plus a **Download all (.txt of links)** option. A merged MP4 is not produced server-side in R1.
- **Credentials:** the S3 credentials live only in the supervisor's environment file.
- **Storage estimate:** about 2.7 GB/h at full_hd and about 1.8 GB/h at reliable_hd. The UI states this.

---

## 13. Destinations (Facebook, YouTube)

### 13.1 Destination setup (S05, owner only)

Built in M7 as Settings → Destinations (`/api/destinations`, owner). **Send test media** is not built: a platform test is Go live to a test or unlisted event (§9.6).

Fields:

- platform, label
- server URL, chosen from the allowlist dropdown with no free text
- key mode: `persistent` or `per_event`
- key (masked input; write-only; `key_last4` shown)
- **auto-publishes on ingest**: yes, no, or unknown
- watch-page URL (optional; an `https` URL on facebook.com or youtube.com)
- event reference (free text)

Defaults for each platform:

| Platform | Key mode | Auto-publishes |
|---|---|---|
| Facebook | `per_event` (I-13) | `unknown` |
| YouTube | `persistent` | `unknown` (I-14) |

Help text explains what auto-publishing means for the platform: YouTube "Auto-start" in Live Control Room, and Facebook "Go live" vs "Streaming software → preview".

**Validate** checks the syntax and the allowlist, and runs a DNS/TCP-TLS connect to the ingest host without sending media. **Send test media (publishes!)** is a separate, clearly labelled action behind a confirm dialog (B§16.2).

Keys are never returned by any API. They can be **replaced**, never revealed.

### 13.2 YouTube modes (I-14)

- `auto_publishes_on_ingest = yes`: the Start modal shows a red warning, "YouTube will go public as soon as sending starts".
- `no`: the state goes to `SENDING` and the destination row shows the persistent hint "Media arriving. Click **Go Live** in YouTube Live Control Room", with a link to the watch/event URL (A30).
- `unknown` is treated as `yes` for warnings.

### 13.3 Facebook per-event key (I-13)

- In Preparation, a Facebook destination whose key mode is `per_event` shows "**Facebook key needed for this service**", a paste field, and **Save**.
- The key is saved encrypted in `session_destinations.session_key_enc`, shown only as `••••1234`. It is **wiped** at ENDED/INTERRUPTED.
- If the key ending matches the last session's key, the app shows a warning: "This looks like last week's key. Facebook may have issued a new one."
- Readiness is **blocking** until a key is present or Facebook is deselected (B§16.4).
- Operators can paste the key but never read it (§6.2).

### 13.4 State model (B§16.3)

The states are NOT_CONFIGURED, READY_UNVERIFIED, CONNECTING, SENDING, LIVE_CONFIRMED, RECONNECTING, FAILED and STOPPED. The supervisor sets them from process state. The operator can set `LIVE_CONFIRMED` only through **"I've checked the platform playback"**, which stores `{source:'operator', by, at}`. The confirmation is cleared (set back to SENDING) after any RECONNECTING episode, and it shows "Checked 47 min ago" after 30 min. Viewer counts are never shown.

### 13.5 Partial publication

- If one destination is FAILED/RECONNECTING while another is SENDING, the session becomes `PARTIAL`.
- A persistent amber banner shows "Only YouTube is receiving the service. Facebook: rejected key. [Fix key] [Retry]".
- **Fix key** (for per-event keys) accepts a new paste and retries only that destination through `POST …/destinations/{d}/retry` (A28/A29).

---

## 14. Security specifics

### 14.1 Headers and CSP (B§23.4)

Caddy sets:

- `Strict-Transport-Security: max-age=31536000`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `Cross-Origin-Opener-Policy: same-origin`
- `Permissions-Policy: camera=(self), microphone=(self), display-capture=()`
- CSP: `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' wss://{host}; script-src 'self'; style-src 'self'; font-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`

The page loads no third-party scripts and no analytics.

### 14.2 Key encryption

- Envelope encryption: `KEK` (32 bytes) lives in `/run/secrets/rs_kek`. It is a Docker secret sourced from a file on the VM at `/etc/raelstream/kek`, mode 0400, and is **not in the repo and not in backups**. Its offline copy is kept by the owner, in the owner's password manager.
- `control` gets a **wrap-only** capability. It holds the public half of an X25519 key pair (sealed box, libsodium) and seals keys at write time. Control can therefore encrypt keys but never decrypt them. `supervisor` holds the private key.
- This meets B§23.2, "limit decryption to the publisher supervisor". **[DECISION]** It uses asymmetric sealing instead of a shared symmetric KEK.

### 14.3 Service worker

- Caches only the hashed static bundle and fonts. The fetch handler never caches `/api/*`, `/ws`, `/whip/*`, `/cam#…`, or anything with an `Authorization` header or `Set-Cookie`.
- **Updates during a session:** the new SW waits. The page shows "Update available after this service" and calls `skipWaiting` only when the session is ENDED or when no session is active (B§28.3, A43).

### 14.4 Rate limits and validation

- Every WS message is validated with Zod on the server, and invalid messages are dropped and counted. A socket that sends more than 10 invalid messages in 10 s is closed (B§23.6, "message floods").
- SDP is capped at 16 KB.
- The pairing endpoints are limited to 10 per minute per IP.

### 14.5 Security test list

Automated in `tests/integration/security/*`:

- A03–A05 (invitations)
- A12 (revocation)
- A40–A42 (secrets and access)
- SSRF destination cases
- a malicious image corpus (polyglot, zip bomb, huge dimensions, EXIF with a script)
- WS flood
- CSRF without the header
- cross-session WHIP publish
- a stale-generation command

---

## 15. Deployment and infrastructure

### 15.1 VM baseline (I-02, I-03, I-18)

- **Start:** a Vultr JNB compute instance with 4 dedicated vCPU / 8 GB, sized for software x264 1080p30 plus headroom (B§28.1). Check current Vultr pricing when provisioning, since the spec doesn't quote a price.
- **WP0 benchmark:** measure the normaliser at 1080p and 720p (`speed`, CPU %). If headroom is below 30 % (P-12), resize the instance up or change the x264 preset, and record an ADR.
- OS: Ubuntu LTS, unattended security upgrades **with reboots disabled on Sundays 06:00–14:00 local time**.
- Firewall:

| Port | Protocol | Purpose |
|---|---|---|
| 22 | tcp | Restricted to the owner's IPs, or opened via Vultr console |
| 80, 443 | tcp | HTTPS and TLS certificate issuance |
| 8189 | **udp** | MediaMTX WebRTC ICE UDP mux |
| 8189 | tcp | MediaMTX WebRTC TCP fallback, if enabled |

- MediaMTX: `webrtcAdditionalHosts: [<public IPv4>]`, `webrtcLocalUDPAddress: :8189`, `webrtcLocalTCPAddress: :8189` (TCP enabled so networks that block UDP still work, B§28.2).

### 15.2 Compose services

`caddy`, `web` (build output copied into the caddy image), `control`, `supervisor` (includes FFmpeg from a pinned static build or a distro package), `mediamtx`, `postgres`.

- Each has healthchecks, `restart: unless-stopped`, CPU and memory limits, and named volumes `pgdata`, `assets`, `recordings`, `diag`, `caddydata`.
- Postgres has no published port.

### 15.3 TURN for contribution (optional)

Not deployed by default. If WP0 or a venue finds UDP blocked, first test MediaMTX's own TCP ICE on 8189. If that is also blocked, enable **Cloudflare TURN** (TURN over TLS on 443/tcp, anycast, with short-lived credentials minted by `control` and returned only in the ingest response). It is used for the studio→server contribution only, never the camera link (NET-02). This replaces the brief's self-hosted TURN on a second public IP (B§28.2). Record an ADR when it is enabled. The contribution's route (UDP, TCP or TURN) is shown in the Programme upload health group.

### 15.4 Budget safeguards (B§28.5)

- Maximum sessions 1, maximum contribution 8 Mbps, bounded grace, recording off by default.
- After each session, the report shows an **estimated data use**: venue upload GB, server egress GB and recording GB, using the B§28.4 formula and actual byte counters where available.

### 15.5 Backups (B§28.3)

- A nightly `pg_dump` plus a tar of the `assets` volume, encrypted with `age` to the owner's public key and uploaded to the R2 bucket under `backups/`, with 30-day retention.
- The KEK and the supervisor's private key are **not** included. They are kept separately.
- `infra/scripts/restore.sh` restores the backup to a clean VM. A46 runs this as a drill.

### 15.7 Cloudflare evaluation (I-24)

| Cloudflare product | Could it do… | Verdict |
|---|---|---|
| **Stream Live** (WHIP ingest + simulcast) | Replace MediaMTX+FFmpeg and publish to FB/YT | **No.** The docs state that WHIP/WebRTC inputs do not support simulcasting (restreaming via RTMP/SRT) or recording. RTMP ingest does support simulcast, but a browser cannot send RTMP, and adding a local encoder breaks C-02. Revisit if Cloudflare adds WHIP→RTMPS output. |
| **Containers** | Run MediaMTX/FFmpeg | **No.** Instances are reached over HTTP through Workers, sleep when idle, and top out at 4 vCPU. WebRTC ingest needs a public UDP listener and an always-on process. |
| **Realtime SFU** | Ingest WebRTC | It is not an RTMPS publisher, so a server-side transcoder is still needed. It adds a hop and gives nothing over MediaMTX here. |
| **R2** | Recordings and backups | **Yes.** S3-compatible, free egress (owner downloads of recordings cost nothing), 10 GB-month free, then $0.015/GB-month, with lifecycle rules for the 30-day expiry. At ~2.7 GB per 1080p hour, four 3-hour services a month (~32 GB in rolling storage) cost about $0.35/month above the free tier. |
| **TURN** | Contribution fallback when UDP is blocked | **Yes, as the optional fallback** (§15.3). Anycast, so a PoP is near Lusaka. TLS on 443. $0.05/GB outbound to the client, which is small for an upload-direction stream. Off by default. |
| **DNS** | Domain | **Yes, DNS only (grey cloud)** for the media hostname, because proxied mode would not carry WebRTC UDP. The app hostname may also be grey-clouded. Caddy keeps terminating TLS on the VM. |

**Consequence:** the brief's single-VM media design stays. Cloudflare takes the storage and fallback-relay jobs. That reduces VM disk needs and removes the second-public-IP requirement for TURN.

### 15.6 Venue profile

A singleton settings row with:

- the production SSID label
- the router model (free text)
- `wan_block_test_passed_at`, set by the owner after running the installation runbook's WAN-block test
- a notes field for the camera-route map (upload an image)

The route map, positions and dead zones (B§7.4) live in `docs/evidence/venue/`.

---

## 16. CI/CD (I-22)

### 16.1 `ci.yml` (push and PR)

1. `pnpm install --frozen-lockfile`
2. `pnpm format:check`, `pnpm lint` (ESLint + the i18n no-literal rule), `pnpm typecheck`
3. `pnpm test:unit`
4. `pnpm test:integration`, using a Postgres service container and a MediaMTX + FFmpeg container. This covers the invitation race, fencing, supervisor reconcile, publisher isolation against two local RTMP sinks (nginx-rtmp or MediaMTX RTMP) where one sink is killed or throttled, and fallback-slate behaviour.
5. `pnpm test:browser`: Playwright Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, a camera page and a studio page in two contexts, the QR flow via the URL, scene apply, keyboard safety, and banners. **These tests are labelled synthetic and do not qualify hardware** (B§26.1).
6. `pnpm test:media`: FFmpeg-generated frame-numbered and beep clips run through the normaliser. The test asserts PTS monotonicity, the 2 s GOP, AAC 44.1 kHz stereo, and the A/V offset of the synthetic clip (±1 frame).
7. Build Docker images, tagged with the git SHA, and push them to GHCR on `main`.

Every command also runs locally (`pnpm ci:local`), so the owner does not depend on hosted CI (B§22.3).

### 16.2 `deploy.yml` (manual `workflow_dispatch`, input `sha`)

1. SSH to the VM using a deploy key held in a GitHub environment `production` that requires owner approval.
2. **Deploy guard:** `curl https://{host}/internal/deploy-guard`, authenticated with a deploy token. It returns `409` if any session is in PREPARING…RECOVERING **or** has been STARTING within the last 5 min. The workflow fails with "Active service; deploy after it ends".
3. `infra/scripts/deploy.sh {sha}`: pull images by digest, run migrations (forward-only, and each must be backward compatible with the previous app version for one release), `compose up -d`, then smoke-test `/api/health`, the MediaMTX API and a WHIP OPTIONS request.
4. On smoke failure, roll back to the previous SHA recorded in `/etc/raelstream/last-good`. On success, write `last-good`.

Deploys never happen while a service is live (B§28.3).

---

## 17. API and message contracts

### 17.1 HTTP (extends B§21.1)

All requests are JSON and validated by the Zod schemas in `packages/contracts`. Every mutating request carries an `Idempotency-Key` header (a UUID). Every response carries an `X-Request-Id`.

| Method / route | Role | Notes |
|---|---|---|
| POST /api/auth/login, /api/auth/totp, /api/auth/logout; GET /api/auth/me | any | §6.1 |
| POST /api/invites; POST /api/invites/accept | owner; public (token) | Operator invites |
| GET/POST/PATCH /api/presets[/{id}] | owner/operator | |
| POST /api/assets; GET /api/assets/{id} | owner/operator | §10.6 |
| GET/POST/PATCH/DELETE /api/destinations[/{id}]; POST …/{id}/validate; POST …/{id}/test-media | owner | Keys write-only |
| POST /api/sessions | owner/operator | From a preset; DRAFT; acquires the lease |
| GET /api/sessions/{id} | session members | Redacted snapshot + `lastSequence` |
| POST /api/sessions/{id}/mode | lease | `rehearsal`/`ingest_test` |
| POST /api/sessions/{id}/pairings | lease | Returns URL + expiry |
| POST /api/pairings/preview, /api/pairings/claim | public (token) | §7.1 |
| POST /api/sessions/{id}/sources/{src}/admit, …/reject; PATCH …/{src} (label); DELETE …/{src} | lease | |
| PUT /api/sessions/{id}/destinations/{d}/session-key | lease | Per-event key, write-only |
| DELETE /api/sessions/{id}/destinations/{d} | lease | Deselect before Start |
| POST /api/uplink-test/sink | lease | Streaming sink, max 64 MB |
| POST /api/sessions/{id}/uplink-test | lease | Stores the result |
| POST /api/sessions/{id}/preflight | lease | Returns checks[] `{id, severity, status, evidence, observedAt, action}` |
| POST /api/sessions/{id}/preflight/ack | lease | `{checkId, reason}` |
| POST /api/sessions/{id}/ingest | lease | WHIP URL + bearer |
| POST /api/sessions/{id}/start | lease | `{profile, destinations[], record}`. Idempotent. |
| POST /api/sessions/{id}/stop | lease **or** owner without the lease | Idempotent. Stop wins. |
| POST /api/sessions/{id}/scene | lease | `{sceneId, rundownItemId?, version}`. Records the *runtime-acked* apply; the browser posts after the ack. |
| PATCH /api/sessions/{id}/audio | lease | Persists the applied values reported by the runtime |
| POST /api/sessions/{id}/destinations/{d}/retry, …/confirm-live | lease | |
| POST /api/sessions/{id}/takeover | owner/operator per §6.2 | New generation |
| POST /api/sessions/{id}/calibrations; POST …/diag-clips; GET …/diag/{clip} | lease | §11.4 |
| GET /api/sessions/{id}/report[.json] | members | §19 |
| GET /api/recordings/{id} | owner | Presigned URLs |
| GET /api/health; GET /internal/deploy-guard; POST /internal/mediamtx/auth | public; deploy token; internal only | |

Error body (B§21.4): `{code, message, component, retryable, action, requestId}`. The safe message comes from the i18n catalogue.

Error code catalogue (first set):

| Component | Codes |
|---|---|
| Auth | `AUTH_INVALID`, `AUTH_LOCKED`, `AUTH_TOTP_REQUIRED` |
| Session | `LEASE_HELD`, `STALE_GENERATION`, `SESSION_ACTIVE_EXISTS` |
| Pairing | `PAIR_INVALID` |
| Camera | `CAM_PERMISSION_DENIED`, `CAM_IN_USE`, `CAM_NOT_FOUND`, `CAM_ICE_FAILED`, `CAM_STALLED`, `CAM_REVOKED` |
| Audio | `AUDIO_DEVICE_LOST`, `AUDIO_SILENT`, `AUDIO_CLIPPING`, `AUDIO_PROCESSING_NOT_DISABLED`, `AUDIO_LATE_UNFIXABLE` |
| Contribution | `INGEST_AUTH`, `INGEST_TIMEOUT`, `INGEST_MEDIA_UNSUPPORTED`, `CONTRIB_LOST` |
| Media node | `NORMALISER_STALLED`, `NORMALISER_SLOW` |
| Destinations | `DEST_NOT_CONFIGURED`, `DEST_KEY_MISSING`, `DEST_AUTH_REJECTED`, `DEST_NETWORK`, `DEST_MEDIA_REJECTED`, `DEST_URL_NOT_ALLOWED` |
| Content | `ASSET_NOT_READY`, `ASSET_REJECTED` |
| Recording | `RECORDING_DISK_LOW`, `RECORDING_UPLOAD_FAILED` |
| Uplink | `UPLINK_INSUFFICIENT` |

### 17.2 WebSocket `/ws`

- The first message is `hello {role:'studio'|'camera', clientId, sessionId, lastSequence?, credential?}`. A studio connection authenticates with the cookie. A camera connection uses the credential in the message.
- The server replies with `welcome {snapshot, generation, lease}`.
- Server → client:
  - `event` (the B§21.3 envelope, with `sequence`)
  - `snapshot` (sent after a sequence gap)
  - `lease.lost`
  - `signal` (SDP and ICE relay; transient; never logged)
  - `revoke`
  - `tally`
  - `credential.renewed`
  - `observed` (the supervisor's observed state, throttled to 1 Hz)
- Client → server:
  - `signal`
  - `lease.renew` (studio, every 10 s; lease TTL 45 s, B§19.3)
  - `cam.state` (camera, ≤1 Hz)
  - `stats.aggregate` (studio, every 10 s)
  - `runtime.applied` (scene/audio acks)
- On reconnect, the client sends `lastSequence`. The server replays up to 500 events, and if the gap is larger it sends `snapshot`. An optimistic UI state is reconciled against the server's (B§21.3).

### 17.3 Lease semantics (B§19.3)

- Lease TTL 45 s, renewed every 10 s over WS (or HTTP fallback).
- **Expiry blocks new privileged commands** from the stale client. It does **not** stop healthy media. The supervisor tears down media only because of the media's own health and the grace policy.
- A control-service restart with healthy media behaves like this (A38): the studio's WS reconnects, it re-sends `hello` with `lastSequence`, and the lease is re-validated against the stored generation. The WHIP contribution and the publishers never notice.

---

## 18. Session lifecycle

```text
DRAFT ─prepare─► PREPARING ─preflight ok─► READY ─start─► STARTING ─first dest SENDING─► SENDING
                     ▲  │ config change            (≤30 s)       └─ none SENDING in 30 s ─► PARTIAL/FAILED shown, stays STARTING→ operator decides
                     └──┘ (READY goes stale)
SENDING ⇄ PARTIAL      (per destination health)
SENDING/PARTIAL ─contrib lost─► RECOVERING ─restored─► SENDING/PARTIAL
RECOVERING ─grace expired─► INTERRUPTED
any active ─stop─► STOPPING ─all publishers STOPPED + ingest closed─► ENDED
```

- **Rehearsal** and **ingest-test** modes stay in PREPARING/READY. Neither can reach STARTING. The server refuses `start` unless `mode=live` was set in the same request, which the Start modal does (A31).
- **READY** is derived from the latest preflight, is valid for 10 min, and becomes stale whenever the devices, profile, destinations or scene configuration change.
- **At ENDED:**
  - revoke all contributor credentials
  - close invitations
  - delete the WHIP resource and the MediaMTX session paths
  - wipe per-event keys
  - finalise recording uploads
  - build the report
  - show the "Verify each platform has ended" checklist (A48)
- **Reuse:** **Duplicate** creates a new session from the preset, copying non-secret config. The destination selection must be re-reviewed (B§19.3).

---

## 19. Observability and report

- **Studio stats:** 1 Hz collection for both peer connections (B§24.1). Only the aggregates are uploaded: 10 s windows of min/avg/max received fps, bitrate, loss %, RTT, jitter-buffer ms/frame, encode fps, `qualityLimitationReason` histogram, audio peak max, clip count and silence seconds. Fields the browser doesn't provide are stored as `null` and shown as "unavailable", never as 0.
- **Supervisor:** 5 s snapshots of normaliser speed and fps, per-publisher bytes/s and state, CPU % per process (from `/proc`, which is valid server-side), and disk space.
- **Report** (S06, plus a JSON download):
  - requested and actual profiles
  - device, browser, OS and app versions (the browser's UA-CH where available), and the server image digests
  - durations per state and per destination
  - reconnects
  - critical alerts, with acknowledgement times
  - quality reductions
  - sync calibration and any rechecks
  - uplink test result
  - route label timeline
  - live confirmations (source/time)
  - estimated data use
  - recording links/expiry
  - the event timeline

  Every check shows `Passed` / `Failed` / `Not tested` / `Inconclusive` (B§24.4, A45). The JSON is redacted: no keys, tokens, SDP or IPs.

---

## 20. Failure and edge-case catalogue

B§17 still applies. This table adds implementation-specific cases found during the interview and design.

| # | Situation | Behaviour |
|---|---|---|
| E01 | Operator scans an old QR code | Generic "code no longer valid". Studio **New code**. |
| E02 | A WhatsApp or scanner link-preview bot opens the URL | The token is in the fragment, so the bot never sends it to the server. Even with the token, preview does not consume it. |
| E03 | Phone reloads the page mid-service | `deviceId` + credential (sessionStorage) → rejoin slot, no re-admit. Credential lost → the studio sees "Camera 1 left" and re-pairs (a new invitation for the same slot is allowed once the old source is revoked). |
| E04 | A second phone claims while slot 1 is admitted | Claim refused (`PAIR_INVALID`). The studio must revoke first. R1 has one camera. |
| E05 | Phone rotates to portrait on air | Programme stays 16:9, the contain policy pillarboxes, and the phone shows a rotate prompt. |
| E06 | Phone gets a phone call | Chrome usually suspends capture → frame stall → auto-holding after 3 s. The report records it. Runbook: use Do Not Disturb / airplane mode + Wi-Fi. |
| E07 | Phone battery drops below 15 % (if reported) | Warning on phone and studio. |
| E08 | Camera never reaches `connected` | §8.5 panel. No relay. |
| E09 | Venue WAN drops, LAN up | Camera continues (DataChannel). Contribution lost → server slate → grace countdown. The studio shows "Internet down: viewers see the slate". Local preview continues. On return, the WHIP reconnects and the programme resumes (A08, A36–A37). |
| E10 | Laptop sleeps or the lid closes | Everything stops: frames stall, the contribution is lost, grace starts. The runbook asks for sleep to be disabled for the duration via the OS power settings, if policy allows. Preparation shows the hint "Keep the lid open; plug in power". |
| E11 | Studio tab is backgrounded | The worker clock keeps ticking. Chrome may still throttle canvas/rVFC. Preparation warns "Keep this tab in front", and a `visibilitychange` → hidden during SENDING raises a warning event. |
| E12 | UMC unplugged, then plugged in again | §10.4 step 7. The device id may change, so the app matches by label and asks for confirmation. |
| E13 | Windows switches the default audio device | Irrelevant, because capture uses an exact `deviceId`. |
| E14 | Mixer feed is on Input 2 while the mapping is In1 | The meters show input activity on only one channel. Preparation highlights "Signal on Input 2 but mapping uses Input 1" when In2 has signal and In1 is silent for 5 s. |
| E15 | Operator changes the delay while live | Crossfaded change (§10.4.3). The event is logged. The calibration is marked "manually adjusted during service". |
| E16 | Facebook key expired or wrong at Start | FB → FAILED `DEST_AUTH_REJECTED` → PARTIAL with YouTube continuing. **Fix key** retries FB only. |
| E17 | Both destinations fail at Start | Session stays STARTING with a critical banner. The operator can retry either one or Stop. The contribution and normaliser keep running, so a retry is fast. |
| E18 | Operator double-clicks Start, or a network retry replays it | Idempotency key → the same operation result (A32). |
| E19 | Stop is pressed during reconnect storms | `stopRequestedAt` set → the supervisor kills everything and ignores timers (A34). |
| E20 | Control container restarts | The supervisor keeps running processes (desired state unchanged). The studio reconnects the WS (A38). |
| E21 | Supervisor restarts | **[DECISION, M8]** No adoption: FFmpeg runs as the supervisor's child in the same container, so a supervisor restart (container restart) ends them too. On boot the supervisor rebuilds from the unchanged desired state: the slate covers the programme path, the normaliser and publishers restart, destinations show RECONNECTING, and the report shows the reconnects. A control restart (E20) does not touch media at all. |
| E22 | VM reboots | Honest outage. The session becomes INTERRUPTED if it doesn't recover within grace. After boot, the supervisor sees desired=running with no contribution, and does not auto-publish the slate after grace (B§17: no HA claim). |
| E23 | A second studio tab opens | Read-only (§9.10). |
| E24 | Owner opens the studio on a phone | Unsupported layout. A warning, with read-only suggested. |
| E25 | Browser update mid-week changes behaviour | Preparation shows "Browser version changed since last qualified run (X → Y)" as a warning. |
| E26 | App update deployed while the studio is open (between services) | The SW waits. The banner offers a reload when no session is active. |
| E27 | Asset deleted while referenced by a preset | Deletion is blocked. The response lists the referencing presets. |
| E28 | Text too long for the card | Apply is blocked with the reason (§10.3). |
| E29 | Recording disk full | Recording stops with a warning. The stream is unaffected. |
| E30 | Recording upload fails | Retries with backoff for 24 h. The local copy is kept, and the report marks the recording `failed`. |
| E31 | Uplink test run during SENDING | Refused (the button is hidden and the server refuses). |
| E32 | Clock skew between the laptop and the server | Durations, event times and the lease use server timestamps. The client clock is used only for local UI timers. |
| E33 | Grace timer expires while the operator is actively reconnecting | Grace is strict. The operator can **Extend grace by 2 min** once per incident, up to the preset maximum of 10 min in total (I-15). |
| E34 | Scheduled YouTube event not yet in "Go Live" | Destination SENDING plus the persistent Live Control Room hint (§13.2). |
| E35 | Operator's login session expires mid-service | Cannot happen: the login is kept alive while the session is active (§6.1). |
| E36 | Owner disables an operator mid-service | The operator's new commands are refused. Media continues. The owner can take over. |
| E37 | Takeover while a camera is connected | The camera renegotiates with the new studio client, keeping the same slot (§9.10). The programme shows the slate for the takeover gap. |
| E38 | The laptop is on Wi-Fi instead of Ethernet | Not detectable from the browser. The Preparation checklist item "Laptop on Ethernet?" is a manual tick. The camera-link loss and jitter show the effect. |

---

## 21. Test and acceptance plan

- **Unit** (Vitest): the pairing token lifecycle, lease/generation logic, the destination state reducer, the session lifecycle reducer, routing and gain maths (mono blend = 0.5), delay clamping, profile selection from the uplink result, adaptation controllers (driven by fake stats timelines, which must show no oscillation), the retry schedule, redaction, report aggregation (null ≠ 0), the stderr classifier fixtures, the SSRF validator, and the keyboard shortcut guard.
- **Integration:** everything in §16.1 step 4, plus the §14.5 security list.
- **Browser (synthetic):** the QR → claim → admit → fake camera flow, permission-denied UI, scene apply ack, rundown draft vs apply (A23), keyboard safety (A44), banners, the read-only second tab (A33), and the 1366×768 layout screenshot test.
- **Media harness** (`tests/media`): normaliser conformance, fallback switch continuity (ffprobe PTS/DTS monotonic across the slate in and out), publisher isolation, a 10-min still hold (A25), and a 3 h soak script for the VM (`tests/media/soak.ts`).
- **Hardware acceptance:** every B Appendix A scenario, A01–A48, is executed and recorded under `docs/evidence/{gate}/{scenario}-{date}.md` using a template with the fields build, env, steps, observed, evidence links and status. There is an index at `docs/evidence/INDEX.md`. Glass-to-glass latency (P-02) is measured with a 240 fps phone camera filming a millisecond timer on a second screen next to the studio preview, over 100 observations. The method and resolution (±4.2 ms) are recorded.

---

## 22. Delivery plan (all work packages)

Each WP ends with its evidence (B§27). Tasks are listed in rough order.

### WP0: Feasibility spine (G1–G5 preliminary)

1. Monorepo skeleton, CI (lint, type, unit), and the compose stack on the Vultr JNB VM with TLS. `infra/VERSIONS.md` pinned.
2. Minimal `/cam` + `/studio` without auth: a hard-coded dev session token behind a server env flag, **disabled in production builds**. It has QR, WSS signalling, and a direct peer connection with no ICE servers.
3. **Verify mDNS host-candidate connectivity** A26 ↔ Dell, and alternate laptop, on the production LAN. Record the route stats (§8.4). Run the WAN-block test.
4. Audio capture of the UMC and channel identification (A15/A16). Record `getSettings()`.
5. A compositor with a camera + logo + lower third, a delay line, and meters.
6. WHIP to MediaMTX, the normaliser, two publishers → **private or unlisted** FB and YT test events. Verify that both accept the output profile (the `-bf 0`/zerolatency question). Record the FB account's actual limits (B§15.2, S15).
7. **Fallback verification:** the MediaMTX always-available switch with audio and reader continuity (§12.5). If it fails → write the GStreamer/FFmpeg-switcher ADR.
8. Measurements: Dell CPU/memory at 1080p and 720p (P-07/P-08), glass-to-glass latency (P-02), received fps (P-03), normaliser speed/CPU on the VM (P-12), RTT and loss from the venue to JNB, and the uplink test.
9. **Go/no-go ADR:** accepted at 1080p, accepted at 720p pending, or blocked (B Appendix D).

### WP1: Session foundation

- Migrations (§5), auth + TOTP + invites, presets CRUD, sessions + lifecycle reducer, leases/generation, idempotency, the WS hub with sequence replay, pairing/admission/revocation.
- Events, the timeline, the retention job, and the i18n catalogue plus its lint rule.
- Tests: the unit and integration lists, and security A03–A05, A12, A42.

### WP2: Qualified camera

- The full `/cam` UI (§7.6), capability handling, the camera selector, zoom (§7.4), the wake lock, battery, the DataChannel `ctl` protocol, tally, the quality relay, reconnection (§8.6), the route classification, and the direct-fail panel.
- Evidence: A02, A06–A14, the roaming walk, and interruption tests.

### WP3: Audio and programme

- The full audio engine (§10.4), including the HPF and compressor with bypass, the crossfaded delay, meters, silence/clip/device-loss handling, and channel ID.
- The compositor with all 5 scene types, themes, the rundown + draft/apply, assets (the upload pipeline), keyboard shortcuts, and the privacy action.
- The Private ingest test + clip calibration tool (§11.4), with `sync_calibrations`.
- Evidence: A13, A15–A25, and the P-05 3 h sync.

### WP4: Media publication

- The supervisor reconciler, `media-node-adapter` (the MediaMTX API client, FFmpeg arg builders, the progress parser, the classifier), destinations CRUD + allowlist + SSRF checks + sealed-box encryption, the FB per-event key flow, YT auto-publish handling, the Start/Stop modals, the partial-publication UI, and live confirmation.
- The uplink test.
- Recording + S3 uploader + lifecycle rule.
- Evidence: A22, A27–A31, A40–A41, A48, P-09, P-10.

### WP5: Recovery and health

- The adaptation controllers (§11.5), camera stall → holding, the fallback slate render + grace + extend, contribution reconnect, supervisor adoption, the health groups with stale detection, critical banners/ack, the service report + JSON, and estimated data use.
- Evidence: A08, A32–A39, A45.

### WP6: Hardening and operations

- CSP and headers, the SW update deferral (A43), security test completion, `deploy.yml` + the deploy guard, backups + a restore drill (A46), runbooks (§24), the 3 h soak (A26, P-11), two real services (A47), and the acceptance statement (B§30).

---

## 23. Assumptions WP0 can overturn (and what changes)

| Assumption | If false |
|---|---|
| mDNS host candidates connect the A26 and the Dell on the LAN | Try the alternate laptop. If both fail → G2 stop condition, and the owner decides (a relay is **not** a silent fallback, I-19). |
| The Dell policy permits camera/mic/WebRTC/UDP | Qualify the alternate laptop (I-20). |
| The Dell sustains the 1080p30 workload within P-07 | 720p-qualified product. Record a pending decision. |
| MediaMTX always-available switches with audio and reader continuity | Replace the fallback with a GStreamer/FFmpeg switcher behind the adapter. |
| FB and YT accept `-bf 0` zerolatency 6 Mbps 1080p | Adjust the profile. Record per-platform evidence. |
| 4 vCPU JNB handles x264 veryfast at 1080p30 with 30 % headroom | Bigger instance, or a faster preset, or the 720p normalised output. |
| The venue uplink sustains ≥7 Mbps | Below that, the product is not viable at that venue without an uplink upgrade. Report honestly. |
| The A26 exposes `zoom` in Chrome | Zoom UI absent (by design). |

---

## 24. Runbooks to write (WP6)

- First install (VM, DNS, TLS, KEK and sealed-box keys, firewall, the owner bootstrap)
- Venue network setup and the WAN-block test
- The pre-service checklist, printable on one page for volunteers
- Camera cannot connect
- Camera stopped during service
- Audio interface lost
- Platform refused key (FB per-event key)
- Internet down during service
- Manual stop from the platform consoles
- Key replacement
- Backup restore
- Rollback to the last good version
- Recording retrieval

---

## 25. Open items (to be answered by evidence, not further interview)

1. The exact Dell hardware and policies, and the alternate laptop model (WP0).
2. ~~Object storage provider~~ Resolved: Cloudflare R2 (I-24). Still to verify in WP4: the upload throughput from JNB to R2, and the R2 lifecycle rule and presigned-URL behaviour.
3. The exact current FB/YT RTMPS endpoints and FB account limits (WP0/WP4).
4. The venue's real uplink figures and the route survey (WP0).
5. Whether the A26 zoom is optical-switching or a digital crop (WP2).
6. The actual A/V offset and drift over 3 h (WP3).
