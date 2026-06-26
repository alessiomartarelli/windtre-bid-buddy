#!/usr/bin/env bash
# Run the admin role/org boundary test suite (tests/admin-authz.test.mjs).
#
# Gli scenari hit-tano l'app su http://localhost:5000, quindi lo script
# aspetta (fino a ~30s) che il dev server risponda. Avvialo via il workflow
# "Start application" (npm run dev) prima di lanciare questo script.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[admin-authz-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[admin-authz-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[admin-authz-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[admin-authz-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/admin-authz.test.mjs
