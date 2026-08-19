#!/usr/bin/env bash
# API + Playwright UI regression suite for self-service profile avatars.
set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[profile-avatar-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[profile-avatar-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[profile-avatar-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

exec node --import tsx --test tests/profile-avatar-ui.test.mjs