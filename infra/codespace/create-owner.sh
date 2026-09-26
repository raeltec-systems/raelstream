#!/usr/bin/env bash
# Creates the owner account in the Codespace stack and shows the authenticator setup.
set -euo pipefail
cd "$(dirname "$0")/../.."
compose() {
  docker compose -f infra/compose/docker-compose.yml -f infra/codespace/compose.yml \
    ${RS_COMPOSE_EXTRA:+-f "$RS_COMPOSE_EXTRA"} "$@"
}

read -rp "Your email: " EMAIL
read -rp "Your name (shown to volunteers): " NAME
read -rsp "Choose a password (at least 12 characters): " PW; echo
read -rsp "Type it again: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "The two passwords are different."; exit 1; }

OUT=$(printf '%s' "$PW" | compose exec -T control node dist/cli.js user:create-owner --email "$EMAIL" --name "$NAME")
unset PW PW2
echo "$OUT"
URI=$(echo "$OUT" | sed -n 's/.*otpauth URI: //p')
if [ -n "$URI" ] && command -v qrencode >/dev/null; then
  echo
  echo "Scan this with your authenticator app:"
  qrencode -t ANSIUTF8 "$URI"
fi
echo "Then sign in at the Studio address shown when the Codespace started."
