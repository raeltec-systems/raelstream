# WP0 hardware run (M3): owner procedure

This run checks the M1 spine on the **real** devices and venue network. Automated tests use fake media, so
they cannot qualify the Galaxy A26, the Dell, the UMC204HD or the Wi-Fi (B§26.1). Record everything under
`docs/evidence/wp0/` using the fields in B Appendix A: build, environment, steps, observed result,
evidence, and pass/fail/blocked.

> Facebook and YouTube publishing is **not** part of M1. This run covers G1 (browser and device access),
> G2 (the direct camera link) and the laptop side of G3. Platform output (G5) comes after M2.

## 1. Server (once)

1. Create a Vultr **Johannesburg** instance (4 vCPU / 8 GB to start, Ubuntu LTS). Note its public IPv4.
2. Point a DNS A record (e.g. `stream.<your-domain>`) at it. With Cloudflare DNS, use **DNS only (grey cloud)**.
3. Firewall: allow TCP 80 and 443, **UDP 8189** and TCP 8189. SSH only from your IP.
4. Install Docker Engine and the Compose plugin. Clone this repository.
5. `cp infra/compose/.env.example infra/compose/.env` and fill in the values. For this run only, set:
   `NODE_ENV=wp0`, `RS_DEV_AUTH=1`, `RS_DEV_PASSPHRASE=<long random phrase>`.
6. `mkdir -p infra/compose/secrets && openssl rand -hex 24 > infra/compose/secrets/pg_password`. Then put
   the same password into `DATABASE_URL` in `.env`.
7. `docker compose -f infra/compose/docker-compose.yml up -d --build`
8. Open `https://stream.<your-domain>/studio`. You should see the sign-in page.

## 2. Venue

- The production router's Wi-Fi must have client/AP isolation **off**. The Dell is plugged into the same
  router by Ethernet.
- The phone joins the production Wi-Fi.

## 3. Checks to record

| # | Step | Record |
|---|---|---|
| G1-a | Open the studio on the Dell (approved Chrome or Edge). Sign in with the passphrase. | Browser version, OS build, any policy prompts. A01: nothing asked you to install anything. |
| G1-b | Devices → Show pairing code. Scan it with the A26 camera app. | That the link opened in Chrome. That the address bar shows no `#t=`. |
| G1-c | Join. Compare the words on both screens. Let the phone in. Start camera. | A02. Try a permission denial once (A06). |
| G2-a | Watch "Connected directly" and the route line. | Whether it connected. Screenshot of the Devices card. **If it never connects, that is the most important finding:** note the router model and isolation setting, and send `chrome://webrtc-internals` dumps from both devices. |
| G2-b | Walk the camera route, including a busy room if possible. | Phone status lines, studio "Receiving" fps/resolution, any freezes (P-03, P-04). |
| G2-c | Unplug the router's internet (WAN) cable while the camera runs. | Whether the camera keeps going (A08). Plug it back in. |
| G1-d | Audio → choose the UMC204HD. | The channel count the browser reports, and any "processing kept on" warning. Play into Input 1 only, then Input 2 only, and note which meters move (A15/A16). |
| G3-a | Open the Studio. Start private test. | "server receiving". Windows Task Manager CPU and memory for the browser at 720p, then 1080p (P-07/P-08). Health panel values. |
| G3-b | Leave it running for 30 minutes. | Any drops, memory growth, and meter behaviour. |

Also run the lip-sync check: clap on camera next to a mixer-fed microphone. The clip-review tool comes in a
later build, so for now note roughly the delay value that looked right.

## 4. After the run

Tear down or keep the server, but **remove `RS_DEV_AUTH` and `RS_DEV_PASSPHRASE` from `.env`** before
using it for anything else. Share the evidence folder. It feeds the go/no-go ADR (PLAN M3).
