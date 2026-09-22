# Raeltec Stream
## Product and Engineering Specification

**Version:** 1.0  
**Date:** 20 September 2026  
**Product owner:** Israel Muyoba, Raeltec Systems Limited  
**Initial deployment:** Personal/church use; one organisation, one concurrent broadcast  
**Status:** Proposed implementation baseline. No hardware performance or platform interoperability test is claimed as completed.  
**Working product name:** Raeltec Stream. Naming and branding are not prerequisites for the technical proof.

> **Product promise:** A camera operator moves freely with a phone. A studio operator opens a browser on an ordinary authorised laptop, pairs the phone, selects mixer audio, and sends one programme to Facebook and YouTube.

## 1. Purpose and intended outcome

Build a narrowly focused browser-based production studio, not a general replacement for OBS. The system must provide a dependable weekly workflow for a church that already owns a phone, an analogue mixer, a USB audio interface, and a laptop. The main problem is not the absence of streaming features; it is the friction, processing load, and unreliability of combining those devices.

The first useful release must support a roaming Samsung phone camera, clean mixer audio, simple branding and text, a meaningful programme preview, and simultaneous publication to Facebook and YouTube. It must explain failures clearly enough for a volunteer to act without interpreting a log file.

The design prioritises five outcomes: freedom of camera movement, no streaming-software installation on the laptop, a genuinely usable 1080p30 mode on the tested setup, synchronised speech and video, and predictable behaviour during interruptions. A stable 720p30 mode is required as a fallback, but it must not be presented as proof that the 1080p30 objective has been met.

This document defines requirements, proposed implementation choices, proof gates, and delivery evidence. **MUST** means a release requirement; **SHOULD** means the default unless a recorded engineering justification supports an alternative; **MAY** means optional. Numerical performance values are proposed acceptance thresholds, not claims about hardware already tested.

### 1.1 Definition of a successful service

The operator sets up a saved service without entering IP addresses or installing software. The phone operator walks the agreed camera route without a data cable to the laptop or mixer. Both destinations receive the intended video and mixer audio. A three-hour service completes without an application crash, unbounded latency growth, lost channel routing, or progressive lip-sync drift. When a component fails, the interface identifies that component and the defined recovery behaviour occurs.

An attractive mock-up, a short camera demo, or a successful encoder connection alone does not meet this definition.

## 2. User context and binding constraints

### 2.1 Existing equipment and workflow

The camera device is a Samsung Galaxy A26. The studio device is the user's Dell 14 work laptop; its exact CPU, GPU, browser policy, and driver configuration must be recorded during the proof. This specification does not assume a processor model from a different laptop discussed previously.

The audio equipment includes a Behringer UMC204HD USB interface and a church analogue mixer with AUX OUT. The intended feed is a dedicated livestream mix from an appropriate mixer output to the interface, then USB audio into the laptop. A single mixer channel may arrive on only one side of the interface's stereo capture; the software must explicitly support that situation.

Previous workflows have used phone video with OBS/vMix and an audio interface. The current requirement is browser operation on the work laptop, without requiring those applications, NDI Tools, a virtual-camera driver, a browser extension, or a locally installed streaming helper.

### 2.2 Constraints that must not be traded away silently

| ID | Constraint | Engineering consequence |
|---|---|---|
| C-01 | The camera operator must remain mobile. | No USB, HDMI, or audio cable from the roaming phone to the desk is required. |
| C-02 | No streaming software installation on the work laptop. | All operator functions run in an approved browser; media services run elsewhere. |
| C-03 | Only Facebook and YouTube initially. | No generic multichannel product, social scheduler, or third-party platform catalogue. |
| C-04 | Mixer audio, not the moving phone microphone, is the programme sound. | Phone audio is disabled; interface loss must not trigger an automatic microphone substitution. |
| C-05 | High quality without a high-end production workstation. | Bound the workload, benchmark real devices, and provide a defined reduced-quality mode. |
| C-06 | Pairing should be as simple as scanning a QR code. | QR-based authenticated session association; no manual ICE, SDP, or IP entry. |
| C-07 | The system must be maintainable by its owner. | Small deployable stack, documented configuration, no unnecessary enterprise infrastructure. |
| C-08 | A managed work device must remain within its security policy. | No disabling endpoint protection, bypassing browser policy, or unapproved driver installation. |

Wireless video necessarily uses a radio link. For this specification the proposed primary connection is a dedicated local Wi-Fi network, not the church's shared guest network. The phone is wireless; the stationary laptop should use Ethernet to the same access point/router. Bluetooth and NDI are not dependencies of release 1.

A battery pack mounted with the phone is allowed: it preserves mobility because it does not tether the operator to the production desk.

## 3. Release scope and deliberate exclusions

### 3.1 P0: feasibility before product implementation

P0 is a thin but real vertical slice: open both clients over trusted HTTPS, pair the actual A26 with the actual Dell, carry video locally over WebRTC, capture the UMC204HD, establish manual synchronisation, publish one programme to a server, and receive it at both target platforms in controlled tests.

P0 must measure the complete path. The laptop can show a smooth incoming preview while its programme encoder is overloaded, so an incoming-camera test is insufficient. The owner must see the real programme and the platform output, not only the camera preview.

P0 should use functional engineering controls rather than a finished design system. No substantial scene editor, account management product, or commercial billing work starts before the hardware/media path passes its gates.

### 3.2 Release 1: dependable single-camera church studio

Included: one active phone camera; one USB audio input device; mono/stereo routing; manual audio delay; camera, lower-third, text, image, and holding scenes; a single programme feed from the venue; two independent destination publishers; reusable service presets; actionable health indicators; recovery workflows; and a post-service report.

Phone pairing requires studio approval. A local rehearsal mode must operate without publishing externally. A separate ingest-test mode may publish to the private media server without starting destination publishers. External destination tests require an explicit warning and the correct platform privacy/test configuration.

### 3.3 Later releases, not hidden requirements for release 1

A second or third camera, remote guests, cloud composition, local hardware composition, automatic synchronisation assistance, native camera applications, OAuth-based platform setup, comments, licensed Bible-library lookup, captions, recording, and remote-control-only clients are possible later additions.

Excluded from release 1: 4K; 60 fps; background removal; AI camera following; replay; video-file playback; arbitrary browser sources; screen sharing; multitrack audio; a DAW/plugin host; end-user billing; public signup; NDI interoperability; Bluetooth transport; and guaranteed operation while the phone screen is locked.

The first version must not pretend that a browser is a full camera-control application or that a web studio can override an organisation's device-management policies.

## 4. Technical boundaries and corrected assumptions

### 4.1 Browser-based does not mean processing-free

The selected baseline is **local browser composition with server-side output normalisation and distribution**. The laptop receives and decodes the phone feed, renders the programme, processes mixer audio, and encodes one outgoing WebRTC programme. It is therefore more than a remote control. Its actual performance must be measured.

A server relay removes duplicate venue uploads and moves platform-format enforcement away from the browser. It does not remove the browser's local compositing and encoding cost. The design must not be marketed as requiring negligible CPU without results from the target laptop.

Canvas capture provides a browser video track, but that is not proof of hardware encoding or a zero-copy pipeline. Likewise, adding a received media track to a second peer connection is not evidence of compressed-video passthrough. [S02, S03]

### 4.2 Camera-link latency is not viewer latency

Three different delays must be named separately: phone-to-studio camera latency; studio-to-server contribution delay; and platform-to-viewer delay. A low local camera delay does not mean Facebook or YouTube viewers see the service with the same delay. Platform buffering is outside this application's direct control. [S14]

### 4.3 Statistics do not automatically solve independent-source lip-sync

The phone camera and the USB interface originate from different capture paths. Network round-trip time and WebRTC jitter-buffer statistics do not reveal every capture, rendering, audio-device, and acoustic delay. Release 1 therefore uses a measured calibration and manual offset, not an invented automatic synchronisation calculation. [S04, S05]

### 4.4 QR pairing is not a transport

Scanning a QR code authorises association with a session. It does not join the correct Wi-Fi network automatically, carry the video, bypass firewall rules, or guarantee that the selected media route remains local.

### 4.5 Browser capabilities are conditional

The sender must discover actual capture capabilities and inspect applied settings. Resolution, camera selection, zoom, focus, exposure, torch, stereo audio, and battery information must never be assumed available merely because the phone supports something in its native camera app. [S01, S06]

## 5. Architecture and ownership of processing

### 5.1 Selected baseline

```text
ROAMING CAMERA                         PRODUCTION DESK
Samsung A26 / browser
  camera capture
  one WebRTC video encoder
          |
          | Dedicated local Wi-Fi
          v
Access point/router ---- Ethernet ---- Dell / browser studio
                                       camera decode
Mixer AUX -> UMC204HD -> USB ----------> audio routing + delay
                                       programme compositor
                                       one WebRTC programme encoder
                                                |
                                                | Internet: one AV contribution
                                                v
                                      SELF-HOSTED MEDIA NODE
                                      WHIP/WebRTC ingest
                                      codec/timestamp normalisation
                                      one shared H.264/AAC programme
                                          /                  \
                                 isolated publisher    isolated publisher
                                       RTMPS                  RTMPS
                                         |                      |
                                      Facebook                YouTube
```

A separate HTTPS/WSS application service handles login, pairing, configuration, control, and health. It is not the phone-video relay in normal local mode. Both browsers may load from the same public HTTPS origin while the camera media travels directly across the LAN.

### 5.2 Component responsibilities

| Component | Required responsibility | Must not assume |
|---|---|---|
| Phone camera client | Capture, encode, publish camera video, display tally and connection health. | It can continue capturing while backgrounded or locked. |
| Browser studio | Receive camera, capture USB audio, synchronise, compose, publish one programme, control session. | Another browser tab is merely a harmless duplicate operator. |
| Application/control service | Authenticated pairing, session state, destination configuration, job supervision, events. | An API success response means a platform is publicly live. |
| Media router | Receive WebRTC, expose an internal media path, support protocol bridging. | Routing alone performs codec conversion. |
| Normalisation worker | Produce the chosen fixed output format and coherent timestamps. | The browser always supplies destination-compliant GOPs or audio. |
| Destination publishers | Publish a shared encoded programme independently; retry without affecting the other destination. | RTMPS-connected means viewer playback is verified. |
| Database | Durable presets, session history, leases, configuration, event records. | It should store per-frame media or every high-rate statistics sample. |

### 5.3 Media-node implementation baseline

Use MediaMTX as the proposed ingest/router and FFmpeg as the proposed normalisation and publisher engine. MediaMTX documents browser/WHIP publication and describes using FFmpeg or GStreamer for re-encoding. These are building blocks, not a complete streaming product. [S09, S10]

The preferred internal sequence is: authenticated WHIP ingest -> private contribution path -> supervised normaliser -> private normalised H.264/AAC path -> two independently supervised copy/remux publishers. The normalised path must be unguessable and access-controlled, not exposed as a public playback endpoint.

If selected MediaMTX/FFmpeg versions cannot preserve timing, deliver usable fallback media, or isolate destination recovery, replace that media-node implementation with a GStreamer pipeline behind the same application contracts. Record the evidence in an architecture decision; do not add multiple competing engines without a reason.

