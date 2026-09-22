# Raeltec Stream: UI Design Brief

**For:** UI/visual design (Claude Design)
**Source of truth:** [`SPEC.md`](SPEC.md). Section references (§) point there. If this brief and the spec disagree, the spec wins. Please flag the conflict.
**Date:** 22 September 2026

---

## 1. What the product is

It's a browser-based live-streaming studio for one church. A volunteer walks around with a **phone** that acts as the camera. An operator sits at a **laptop**, where the browser receives the phone's video over local Wi-Fi, adds sound from the church mixer and simple graphics (logo, lower thirds, scripture cards, announcement images), then sends one programme to **Facebook and YouTube** at the same time.

There's nothing to install on the laptop. Everything runs in Chrome or Edge.

It is **not** a general-purpose OBS replacement. It has one camera, one audio input, five scene types and two destinations. Keep the design small and calm.

## 2. Who uses it, and where

| User | Device | Context | What they need |
|---|---|---|---|
| **Owner** (Israel) | Laptop | Sets up destinations, presets, theme and users during the week. Often runs Sunday himself. | Complete control, and to trust what the screen says. |
| **Volunteer operator** (1–3 people) | Laptop 1366×768, sometimes on a small desk. Ethernet, mixer nearby. | A **dim church hall**, live, under pressure, while listening to the service. Not technical. | Big obvious actions, no jargon, no way to end the broadcast by accident, and a clear answer to what is wrong and what to do about it. |
| **Camera operator** | Samsung Galaxy A26 in landscape, often one-handed, **walking**. A battery pack may be attached. | Moving around the room, glancing at the screen. | Knowing whether they're on air (tally), whether the connection is OK, and an easy way to stop. Nothing else. |

## 3. Design principles

1. **Say only what's true.** Never show a green "Live" or "Everything is fine" unless it has been verified. Camera, audio, upload and each platform each have their **own** status (§9.3, B§10.4). Missing data reads "unavailable" or "unknown", never healthy.
2. **Calm by default, loud when needed.** Normal operation should look quiet. Critical problems get a persistent banner that toasts can't hide.
3. **Volunteer-safe.** Dangerous actions are hard to trigger by accident. Common actions take one click.
4. **Programme first.** The large preview is the actual broadcast output, not a camera feed.
5. **Status is never colour alone.** Every state shows an **icon + word + colour** (§9.9). Meet WCAG 2.2 AA contrast.
6. **Plain words.** Say "Pulpit camera", "Behringer USB audio" and "Facebook church page". IDs, IP addresses and codes appear only in a copyable "Details" area.

## 4. Visual direction

- **Dark theme is the default** for the studio, because the hall is dim and a bright screen distracts the congregation. Provide a light theme too.
- The UI chrome is **neutral**, not church-branded. The church's brand (logo, two colours, one font) appears **only inside the programme output**. Don't mix the two: the operator must always be able to tell the UI apart from the broadcast.
- Status palette (please propose exact values that pass AA on both themes):

| State | Colour | Notes |
|---|---|---|
| ok | green | |
| warn | amber | |
| critical | red | |
| unknown/stale | grey | |
| info | blue | |
| **On programme / tally** | broadcast red | Must be distinct from the critical red: broadcasting is not an error. |

- Mode banners must be unmistakable:

| Mode | Colour | Banner text |
|---|---|---|
| Rehearsal | grey | "REHEARSAL: nothing leaves this laptop" |
| Private test | blue | "PRIVATE TEST: sending to Raeltec server only" |
| Live | red | "LIVE" |

- Typography: a highly legible sans serif for the UI (the spec bundles Inter and Atkinson Hyperlegible, and either is fine). Use tabular numerals for timers, dB values and bitrates.
- Motion: minimal. The only blinking allowed is the camera "Reconnecting" tally and the "Camera ready: cut back" hint. There are no decorative animations.
- **Deliver tokens as CSS custom properties** (colour, spacing, radius, type scale, z-index layers). The build uses React with plain CSS modules and **no component library** (SPEC §4.3), so a token sheet plus component specs is the most useful output.

## 5. Screens to design

The priority order is **S03 Live**, **S04 Camera phone**, **S02 Preparation**, then everything else.

### S03: Live studio (most important). §9.2

The fixed layout at **1366×768, 100 % zoom, no horizontal scroll, no fullscreen required**:

