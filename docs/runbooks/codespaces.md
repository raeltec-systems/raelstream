# Test studio in GitHub Codespaces (free, browser only)

Run the whole raelstream server in a GitHub Codespace, then use it from the Dell and the phone with
nothing installed on either. Use it to try every screen, pair the real phone, route in the real mixer
and go live to **stand-in platforms**, or to private Facebook/YouTube test events. Then tell Claude what
to change.

**What it does not test:** the delay from Zambia to Johannesburg, or whether the church upload holds up
for a real service. The Codespace runs in the US or Europe. For that check, use
`docs/runbooks/gcp-johannesburg.md` once, near the end.

**Cost:** nothing, within GitHub's free Codespaces allowance for personal accounts (at the time of
writing, 120 core-hours a month: about 60 hours on a 2-core machine or 30 hours on a 4-core one) and
Cloudflare's free TURN allowance. Stop the Codespace when you finish (step 8).

## How it fits together

- The phone ↔ laptop camera link is **direct on your Wi-Fi**, exactly as in production.
- A free **Cloudflare quick tunnel** gives the Codespace one public HTTPS address
  (`https://….trycloudflare.com`). The studio, sign-in, pairing and the stand-in platforms' watch
  pages all use it. It changes each time the Codespace restarts; the start banner always shows the
  current one. (If the tunnel cannot start, the script falls back to GitHub's own port forwarding:
  see step 4.)
- GitHub only forwards web traffic, so the studio's programme upload (WebRTC) cannot reach the
  Codespace directly. It goes through **Cloudflare's TURN relay** instead. Production uses the same
  relay as a fallback for networks that block media. The automated test suite checks this
  relay-only path on every change.

## 1. One-time: Cloudflare TURN key (about 5 minutes)

1. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up> (or sign in).
2. In the dashboard, open **Realtime → TURN Server** and create a TURN key. (Cloudflare renames
   menus from time to time; searching the dashboard for "TURN" finds it.)
3. Copy the **Turn Token ID** (key ID) and the **API token**. The API token is shown only once.

## 2. One-time: give the keys to Codespaces

1. On GitHub: your picture → **Settings → Codespaces → Codespaces secrets → New secret**.
2. Add `RS_TURN_CF_KEY_ID` (the key ID). Under **Repository access**, choose
   `raeltec-systems/raelstream`.
3. Add `RS_TURN_CF_API_TOKEN` (the API token), with the same repository access.
4. While you are there, set **Default idle timeout** to **120 minutes**. A Codespace stops after the
   timeout without editor activity, even while you are streaming a test.

Without these secrets everything else still works (sign-in, pairing, camera, audio, scenes), but
**Start private test** and **Go live** cannot connect.

## 3. Start the Codespace

1. Open <https://github.com/raeltec-systems/raelstream>.
2. **Code → Codespaces → … → New with options**. Branch: `main`. (Before the pull request is merged,
   use `claude/charming-noether-bgruhx`.) Machine type: **4-core** if your allowance allows, otherwise
   2-core. Then **Create codespace**.
3. Wait. The first start installs tools and builds everything: about **5–10 minutes**. Later starts
   take about a minute. When it is ready, the terminal shows:

   ```text
   raelstream test studio is running
   Studio (Dell):      https://<three-or-four-words>.trycloudflare.com/studio
   What viewers see:   https://<three-or-four-words>.trycloudflare.com/watch/facebook/test-facebook-key-0001/
   ...
   ```

   If you missed it, run `bash infra/codespace/start.sh` in the terminal to start (or restart) the
   stack and print it again.

   If GitHub says Codespaces is not available for this repository, the organisation has not enabled
   Codespaces for its repositories. Either enable it in the organisation's settings (it bills the
   organisation, still within any free allowance it has) or fork the repository to your personal
   account and create the Codespace from the fork.

## 4. Only if the banner shows a `github.dev` address: make port 8080 public