### 5.4 Resource-placement fallback

If the Dell fails the agreed 1080p test, first remove unnecessary copies, reduce preview work, and validate hardware acceleration where policy permits. Then test 720p and report the difference honestly.

Cloud composition is a separate design decision: the phone would upload camera video to the server and the laptop would upload mixer audio plus commands. That can reduce laptop video processing but introduces separate contribution clocks, more dependence on the venue uplink, and potentially more preview traffic. It is not a free switch, and it must not silently replace the local-camera baseline.

An optional owned on-site media appliance is another future alternative, but it would add equipment. Neither alternative may be declared implemented by merely drawing it into the architecture.

## 6. Supported environment and compatibility contract

### 6.1 First qualification matrix

The first qualified combination is the actual Galaxy A26 with Chrome for Android, the actual Dell 14 with an employer-approved Chrome or Edge build, and the UMC204HD as exposed by Windows/browser capture. Exact operating-system, browser, firmware, interface-driver, and server-image versions must be recorded.

Support the current approved stable desktop build and test a second current Chromium browser where available. Do not claim all-browser support. Samsung Internet, Firefox, Safari, iPhone, and older Android devices remain unqualified until their own acceptance runs pass.

The browser must expose working camera/audio capture, WebRTC, canvas capture, and Web Audio for the required paths. Capture requires user permission and a secure context; normal deployment must use trusted HTTPS. [S01, S02]

### 6.2 Managed-device preflight

P0 must determine whether camera/microphone access, WebRTC, UDP media, local peer connectivity, audio-device access, and hardware acceleration are permitted on the work laptop. A blocked capability is reported as a compatibility blocker, with the exact symptom. No instruction may ask the user to disable their employer's VPN, security software, certificate controls, or administrative restrictions.

Browser local-network restrictions are evolving. Chrome's published Local Network Access guidance distinguishes request types and implementation stages. Test the actual supported versions rather than assuming every connection needs the same prompt or that a historical exemption still applies. [S07]

### 6.3 No-install definition

The laptop must not require an installer, extension, local service, virtual driver, CLI, Docker, or developer certificate. An optional PWA installation may improve convenience but must not be required. A permitted Ethernet adapter and an already recognised USB audio interface are physical peripherals, not reasons to bypass the no-install constraint.

Development tools and server containers are permitted on the developer's authorised machine and server, not required on the operating laptop.

## 7. Venue network and media-route requirements

### 7.1 Physical network baseline

Use a dedicated production SSID on an access point/router positioned for the intended camera route. Prefer a 5 GHz connection where measured coverage supports it. The laptop should connect by Ethernet to the same LAN, and the LAN should have a routed internet uplink for application access and programme contribution.

The access point must not isolate the phone from the laptop. Avoid guest-client isolation, unintended VLAN separation, or double-wireless forwarding. The operator does not need to manage these during a service; the installation guide and readiness check must make the required topology clear.

The browser cannot reliably identify the Wi-Fi channel, RF noise, RSSI, or exact access point in a portable way. App connection-quality labels must be based on measured media symptoms, not fabricated Wi-Fi signal bars. Router diagnostics may be recorded separately during installation.

### 7.2 Direct camera mode

**NET-01:** The normal camera peer connection must use a direct local candidate pair. P0 must verify the selected route using browser statistics where exposed and a controlled WAN-block test on authorised equipment. A candidate type alone is not sufficient proof that packets remained in the building.

**NET-02:** Do not configure a cloud TURN relay for the camera connection by default. A future explicitly enabled relayed-camera mode must disclose its different latency and internet usage. TURN for the separate studio-to-media-node connection is allowed because that contribution is already intended to traverse the internet.

**NET-03:** Show camera transport as `Direct/local verified`, `Direct/location unverified`, `Relayed`, or `Unknown`, based on available evidence. Do not show a green `Local` label from a guess.

**NET-04:** If local pairing fails, show a focused diagnostic: check that both devices are on the production network, that client isolation is off, and that the authorised browser/network policy permits the connection. Do not silently route through a distant server to make a demo appear successful.

### 7.3 Internet and signalling behaviour

The public app and signalling service require internet for initial load, login, and pairing. A previously established direct camera connection should survive a short WAN interruption if the LAN remains intact; the implementation must test this. An ICE restart or new pairing can still require signalling.

Cache only the static application shell and safe local configuration as appropriate. A cached PWA is not proof of offline authentication, server reachability, or offline session creation. Release 1 does not promise starting a new service with no internet.

### 7.4 Venue survey acceptance

Record a simple camera-route map, allowed operator positions, equipment placement, and any dead zones. Test a walk-through with real movement and a busy-room condition, not just a stationary empty-hall speed test. The network acceptance report must state the tested route and observed behaviour; it must not claim an unmeasured range in metres.

## 8. Identity, pairing, and operator authority

### 8.1 Roles

Release 1 needs an **Owner** who manages settings and destinations, a **Studio Operator** who runs the service, and a temporary **Camera Contributor** restricted to one session's camera. One person may hold the first two roles. This is not an enterprise multi-tenant identity product.

A camera contributor must not receive platform stream keys, account credentials, other session media, administrative controls, or the ability to start a broadcast. The studio operator decides when an admitted source enters the programme.

### 8.2 QR pairing protocol

**PAIR-01:** The studio creates a pairing invitation for one session and one camera slot. Generate a cryptographically random token with at least 128 bits of entropy, preferably 256 bits. Store only a token hash, expiry, purpose, and server-side scope. Default invitation lifetime: two minutes.

**PAIR-02:** Encode the invitation in an HTTPS camera URL. Prefer placing the one-time secret in the URL fragment, exchanging it through an authenticated HTTPS request, then clearing it from the visible address. Use `Referrer-Policy: no-referrer` and exclude token-bearing content from analytics, logs, screenshots, and service-worker caches.

**PAIR-03:** Opening or scanning the link does not consume it. The phone displays the service name and asks the person to join. Consumption occurs atomically during a valid claim, preventing link previewers from using it and preventing two phones from claiming the same slot.

**PAIR-04:** After the claim, the desktop shows a pending device request with a human label and matching short verification phrase. The operator admits or rejects it. Admission and explicit camera permission precede transmission to the studio.

**PAIR-05:** Issue a session-bound contributor credential with a renewable lifetime sufficient for a long service. Suggested token lifetime: 15 minutes, renewed while the contributor remains authorised. Invitations and active contributor credentials are different objects.

**PAIR-06:** Pairing links must not contain Wi-Fi passwords, destination keys, account passwords, or long-lived administrator credentials. A separate optional Wi-Fi setup QR is outside the session-admission flow and must be clearly labelled.

### 8.3 Reconnection and revocation

An admitted phone may reconnect into its existing camera slot during a temporary interruption without a new approval, provided its credential is still valid. It must not displace a different admitted device. Revocation must stop acceptance of new media and terminate the active source within five seconds under a functioning network.

The phone displays its role as `Camera only`. The operator can rename it `Pulpit camera` without exposing raw device identifiers. End of session revokes remaining contributor credentials and closes pairing invitations.

### 8.4 Single active studio ownership

Use a server-side session lease and fencing generation for the active studio and programme publisher. A second tab opens read-only unless the owner explicitly takes over. Taking over must invalidate the previous generation and stop its contribution before accepting a replacement.

A session lease coordinates authority; it must not cause a healthy ongoing media path to be killed simply because a brief control connection is lost. Define lease expiry and recovery together with the session controller in Section 19.

## 9. Phone camera client

### 9.1 Joining and starting capture

The initial camera page displays the service name, device label, permission explanation, and a large `Join as camera` action. After admission, `Start camera` must initiate capture through a user gesture. Request video only; use `audio: false`. Do not ask for microphone access just to discover the device name.

Prefer the rear-facing camera using an ideal constraint, then inspect the actual track settings. Present an explicit camera selector when more than one usable capture device is available. A phone model name is a label, not proof of which physical lens the browser selected.

Capture target: landscape 1920 x 1080, 30 fps, SDR. Fallback capture: 1280 x 720, 30 fps. A lower-resolution result must be displayed as the actual result rather than the requested resolution. Do not request 4K only to downscale it for the first version.

**CAM-01:** Show separate requested and actual quality in diagnostics.  
**CAM-02:** Do not send microphone audio. Verify the outgoing stream contains no audio track.  
**CAM-03:** Keep the selected video source stable across minor UI updates.  
**CAM-04:** Gracefully report permission denied, device unavailable, camera in use, and unsupported constraints.  
**CAM-05:** Provide `Stop camera`; stopping must release the device and wake lock.

### 9.2 Camera controls

Always provide start/stop, device selection where available, landscape guidance, connection status, and an operator-readable source name. Offer zoom, focus, exposure, or torch controls only when capabilities are actually reported and the action is verified by applied settings or observable behaviour. Unsupported controls should be absent or explicitly disabled with an explanation. [S06]

Do not display arbitrary `Wide / Normal / Close` controls unless the device exposes a verified implementation. Digital crop must be labelled digital crop, not optical zoom. Do not promise browser-controlled stabilisation or native camera image-processing quality.

The first release may retain automatic focus and exposure as the only qualified capture behaviour. Fine camera controls must not delay the core reliability work.

### 9.3 Orientation and framing

The programme output remains 16:9 landscape throughout a live session. The phone page guides the operator into landscape, but cannot rely solely on orientation-lock API support. If the handset rotates unexpectedly, preserve the configured programme dimensions and apply the selected contain/crop policy; do not renegotiate the public output dimensions.

Default framing is `Contain`, avoiding accidental loss of the subject. `Fill/crop` is an explicit studio choice. No mirrored rear-camera output. Any selfie-preview mirroring must be display-only unless the operator explicitly chooses otherwise.

### 9.4 Foreground operation and power

Request a screen wake lock after capture begins; show whether it is active and attempt to reacquire it when the page becomes visible again. Wake locks may be refused or released by the platform, so the camera must not claim guaranteed capture with the screen off. [S08]

Display `Keep this page open and the screen unlocked`. Warn the studio when camera frames stop, irrespective of whether the phone can send an explanation. A PWA installation is not a guarantee against background suspension.

Battery percentage and charging state are optional capability-derived fields. If unavailable, show `Battery information unavailable` or omit the field. Do not invent temperature, Wi-Fi RSSI, or battery estimates. Sustained frame loss can support a `Device may be struggling` warning, not a definitive thermal diagnosis.

Qualification must include a three-hour powered or battery-supported run and a walk-through. The phone operator must still be able to carry the phone comfortably with any power bank attached.

### 9.5 Tally and operator feedback

The sender displays `Connected, not on programme`, `On programme`, `Reconnecting`, or `Stopped`. `On programme` means the studio is using that camera; it does not assert that both platforms are publicly live. Show platform publication state separately if the studio supplies it.

A camera-side control may stop that camera but may not end the entire broadcast. Network quality is `Good`, `Reduced quality`, `Unstable`, or `Disconnected`, with one suggested action. Avoid exposing raw SDP, candidate addresses, or internal UUIDs to the camera operator.

## 10. Desktop studio and interaction specification