```text
┌───────────────────────────────────────────────┬──────────────────┐
│ Service name · ● SENDING 00:42:13 · LIVE  [?] │ [■ Stop sending] │  top bar
├───────────────────────────────────────────────┼──────────────────┤
│ Critical banner(s): persistent, only if any   │ HEALTH (4 groups)│
├───────────────────────────────────────────────┤ Camera link      │
│ "Programme preview - before platform delay"   │ Mixer audio      │
│ ┌───────────────────────────────────────────┐ │ Programme upload │
│ │   16:9 programme preview (~960×540)       │ │ Destinations:    │
│ └───────────────────────────────────────────┘ │  Facebook  state │
│ Draft panel: [item ▾] [Edit] [Apply to prog.] │  YouTube   state │
├───────────────────────────────────────────────┤ AUDIO meters     │
│ SCENES [1 Camera][2 Cam+LT][3 Text][4 Image]  │ [Mute programme] │
│        [0 Holding]                            │ Delay 120 ms     │
│ RUNDOWN ◂ Prev  3/14 "Reading – John 3:16" ▸  │ Timeline ▸       │
│                                               │ [Privacy: Hold+Mute]
└───────────────────────────────────────────────┴──────────────────┘
```

The ~300 px right panel is fixed. Required elements:

- **Top bar:** service name, session state (DRAFT / PREPARING / READY / STARTING / SENDING / PARTIAL / RECOVERING / STOPPING / ENDED / INTERRUPTED), elapsed time, mode, a help `?` for the shortcuts overlay, and **Stop sending**, which is always top-right and never covered.
- **Programme preview** with the exact caption "Programme preview - before platform delay". Below it, a quality line such as "Camera received at 720p; programme output 1080p (upscaled)".
- **Draft panel:** the selected rundown item, **Edit** (opens a small editor), a static 320×180 thumbnail of the draft, and **Apply to programme**. The draft must be visually distinct from what is on air.
- **Scene strip:** 5 buttons with keyboard hints (1, 2, 3, 4, 0). The **on-air** scene is clearly marked with broadcast red and the words "ON AIR". The **holding** scene should look slightly different, since it is a safe state.
- **Rundown stepper:** Prev / Next, "3/14", and the item title. Moving the cursor only changes the draft.
- **Health groups:** each shows a status pill, a one-line summary, and a "last updated" age that turns "stale" after 5 s. Clicking a group opens details. Example summaries:
  - "Camera good · 1080p30 received · Direct/location unverified"
  - "Mixer audio silent for 20 s"
  - "Programme reaching server · 7.8 Mbps"
  - "Facebook: rejected key"
- **Destination rows** with the states NOT CONFIGURED, READY TO TEST, CONNECTING, SENDING, LIVE ✓ (checked by operator, "Checked 12 min ago"), RECONNECTING (attempt n), FAILED (with reason and action), and STOPPED. Include the **"I've checked the platform playback"** action and the YouTube hint "Media arriving: click Go Live in YouTube Studio".
- **Audio:** input and programme meters in dBFS, with peak hold and a **CLIP** indicator, the mapping label (e.g. "Input 1 → both (dual-mono)"), **Mute programme** (whose state must be unmistakable when muted), and the delay value.
- **Privacy: Hold + Mute:** the emergency button. It is red-outlined and must look different from the scene buttons.
- **Timeline drawer:** plain-language events, e.g. "10:42 Camera stopped sending; holding slide applied".
- **Toasts** appear bottom-left and never cover Stop or the banners.

States to show:

| State | What it looks like |
|---|---|
| Normal SENDING | Both destinations sending |
| PARTIAL | Amber banner "Only YouTube is receiving the service. Facebook: rejected key. [Fix key] [Retry]" |
| Camera stalled | Auto-cut to holding. Critical banner. After the camera returns, a pulsing **"Camera ready: Cut back"** on the Camera scene button. |
| Mixer audio lost | Critical: "Behringer USB audio disconnected. Programme is silent." |
| RECOVERING | Upload lost, viewers see the slate. The banner has a countdown: "Viewers are seeing 'We'll be right back'. Publishing stops in 1:42 unless the studio reconnects. [Extend 2 min]" |
| Read-only second tab | Grey banner "Viewing only: Israel is running the studio on another device. [Take over]" with all controls disabled |
| Acknowledged critical | Banner dimmed, but the health group stays red |

