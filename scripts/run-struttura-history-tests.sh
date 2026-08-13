#!/usr/bin/env bash
# Run the struttura history test suite (Task #339):
#   - tests/struttura-history.test.mjs (route + DB: archivio automatico delle
#     versioni di puntiVendita/ragioniSociali in organization_config_history,
#     retention 20, endpoint /api/admin/struttura/history list/get/restore).
# Richiede il dev server su http://localhost:5000 e il DB di dev.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"
echo "[struttura-history-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[struttura-history-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[struttura-history-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[struttura-history-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/struttura-history.test.mjs
