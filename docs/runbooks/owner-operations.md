# Owner operations

Everything the owner does outside the studio: the production server, deploys, backups, restores and
the weekly routine. Operators use `sunday-operator.md`.

## 1. Production server (once)

Follow `wp0-hardware-run.md` §1 (Vultr Johannesburg VM, DNS, firewall, Docker, `.env`, secrets, owner
account). Then:

1. Put the repository at `/opt/raelstream` and make it owned by a `deploy` user that is in the `docker`
   group. Deploys run as that user.
2. Install the tools the scripts use: `sudo apt-get install -y age rclone curl` and Node 24 with
   `corepack enable` (the deploy builds the media node bundle).
3. `sudo mkdir -p /etc/raelstream && sudo chown deploy /etc/raelstream` (it records the last good
   deploy).
4. Keep these **off the server's backups and out of the repository**, in your password manager:
   - the supervisor's secret key (`infra/compose/secrets/seal_secret`): without it no saved stream key
     can be used, and destinations must be re-entered;
   - `RS_TOTP_KEY` from `.env`: without it every account needs `cli.js user:reset-mfa`;
   - your **age identity** (below): without it no backup can be restored.

## 2. Deploying an update

Deploys are manual and never happen during a service.

**Once, on GitHub:** Settings → Environments → **New environment** `production` → *Required reviewers*:
you. Add these environment secrets:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the server's address |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | a private key whose public half is in `~deploy/.ssh/authorized_keys` (make a new one just for deploys) |
| `DEPLOY_KNOWN_HOSTS` | the output of `ssh-keyscan <server>` checked against the server's own fingerprint |

**Each update:** Actions → **Deploy** → *Run workflow* → paste the full commit SHA of a green commit on
`main` → approve it. On the server, `infra/scripts/deploy.sh`:

1. refuses if a service is sending or recovering, or if someone has a studio open ("Active service;
   deploy after it ends");
2. checks out the commit, builds, restarts the stack (database migrations run on start);
3. smoke-tests the health endpoint (it must report the new version), the MediaMTX API and the WHIP
   route;
4. on failure, rolls back to the last good commit and fails the workflow.

Studios that were open during the deploy show **Update available → Reload now**; they never reload by
themselves.

## 3. Backups

Nightly, encrypted to your **age** key; the server can write backups but not read them.

1. On your own computer: `age-keygen -o raelstream-backup.key`. Store the file in your password
   manager. It prints a public key (`age1…`).
2. On the server, as `deploy`, `crontab -e`:

   ```text
   15 3 * * * cd /opt/raelstream && RS_BACKUP_AGE_RECIPIENT=age1... infra/scripts/backup.sh >> /var/log/raelstream-backup.log 2>&1
   ```

   Backups go to `/var/backups/raelstream` and are kept 30 days. To also copy them off the server (for
   example to Cloudflare R2), configure an `rclone` remote and add `RS_BACKUP_REMOTE=r2:<bucket>/backups`.
3. What is in a backup: accounts, saved services, destinations (their keys stay sealed), the church look,
   uploaded images, calibrations and reports. **Not** in it: recordings (kept 30 days on the server), the
   supervisor's secret key, `RS_TOTP_KEY`.

## 4. Restoring (A46)

On a clean server set up as in §1 (same `.env` values and the same `seal_secret`):

```sh
docker compose -f infra/compose/docker-compose.yml up -d postgres
infra/scripts/restore.sh /path/to/raelstream-<date>.dump.age ~/raelstream-backup.key
docker compose -f infra/compose/docker-compose.yml up -d
```

Then sign in, open **Settings**, check the destinations and the church look, and run a private test.
CI runs the same backup → restore drill on every change (`infra/scripts/test-backup-restore.sh`); run it
yourself on the server once a quarter.

## 5. Weekly routine

- Before the service: nothing, unless Facebook needs a new key (operators paste it in Preparation).
- After the service: open the report from the home screen. *Failed* or *Not tested* items are the
  things to look at before next week. Download the private recording within 30 days if you want to keep
  it.
- Monthly: check `/var/log/raelstream-backup.log` and that `/var/backups/raelstream` has recent files.

## 6. When something goes wrong

| Symptom | What to do |
|---|---|
| Studio says "Media server status not updated" | `docker compose ps`; restart the `supervisor` service if it is not running. Media restarts; the report shows the reconnects. |
| A platform keeps failing with "rejected key" | Settings → Destinations → Edit → paste a new key (YouTube), or paste this week's key in Preparation (Facebook). |
| Deploy refused with "Active service" | Wait for the service to end, or end a forgotten service from the studio. |
| Deploy rolled back | Read the workflow log; the server is on the previous version and safe to use. |
| Disk filling up | Recordings: `docker volume inspect raelstream_recordings`; they are deleted after 30 days. Backups older than 30 days are deleted by the backup script. |