### 10.1 Core screens

| Screen | Primary purpose | Required content |
|---|---|---|
| S01 - Service home | Start or reuse a service. | Saved presets, create service, last outcome, no automatic broadcasting. |
| S02 - Preparation | Connect and test equipment. | Pair camera, select audio, channel routing, sync, destination selection, readiness. |
| S03 - Live studio | Operate the programme. | Programme preview, scene buttons, audio meters, both destination states, health, stop. |
| S04 - Camera client | Supply mobile video. | Permission flow, preview, tally, capture status, stop camera. |
| S05 - Destination setup | Save publication credentials safely. | Platform, label, server URL/key, validation status, replace key, delete. |
| S06 - Service report | Review outcome. | Durations, failures, recoveries, actual quality, sync checks, destination outcomes. |

### 10.2 Layout at laptop size

At 1366 x 768 the main programme preview, audio state, active scene, destination status, and stop action must remain accessible without horizontal scrolling. Controls must not require full-screen mode. Use one central programme preview, a right-hand equipment/health panel, and a bottom scene strip.

The preview is the actual composed programme, not a camera image with decorative DOM labels that never reach the broadcast. The caption above it must state `Programme preview - before platform delay`.

Editing a lower third or text slide occurs in a small draft panel. Changes do not affect the live output until `Apply to programme`. The editor may show a static draft thumbnail rather than continuously rendering a second full-quality video canvas.

### 10.3 Operator actions

The following must be one clear action from the live studio: cut to camera, show the prepared text slide, show the holding slide, hide a lower third, mute/unmute programme audio, open the dominant health issue, and stop sending the programme.

A two-second accidental key press must not terminate the service. Stopping requires a clearly labelled confirmation summarising affected destinations. A distinct `Cut to holding` control must not end the stream.

Keyboard scene shortcuts may be enabled, but must not fire while typing text or using an input control. Provide keyboard focus, visible labels, readable contrast, and status text in addition to colour.

### 10.4 Terminology and truthfulness

Use names such as `Pulpit camera`, `Behringer USB audio`, `Sunday service`, and `Facebook church page`. Internal identifiers belong in copyable diagnostics, not normal navigation.

Do not use `Everything is fine` when only the browser is running. Present camera, audio, contribution, and destination states independently. For example: `Camera good; mixer audio silent; programme reaching server; YouTube sending; Facebook rejected key`.

The studio must remain operable while a destination is failing. Toasts must not cover the stop button or replace a persistent critical error banner.

## 11. Programme compositor, scenes, and assets

### 11.1 Rendering contract

One media runtime owns the programme canvas and its capture track. Keep it independent of the React component lifecycle so changing a panel does not recreate the encoder, camera connection, or audio graph.

Render the programme at the configured output dimensions, independent of CSS preview size and device pixel ratio. Reuse decoded video frames and pre-render static overlays. Prefer a measured Canvas 2D implementation first; move to WebGL only where benchmark evidence justifies the extra complexity.

Use video-frame callbacks where available to coordinate source updates, while maintaining a bounded programme scheduler for still scenes. Do not assume animation-frame callbacks remain timely in a background or minimised tab. Foreground operation is the qualified baseline. [S18]

Keep a single long-lived output video track. Scene changes modify its contents rather than repeatedly replacing or renegotiating the stream. During a holding slide, continue a valid video cadence and the configured audio behaviour.

### 11.2 Required scene types

**SCN-01 Camera:** The selected camera, optional logo, no lower third.  
**SCN-02 Camera with lower third:** Camera plus speaker name/title or sermon title.  
**SCN-03 Text/Scripture:** A prepared full-frame text card with optional reference line. Text is manually entered or pasted; no licensed Bible database is bundled.  
**SCN-04 Announcement image:** A preloaded still image using an explicit contain/crop mode.  
**SCN-05 Holding:** A preloaded neutral image/text scene used for preparation and failures.

Every scene must define whether mixer audio continues. Default: mixer audio continues across normal scene changes. `Hold picture` and `Mute audio` are independent actions. A privacy/emergency action may combine a holding slate with mute, but it must be visibly different from an ordinary scene switch.

### 11.3 Scene editing and transitions

Support cuts first. A 200-300 ms fade is optional only after measured performance passes. Do not allocate a second full video encoder for a transition.

Store draft and applied scene versions separately. Applied content must have an acknowledgement from the media runtime; saving text in the database alone does not prove it appeared in the output. If an asset is not decoded and ready, keep the existing programme and report the failure instead of producing a black frame.

### 11.4 Asset rules

Release 1 accepts PNG, JPEG, and WebP still images with a proposed 10 MB upload limit and 4096-pixel maximum dimension. Reject animated formats and raw SVG in the first implementation, or securely rasterise them before use. Strip unnecessary metadata during server-side processing.

Assets must be same-origin or served with a deliberately configured CORS policy. A tainted canvas can prevent capture, so arbitrary external image URLs must not be accepted as programme sources. [S02]

Preload all assets needed for the service. Limit the active programme to one video source, one logo, one lower-third/text layer, and one background at a time. Limit a preset to 12 scene entries initially. Avoid a general-purpose nested scene graph.

### 11.5 Source and output quality labels

Report `Camera received at 720p; programme output 1080p` when scaling is occurring. Do not label an upscaled camera feed as native Full HD. A 1080p holding slide also does not prove the live camera is delivering 1080p.

## 12. Audio capture, routing, monitoring, and processing

### 12.1 Input selection

The application must capture a user-selected audio device, inspect the returned track settings, and keep that source stable. A preferred device label may be remembered, but changed browser device identifiers must be handled without assuming a permanent identifier.

Use an internal audio processing rate of 48 kHz where available. Request echo cancellation, automatic gain control, and noise suppression off for mixer music/audio. Inspect the actual result and warn when a requested setting cannot be applied. Browser and device capabilities vary. [S06]

The initial setup uses the UMC204HD with the approved mixer feed. The installation checklist must reference the mixer/interface manuals, appropriate line-level outputs, and channel selection. This software does not require, create, or recover separate instrument tracks from a combined analogue mix.

### 12.2 Channel mapping

Provide four explicit modes: `Input 1 to both ears`, `Input 2 to both ears`, `Stereo input 1/2`, and `Mono blend to both ears`. The mono blend must use a documented normalisation, for example `(L + R) / 2`, to avoid an unintended level increase.

Default for the user's single-cable mixer feed: `Input 1 to both ears`, subject to the channel-identification test. A one-sided input must not produce audio in only the viewer's left ear. Duplicating mono creates dual-mono output; do not call it true stereo.

If the browser exposes only one channel, disable unavailable routing modes and explain the actual capture. Test channel identity with separate known input signals before accepting the interface configuration.

### 12.3 Audio graph

```text
Selected USB capture
  -> input channel routing
  -> user gain
  -> optional high-pass filter / gentle compressor
  -> peak limiter, if qualified
  -> calibrated audio delay
  -> programme destination track
  -> optional local headphone monitor, off by default
```

All processing stays within one persistent AudioContext. Use AudioWorklet for any custom real-time processor; no per-sample React updates or network round trips. The monitor path must not feed back into programme capture.

A limiter must be tested as a limiter. A generic compressor must not be labelled a true-peak limiter without appropriate implementation and verification. Provide a bypass for optional tone/dynamics processing; basic channel routing, gain, mute, metering, and delay are mandatory.

### 12.4 Levels and alerts

Display input and programme peak meters, clipping indication, mute state, and selected channel mapping. Provide a simple setup recommendation to leave headroom; do not imply a digital limiter can repair analogue clipping at the mixer or interface.

Proposed warning thresholds: sustained near-zero input for 15 seconds while audio is expected; any detected sample clipping; and explicit input-track interruption. Silence is a warning, not an automatic disconnection or stop condition, because prayer or planned silence can be intentional.

Do not automatically increase gain during silence. Do not automatically enable noise suppression during music. Do not automatically select the laptop microphone when the interface is unplugged.

### 12.5 Monitoring and sound quality

Local monitoring is off by default and enabled through a user gesture. Recommend headphones for any delayed programme monitoring. The UMC204HD's direct hardware monitoring, the browser programme monitor, and platform playback are different listening points and must be labelled in the setup guide.

Room ambience must come through the deliberate mixer mix. The moving phone microphone is not a hidden ambience source. Monitoring and diagnosis must never make the phone microphone part of the broadcast without a future explicitly designed feature.

## 13. Synchronisation and clock behaviour

### 13.1 Required manual calibration

**SYNC-01:** Provide an audio delay control from 0 to 2000 ms, adjustable in 10 ms steps, with direct numeric entry and reset. Clamp invalid values and show the applied value.

**SYNC-02:** Explain the sign clearly: `Increase audio delay when sound happens before the matching movement`. Do not use an unexplained positive/negative offset convention.

**SYNC-03:** Use a visible clap or a purpose-made flash/beep source whose audio reaches the mixer input. Verify the result in a captured programme output. The ordinary room sound heard beside the laptop is not the correct reference for judging the digital programme.

**SYNC-04:** Save the calibration with the camera identity/label, interface mapping, capture profile, and application version. Reconnection, device replacement, profile changes, or significant camera-path delay changes must mark it `Recheck recommended`.

**SYNC-05:** Provide optional short, explicitly initiated diagnostic capture before going live, or a server-side private test recording. Make the retention clear and delete temporary captures after calibration unless the owner exports them.

### 13.2 What release 1 does not promise

There is no guaranteed automatic lip-sync algorithm in release 1. A calculation such as `network RTT minus interface latency` is not acceptable. WebRTC statistics contain useful transport and buffering measurements, but they are not a complete calibration of independent camera and mixer paths. [S04, S05]

Manual audio delay cannot make already-late audio arrive earlier. If a tested audio path is later than the video and exceeds tolerance, report that the current configuration cannot be aligned with audio delay alone. A bounded video-delay buffer is a separate enhancement requiring memory/performance proof; it is not silently assumed to exist.

### 13.3 Clock ownership and drift

Preserve media timestamps through the ingest/normalisation pipeline. The audio processor must use its audio clock rather than wall-clock timers; video timestamps must remain monotonic. A server restart or reconnect must not concatenate incompatible timestamp epochs without resetting the relevant media session.

Do not rely on the phone and laptop's wall clocks being precisely synchronised. Timestamp metadata and playout estimates may assist diagnostics where available, but calibration remains empirical. The server must verify monotonic output timestamps and maintain a continuous audio track during normal operation.

### 13.4 Acceptance thresholds

Proposed acceptance: programme lip-sync offset within +/-80 ms at start and periodic checks; change in offset no greater than 40 ms across a three-hour controlled run. Record the measurement technique and its resolution. Tests should include checks at 0, 30, 60, 120, and 180 minutes.

If the result moves outside tolerance after a radio disruption, warn and offer recalibration. Do not dynamically change delay from every jitter spike. Any future automatic correction requires bounded adjustments, confidence reporting, audible-artifact tests, and explicit evidence that it improves rather than destabilises synchronisation.

## 14. Video profiles, bitrate control, and overload response

### 14.1 Independent camera and contribution controllers

