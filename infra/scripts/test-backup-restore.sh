#!/usr/bin/env bash
# Backup → restore drill (A46), run in CI and on demand: two throwaway PostgreSQL 18 containers, the
# real migrations, real rows (a user, a preset, an uploaded image, a sealed destination key), then
# backup.sh → restore.sh into the empty one and a table-by-table comparison.
set -euo pipefail
cd "$(dirname "$0")/../.."
work="$(mktemp -d)"
cleanup() { docker rm -f rs-bk-a rs-bk-b >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

for n in a b; do
  docker rm -f "rs-bk-$n" >/dev/null 2>&1 || true
  docker run -d --name "rs-bk-$n" -e POSTGRES_USER=raelstream -e POSTGRES_PASSWORD=dev \
    -e POSTGRES_DB=raelstream postgres:18 >/dev/null
done
for n in a b; do
  for _ in $(seq 1 60); do docker exec "rs-bk-$n" pg_isready -U raelstream -q && break; sleep 1; done
done
ip_a="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' rs-bk-a)"

echo "== migrate and seed the source database"
DATABASE_URL="postgres://raelstream:dev@$ip_a:5432/raelstream" PUBLIC_ORIGIN=https://drill.test \
  WHIP_PUBLIC_BASE=https://drill.test/whip NODE_ENV=test MIGRATIONS_DIR="$PWD/infra/migrations" \
  pnpm --silent --filter @raelstream/control exec tsx src/migrate-cli.ts
docker exec -i rs-bk-a psql -q -v ON_ERROR_STOP=1 -U raelstream -d raelstream <<'SQL'
insert into users (email, display_name, role, password_hash) values ('owner@drill.test', 'Owner', 'owner', 'x');
insert into presets (name, rundown) values ('Sunday Service', '[{"type":"text","title":"Welcome"}]');
insert into assets (sha256, mime, width, height, bytes, data)
  values (decode(repeat('ab', 32), 'hex'), 'image/png', 1, 1, 4, decode('89504e47', 'hex'));
insert into destinations (platform, label, server_url, key_mode, key_enc, key_last4)
  values ('youtube', 'YouTube', 'rtmps://a.rtmps.youtube.com/live2', 'persistent', decode('00ff00ff', 'hex'), '9876');
SQL

echo "== back up (encrypted to a throwaway owner key)"
age-keygen -o "$work/owner.key" 2>/dev/null
recipient="$(grep -o 'age1[0-9a-z]*' "$work/owner.key")"
RS_BACKUP_AGE_RECIPIENT="$recipient" RS_BACKUP_DIR="$work/backups" RS_PG_EXEC="docker exec -i rs-bk-a" \
  infra/scripts/backup.sh
file="$(ls "$work"/backups/raelstream-*.dump.age)"
head -c 21 "$file" | grep -q 'age-encryption.org/v1' || { echo "backup is not age-encrypted"; exit 1; }
if grep -aq 'owner@drill.test' "$file"; then echo "plaintext found in the backup"; exit 1; fi

echo "== restore into the empty database"
RS_PG_EXEC="docker exec -i rs-bk-b" infra/scripts/restore.sh "$file" "$work/owner.key"

echo "== compare"
q="select concat_ws('|',
  (select count(*) from users), (select count(*) from presets),
  (select string_agg(md5(data), ',') from assets), (select count(*) from destinations),
  (select string_agg(encode(key_enc, 'hex'), ',') from destinations),
  (select count(*) from schema_migrations))"
a="$(docker exec rs-bk-a psql -tA -U raelstream -d raelstream -c "$q")"
b="$(docker exec rs-bk-b psql -tA -U raelstream -d raelstream -c "$q")"
echo "source:   $a"
echo "restored: $b"
[ "$a" = "$b" ] || { echo "restore differs from the source"; exit 1; }
echo "backup/restore drill passed"
