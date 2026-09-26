#!/usr/bin/env bash
# Deploy one git commit to the production VM (SPEC §16.2). Run on the VM, in the repository:
#   infra/scripts/deploy.sh <git-sha>
# Never during a service: the deploy guard refuses while a service is live or a studio is open.
# On a failed smoke test it rolls back to the last good commit.
set -euo pipefail

SHA="${1:?usage: deploy.sh <git-sha>}"
cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f infra/compose/docker-compose.yml)
STATE_DIR="${RS_STATE_DIR:-/etc/raelstream}"
LAST_GOOD="$STATE_DIR/last-good"
DOMAIN="$(grep -E '^DOMAIN=' infra/compose/.env | cut -d= -f2-)"

log() { printf '\n== %s\n' "$*"; }

guard() {
  if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx control; then
    "${COMPOSE[@]}" exec -T control node dist/cli.js deploy:guard
  else
    echo "control is not running: nothing to protect"
  fi
}

build_and_start() {
  local sha="$1"
  git -c advice.detachedHead=false checkout --quiet --detach "$sha"
  corepack enable >/dev/null 2>&1 || true
  pnpm install --frozen-lockfile --silent
  pnpm --filter @raelstream/supervisor build
  export RS_APP_VERSION="$sha"
  "${COMPOSE[@]}" build --quiet
  "${COMPOSE[@]}" up -d --remove-orphans
}

smoke() {
  local sha="$1" ok=""
  for _ in $(seq 1 60); do
    if curl -fsS "https://$DOMAIN/api/health" | grep -q "\"version\":\"$sha\""; then ok=1; break; fi
    sleep 2
  done
  [ -n "$ok" ] || { echo "health check did not report $sha"; return 1; }
  "${COMPOSE[@]}" exec -T mediamtx wget -qO- http://127.0.0.1:9997/v3/paths/list >/dev/null \
    || { echo "MediaMTX API not answering"; return 1; }
  # WHIP endpoint reachable through Caddy (405/404 is fine: the route exists; 5xx or no answer is not).
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "https://$DOMAIN/whip/")"
  case "$code" in 2*|4*) ;; *) echo "WHIP route answered $code"; return 1 ;; esac
}

log "Deploy guard"
guard

PREVIOUS="$(cat "$LAST_GOOD" 2>/dev/null || git rev-parse HEAD)"
log "Deploying $SHA (previous good: $PREVIOUS)"
git fetch --quiet origin
build_and_start "$SHA"

log "Smoke test"
if smoke "$SHA"; then
  mkdir -p "$STATE_DIR" && echo "$SHA" > "$LAST_GOOD"
  log "Deployed $SHA"
else
  log "Smoke test failed: rolling back to $PREVIOUS"
  build_and_start "$PREVIOUS"
  smoke "$PREVIOUS" || echo "WARNING: the rollback's smoke test failed too; check the server"
  exit 1
fi
