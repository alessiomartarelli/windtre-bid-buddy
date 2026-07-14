#!/usr/bin/env bash
# Test authz del modulo Gestione DTS (Task #322): operatore => 403 su
# upload/delete lead, admin => scrittura/cancellazione solo nella propria
# org, GET /api/dts/leads scoped per organizzazione.
#
# Gli scenari hit-tano l'app su http://localhost:5000 e usano il DB dev,
# quindi servono il workflow "Start application" (npm run dev) attivo e
# DATABASE_URL impostata. Lo script aspetta (fino a ~30s) il dev server.

set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[dts-authz-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[dts-authz-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[dts-authz-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[dts-authz-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/dts-authz.test.mjs
