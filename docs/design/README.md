# Handoff: Raelstream brand identity and design system

## Overview
Raelstream is an open-source broadcast studio for churches. A phone acts as the camera, a laptop composes the programme, and a single stream goes to Facebook Page and YouTube through a media node. This package defines the brand (logo, colour, type, voice), the core components, the live-state patterns, and six reference screens: Preparation (Destinations, Rundown, Audio), Studio (dark and light) and Camera (phone). It also covers the church-themed on-air graphics (fallback slate, lower thirds, text card).

The users are the owner plus 1–3 **volunteer operators**. Every decision favours legibility, large hit targets and calm, explicit copy.

## About the design files
The files in this bundle are **design references created in HTML**. They are prototypes that show the intended look and behaviour, not production code to copy. Recreate them in the target codebase's environment using its own patterns. If none exists yet, choose an appropriate stack (for example React + TypeScript for the studio/camera web apps). `Raelstream Design System.dc.html` opens directly in a browser, provided `support.js` sits next to it.

## Fidelity
**High-fidelity.** Colours, type, radii, sizes and copy are final. Recreate them pixel-accurately. Striped boxes are image or video placeholders (camera feed, church logo).

---

## Design tokens

### Colour — neutrals
| Token | Hex | Use |
|---|---|---|
| `linen` | `#F7F6F0` | Light app background |
| `card` | `#FFFFFF` | Light surface |
| `line` | `#E0DED4` | Light borders, inactive toggle track, secondary button border |
| `fill-subtle` | `#F2F1EA` | Segmented track, key chips, selected nav item |
| `disabled-bg` / `disabled-fg` | `#EEEDE6` / `#9A9E98` | Disabled button |
| `muted` | `#5B6059` | Secondary text on light |
| `ink` | `#1F2320` | Text on light |
| `slate` | `#161A18` | Dark app background |
| `slate-raised` | `#232825` | Dark surface |
| `slate-line` | `#353B37` | Dark borders, secondary button border |
| `slate-divider` | `#2A302C` | Dark top-bar divider |
| `slate-muted` | `#B9BFB9` | Secondary text on dark |
| `slate-faint` | `#7C847E` | Placeholder/tertiary text on dark |
| `paper-text` | `#F7F6F0` | Text on dark |

### Colour — accent (themeable)
The default accent is **Sky**. Each church preset replaces the accent (preset theme = logo, 2 colours, 1 font; spec I-10). Two values are needed per accent:

| Accent | On light (`accent`) | On dark (`accent-dark`) |
|---|---|---|
| **Sky (default)** | `#2F6FCF` | `#6EA2F0` |
| Clay | `#C0613A` | `#E07A52` |
| Teal | `#1F7A86` | `#3FB0BD` |
| Navy | `#2B4C7E` | `#8AA8DA` |

- On light: accent fill uses white text (`#FFFFFF`).
- On dark: `accent-dark` fill uses near-black text (`#101418`).
- The accent is used for primary buttons, selection, focus ring, active step, active scene, "next" rundown item, toggles on, text links and the logo ring.
- **Never** use the accent for status.
- **Validation:** when a church sets its accent, derive or ask for the dark variant, and check contrast of at least 4.5:1 for button text.

### Colour — status (fixed, never themed)
| Token | Hex | Meaning | Tints (dark bg / text) | Tints (light bg / text) |
|---|---|---|---|---|
| `live` | `#D6342C` | On air, programme tally, stop/destructive | `#2A1614` / `#FF8A82`, secondary `#E3C9C6` | `#FBE9E7` / `#B3261E` |
| `ready` | `#2F9A5A` | Check passed, healthy, confirmed | `#1B3325` / `#9BE0B4` | `#E3F3E8` / `#1D6A3C` |
| `standby` | `#D99A1E` | Waiting, reconnecting, slate on, needs decision | `#3A2E14` / `#F4C866` | `#FBF0D9` / `#7A5308` |

Rule: a status is always **dot + word (+ number)**. Colour never carries meaning alone. An "off" dot is an outlined ring (2px border, no fill).

### Typography
Google Fonts: `Bricolage Grotesque` (opsz 12–96, 500/700), `Atkinson Hyperlegible` (400/700), `IBM Plex Mono` (400/500).

