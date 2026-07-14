#!/usr/bin/env bash
# Run the non-WindTre org brand-gating authz suite (Task #315):
#   - tests/non-windtre-authz.test.mjs  (app su :5000 + DATABASE_URL)
#
# Verifica a livello di route HTTP che un'org con solo brand Fastweb
# mantenga Vendite BiSuite / Customer Journey / Incentivazione (200) e
# resti bloccata su Simulatore / Gara / DRMS (403).
# Avvia il workflow "Start application" (npm run dev) prima.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[non-windtre-authz-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[non-windtre-authz-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[non-windtre-authz-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[non-windtre-authz-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --import tsx --test tests/non-windtre-authz.test.mjs
