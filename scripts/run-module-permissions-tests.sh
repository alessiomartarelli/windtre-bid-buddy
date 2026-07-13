#!/usr/bin/env bash
# Run the per-user module permissions test suites (Task #311):
#   - tests/module-permissions.test.mjs        (puri, nessun prerequisito)
#   - tests/module-permissions-authz.test.mjs  (app su :5000 + DATABASE_URL)
#
# Il file authz hit-ta l'app su http://localhost:5000 e semina/pulisce via
# DATABASE_URL. Avvia il workflow "Start application" (npm run dev) prima.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[module-permissions-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[module-permissions-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[module-permissions-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[module-permissions-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --import tsx --test tests/module-permissions.test.mjs tests/module-permissions-authz.test.mjs