| Role | Font | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Display | Bricolage Grotesque | 56/58 | 700 | −2% |
| H1 (screen title) | Bricolage Grotesque | 36/40 | 700 | −2% |
| Title | Bricolage Grotesque | 28/34 | 700 | 0 |
| Card title | Bricolage Grotesque | 22 | 700 | 0 |
| Body | Atkinson Hyperlegible | 17/26 | 400 | 0 |
| Body small | Atkinson Hyperlegible | 14–15/1.45 | 400 | 0 |
| Label / button | Atkinson Hyperlegible | 15–17 | 700 | 0 |
| Data | IBM Plex Mono | 13–16 | 400/500 | 0 |
| Overline | IBM Plex Mono | 12–13 | 500 | +8%, uppercase |
| ON AIR / LIVE pill | Atkinson Hyperlegible | 15 (18 on phone) | 700 | +6–8%, uppercase |

- Numbers, timers, bitrates, RTT, keys and diagnostics always use Plex Mono.
- Stream key fields use Plex Mono at 16–17px with +10% tracking.

### Radius
`8` (small chips) · `12` (thumbnails, icon tiles) · `14` (list rows, scene buttons, lower thirds) · `16` (inputs, dark panels) · `18` (bottom panels) · `20–22` (cards) · `24–28` (screen frames, modal) · `999` (buttons, pills, segmented, toggles).

### Spacing
The base unit is 4. Common values are 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40.
- Card padding: 20–28.
- Screen padding: 36×40 (Preparation) and 16 (Studio).

### Size
- Control heights: **56** (default), **44** (dense panels, the minimum), 48 (Studio top-bar action, phone segmented at 52).
- Toggle: 64×36 track with a 28px knob and 4px inset.
- Status dot: 8–12px.

### Shadow
- Modal: `0 24px 60px rgba(22,26,24,.18)`.
- Selected segment: `0 1px 3px rgba(0,0,0,.12)`.
- Lower third on light: `0 4px 16px rgba(22,26,24,.15)`.
- Programme tally is an inset ring: `inset 0 0 0 4px <live|ready>` (3px on thumbnails, 8px on phone).

---

## Logo
- **Mark:** an open ring. Stroke = 1/6 of the diameter, colour = accent (`accent-dark` on dark).
- **Wordmark:** "raelstream", lowercase Bricolage Grotesque 700 at −3.5% tracking, in ink or paper, never accent.
- **Lockup:** ring + wordmark with a gap of about 0.28× the ring diameter.
- **Clear space:** 1 ring-diameter on every side. Minimum lockup width 96px. Below that, use the app icon.
- **App icon:** a rounded square (radius = 25% of its width) in white or slate with the ring centred at 50% of the width.
- **Don't:** fill the ring, colour it Live red, add religious symbols, or place it on photos.
- **Raelstream never appears on air.** Programme graphics use only the church theme.

## Components

### Buttons (pill, radius 999)
| Variant | Light | Dark |
|---|---|---|
| Primary | bg `accent`, text `#fff` | bg `accent-dark`, text `#101418` |
| Secondary | 2px border `line`, text ink | 2px border `slate-line`, text paper |
| Destructive (confirm only) | bg `live`, text `#fff` | same |
| Destructive trigger | — | 2px border `live`, text `#FF8A82`, label ends with "…" |
| Ghost / link | text `accent` | text `accent-dark` |
| Disabled | bg `#EEEDE6`, text `#9A9E98` | — |

- Padding is 0 26–28px at 56 high and 0 18–20px at 44 high.
- Labels are verb + object ("Start session", "Test uplink", "Stop both"). Never "OK" or "Yes".
- Keyboard shortcut chip inside a button: Plex Mono 11px, bg `rgba(0,0,0,.12)` on a dark-mode accent button, radius 6, padding 2px 6px.
- Focus ring on every interactive element: `outline: 3px solid accent; outline-offset: 3px`.

### Inputs
- 56px high, 2px border `line`, radius 16, padding 0 18px, 17px text. The label (15px bold) sits 8px above and helper text (14px muted) 8px below.
- **Focused:** border `accent`.
- **Error:** border `live`, helper text `#B3261E` bold, phrased as cause + fix ("This key has 1 character too few. Copy it again from YouTube Studio.").
- **Secret field (stream key):**
  - Masked, showing the prefix and the last 4 characters (`FB-••••-••••-••••-7Q2K`), in Plex Mono.
  - Inline pill buttons "Show" and "Paste" (bg `#F2F1EA`, or accent for the primary action when the field is empty).
  - Helper: "Encrypted when saved. Only the media server can read it."

