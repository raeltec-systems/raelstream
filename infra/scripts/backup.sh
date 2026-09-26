#!/usr/bin/env bash
# Nightly encrypted database backup (SPEC §15.5). The database holds everything that matters:
# accounts, services, destinations (keys stay sealed; the supervisor's secret key is NOT backed up),
# uploaded images and reports. Recordings are not backed up (they expire after 30 days).
#
#   RS_BACKUP_AGE_RECIPIENT=age1...   the owner's age public key (required)
#   RS_BACKUP_DIR=/var/backups/raelstream
#   RS_BACKUP_REMOTE=r2:bucket/backups    optional rclone destination
#   RS_PG_EXEC="docker compose -f infra/compose/docker-compose.yml exec -T postgres"
#
# Cron (as the deploy user):  15 3 * * *  cd /opt/raelstream && infra/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${RS_BACKUP_AGE_RECIPIENT:?set RS_BACKUP_AGE_RECIPIENT to the owner age public key}"
DIR="${RS_BACKUP_DIR:-/var/backups/raelstream}"
read -r -a PG_EXEC <<<"${RS_PG_EXEC:-docker compose -f infra/compose/docker-compose.yml exec -T postgres}"
mkdir -p "$DIR"
chmod 700 "$DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DIR/raelstream-$ts.dump.age"
"${PG_EXEC[@]}" pg_dump -U raelstream -d raelstream --format=custom \
  | age --encrypt -r "$RS_BACKUP_AGE_RECIPIENT" >"$out.part"
mv "$out.part" "$out"
echo "backup written: $out ($(du -h "$out" | cut -f1))"

if [ -n "${RS_BACKUP_REMOTE:-}" ]; then
  rclone copy --quiet "$out" "$RS_BACKUP_REMOTE"
  echo "copied to $RS_BACKUP_REMOTE"
fi

find "$DIR" -name 'raelstream-*.dump.age' -mtime +30 -delete