The phone-to-laptop link and laptop-to-server link must have separate statistics and adaptation decisions. A weak camera link is not the same as a weak internet uplink. Lowering the public encoder's bitrate does not repair missing local camera frames.

Browser sender parameters can request bitrate, frame-rate, and resolution-scaling changes, but actual behaviour must be verified from settings and statistics. A requested maximum is not proof of constant-rate output or hardware implementation. [S03]

### 14.2 Proposed programme profiles

| Profile | Programme canvas | Target frame rate | Browser contribution video ceiling | Intended use |
|---|---|---|---|---|
| Full HD | 1920 x 1080 | 30 fps | 8 Mbps | Normal target after hardware and network qualification. |
| Reliable HD | 1280 x 720 | 30 fps | 4.5 Mbps | Lower laptop/network demand. |
| Recovery | Existing session canvas remains fixed | Prefer 30; temporary 15 fps allowed | 1.5-3 Mbps | Temporary degraded contribution, visibly labelled. |

Values are starting tuning settings. Record the actual bitrate, frame rate, negotiated codec, and delivered source dimensions. Prefer H.264 when it works well on the qualified devices; permit VP8 internally only if the tested server normalisation supports it. Do not require AV1 or HEVC in release 1. [S11]

### 14.3 Public-output stability

Choose the public output profile before publication. Keep its dimensions and audio format stable during the session. The contribution may reduce quality while the server maintains a constant output envelope; the interface must disclose that the source quality has fallen.

A midstream public resolution change is not a release-1 automatic action. Offer a controlled profile switch/restart with warning if required. Do not tell the user that every platform accepts arbitrary resolution changes without interruption.

### 14.4 Adaptation policy

Begin with the qualified profile. Degrade only after sustained evidence, for example five seconds of repeated frame loss, growing send delay, or transport congestion. Allow a minimum 20-second interval between automatic changes. Upgrade only after at least 60 seconds of stable conditions, one level at a time.

CPU overload and network congestion require different responses. For CPU pressure, first reduce preview work and optional effects, then encoded resolution/frame workload. For network pressure, reduce the contribution ceiling. For camera-path pressure, command the phone sender. Never mute audio as the first quality-recovery measure.

Allow `Auto` and `Fixed profile` modes. In fixed mode, report conditions rather than silently changing the chosen settings. Do not guarantee uninterrupted video during complete connectivity loss.

## 15. Contribution ingest, encoding, and destination distribution

### 15.1 Browser-to-server contribution

The studio must publish one programme containing one video track and one processed audio track. Use WebRTC over WHIP for ingest where the selected server supports it. WHIP defines an HTTP-based session setup around WebRTC; it does not mean the media itself is carried inside ordinary HTTP requests. [S12]

Create short-lived, session-scoped ingest credentials. The browser receives permission to publish only to its assigned contribution path. It must not receive reusable server administration credentials or Facebook/YouTube keys as part of the ingest response.

Handle successful creation, authentication failure, unsupported media, connection timeout, ICE restart, and session deletion. Close abandoned ingest sessions. Do not repeatedly create sessions on every statistics update or reconnect loop.

Use UDP media where permitted. A tested TURN/TLS contribution fallback may be enabled for restrictive networks; report its use and include its resource cost. A functioning HTTPS website does not prove the media path is reachable.

### 15.2 Mandatory codec normalisation in the baseline

The baseline media worker decodes the incoming programme as needed and emits a validated shared H.264/AAC output. WebRTC commonly uses Opus audio, so release 1 must include and test conversion to the selected destination audio format. Media routing alone must not be treated as audio transcoding. [S09, S11, S13]

Proposed dual-destination Full HD output: 1920 x 1080 progressive, 30 fps, SDR Rec.709, 8-bit 4:2:0, H.264 Main, target 6 Mbps video, keyframes every two seconds, AAC-LC stereo at 128 kbps and 44.1 kHz. Internal 48 kHz audio may be resampled once at this boundary. A no-B-frame low-latency configuration may be used if validated by both destinations.

This 6 Mbps shared profile is a proposed interoperability compromise, not a statement that it is YouTube's optimum. YouTube's retrieved documentation recommends 10 Mbps H.264 for 1080p30 and a two-second keyframe frequency. Its published encoder settings also specify supported audio and colour options. [S13]

Facebook's complete account-specific requirements must be verified in the real Live Producer environment. The unauthenticated official help page was not fully accessible during this specification review. Do not hard-code an unverified universal Facebook maximum or assume every account has the same capability. [S15]

For Reliable HD, the starting public profile is 1280 x 720 at 30 fps and 3.5-4 Mbps video, with the same audio format and two-second keyframe interval. Actual launch profiles must be stored with a verification date and test evidence.

### 15.3 Passthrough is an optimisation, not the initial assumption

Video-copy/remux mode may be introduced only after proving that the incoming stream satisfies the destination codec/profile, keyframe interval, timestamps, resolution behaviour, and recovery requirements. Audio conversion may still be necessary. If the browser cannot provide a compliant sequence, the normaliser remains required.

Record the actual encoder and hardware/software path on the server. Do not promise a tiny relay VM when the chosen implementation performs continuous Full HD transcoding. Benchmark the selected worker and allocate headroom.

### 15.4 Shared programme, independent publishers

Produce the normalised programme once. Each destination publisher reads that encoded stream and performs only the required muxing/transport work. Starting the second destination must not create a second video encode on the laptop or an unnecessary second shared normalisation encode on the server.

Each publisher must have a bounded queue, independent timeout, and independent restart policy. A slow or rejected Facebook connection must not block YouTube. If FFmpeg tee/fifo output is used instead of separate publisher processes, its failure isolation must pass the same tests; setting an ignore-failure option is not sufficient evidence. FFmpeg documents tee/fifo mechanisms that can support this design. [S16]

Suggested queue budget: no more than two seconds of encoded programme per destination. On overflow, discard stale backlog and reconnect at a decodable keyframe rather than making the destination progressively minutes late.

### 15.5 Fallback media at the server

When the entire browser contribution disappears, the server must not imply it still has fresh camera or mixer content. After a proposed three-second detection threshold, switch to a clearly labelled connection-interrupted slate with silence, provided the media worker is alive.

A prepared fallback clip must match the active output profile, include both audio and video, and produce coherent timestamps. MediaMTX's always-available capability is one candidate mechanism; its actual selected-version behaviour and audio support must be tested. [S17]

Resume the real programme only when both tracks are healthy and after applying the recovery policy. Default maximum unattended fallback period: two minutes, then stop external publishing and mark the session interrupted. The operator may choose a different bounded grace period before the service, not an indefinite hidden loop.

## 16. Facebook and YouTube integration

### 16.1 Release-1 integration boundary

Use user-supplied RTMPS server details and stream keys, stored securely. The user prepares the event, account permissions, title, audience/privacy, and any necessary platform activation in each platform's own interface. The application sends media; it does not initially automate every platform workflow.

YouTube distinguishes encoder connection and some scheduled-stream publication actions. A scheduled event can require a further action in Live Control Room. The application's state model must support that separation. [S19]

OAuth login, event creation, viewer-count aggregation, comments, and one-click public lifecycle management are future integration work, not implied by a successful RTMPS connection.

### 16.2 Destination setup fields

Store platform type, user-friendly label, encrypted stream key, validated server address, enabled status, optional watch-page URL, optional event reference, and last verification result. A saved destination is not automatically selected for every service.

Keys are masked and replaced rather than routinely revealed. The server must not echo the full key in configuration responses. Validation of syntax and connectivity must not unexpectedly broadcast: a test that sends media must be clearly labelled and explicitly confirmed.

Only support the two platform types in the operator UI. Destination endpoints must be validated server-side against an owner-maintained allowlist of official ingest hosts/schemes. No unrestricted arbitrary RTMP URL field accessible to camera contributors.

### 16.3 Destination state model

| State | Meaning | Allowed display claim |
|---|---|---|
| NOT_CONFIGURED | Required destination information is missing. | Not configured. |
| READY_UNVERIFIED | Configuration exists; no current successful connection. | Ready to test. |
| CONNECTING | Publisher is attempting the destination connection. | Connecting. |
| SENDING | Publisher reports accepted transport and advancing media. | Sending to platform. |
| LIVE_CONFIRMED | A supported API or explicit operator observation confirms public playback. | Live, with confirmation source/time. |
| RECONNECTING | Connection was lost and a retry is in progress. | Reconnecting; publication may be interrupted. |
| FAILED | Bounded retries exhausted or a non-retryable error occurred. | Failed, with actionable reason. |
| STOPPED | Publisher is closed for this service. | Sending stopped; platform closure may need verification. |

Without an API, the studio may offer `I have checked the platform playback`. Mark this as operator confirmation, not automatic verification. Expire or flag stale confirmation after a disconnect or long gap. Do not fabricate viewer counts.

### 16.4 Starting safely

Preparation must not automatically send media to an external platform. The final confirmation identifies selected destinations, programme scene, audio source, known privacy/test status, and unresolved warnings. Some platform configurations can publish as soon as ingest starts, so `Test stream` is not inherently private. [S19]

Default policy: if any selected destination is missing required configuration, block starting until it is corrected or explicitly deselected. If a destination fails after sending begins, keep the healthy destination running and show a persistent partial-publication warning.

### 16.5 Ending safely

`Stop sending` stops all selected publisher jobs idempotently, closes ingest, and revokes session credentials. Show whether the server acknowledged stop. If control connectivity is lost, explain that immediate remote shutdown has not yet been confirmed and direct the operator to the platform interface as needed.

Do not assume stopping ingest instantly closes every public player or platform event. The end screen asks for publication-end verification where integration cannot provide it.

## 17. Failure detection and recovery requirements

All times below are proposed starting defaults. They must be configurable within safe bounds and tested under real failure injection.

| Failure | Detection and immediate response | Recovery requirement |
|---|---|---|
| Camera frames stop | Detect no new camera frames for two seconds; warn. Hold last picture no longer than one additional second. | Cut to holding scene; continue mixer audio by default; reconnect admitted camera. |
| Camera reconnects | Frames return and source identity is valid. | Restore as available, not automatically on programme. Operator chooses when to cut back. |
| Phone page locks/backgrounds | Track/state event or frame starvation. | Explain likely capture interruption; never report stale frames as live motion. |
| USB interface disappears | Track ended/device change or verified read failure. | Output silence, keep video, show critical audio warning; no microphone fallback. |
| Mixer input is silent | Input below configured threshold for 15 seconds. | Warn only; allow intentional-silence acknowledgement. |
| Local camera link degrades | Persistent loss/jitter/frame symptoms. | Adapt phone sender; show reduced received quality and sync recheck warning where needed. |
| Internet contribution fails | ICE/transport state plus server media age. | Retain local camera/controls where possible; server fallback slate; bounded retry. |
| One destination fails | Publisher state and advancing-byte timeout. | Retry that destination only; other publisher remains uninterrupted. |
| Studio tab closes/crashes | Contribution heartbeat/media expires. | Server fallback then bounded shutdown; reopening offers recovery, never silent duplicate publication. |
| Application/control service restarts | Lost WSS and service health. | Existing media should continue where safe; recover authoritative state and reconcile jobs. |
| Media worker dies | Process exit or stalled encoded output. | Report interruption; restart from desired state; no claim of seamless recovery. |
| Entire media VM dies | External health or lost contribution endpoint. | Honest outage; restore manually/automatically as implemented. No high-availability claim in release 1. |
| Destination key is rejected | Classified authentication/publish refusal. | Stop rapid retries; request owner correction; never log the key. |
| Browser loses permission | Capture rejection/ended track. | Explain permission recovery; no bypass or concealed substitute. |