### S04: Camera phone (`/cam`). §7

Portrait for joining, landscape for shooting. Big touch targets, readable at arm's length while walking. States:

1. **Join:** service name, a "Camera only" badge, "This phone will send video only. Sound comes from the church mixer.", a label field, and a large **Join as camera** button.
2. **Waiting for admission:** "Waiting for the studio to admit this phone", with the **verification phrase** in very large type (e.g. `river-lamp-42`). The operator compares it with the laptop.
3. **Admitted:** **Start camera**.
4. **Live (landscape, full-screen preview):** a **tally bar** across the top, which must be visible from about 1 m away:

| Tally | Style |
|---|---|
| Connected, not on programme | grey |
| On programme | broadcast red |
| Reconnecting | amber, blinking |
| Stopped | — |

   Also on this screen:
   - small secondary text for the broadcast state ("Broadcast: sending to 2 platforms")
   - network quality (Good / Reduced quality / Unstable / Disconnected) with one suggested action
   - "Screen kept on" or its warning
   - battery, if available
   - a zoom slider, only when supported, labelled "Zoom (browser-reported)"
   - the camera selector
   - **Stop camera** with a confirm
   - a permanent small note, "Keep this page open and the screen unlocked"
5. **Rotate prompt** overlay when the phone is in portrait during capture.
6. **Errors:** permission blocked (with steps), camera in use, code expired ("This code is no longer valid. Ask the studio for a new one."), can't reach the studio laptop, removed by the studio.

No IPs, IDs or technical data anywhere on the phone.

### S02: Preparation. §9.5

A checklist-style single column. Each card has a status and can collapse once it's done. The mode switch sits at the top: **Local rehearsal | Private ingest test | Go live…**.

1. **Camera:**
   - A pairing QR code with a 2-minute countdown and **New code**
   - A pending request card showing the label, the **verification phrase**, a device hint ("Android · Chrome") and **Admit / Reject**
   - Capture settings (requested vs actual)
   - The route label
   - A "movement test done" tick
   - A **Contain / Fill** framing toggle
   - The "Camera can't connect directly" help panel (a 4-step checklist with **Try again** and **Re-pair**)
2. **Audio:**
   - Device dropdown
   - Warnings such as "Echo cancellation could not be turned off"
   - Routing mode (4 options)
   - Gain slider
   - HPF and compressor toggles
   - Meters
   - A channel identification helper: "Play something into Input 1 only. Which meter moved?"
3. **Sync:**
   - A delay control (0–2000 ms with numeric entry, ±10, ±50 and Reset) and the sentence "Increase audio delay when sound happens before the matching movement."
   - **Record a 20 s test clip**
   - The clip review player, with frame-step controls and an **audio waveform strip under the video** where the operator marks the clap frame. It then shows the measured offset.
   - A calibration status of `Calibrated`, `Recheck recommended` or `Not calibrated`
4. **Upload:** **Run uplink test** with progress and a data-use note, the result ("11.2 Mbps sustained → Reliable HD recommended"), and the profile choice. Choosing higher than recommended requires acknowledgement with a reason.
5. **Destinations:** a row per destination showing its auto-publish flag and a watch link. Facebook's per-event key has a paste field (masked, `••••1234` afterwards), a warning if it looks like last week's key, and the option to deselect.
6. **Content:** the rundown loaded, assets ready (e.g. "12/12 images ready"), and the starting scene.
7. **Readiness:** grouped into **Blocking** (cannot be dismissed), **Warnings** (**Acknowledge** with an optional reason) and **Info**.

### Modals

- **Start sending:**
  - Destinations, each with an auto-publish warning ("Viewers may see this immediately")
  - The starting scene thumbnail
  - Audio source and mapping
  - Profile
  - **Record a private copy** checkbox
  - Acknowledged warnings

  **Cancel** is focused by default. The confirm button reads "Start sending to 2 destinations".
- **Stop sending:**
  - "Stop sending to: Facebook church page, YouTube church channel."
  - **Keep sending** is focused. **Stop sending** is secondary-positioned and destructive.
  - After confirming, the modal shows per-destination stop progress, and an error variant: "We couldn't confirm the stop. Open Facebook/YouTube and end the broadcast there."
- **Take over studio** confirm.
- **Keyboard shortcuts** overlay (`?`).

