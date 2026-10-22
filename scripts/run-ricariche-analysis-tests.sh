#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then break; fi
  if [ "$i" = "30" ]; then
    echo "Applicazione non raggiungibile su $BASE_URL; avviare il workflow Start application." >&2
    exit 1
  fi
  sleep 1
done

exec node --import tsx --test tests/ricariche-analysis.test.mjs tests/ricariche-analysis-authz.test.mjs