### 17.1 Retry policy

Use bounded exponential backoff with jitter: proposed delays of 1, 2, 4, 8, then 15 seconds, continuing only within the service's recovery grace period. Authentication errors and invalid media profiles should not be retried as network glitches indefinitely.

On a restored camera link, target usable video within ten seconds after network conditions and any required phone interaction are restored. On restored internet contribution, target accepted server media within 20 seconds. Platform player recovery is measured separately and is not guaranteed by those internal targets.

### 17.2 Recovery visibility

Keep an event timeline with plain-language causes and actions: `10:42 Camera stopped sending; holding slide applied`, `10:43 Camera reconnected; waiting for operator`, `10:44 Returned to pulpit camera`.

Critical state must remain visible until resolved or acknowledged. Acknowledgement records that the operator has seen the issue; it must not turn a continuing failure into a healthy state.

## 18. Preflight, rehearsal, and service workflow

### 18.1 Preparation checks

Preflight must distinguish **blocking**, **warning**, and **informational** checks. Blocking checks include no admitted usable source for the chosen starting scene, no usable programme audio unless explicitly starting silent, unavailable contribution service, invalid selected-destination configuration, and an unsupported critical browser capability.

Warnings include unmeasured upload headroom, stale sync calibration, unsupported battery reporting, audio silence, reduced camera resolution, unverified platform audience setting, and an unqualified browser/hardware combination. A warning may be acknowledged with a reason; a missing required capability cannot be dismissed into existence.

Do not run a saturating speed test during a live programme. Before service, measure a representative upload to the actual media endpoint and retain the result. During service use passive media statistics.

### 18.2 End-to-end operator journey

1. Open the HTTPS studio and authenticate.
2. Choose `Sunday service` or duplicate the last preset.
3. Confirm the intended destinations without starting their publishers.
4. Connect the laptop to the production network and select UMC204HD audio.
5. Scan the session QR from the phone on the production Wi-Fi; admit it and start rear-camera capture.
6. Confirm actual camera resolution, audio channel mapping, levels, and a short movement test.
7. Calibrate/check lip-sync using the private test path and prepared clap/beep exercise.
8. Prepare lower-third/text/image content and choose the starting scene.
9. Run readiness checks, resolve blockers, and review warnings.
10. Confirm `Start sending` with the named destinations and publication-risk warning.
11. Check actual platform playback and record its verification status.
12. Operate scenes and monitor camera, audio, contribution, and destinations independently.
13. Stop sending deliberately, verify platform closure, and review the service report.

This is an ordered operating procedure, not a requirement for 13 different screens. The UI should combine related work and preserve settings to minimise typing.

### 18.3 Rehearsal boundaries

`Local rehearsal` opens camera/audio and composes the programme without creating any external publisher. `Private ingest test` sends only to the authenticated media node and may make a short diagnostic recording with consent. `Platform test` is a separate explicit action and requires an appropriate platform audience/test setup.

All three modes must have clear banners. A developer test flag must never replace operator-visible publication safeguards.

## 19. Session lifecycle and concurrency

### 19.1 Session states

```text
DRAFT -> PREPARING -> READY -> STARTING -> SENDING
                                      -> PARTIAL
SENDING/PARTIAL -> RECOVERING -> SENDING/PARTIAL
Any active state -> STOPPING -> ENDED
Unrecoverable interruption -> INTERRUPTED
```

Destination states remain independent. `SENDING` is a transport-level programme state, not automatic proof of public playback. `READY` is derived from the latest preflight evidence and becomes stale when critical configuration changes.

### 19.2 Command behaviour

All start/stop/retry/takeover commands carry an idempotency key. Repeated `Start` requests must return the existing operation rather than spawn duplicate media workers. `Stop` is safe to repeat and takes precedence over pending reconnect attempts.

Use a desired-state record and observed runtime state. The supervisor reconciles differences after restart. Persist a monotonically increasing session generation/fencing token so an old browser or worker cannot resume publishing after a newer session controller has taken over.

### 19.3 Leases and reconnect rules

Suggested active-studio lease: 45 seconds, renewed every ten seconds. A control-service disconnection alone should not interrupt a healthy current contribution. Lease expiration prevents new privileged commands from a stale client; the media supervisor also evaluates observed contribution health and the configured recovery policy before teardown.

A new operator takeover requires explicit owner authority, stops or fences the old publisher, and records the transition. The media ingest path must reject a second simultaneous contributor for the same session generation.

Ended sessions cannot be restarted with stale credentials. Reusing a service creates a new session with copied non-secret configuration and an explicit destination selection review.

## 20. Data model and retention

### 20.1 Minimal durable entities

| Entity | Key fields | Important invariant |
|---|---|---|
| User | id, display_name, auth_reference, role, disabled_at | Disabled users cannot start/control a new session. |
| ServicePreset | id, owner_id, name, profile, scene_config, audio_defaults | Presets contain configuration, not active media credentials. |
| StreamSession | id, preset_id, name, lifecycle, generation, desired_state, timestamps | At most one active session for the initial deployment. |
| StudioLease | session_id, holder_id, generation, expires_at | Only the current generation may issue live-control commands. |
| CameraInvitation | id, session_id, token_hash, slot, expires_at, consumed_at | Single-use atomic claim; never store the raw invite secret. |
| CameraSource | id, session_id, label, admitted_at, revoked_at, capability_snapshot | A source is authorised only for its admitted session. |
| Destination | id, platform, label, endpoint, encrypted_key_ref, last_verified_at | Secret values never appear in ordinary read responses. |
| SessionDestination | session_id, destination_id, desired_state, observed_state, failure_code | A failed destination does not stop a healthy sibling by default. |
| Scene | id, preset_id, type, draft_version, applied_version, content, asset_refs | Applied version reflects runtime acknowledgement. |
| Asset | id, owner_id, object_key, mime, dimensions, hash | Only validated assets may enter the compositor. |
| SyncCalibration | id, source_fingerprint, audio_mapping, profile, offset_ms, measured_at | Calibration is invalidated or flagged by relevant path changes. |
| SessionEvent | id, session_id, sequence, kind, actor, occurred_at, payload | No stream keys, full SDP, or raw bearer tokens. |
| DiagnosticSummary | session_id, time_window, aggregated_metrics, evidence_refs | Missing telemetry stays missing, not zero/healthy. |

### 20.2 Storage boundary

Use PostgreSQL for durable application state. The first deployment may run a small database alongside the application with persistent storage and backups. Keep configuration and secret encryption keys outside source control. The database must never be in the per-frame media processing loop.

Validated branding assets may use local persistent storage or an S3-compatible store behind the same application interface. Do not add distributed storage solely for a handful of logos unless it already fits the hosting environment.

### 20.3 Proposed retention defaults

Keep service summaries and operator event history for 90 days; aggregate operational metrics for 30 days; high-frequency diagnostic samples for up to 24 hours only when explicitly collected. Pairing invitations expire promptly and may be purged after their security/audit retention window.

No routine programme recording in release 1. Short diagnostic captures require explicit consent, private access, and automatic deletion after 24 hours or earlier operator deletion. The owner may export a capture for an acceptance pack. These are product privacy defaults, not a statement of a particular statutory retention obligation.

## 21. Application APIs and event contracts

### 21.1 HTTP command surface

All authenticated resources are scoped to the current owner's deployment and authorised session. Use schema validation, structured error codes, and request correlation. The following names define intent; implementation may refine route spelling without changing behaviour.

| Method and route | Purpose | Key response/constraint |
|---|---|---|
| POST /api/sessions | Create service session. | Session summary, generation; no publishers started. |
| GET /api/sessions/{id} | Read authoritative state. | Redacted configuration and independent component states. |
| POST /api/sessions/{id}/pairings | Create camera invitation. | Expiring one-time invitation URL; owner/operator only. |
| POST /api/pairings/claim | Claim invitation. | Pending admission, not unrestricted media permission. |
| POST /api/sessions/{id}/sources/{source}/admit | Admit source. | Session-bound camera capability. |
| DELETE /api/sessions/{id}/sources/{source} | Revoke camera. | Active source closed and credential revoked. |
| POST /api/sessions/{id}/preflight | Evaluate readiness. | Checks with severity, evidence, freshness, next action. |
| POST /api/sessions/{id}/ingest | Create private contribution. | Scoped WHIP endpoint/token; no destination keys. |
| POST /api/sessions/{id}/start | Start selected publishers. | Idempotent operation reference and observed progress. |
| POST /api/sessions/{id}/stop | Stop publication. | Idempotent shutdown state and confirmation status. |
| POST /api/sessions/{id}/scene | Apply validated scene version. | Runtime acknowledgement, not just database save. |
| PATCH /api/sessions/{id}/audio | Apply gain/routing/delay. | Applied values and calibration status. |
| POST /api/sessions/{id}/destinations/{dest}/retry | Retry one destination. | No restart of the other destination. |
| POST /api/sessions/{id}/takeover | Transfer studio ownership. | New generation; old publisher fenced. |
| GET /api/sessions/{id}/report | Service outcome. | Redacted metrics, events, and verification evidence. |

The ingest resource uses WHIP's own session semantics, including appropriate creation, update/restart, and deletion handling. Wrap it through an application adapter rather than improvising incompatible signalling. [S12]

### 21.2 WebSocket control and signalling

Use authenticated WSS for session events and peer negotiation. A camera client may send only its scoped admission/capability/state messages and the appropriate WebRTC signalling. The server validates message type, size, role, session generation, and rate.

Separate transient negotiation messages from durable business events. SDP and ICE candidates are sensitive transient networking data; do not put them into the normal session timeline. Enforce small message-size limits and redact diagnostic exports.

For a direct camera link, source tally and a small set of live controls may use an RTCDataChannel after admission, with acknowledgements and the same session generation. If WSS is used instead, document the dependency on internet signalling.

### 21.3 Example event envelope

```json
{
  "schemaVersion": 1,
  "eventId": "opaque-internal-id",
  "sessionId": "opaque-internal-id",
  "sessionGeneration": 3,
  "sequence": 124,
  "type": "destination.state.changed",
  "occurredAt": "2026-09-20T10:45:00Z",
  "data": {
    "destinationLabel": "YouTube church channel",
    "state": "SENDING",
    "confirmation": "transport_only",
    "reasonCode": null
  }
}
```

Reconnect subscribers using a sequence cursor, then reconcile from a fresh state snapshot if events were missed. An optimistic button state must not override a later server rejection.

### 21.4 Error contract

Errors include a stable code, safe message, component, retryable flag, and suggested action. Example: `AUDIO_DEVICE_LOST`, `The selected USB audio interface is no longer available`, `audio`, `false`, `Reconnect the interface and select it again`.