Normally the address comes from the Cloudflare tunnel and there is nothing to do here. If the tunnel
could not start, the banner shows a `…-8080.app.github.dev` address instead. The phone cannot sign in to
GitHub, so that port must be **public**: open the **PORTS** tab, right-click port **8080 → Port Visibility
→ Public**. (GitHub's forwarding has proved unreliable: if that address says "page can't be found", run
`bash infra/codespace/start.sh` again to retry the tunnel.)

## 5. One-time: create your owner account

In the Codespace terminal:

```sh
bash infra/codespace/create-owner.sh
```

It asks for your email, name and a password (at least 12 characters). Then it shows a QR code to
scan with your authenticator app (Google Authenticator, Microsoft Authenticator or similar), plus 10
recovery codes. Save them in your password manager; they are not shown again.

## 6. Test

On the **Dell**, open the Studio address in Chrome or Edge and sign in. Suggested checklist:

| # | Try | Look for |
|---|---|---|
| 1 | Settings → Create invite link; open it on another device | A volunteer can join and set up an authenticator |
| 2 | Start a service → Devices → Show pairing code; scan it with the **phone** on the church/home Wi-Fi | "Connected directly" and the route line |
| 3 | Audio → choose the UMC | Channel count, and which meters move for Input 1 / Input 2 |
| 4 | Rundown and scenes | Lower thirds, text cards, slate |
| 5 | Studio → **Start private test** | "server receiving" (this is the relay path) |
| 6 | **Go live…** → both stand-ins | ON AIR, both rows "Sending" |
| 7 | Open a "What viewers see" address (on the phone or another tab) | The programme, about 5–10 s behind |
| 8 | **Stop streaming…** | Both rows stop; "This service has ended" |

Write down anything confusing, slow or wrong, with a screenshot if you can, and send it to Claude.

### Going live to your real private test events (optional)

The stand-ins are the safe default. To also send to a private YouTube or Facebook test event, open
**Settings → Destinations** in the studio (owner only):

- **Add YouTube:** choose *Same key every week*, press **Paste** with the stream key from YouTube Live
  Control Room on the clipboard, and set *When video arrives* to what the event does (Auto-start on
  = *Goes public on its own*). **Check connection** confirms the server answers without sending video.
- **Add Facebook:** leave *New key each service*. In each service, paste that week's key under
  **Preparation → Destinations**.

Keys are locked on the server as soon as they are pasted and can only be replaced, never read back.
Remember that this path goes Zambia → Codespace (US/Europe) → platform, so its delay is not what
production will have.

## 7. After Claude pushes changes

In the Codespace terminal:

```sh
git pull && pnpm install && pnpm --filter @raelstream/control --filter @raelstream/supervisor build \
  && bash infra/codespace/start.sh
```

Your account, saved services and destinations are kept. Everything lives in the Codespace until you
delete it.

## 8. When you finish

Stop the Codespace so it doesn't use your allowance: <https://github.com/codespaces> → **…** next to it →
**Stop codespace**. Start it again from the same page next time. **Delete** it only if you want to start
from scratch. That also deletes the accounts and secrets in it.

## Troubleshooting

- **Sign-in says "You don't have permission to do that":** check the address bar. It must be the
  Studio address from the latest banner, not `127.0.0.1:8080` or `localhost:8080` (VS Code desktop opens
  those when you click the port), and not an older tunnel address. The phone's pairing link and the
  studio's upload both use the public address.
- **The address stopped working after a restart:** the tunnel address changes when the Codespace
  restarts. Run `bash infra/codespace/start.sh` to see the new one, then sign in again and re-pair the
  phone.
- **The studio loads but the phone's pairing link does not open:** make sure the phone has internet
  access, and, if the banner shows a `github.dev` address, that port 8080 is public (step 4).
- **Private test / Go live stays on "Starting" and then fails:** the TURN secrets are missing or wrong.
  The banner says `TURN relay: NOT configured`. Fix the secrets (step 2), then **stop and restart** the
  Codespace so it picks them up.
- **The watch page says the codecs are not supported:** open it in Chrome or Edge. Some minimal
  browsers lack H.264/AAC.
- **It stopped in the middle of a test:** the idle timeout (step 2.4) or the monthly allowance ran out.
