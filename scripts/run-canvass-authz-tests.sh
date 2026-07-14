#!/usr/bin/env bash
# Run the Canvass Vodafone/Fastweb authz test suite
# (tests/canvass-authz.test.mjs).
#
# Verifica i confini di ruolo/org sulle route canvass (Task #302):
#   - operatore => 403 su catalog, mapped-sales, import, reset;
#   - admin => solo la propria org su mapped-sales, niente import/reset;
#   - import di un reference senza offerte => 400 (Task #305 lato server).
#
# Prerequisiti: app attiva su localhost:5000 (workflow "Start application")
# e DATABASE_URL (i test creano/puliscono org di test via SQL). Lo script
# aspetta (fino a ~30s) che il dev server risponda.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[canvass-authz-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[canvass-authz-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[canvass-authz-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[canvass-authz-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/canvass-authz.test.mjs