Do not send raw process arguments, destination keys, stack traces, or full internal URLs to volunteers. Detailed privileged diagnostics may use correlation IDs with server-side redaction.

## 22. Suggested codebase and engineering standards

### 22.1 Stack baseline

Use TypeScript for the browser and application control plane. A React/Vite single-page app is sufficient; server-side rendering is not required for the live studio. Use a small Node.js HTTP/WebSocket service, a PostgreSQL database, MediaMTX, FFmpeg, and a reverse proxy with automated trusted TLS.

Pin maintained stable versions and container digests when implementation starts. This specification intentionally does not assert unverified package version numbers. Use one package manager and committed lockfiles. The media-node adapter must isolate vendor/version-specific behaviour from the user-facing application.

Do not add LiveKit, mediasoup, a second SFU, Kubernetes, Redis, and a separate message broker simply because they are common in larger video products. Add a component only when a demonstrated requirement exceeds the smaller design.

### 22.2 Suggested repository shape

```text
apps/
  web/                 studio and phone routes
  control/             API, WSS, auth, desired-state supervision
packages/
  contracts/           runtime schemas, typed commands and events
  media-runtime/       camera receiver, compositor, audio graph, ingest client
  camera-client/       capture, capabilities, phone connection controller
  media-node-adapter/  router, normaliser and publisher orchestration
  ui/                  shared accessible controls
infra/
  compose/             local and server deployments
  proxy/               HTTPS/WSS configuration
  media/               pinned router/encoder profiles and fallback assets
  migrations/          database changes
tests/
  unit/
  integration/
  browser/
  media/
  acceptance/
docs/
  architecture/
  runbooks/
  evidence/
```

Folder names are suggestions. Ownership boundaries and testability are requirements. Browser media objects must not be serialised into application state stores or recreated by ordinary component renders.

### 22.3 Engineering rules

Treat media lifecycles as explicit controllers with `start`, `stop`, `dispose`, and observable state. Release tracks, event listeners, timers, WebSocket subscriptions, image bitmaps, AudioNodes, workers, and peer connections on disposal. Test repeated start/stop cycles.

Use a typed command bus or small state-machine layer to keep control state separate from frame processing. Route errors through component-specific classifications. Configuration changes must have an applied acknowledgement and a safe fallback.

Run formatting, type checks, lint, unit tests, integration tests, and a browser smoke test locally. CI may repeat these but is not the only acceptable evidence. Commit test commands and deterministic fixtures so the owner can reproduce results without depending on a particular hosted CI allowance.

## 23. Security, privacy, and abuse resistance

### 23.1 Trust boundaries

The phone is a scoped contributor, the laptop is an authenticated operator endpoint, and the server is a trusted media processor. WebRTC and RTMPS protect their transport legs; this is not end-to-end encryption from the camera through the social platform, because the studio and server must process media. [S12, S13]

No public room directory, anonymous join, or open relay is permitted. All read/publish paths require scoped authorisation. Enforce the deployment's one-active-broadcast limit at the control and media layers, not only in the UI.

### 23.2 Secrets and authentication

Use secure, HttpOnly, appropriately SameSite session cookies for the owner/studio where applicable. Protect state-changing requests against CSRF and verify WebSocket origins. Use short-lived media and contributor capabilities with explicit purposes.

Encrypt platform keys at rest with a deployment key kept outside the database and source repository. Limit decryption to the publisher supervisor. Ensure process logs, crash reports, command-line diagnostics, telemetry, API responses, screenshots, and service reports do not expose them.

Public phone code must not contain platform secrets, server admin keys, or a hard-coded universal joining token. A leaked invitation must have limited scope and short expiry.

### 23.3 Network destination validation

Destination URLs, asset fetches, and any diagnostic fetches can create server-side request risks. Enforce allowed schemes/hosts, normalise and validate addresses, reject private/loopback/link-local destinations for external publishers, disable unexpected redirects, and validate resolved addresses at connection time. Document necessary platform-host changes as configuration updates. [S20]

Do not pass untrusted URLs, filenames, or scene text through a shell command. Spawn media processes with argument arrays and a restricted environment. Escape display content, validate uploads by decoded content, and prevent directory traversal.

### 23.4 Browser hardening

Use a restrictive content security policy, narrowly scoped camera/microphone permissions, trusted asset origins, and no third-party advertising or analytics scripts on capture/studio pages. Limit the camera route to the permissions it actually needs.

Do not cache credentials or live media in the service worker. Avoid browser-local persistent storage of stream keys. Stop camera tracks promptly on explicit stop/logout where the application remains active.

### 23.5 People and content privacy

The operator must intentionally choose when to start external publication. Preparation must not leak camera video to Facebook or YouTube. Provide a clear camera-use indicator and an emergency holding-plus-mute action.

The owner remains responsible for appropriate filming permissions, account access, and rights to music, slides, and other content. The software should make deliberate publication possible, not imply that using it supplies those rights. Recording and diagnostics are opt-in and access-controlled.

### 23.6 Security acceptance

Required negative tests include expired/replayed invitations, two concurrent claims, unauthorised scene commands, cross-session media access, a revoked source continuing to send, malformed SDP/message floods, malicious image metadata/content, a destination URL targeting an internal address, and secrets appearing in logs or reports.

## 24. Observability and honest health reporting

### 24.1 Measured signals

Collect low-overhead WebRTC statistics for both links separately: negotiated codec, bytes sent/received, frame dimensions, frames encoded/decoded where available, packet loss, round-trip time, jitter, and buffering/encode-time counters. Record availability rather than assuming every browser returns every field. [S04, S21]

Suggested sampling: collect browser media statistics once per second, update operator health at most once per second, and persist five- or ten-second aggregates. Audio meters can update more frequently locally without writing each sample to the server.

Use counter deltas for interval rates. For example, interval bitrate is `8 * delta(bytes) / delta(seconds)`. Average interval jitter-buffer residence is `delta(jitterBufferDelay) / delta(jitterBufferEmittedCount)` where the counters are valid and the denominator is nonzero. This is buffering residence, not complete camera latency. [S04]

### 24.2 Signals the browser may not provide

Do not invent total machine CPU usage, GPU temperature, exact hardware encoder identity, Wi-Fi RSSI, or phone thermal readings. Use system tools during qualification and mark missing in-app measurements as unavailable. A field inferred from symptoms must be labelled inferred.

Likewise, a ping RTT must not be displayed as `Camera latency`. The local end-to-end camera delay requires a timing experiment or a qualified capture/display timestamp method with its uncertainty recorded.

### 24.3 Health model

Show four health groups: **Camera link**, **Mixer audio**, **Programme upload**, and **Destinations**. Overall readiness derives from those groups but never hides a red component. Include last-updated timestamps and stale-state detection; an offline dashboard must not keep presenting yesterday's green status.

Suggested stale threshold: five seconds for active-session media health, adjusted for the actual sampling cadence. If telemetry is missing but media is visibly advancing, explain the distinction instead of classifying everything as disconnected.

### 24.4 Service report

Include requested and actual profiles; device/browser/server versions; session and destination durations; measured reconnects; critical alerts; source and output quality reductions; sync checks; known recording/test evidence; and public-playback confirmation source and time.

The report must distinguish `Passed`, `Failed`, `Not tested`, and `Inconclusive`. Missing evidence must never become a pass. Provide an owner-downloadable redacted JSON report and a readable on-screen summary.

## 25. Performance and quality acceptance budgets

These are proposed engineering gates for the actual qualified setup. They are deliberately testable and may be revised only through a documented owner-approved trade-off.

| ID | Measure | Initial acceptance target | Measurement method |
|---|---|---|---|
| P-01 | QR claim to usable camera | Within 15 seconds after necessary permission/admission actions. | Timestamped events; exclude time spent waiting for the person to consent. |
| P-02 | Local camera glass-to-glass delay | Median at most 200 ms; 95th percentile at most 350 ms on the qualified route. | At least 100 timed observations across static and walking tests, with method uncertainty. |
| P-03 | Camera/programme frame delivery | At least 27 unique frames/s in 95% of five-second windows during controlled 30 fps motion tests. | Source/decoded counters and frame-marked test output; duplicated encoder frames do not count as unique. |
| P-04 | Unplanned picture freezes | No unexplained freeze longer than one second in the normal-condition test. | Frame sequence/timecode analysis and observer log. |
| P-05 | Lip-sync | Within +/-80 ms; drift no more than 40 ms over three hours. | Captured output checks at defined intervals. |
| P-06 | Operator action responsiveness | 95% of local scene/mute actions visibly applied within 250 ms. | User-event and applied-programme timestamps; not public-player timing. |
| P-07 | Desktop workload | No sustained CPU saturation; target process-group CPU below 50% median and 70% P95 on the reference Dell. | OS/browser task tooling with hardware and measurement basis recorded. |
| P-08 | Memory stability | Target studio process group below 1 GB steady state; no sustained upward growth greater than 100 MB from minute 30 to 180. | OS process-group measurement; distinguish JS heap from GPU/media buffers. |
| P-09 | Venue upload copies | One programme contribution independent of destination count. | Network counters with one and two destinations; no material second venue upload. |
| P-10 | Publisher isolation | Failure of one destination adds no interruption to the other. | Forced refusal/stall of one publisher while checking the other output. |
| P-11 | Sustained operation | Three-hour controlled run plus two real-service pilots without critical application faults. | Complete reports, outputs, event logs, and owner observation. |
| P-12 | Server headroom | Shared normaliser processes real time with at least 30% measured resource headroom. | Worker throughput, CPU/GPU usage, queue age, and media timestamps. |

### 25.1 Interpreting failures

If 1080p passes visual quality but fails the resource budget, record both facts. Optimise and retest; do not quietly delete the resource requirement. If only 720p qualifies, present the product as 720p-qualified with a pending 1080p decision.

CPU and memory thresholds are initial targets rather than universal minimum-device specifications. A low-end support claim requires repeating the full test on a genuinely lower-powered machine. Success on a premium Dell does not prove suitability for every ordinary laptop.

### 25.2 Quality assessment content

Test speech close-ups, camera panning, walking subjects, musicians' movement, low-light areas, small text, bright projection screens, and audio with speech and music. Observe focus hunting, rolling exposure changes, dropped motion, blur, codec blocking, channel imbalance, and audible processing artifacts.

Record environmental limits rather than blaming all picture softness on the software. Conversely, do not blame Wi-Fi without comparing source, receiver, programme, and destination evidence.

## 26. Test strategy and proof gates

### 26.1 Test layers

Unit tests cover state machines, roles, invitation lifecycle, profile selection, routing/gain arithmetic, idempotency, redaction, retry policies, and report aggregation. Integration tests cover database transactions, session fencing, ingest creation/deletion, worker supervision, and publisher isolation.

Browser tests cover permission errors, QR flow, scene editing, audio selection, keyboard safety, recovery banners, and no-install operation. Synthetic browser media is useful for repeatability but does not qualify the A26 camera, Wi-Fi route, interface driver, or hardware encoder.

