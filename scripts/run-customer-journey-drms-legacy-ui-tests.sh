#!/usr/bin/env bash
# Run the Customer Journey DRMS legacy UI (Playwright) test suite
# (tests/customer-journey-drms-legacy-ui.test.mjs).
#
# Gli scenari hit-tano l'app su http://localhost:5000, quindi lo script
# aspetta (fino a ~30s) che il dev server risponda. Avvialo via il workflow
# "Start application" (npm run dev) prima di lanciare questo script.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[cj-drms-legacy-ui-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[cj-drms-legacy-ui-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[cj-drms-legacy-ui-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[cj-drms-legacy-ui-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/customer-journey-drms-legacy-ui.test.mjs
