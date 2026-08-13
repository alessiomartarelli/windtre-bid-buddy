#!/usr/bin/env bash
# Run the CdG recurring-expense dialog regression suite
# (tests/cdg-spese-ricorrenti.test.mjs).
# Richiede il dev server su http://localhost:5000 e il DB di dev.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[cdg-spese-ricorrenti-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[cdg-spese-ricorrenti-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[cdg-spese-ricorrenti-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/cdg-spese-ricorrenti.test.mjs
