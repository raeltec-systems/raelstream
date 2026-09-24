#!/usr/bin/env bash
# Restore an encrypted backup into the stack's database (SPEC §15.5, A46).
#   infra/scripts/restore.sh <backup.dump.age> <owner-age-identity-file>
# Run on a clean server after `docker compose up -d postgres`, BEFORE starting control. Afterwards put
# the supervisor's secret key back (it is never in backups) and start the rest of the stack.
set -euo pipefail
cd "$(dirname "$0")/../.."
FILE="${1:?usage: restore.sh <backup.dump.age> <identity-file>}"
IDENTITY="${2:?usage: restore.sh <backup.dump.age> <identity-file>}"
read -r -a PG_EXEC <<<"${RS_PG_EXEC:-docker compose -f infra/compose/docker-compose.yml exec -T postgres}"

age --decrypt -i "$IDENTITY" "$FILE" \
  | "${PG_EXEC[@]}" pg_restore -U raelstream -d raelstream --clean --if-exists --no-owner \
    --single-transaction
echo "restored $FILE"