### Toggle
- 64×36 track. On = `accent`, off = `line`. White 28px knob.
- Always a row: title (17 bold) + description (14 muted) on the left, toggle on the right.

### Segmented control
- Track `#F2F1EA`, radius 999, padding 4, gap 4. Segments 44–52px high, bold.
- Selected: white with a small shadow. Unavailable: text `#9A9E98`.
- Used for stream quality (480p / 720p · Recommended / 1080p), rundown item type, and phone zoom (0.5× / 1× / 2×; selected = `accent-dark` bg on dark).

### Stop modal (spec I-11)
- White, radius 28, padding 32, max-width 520.
- Title (Bricolage 28/700) includes the number of destinations: "Stop streaming to 2 places?"
- One row per destination: bg linen, radius 16, padding 14×16. Each row has a live dot, the platform + page name in bold ("Facebook Page · Grace Chapel Lusaka"), and a Plex Mono timer ("LIVE 42:17").
- Body: "Viewers will see the stream end. You can't restart this broadcast. Starting again creates a new one."
- Actions, equal width, 56 high: **Keep streaming** (secondary, 2px ink border, receives **initial focus**) and **Stop both** (filled live red).
- **Enter must not confirm.** Escape closes the modal as Keep streaming.
- When only a subset is live, the label names it ("Stop YouTube only").

### Blocker banner
- Dark: bg `#2A1614`, inset 2px `live` ring, radius 20, padding 20×22. Light equivalent: `#FBE9E7` / `#B3261E`.
- Contents: live dot, title (18 bold), explanation (15, `#E3C9C6`), and two 44px actions (secondary "Diagnostics", primary "Try again").
- Example: the direct-link failure (I-19): "Camera can't reach this laptop directly". The copy states that video isn't relayed through the internet.

## Live-state patterns

### Session pill (Studio top bar)
Pill, radius 999, padding 10×18, 15px bold, 10px dot.
| State | bg / text | Label |
|---|---|---|
| Off air | `slate-raised` / `slate-muted`, outlined dot | Off air |
| Ready | `#1B3325` / `#9BE0B4` | Ready to go live |
| Live | `live` / `#fff`, white dot, +6% tracking | ON AIR + mono timer `42:17` |
| Reconnecting | `#3A2E14` / `#F4C866` | Reconnecting camera… |
| Fallback | `#3A2E14` / `#F4C866` | Slate on · ends stream in `1:24` (countdown of the fallback grace period, I-15) |

### Destination row
Dot + platform (bold) + sub-status (14 muted) + mono timer.
- Live: "Live · 2.5 Mb/s".
- YouTube with auto-publish off: standby "Receiving · publish it in YouTube Studio".
- Failed: outlined live dot, inset live ring, sub-status in `#FF8A82` ("Stopped · YouTube rejected the key"), and an accent "Fix" action.

### Health
- Uplink bars: 4 bars, 5px wide, heights 6/10/15/20, filled `ready` up to the measured level.
- Rows: Uplink, Camera direct link (RTT, fps), Laptop CPU. Standby colour applies at CPU above 80% ("Laptop is working hard").

### Tally (camera and programme)
- Inset ring colour: **Live** = `live` (source is in programme), **Ready** = `ready` (connected and in preview), **Off** = `slate-line`.
- The camera phone also shows a large pill (18px bold, +8% tracking) with the word LIVE / READY.
- The Studio programme canvas uses the same ring colour.

## Screens

### Preparation (light, 1280×820 reference)
- **Frame layout:**
  - Grid of a 260px sidebar and a 1fr main area.
  - Main area grid rows are `minmax(0,1fr) 96px`: content above a sticky footer.
- **Sidebar:** white, right border `line`, padding 24×20. It holds the logo lockup (ring 22 / wordmark 24), then a 5-step list, then the signed-in user at the bottom ("Signed in as Chanda / Volunteer operator").
  - The steps are Devices, Uplink test, Destinations, Rundown, Audio.
  - Step row: 26px numbered circle + bold label, radius 14, padding 12×14.
  - Done = green filled circle. Current = accent circle on a `#F2F1EA` row. Upcoming = outlined circle, muted.