Media tests use frame-numbered motion clips, visible/audible sync events, channel-specific tones, and intentionally interrupted inputs. Final acceptance requires actual hardware and target platforms, with the selected privacy/test arrangements.

### 26.2 Eight proof gates

| Gate | Required proof | Failure disposition |
|---|---|---|
| G1 - Browser and device access | A26 capture and UMC204HD capture on the authorised Dell without installs or policy bypass. | Compatibility blocker; document exact policy/capability. |
| G2 - Mobile local camera link | Direct local media, roaming-route results, measured latency and sustained frames. | Correct network/design; no hidden cloud relay. |
| G3 - Complete laptop media workload | Receive, compose, process audio, and upload the real programme together at target quality. | Optimise, test 720p, or obtain owner decision on architecture. |
| G4 - Audio routing and timing | Correct dual-mono/stereo mapping and three-hour sync measurements. | Fix media graph/calibration; no invented auto-sync pass. |
| G5 - Real platform interoperability | Both actual accounts accept the chosen output, with correct picture/audio and publication controls. | Adjust profile/integration; preserve evidence of restrictions. |
| G6 - Failure and concurrency safety | Camera loss, interface loss, WAN loss, rejected key, duplicate start/tab, revoke and stop. | Repair before pilot; no reliability claim. |
| G7 - Security and evidence integrity | Scoped access, secret redaction, negative tests, truthful states/reports. | Release blocker for material exposure or unauthorised publication. |
| G8 - Operational qualification | Three-hour soak, two real services, volunteer workflow, restore/redeploy drill. | Pilot only; no accepted release status. |

G1-G5 require a thin proof during P0. G6-G7 require early targeted tests and complete release validation. G8 closes the first release. It is acceptable for P0 to reveal a blocker; it is not acceptable to obscure one with a polished UI.

### 26.3 Evidence pack

Each gate has the commit SHA, environment manifest, exact test commands/procedure, start/end time, results, relevant screenshots/captures, redacted diagnostics, and unresolved limitations. Use durable filenames and a short index mapping requirements to evidence.

For glass-to-glass latency, document the setup: a reference timer/event viewed by the phone and its received image captured together by an independent device, or an equivalently justified method. State capture frame rate and measurement resolution. Do not use human impression or ping time as the measurement.

A failed or blocked test stays visible in the ledger. Do not substitute a unit test of expected calculations for a demonstrated browser, media-server, or platform result.

## 27. Delivery work packages

| Package | Deliverable | Dependencies | Completion evidence |
|---|---|---|---|
| WP0 - Feasibility spine | Thin camera/audio/programme/platform flow; actual-device benchmark; architecture decision. | Authorised devices and test accounts. | G1-G5 preliminary pack and go/no-go decision. |
| WP1 - Session foundation | Owner login, preset/session model, leases, invitation admission, scoped signalling. | WP0 accepted architecture. | Unit/integration tests and real two-device pairing. |
| WP2 - Qualified camera | A26 capture UI, capability handling, wake-lock state, direct link, reconnect/tally. | WP1. | Roaming and interruption evidence. |
| WP3 - Audio and programme | UMC routing, meters, delay, compositor, five scene types, safe asset loading. | WP0; integrates with WP1-WP2. | Channel tests, burned-in overlay proof, sync tests. |
| WP4 - Media publication | WHIP ingest, normalisation, two isolated publishers, destination setup and honest states. | WP0; WP1; programme from WP3. | Both real outputs, fixed profiles, invalid-key/isolation tests. |
| WP5 - Recovery and health | Bounded fallback, retries, stale telemetry, reports, duplicate-control protection. | WP2-WP4. | G6 scenarios with measurable outcomes. |
| WP6 - Hardening and operations | Redaction, security tests, deployment/runbooks, restore, soak, real-service pilots. | WP1-WP5. | G7-G8 acceptance pack and owner review. |

### 27.1 First owner-visible demonstration

The earliest demonstration must show the actual phone moving while the Dell browser receives it, the actual UMC meter responding, a real applied audio offset, and the programme received at the media node. Show the selected route and measured laptop load.

Do not begin with an attractive landing page or a simulated live dashboard. A fake signal meter or looped sample video may be used only in clearly labelled UI tests.

### 27.2 Engineering stop conditions

Pause the dependent work package for owner decision when the no-install requirement cannot be met, local roaming cannot meet latency/stability targets, the laptop cannot carry the required workload, the necessary Facebook account capability is unavailable, or the cloud/resource cost is materially outside the intended personal-use budget.

Continue independent well-defined work, but do not silently change the product promise. Each decision must state evidence, options, effects on mobility/performance/cost, and the recommended engineering path without presenting an untested option as a solution.

## 28. Deployment, maintenance, and operational cost model

### 28.1 Initial deployment

Use a persistent Linux VM or equivalent long-running container host with a public address, trusted HTTPS, and the required media-port access. This is not a short-lived serverless-function workload. The application can be hosted separately, but media workers need persistent sessions and predictable networking.

Docker Compose is sufficient for the initial private deployment. Run the application, database, media router, supervised worker environment, and reverse proxy with pinned configuration, health checks, restart policies, resource limits, and persistent volumes as needed. Keep database/admin ports private.

An initial benchmarking allocation of approximately four modern vCPUs and 8 GB RAM is reasonable for testing one software-normalised programme, but it is not a guaranteed minimum or a provider quote. Measure the selected instance; adjust for encoder preset, hardware acceleration, and fallback implementation. A pure copy/remux configuration may need less, but that is a separately proven optimisation.

### 28.2 Network deployment checklist

Expose HTTPS/WSS for the app and WHIP signalling. Explicitly configure and document the WebRTC media UDP listener or range, advertised public address, firewall rules, and any TURN service. A reverse proxy handling HTTPS alone is not proof that the WebRTC media path works.

If TURN/TLS on port 443 is needed, plan a separate address or a correctly qualified listener arrangement; do not assume an ordinary HTTPS proxy can forward every TURN connection. Document what happens when only TCP is permitted.

The exact ports and domains belong in the deployment manifest and must match the pinned software configuration, not assumptions copied from a different product's default.

### 28.3 Operating runbooks

Provide runbooks for first install, domain/TLS setup, destination-key replacement, pre-service checks, camera reconnection, audio-interface loss, platform refusal, contribution interruption, manual stop from platform controls, backup restore, and rollback to the last qualified version.

Deploy only between services. Do not hot-reload the studio bundle or forcibly activate a service-worker update during a broadcast. Display `Update available after this service` and apply it after media stops. Keep a compatible last-known-good server profile and application build.

Back up database configuration and assets, protect encryption keys separately, and perform a restore drill. A backup that has never been restored does not close the operational gate.

### 28.4 Data-volume arithmetic

For decimal units, approximate one-way media volume as:

```text
GB per hour = total bitrate in Mbps x 0.45
Monthly venue upload = contribution GB/hour x broadcast hours
Monthly server egress = sum(destination GB/hour) x broadcast hours
```

Illustration, not a usage guarantee: an 8 Mbps video plus 0.128 Mbps audio contribution is approximately 3.66 GB/hour from the venue. Two destinations each receiving 6 Mbps video plus 0.128 Mbps audio total approximately 5.52 GB/hour of server egress.

At 13 broadcast hours/month, those assumptions give approximately 47.55 GB venue upload and 71.70 GB server egress, before protocol overhead, retransmissions, downloads for platform checks, TURN traffic, diagnostic captures, and any recording storage. Camera media that is genuinely direct on the LAN does not add an internet camera-upload leg.

### 28.5 Budget model and safeguards

Budget separately for server compute, database/asset storage, outbound traffic, TURN traffic, backups, domain, venue internet, and any required access point/Ethernet adapter/power support. Use actual selected-provider rates when choosing hosting; this document is not a quotation.

Enforce one concurrent session, maximum configured bitrate, bounded reconnect/fallback periods, expired-session cleanup, and recording disabled by default. Display estimated service data use as an estimate, not a bill. Do not scale the system into a commercial multi-tenant service before the personal workflow is qualified.

## 29. Decision register and unresolved proofs

| ID | Decision/default | Status | Evidence required before changing or accepting |
|---|---|---|---|
| D01 | Dedicated wireless phone link; Ethernet studio preferred. | Proposed baseline preserving mobility. | Actual route and roaming qualification. |
| D02 | Browser-only operator experience; no local helper. | Binding requirement. | G1 on managed Dell. |
| D03 | Local browser composition plus server normalisation. | Proposed baseline, gated. | Complete 1080p workload and latency results. |
| D04 | One camera and two destinations. | Release-1 scope. | No scope expansion without owner approval. |
| D05 | Manual audio calibration; no automatic-sync promise. | Baseline. | G4; future automation requires independent proof. |
| D06 | H.264/AAC fixed shared public profile. | Provisional until real-platform test. | Facebook account capability and both-output inspection. |
| D07 | Manual stream-key setup, platform publication verification. | Baseline. | Owner workflow and credential handling tests. |
| D08 | No routine recording or phone-microphone fallback. | Baseline privacy/resource choice. | Explicit future scope decision to change. |
| D09 | MediaMTX plus FFmpeg behind an adapter. | Proposed implementation. | Timing, fallback, isolation, version/licence review. |
| D10 | Three-hour soak and two real-service pilots. | Release gate. | G8 evidence and owner acceptance. |

Outstanding factual unknowns: exact Dell hardware/policies; actual browser-exposed A26 capture capabilities; real UMC browser channel mapping; occupied-venue network performance; whether the current Facebook account accepts the chosen output profile; measured server sizing; and actual programme drift. These are testable unknowns, not reasons to leave their behaviour undefined.

## 30. Definition of done and handover requirements

Release 1 is complete only when the binding constraints hold, the release-1 functions are implemented, every proof gate has its required evidence, and no critical defect remains hidden behind a simulated status. The user can run the ordinary workflow without developer tools or unapproved software installation.

Handover must include source code and dependency lockfiles, infrastructure configuration, secret-management instructions without secret values, database migrations, local test commands, installation and service runbooks, actual supported-device matrix, acceptance evidence, known limitations, and a prioritised later-release backlog.

The acceptance statement must say what has been proved: for example, `Qualified on the tested Galaxy A26, Dell browser, UMC204HD, venue route, and server configuration at 1080p30`. It must not say `Works on any phone or laptop`, `Zero latency`, `Never disconnects`, or `Automatically perfect lip-sync`.

**Final release question:** Can the owner use this setup for an entire real church service, with a roaming camera operator, correct mixer audio, intelligible failure handling, and both intended platform outputs, without installing a streaming application on the laptop? If the evidence does not support yes, the release remains a pilot.

## Appendix A. Detailed acceptance scenarios

Every scenario records build, environment, steps, observed result, evidence, and pass/fail/blocked status. Scenarios involving external publication require the owner's chosen platform test/privacy arrangements.