### Other screens (lower priority, simpler)

- **S01 Service home:** preset cards (name, last used, last outcome), **New service**, **Duplicate last**. Nothing starts broadcasting from here.
- **Preset editor:**
  - **Theme:** logo upload, corner, scale, 2 colours with a contrast check, and a font choice of 3
  - **Scenes:** up to 12
  - **Rundown:** up to 40 items. Types are lower third (2 lines), text card (title, body, reference) and image (contain/fill). Items can be reordered.
  - Audio defaults, destination selection, and fallback grace (1–10 min)
  - Holding and slate images
- **Programme overlay layouts (in the output canvas, 1920×1080):**
  - The **lower third** is a bar in the bottom 18 % of the frame, with line 1 bold and line 2 regular.
  - The **text/scripture card** is full-frame, with auto-fit text between 64 and 36 px.
  - The **logo** sits in a chosen corner.
  - The **"We'll be right back" slate**.

  All of these use the church's colours and font. Please design these templates too, because they are what viewers see.
- **S05 Destination setup (owner):** platform, label, server (a dropdown, never free text), key mode, a write-only masked key with **Replace**, an auto-publish yes/no/unknown selector with an explanation, watch URL, **Validate**, and a separate, clearly dangerous **Send test media (publishes!)**.
- **S06 Service report:** a summary header, then sections with **Passed / Failed / Not tested / Inconclusive** badges (never green by default), a timeline, destination durations, sync checks, estimated data use, recording links with the expiry date, and **Download JSON**. The end-of-service checklist asks the operator to confirm "Facebook ended" and "YouTube ended".
- **Settings (owner):** users and invites (a copy-link flow), the venue profile (Wi-Fi name, WAN-block test date, route map image), and TOTP management.
- **Login:** email and password, then a 6-digit code, plus first-time TOTP enrolment (a QR code and recovery codes shown once).

## 6. Interaction rules the design must support

- **Stop** has no keyboard shortcut. Enter never confirms Stop.
- These scene shortcuts are disabled while typing or while a modal is open:

| Key | Action |
|---|---|
| 1 | Camera |
| 2 | Camera + lower third |
| 3 | Text card |
| 4 | Image |
| 0 | Holding |
| ← / → | Previous/next rundown item (draft only) |
| Shift+M | Mute toggle |
| Shift+H | Privacy Hold + Mute |

  Show the key hints on the buttons.
- Nothing typed in the draft editor reaches the broadcast until **Apply to programme**.
- Operator actions should visibly update within 250 ms. Show an "applied" confirmation from the runtime, not an optimistic highlight that may be wrong.
- A camera coming back never goes on air automatically. The operator cuts back.
- Every critical state has one clear **next action**.

## 7. Copy and terminology (use these exactly)

| Label | Where |
|---|---|
| "Programme preview - before platform delay" | Caption above the preview |
| "Direct/local verified" · "Direct/location unverified" · "Relayed" · "Unknown" | Camera route |
| "Connected, not on programme" · "On programme" · "Reconnecting" · "Stopped" | Phone tally |
| "Sending to platform" | SENDING; this is not "Live" |
| "Live ✓ (checked by operator, ‹time›)" | Operator-confirmed only |
| "Increase audio delay when sound happens before the matching movement." | Sync control |
| "Keep this page open and the screen unlocked" | Phone |
| "Recovery quality (source)" | When the upload is degraded |

Forbidden: "Everything is fine", "Zero latency", "Perfect sync", viewer counts, Wi-Fi signal bars, and battery or temperature estimates.

## 8. Deliverables requested

1. Design tokens (CSS custom properties) for the dark and light themes.
2. The component set, with all states: button (primary, secondary, destructive, scene, emergency), status pill, health group card, destination row, meter, banner (critical, warn, info, mode), toast, modal, checklist card, QR panel, tally bar, stepper, and slider with numeric entry.
3. High-fidelity screens: S03 Live (normal, PARTIAL, RECOVERING, camera-stalled, read-only), S04 Camera (all 6 states), and S02 Preparation (in progress, and ready).
4. The Start and Stop modals.
5. Programme overlay templates: lower third, text card, logo placement, slate. Show them in 2 sample church colour schemes.
6. Medium-fidelity S01, S05, S06, the preset editor, settings and login.

All strings will live in an English message catalogue (translation-ready later), so avoid baking text into images.
