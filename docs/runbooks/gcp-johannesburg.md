# One-off check from Johannesburg on Google Cloud's free trial

Use this **once, near the end**, after the Codespace testing (`docs/runbooks/codespaces.md`). It
answers the questions a Codespace cannot:

- Can the church upload hold a steady stream to Johannesburg for a whole service?
- What delay do viewers see?
- Is the media node's processor keeping up?

Everything is done in the browser: the Google Cloud console and its **SSH-in-browser** window. Nothing
is installed on the Dell.

**Cost:** Google Cloud's free trial gives new accounts credit for a limited period (at the time of writing,
US$300 for 90 days). Google says it does not charge you unless you choose to upgrade to a paid
account. Check the current terms on the sign-up page. A test machine for a few hours uses a small
part of the credit. **Delete it afterwards** (step 6).

## 1. Sign up

<https://cloud.google.com/free> → **Get started for free**. Google asks for a card to verify you.
Create a project called `raelstream-test`.

## 2. Open the firewall

Console → **VPC network → Firewall → Create firewall rule**:

- Name `raelstream`, Targets **Specified target tags**, tag `raelstream`, Source ranges `0.0.0.0/0`.
- Protocols and ports: **TCP** `80,443,8189` and **UDP** `8189`.

## 3. Create the machine

Console → **Compute Engine → VM instances → Create instance**:

- Region **africa-south1 (Johannesburg)**, any zone.
- Machine type **e2-standard-4** (4 vCPU, 16 GB).
- Boot disk **Ubuntu 24.04 LTS**, 30 GB.
- Networking → Network tags: `raelstream`.

Create it and note its **External IP**, for example `34.35.36.37`.

## 4. Install and start (SSH-in-browser)

Click **SSH** next to the instance. In the window that opens:

```sh
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER" && newgrp docker
sudo apt-get install -y -qq git && git clone https://github.com/raeltec-systems/raelstream.git && cd raelstream
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt-get install -y -qq nodejs && sudo corepack enable
```

Then follow `docs/runbooks/wp0-hardware-run.md` §1 from **step 5**, with these values in `.env`:

- `DOMAIN=34-35-36-37.sslip.io`. The free sslip.io service maps that name to your IP, so no domain
  purchase is needed, and Caddy gets a real HTTPS certificate for it.
- `PUBLIC_ORIGIN=https://34-35-36-37.sslip.io`, `WHIP_PUBLIC_BASE=https://34-35-36-37.sslip.io/whip`.
- `PUBLIC_IP=34.35.36.37`.

(Replace the example IP with yours, dots in `PUBLIC_IP`, dashes in the name.)

## 5. Run the check

On the Dell, open `https://34-35-36-37.sslip.io/studio` and run the hardware-run checklist in
`docs/runbooks/wp0-hardware-run.md` §3. The **G3** (30-minute private test) and **G5** (going live to
private test events) rows matter most here. They are what this machine exists to measure. Record
the numbers in `docs/evidence/wp0/`.

## 6. Delete everything

Console → **Compute Engine → VM instances** → select it → **Delete**. A stopped machine still costs a
little for its disk, so delete it rather than stop it. If you are done with the trial, also delete the
project: **IAM & Admin → Settings → Shut down**.