- **Content:** padding 36×40, gap 24. Overline "SUNDAY SERVICE · SUN 27 SEP · 10:00" (Plex Mono 13 muted), then the H1 question.
- **Footer:** white, top border, padding 0 40. Contains a status sentence (dot + bold lead), "Back" (secondary) and the primary next action. The primary stays disabled until blocking checks pass, and the sentence names what's left.

1. **Destinations** — H1 "Where is this service going?"
   - Two cards side by side:
     - **Facebook Page:** per-event key (I-13). Standby ring and a "Needs key" chip until pasted.
     - **YouTube:** a "Goes public when video arrives" toggle that mirrors YouTube Studio (I-14), and the saved key shown masked with its date.
   - Below the cards, an uplink-result card: "Uplink supports 720p" with mono stats, plus the quality segmented control (I-05). Choosing a profile above the recommendation opens an acknowledgement.
   - Then 3 check chips: Camera paired, Mixer audio in, Browser checks passed (the capability probe).
   - Footer: "1 thing left: paste the Facebook stream key." with "Continue to rundown" disabled.
2. **Rundown** — H1 "What goes on screen, in order?"
   - Left list (420px): 44px rows, drag handle (2×2 dots), mono index, title, and a type chip (Text card / Lower third / Image). The selected row has a 2px accent inset ring. A dashed "Add item" row closes the list, which scrolls when there are many items.
   - Right editor card: a 16:9 preview over the camera placeholder, a type segmented control (Name / Scripture / Text card / Image), and fields "Name" and "Second line". Helper: lines over 40 characters get shortened on air.
   - Footer: "9 items. You can still edit and reorder during the service." and "Continue to audio".
3. **Audio** — H1 "Is the mixer coming through?"
   - Input select ("Behringer UMC204HD · inputs 1 and 2") with a "Sound detected" ready chip.
   - L/R meters: 18px high, `ready` fill, a standby marker line at 82% (about −6 dB), and "peak −9 dB" in mono. Guidance: "Aim for green, just below the amber line."
   - Two toggle cards, Low cut and Gentle compressor (I-16), each with a "Hear without it" momentary bypass button.
   - Footer: "Everything is ready…" and "Open the Studio".

### Studio (dark default, light variant; 1280×800 reference)
- **Frame layout:** grid rows 72px top bar / 1fr / 168px bottom panels.
- **Top bar:** padding 0 20, gap 20, bottom border. Left to right:
  - logo lockup;
  - divider;
  - session name and "Grace Chapel Lusaka · 720p30";
  - spacer;
  - session pill;
  - uplink chip;
  - the session action: "Go live" (primary) when Ready, or "Stop streaming…" (outlined red trigger that opens the Stop modal) when Live.
- **Main:** grid `240px minmax(0,1fr) 300px`, gap 16, padding 16.
  - **Sources:** camera thumbnail (16:9, tally ring) with name, direct-link dot and RTT.
  - **Scenes:** 48px buttons with a mono key chip 1–4 (keyboard scene shortcuts, I-16): "Camera + lower third", "Camera only", "Text card", "Be right back slate". The active scene is filled with `accent-dark`.
  - **Programme (centre):**
    - Overline shows "ON AIR" or "NOT YET ON AIR". The 16:9 canvas has a radius of 16 and the tally ring.
    - Lower third: an 8px accent bar and a white panel with a Bricolage 22 name and a 14 bold accent subtitle.
    - Below the canvas: "Next: …", "Clear graphics" (secondary) and "Take next" (primary, with a `Space` key chip).
  - **Rundown (right):**
    - Past items are faint. The on-screen item has a `#2A1614` bg with a live ring. The next item has an `accent-dark` ring.
    - A counter "4 / 9" and "Edit rundown" link at the bottom.
- **Bottom panels:** 3 columns (1.1fr 1fr 1fr).
  - **Audio:** two meters and chips "Low cut", "Compressor", "Mute".
  - **Destinations:** Facebook Page, YouTube, and Private recording (off by default, outlined dot).
  - **Health:** a 2×2 mono grid: Uplink `2.5 / 3.1 Mb/s`, To Johannesburg `38 ms · 0.2%`, Laptop `CPU 54%`, Dropped frames `0`.
