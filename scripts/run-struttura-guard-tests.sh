#!/usr/bin/env bash
# Run the struttura guard test suites (Task #338):
#   - tests/struttura-guard.test.mjs  (logica pura di shared/strutturaGuard.ts,
#     caricata via loader tsx: niente server né DB)
#   - tests/org-config-guard.test.mjs (route-level: PUT /api/organization-config
#     deve bloccare/neutralizzare gli azzeramenti di massa dei PDV; richiede il
#     dev server su http://localhost:5000 e il DB di dev)

set -euo pipefail

echo "[struttura-guard-tests] pure suite ..."
node --import tsx --test tests/struttura-guard.test.mjs

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"
echo "[struttura-guard-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[struttura-guard-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[struttura-guard-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[struttura-guard-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

echo "[struttura-guard-tests] route suite ..."
exec node --test tests/org-config-guard.test.mjs
