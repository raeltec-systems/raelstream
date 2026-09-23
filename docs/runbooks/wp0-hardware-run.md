# WP0 hardware run (M3): owner procedure

This run checks the M1 spine on the **real** devices and venue network. Automated tests use fake media, so
they cannot qualify the Galaxy A26, the Dell, the UMC204HD or the Wi-Fi (B§26.1). Record everything under
`docs/evidence/wp0/` using the fields in B Appendix A: build, environment, steps, observed result,
evidence, and pass/fail/blocked.

> This run covers G1 (browser and device access), G2 (the direct camera link), G3 (laptop workload) and
> a first G5 check (real Facebook and YouTube **test/private** events).

## 1. Server (once)

1. Create a Vultr **Johannesburg** instance (4 vCPU / 8 GB to start, Ubuntu LTS). Note its public IPv4.
2. Point a DNS A record (e.g. `stream.<your-domain>`) at it. With Cloudflare DNS, use **DNS only (grey cloud)**.
3. Firewall: allow TCP 80 and 443, **UDP 8189** and TCP 8189. SSH only from your IP.
4. Install Docker Engine and the Compose plugin. Clone this repository.
5. `cp infra/compose/.env.example infra/compose/.env` and fill in the values. Set `RS_TOTP_KEY` to the
   output of `openssl rand -base64 32` and keep a copy in your password manager.
6. `mkdir -p infra/compose/secrets && openssl rand -hex 24 > infra/compose/secrets/pg_password`. Then put
   the same password into `DATABASE_URL` in `.env`.
7. Build the bundles: `corepack enable && pnpm install && pnpm build`.
8. Generate the stream-key sealing keys: `node apps/control/dist/cli.js keys:generate`. Put the
   `RS_SEAL_PUBLIC_KEY=` line in `.env` and the secret line in `infra/compose/secrets/seal_secret`
   (`chmod 400`). Keep a copy of the secret in your password manager. It is **not** in backups.
9. `docker compose -f infra/compose/docker-compose.yml up -d --build`
10. Create your owner account. The password is read from the terminal without echoing:

    ```sh
    read -rs PW && printf '%s' "$PW" | docker compose -f infra/compose/docker-compose.yml exec -T control \
      node dist/cli.js user:create-owner --email you@example.org --name "Your name"; unset PW
    ```

    It prints an authenticator key (and an `otpauth://` URI) plus 10 recovery codes. Add the key to
    your authenticator app and store the recovery codes in your password manager. They are not shown
    again. Lost your phone? `node dist/cli.js user:reset-mfa --email ...` issues a new key.
11. Open `https://stream.<your-domain>/studio` and sign in with your email, password and the 6-digit
    code. To add a volunteer, use **Settings → Create invite link** and send the link privately.

## 1b. Test destinations (once per event)

Create a **private or unlisted** YouTube event and a Facebook test/"only me" live, and note each
stream key. Then add them on the server. The key is read from stdin, so it never enters shell history:

```sh
docker compose -f infra/compose/docker-compose.yml exec -T control node dist/cli.js destination:add \
  --platform youtube --label "YouTube test" --server rtmps://a.rtmps.youtube.com/live2 --auto-publish no <<< 'PASTE-KEY'
docker compose -f infra/compose/docker-compose.yml exec -T control node dist/cli.js destination:add \
  --platform facebook --label "Facebook test" --server rtmps://live-api-s.facebook.com:443/rtmp/ --per-event <<< 'PASTE-KEY'
```

(The in-studio key paste for Facebook's per-event keys arrives in M7.)

## 2. Venue

- The production router's Wi-Fi must have client/AP isolation **off**. The Dell is plugged into the same
  router by Ethernet.
- The phone joins the production Wi-Fi.

## 3. Checks to record

| # | Step | Record |
|---|---|---|
| G1-a | Open the studio on the Dell (approved Chrome or Edge). Sign in with your email, password and authenticator code. | Browser version, OS build, any policy prompts. A01: nothing asked you to install anything. |
| G1-b | Devices → Show pairing code. Scan it with the A26 camera app. | That the link opened in Chrome. That the address bar shows no `#t=`. |
| G1-c | Join. Compare the words on both screens. Let the phone in. Start camera. | A02. Try a permission denial once (A06). |
| G2-a | Watch "Connected directly" and the route line. | Whether it connected. Screenshot of the Devices card. **If it never connects, that is the most important finding:** note the router model and isolation setting, and send `chrome://webrtc-internals` dumps from both devices. |
| G2-b | Walk the camera route, including a busy room if possible. | Phone status lines, studio "Receiving" fps/resolution, any freezes (P-03, P-04). |
| G2-c | Unplug the router's internet (WAN) cable while the camera runs. | Whether the camera keeps going (A08). Plug it back in. |
| G1-d | Audio → choose the UMC204HD. | The channel count the browser reports, and any "processing kept on" warning. Play into Input 1 only, then Input 2 only, and note which meters move (A15/A16). |
| G3-a | Open the Studio. Start private test. | "server receiving". Windows Task Manager CPU and memory for the browser at 720p, then 1080p (P-07/P-08). Health panel values. |
| G3-b | Leave it running for 30 minutes. | Any drops, memory growth, and meter behaviour. |
| G5-a | Stop the private test. Choose **Go live…**, check both destinations, and start. | Each row's state. Whether each platform shows the stream (YouTube: click Go Live in Studio if auto-start is off). Picture, sound, and the lower third on the platform. |
| G5-b | Record a phone video of the platform player next to the studio for 30 s during a clap. | Platform delay and a rough lip-sync check at the platform. |
| G6-a | Unplug the laptop's Ethernet for 20 s, then reconnect. | Whether the platforms show "We'll be right back" and then return. The studio countdown. |
| G5-c | **Stop streaming…** then confirm. | That both platforms end, or that you had to end them in each platform's console (A48). |

Also run the lip-sync check: clap on camera next to a mixer-fed microphone. The clip-review tool comes in a
later build, so for now note roughly the delay value that looked right.

## 4. After the run

Tear down or keep the server. If you keep it, the accounts carry over to real use. Share the evidence
folder. It feeds the go/no-go ADR (PLAN M3).