- **Light variant:** swap the dark neutrals for their light equivalents (slate → linen, slate-raised → card, slate-line → line, slate-muted → muted) and `accent-dark` → `accent`. Status colours are unchanged, using the light tints for pill backgrounds.

### Camera (phone, 390×844 reference, dark only)
- Full-bleed camera preview with an 8px inset tally ring.
- **Top overlay (56px from top):** large tally pill ("LIVE"/"READY") and a "Camera 1" chip (bg `rgba(22,26,24,.8)`).
- **Bottom sheet:** 12px margin, radius 32, bg `rgba(22,26,24,.92)`, padding 20. It contains:
  - the zoom segmented control, shown only if the browser reports zoom (I-16);
  - status rows "Connected to Studio · 4 ms" and "Phone is warm · 64%" (standby);
  - the note "Keep this screen open. Locking the phone stops the camera."
- Keep the screen awake with the Wake Lock API.

### On-air graphics (church theme, 1920×1080 output)
- **Fallback slate (I-12):**
  - Rendered server-side into a clip matching the profile, on a theme-dark background.
  - Centred church logo, then "We'll be right back" (theme font, about 72px at a 1100px preview width, which scales to about 125px at 1080p), then "Church · Service" in a muted colour.
  - A 10px accent bar along the bottom edge.
- **Lower third · name:** 6px accent bar and a white panel, radius 12, positioned at 6% from the left and 9% from the bottom. Name in theme font bold, subtitle in accent bold.
- **Lower third · scripture:** full-width panel at 6% side margins, `rgba(22,26,24,.9)` background, verse in 15px regular (preview scale) and reference in `accent-dark` bold.
- **Text card:** full-frame accent background, centred title and a single detail line in white.

## Interactions and behaviour
- **Focus and keyboard:**
  - All controls are reachable by keyboard and show the 3px accent focus ring.
  - Scene shortcuts are 1–4 and Take next is Space. Shortcuts are disabled while a text field is focused.
  - The Stop modal traps focus, starts focus on Keep streaming, ignores Enter and closes on Escape.
- **State changes:** status changes swap colour and label with no flashing or blinking. The ON AIR timer ticks every second in mono, so digits don't shift.
- **Validation:** stream keys are validated on paste (length/format). Errors say what's wrong and where to get a new key.
- **Preparation steps** can be revisited. The Studio can only be opened when all blocking checks pass.

## State (minimum)
- `session.state`: `DRAFT → READY → LIVE → (FALLBACK) → ENDED`, plus `generation`.
- `destinations[]`: `{platform, pageName, state: idle|connecting|receiving|live|failed, error?, startedAt, bitrate, autoPublish}`.
- `camera`: `{linkState, rttMs, fps, tally: off|ready|live, zoom?, battery, thermal}`.
- `uplink`: `{upMbps, rttMs, lossPct, recommendedProfile, selectedProfile, acknowledgedOverride}`.
- `rundown`: `{items[], onAirIndex, nextIndex}`. `scene.active` is 1–4.
- `audio`: `{device, channels, peakDb[], hpf, compressor, muted}`.
- `recording`: `{enabled:false}` by default (opt-in, 30-day retention).
- `theme`: `{accent, accentDark, logo, font}` taken from the preset.

## Voice
- Say what happened, then what to do.
- Name the thing ("Stop YouTube only").
- Stay calm, never alarming.
- Numbers go in the details.
- Plain words for a first-time volunteer.
- English only, with all strings in one message catalogue (I-21).

## Assets
- Fonts: Google Fonts, as listed above.
- There are no images or icons. Status is shown with dots, bars and words.
- The logo is geometric (a ring plus a font wordmark), so build it in code or export it to SVG.
- Placeholders need to be replaced with real content: camera video, church logo and the church theme font.

## Files
- `Raelstream Design System.dc.html`: the full reference, covering logo, colour, type, components, live states, voice, all screens and on-air graphics. It has two settings: `accent` (Sky/Clay/Teal/Navy) and `studioState` (Live/Ready).
- `support.js`: runtime needed to open the reference file locally.
- `tokens.css`: CSS custom properties for every token above.