| Test | Scenario and expected result | Primary gate |
|---|---|---|
| A01 | Open the studio on the authorised Dell; no installer, extension, local helper, or policy bypass is requested. | G1 |
| A02 | Scan a fresh QR, claim, admit, grant permission, and receive the actual rear camera. | G1/G2 |
| A03 | Expire an invitation before claim; reject it and provide a new-QR action. | G7 |
| A04 | Claim the same invitation concurrently from two clients; only one pending source is created. | G7 |
| A05 | Open the QR through a link preview/scanner; do not consume it until the deliberate claim. | G7 |
| A06 | Reject camera permission; show a recoverable, device-specific explanation without hanging. | G1 |
| A07 | Walk the agreed route with frame-marked motion; meet local latency/frame targets and preserve mobility. | G2 |
| A08 | Interrupt WAN while LAN remains intact; verify established local camera continuity and honest contribution failure. | G2/G6 |
| A09 | Attempt local camera pairing with client isolation; fail clearly without an undisclosed cloud relay. | G2 |
| A10 | Lock/background the phone; detect stopped frames and apply the defined holding behaviour. | G6 |
| A11 | Resume the admitted phone; recover its slot without displacing another source or auto-cutting on air. | G6 |
| A12 | Stop and revoke the camera; terminate capture/acceptance and prevent reuse of revoked credentials. | G7 |
| A13 | Rotate the phone; preserve the public 16:9 output and the selected framing policy. | G3 |
| A14 | Request an unsupported camera capability; hide/disable it and show actual applied settings. | G1 |
| A15 | Feed only interface input 1; both output ears receive the intended mono programme. | G4 |
| A16 | Feed distinct left/right test signals; verify stereo mode and each single-input mode. | G4 |
| A17 | Unplug the UMC204HD; output silence and alert, with no laptop/phone microphone substitution. | G4/G6 |
| A18 | Reconnect the interface; require/confirm correct selection and recheck routing/calibration. | G4 |
| A19 | Perform repeated clap/flash-beep checks at the defined times; meet sync and drift thresholds. | G4 |
| A20 | Change the camera quality or source; mark the relevant calibration for recheck. | G4 |
| A21 | Pause sound intentionally; warn after threshold but do not auto-increase gain or end the stream. | G4 |
| A22 | Apply a lower third; confirm it appears in captured programme and both platform outputs, not only the DOM. | G3/G5 |
| A23 | Edit text during camera output; nothing changes on programme until Apply. | G3 |
| A24 | Load a missing/corrupt/disallowed asset; retain safe programme output and explain rejection. | G3/G7 |
| A25 | Hold a still slide for ten minutes; maintain valid video/audio output without timeout or clock discontinuity. | G3/G5 |
| A26 | Run full receive/compose/audio/upload workload for three hours; collect resource, frame, and sync evidence. | G3/G4/G8 |
| A27 | Enable the second destination; venue contribution count and media upload remain essentially unchanged. | G5 |
| A28 | Refuse/stall Facebook publishing; YouTube continues without added interruption, and vice versa. | G5/G6 |
| A29 | Supply an invalid destination key; classify the error, bound retries, and keep keys out of logs. | G5/G7 |
| A30 | Start a scheduled platform event; distinguish media arrival from any required public Go Live action. | G5 |
| A31 | Execute Local rehearsal; verify no external publisher is started and no media reaches social destinations. | G7 |
| A32 | Double-click Start and replay its request; create only one contribution generation and publisher per destination. | G6 |
| A33 | Open a second studio tab; read-only unless explicit takeover fences the old publisher. | G6/G7 |
| A34 | Stop during a reconnect loop; stop wins and no worker resumes publication afterwards. | G6 |
| A35 | Kill the normaliser process; report the fault and recover as documented without claiming seamless output. | G6 |
| A36 | Lose the complete programme contribution; emit matched fallback AV, then stop after configured grace. | G6 |
| A37 | Restore contribution during grace; recover timestamp continuity and calibrated audio behaviour. | G4/G6 |
| A38 | Restart the control service while media is healthy; avoid unnecessarily killing the programme. | G6 |
| A39 | Degrade camera link and WAN independently; the appropriate controller reacts without audio mute or oscillation. | G2/G3/G6 |
| A40 | Inspect logs, browser storage, API responses, and reports; no destination keys or bearer secrets are exposed. | G7 |
| A41 | Try a destination pointing to localhost/private/cloud metadata addresses; reject it server-side. | G7 |
| A42 | Attempt a camera-role scene/start command or another session's media path; deny it. | G7 |
| A43 | Trigger an application update during the service; defer activation until the broadcast ends. | G8 |
| A44 | Operate at 1366 x 768 using keyboard and pointer; critical controls remain visible and typing cannot trigger scene shortcuts. | G8 |
| A45 | Review a report containing missing metrics and failed checks; display unknown/failed rather than green defaults. | G7/G8 |
| A46 | Restore the documented backup to a clean authorised server environment and perform a smoke test. | G8 |
| A47 | Run two real church services; record volunteer friction, coverage limits, actual outputs, and owner acceptance. | G8 |
| A48 | Verify Stop sending and platform end state; report any unconfirmed remote shutdown honestly. | G5/G6 |

## Appendix B. Initial configuration defaults

```yaml
product:
  mode: private_single_organisation
  max_concurrent_sessions: 1
  max_camera_sources: 1
  allowed_destinations: [facebook, youtube]

pairing:
  invitation_ttl_seconds: 120
  invitation_entropy_bits: 256
  studio_admission_required: true
  contributor_token_ttl_seconds: 900

camera:
  preferred_facing: environment
  requested_width: 1920
  requested_height: 1080
  requested_fps: 30
  audio_enabled: false
  cloud_relay_default: false

programme:
  default_profile: full_hd_pending_qualification
  contribution_video_ceiling_mbps: 8
  public_video_target_mbps: 6
  public_keyframe_interval_seconds: 2
  internal_audio_rate_hz: 48000
  public_audio_rate_hz: 44100
  public_audio_codec: aac_lc
  public_audio_bitrate_kbps: 128
  output_dimensions_change_midstream: false

user_audio:
  default_mapping: input_1_to_both
  echo_cancellation: false
  automatic_gain_control: false
  noise_suppression: false
  local_monitoring: false
  audio_delay_ms: 0
  calibration_required: true

recovery:
  camera_stall_seconds: 2
  additional_last_frame_hold_seconds: 1
  contribution_stall_seconds: 3
  server_fallback_grace_seconds: 120
  destination_queue_limit_seconds: 2
  automatic_camera_return_to_programme: false
  automatic_microphone_fallback: false

privacy:
  routine_recording_enabled: false
  diagnostic_recording_requires_consent: true
  diagnostic_capture_retention_hours: 24
  service_history_retention_days: 90
```

These are specification defaults, not a ready-to-deploy MediaMTX, FFmpeg, or application configuration. Capability-derived settings must be validated at runtime; pending qualification must not be interpreted as permission to ignore a failed preflight.

## Appendix C. Source notes and external verification

External documentation was reviewed on 20 September 2026. References support the stated platform/API facts, not the custom numerical targets or an assertion that this application has already been tested. Recheck changing browser/platform behaviour against the pinned implementation versions and actual accounts.

**[S01] MDN - MediaDevices.getUserMedia.** Secure-context, permission, capture constraints, and errors.  
`https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia`

**[S02] MDN - HTMLCanvasElement.captureStream.** Canvas-to-media capture and origin-clean restrictions.  
`https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream`

**[S03] MDN - RTCRtpSender.setParameters.** Sender controls and their API limitations.  
`https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters`

**[S04] W3C - Identifiers for WebRTC's Statistics API.** Media counters, jitter-buffer statistics, and timestamp semantics.  
`https://www.w3.org/TR/webrtc-stats/`

**[S05] MDN - AudioContext.baseLatency.** Describes a particular audio-output processing latency, not complete USB input or camera delay.  
`https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency`

**[S06] MDN - MediaStreamTrack.getCapabilities.** Device/browser-dependent constraint support and applied capability handling.  
`https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities`

**[S07] Chrome for Developers - New permission prompt for Local Network Access.** Published rollout guidance; actual request-type support must be verified on the tested browser.  
`https://developer.chrome.com/blog/local-network-access`

**[S08] MDN - Screen Wake Lock API.** Active-document requirements, possible refusal/release, and reacquisition.  
`https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API`

**[S09] MediaMTX - Re-encoding.** FFmpeg/GStreamer integration for changing codecs/formats/compression.  
`https://mediamtx.org/docs/features/remuxing-reencoding-compression`

**[S10] MediaMTX - Publish with WebRTC clients.** WHIP publication and connectivity/codec cautions.  
`https://mediamtx.org/docs/publish/webrtc-clients`

**[S11] MDN - Codecs used by WebRTC.** Required/common WebRTC audio/video codecs and interoperability context.  
`https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/WebRTC_codecs`

**[S12] IETF RFC 9725 - WebRTC-HTTP Ingestion Protocol.** WHIP session and ingest protocol; published March 2025.  
`https://www.rfc-editor.org/rfc/rfc9725.html`

**[S13] YouTube Help - Choose live encoder settings, bitrates, and resolutions.** Retrieved encoder recommendations, including 1080p30 H.264 guidance and RTMPS.  
`https://support.google.com/youtube/answer/2853702?hl=en`

**[S14] YouTube Help - Understand live streaming latency.** Platform latency is a separate part of the viewing path.  
`https://support.google.com/youtube/answer/7444635?hl=en`

**[S15] Meta/Facebook - Live-video requirements help entry.** Full unauthenticated page access was unavailable; account-specific limits remain a required G5 verification, not a verified numerical claim in this document.  
`https://www.facebook.com/business/help/162540111070395`

**[S16] FFmpeg - Formats documentation.** Tee/fifo muxer and output-handling mechanisms.  
`https://ffmpeg.org/ffmpeg-formats.html`

**[S17] MediaMTX - Always-available.** Candidate offline-media/fallback mechanism requiring selected-profile qualification.  
`https://mediamtx.org/docs/features/always-available`

**[S18] MDN - HTMLVideoElement.requestVideoFrameCallback.** Frame-driven work, timing metadata, and lack of strict callback synchronisation guarantees.  
`https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback`

**[S19] YouTube Help - Create a live stream with an encoder.** Encoder setup and immediate/scheduled live workflows.  
`https://support.google.com/youtube/answer/2907883?hl=en`

**[S20] OWASP - Server-Side Request Forgery Prevention Cheat Sheet.** Trust boundaries and validation concerns for server-initiated network requests.  
`https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`

**[S21] MDN - RTCPeerConnection.getStats.** Connection and track statistics retrieval, with result fields dependent on the connection.  
`https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats`

## Appendix D. First engineering assignment

Implement WP0 only before committing to the full product architecture. Use the actual Galaxy A26 and authorised Dell browser, with the UMC204HD and the proposed production network. Build the smallest genuine pairing, local camera, audio routing/delay, programme composition, WHIP ingest, and dual-platform output path.

Return the active-camera demonstration, complete laptop workload measurements, observed audio mapping, manual calibration result, real destination outputs, media-route evidence, and the list of failed/unproven assumptions. Include exact source revision and environment versions. Do not claim completion from mocks, expected calculations, or a green transport indicator alone.

Then record whether the baseline is accepted for WP1-WP6, accepted only at 720p pending a 1080p decision, or blocked by a named compatibility/network/media constraint. Preserve the mobility and no-install requirements in every proposed alternative.
