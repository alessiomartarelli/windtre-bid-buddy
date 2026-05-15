#!/usr/bin/env bash
# Run the FinPlan sync test suite (tests/finplan-sync.test.mjs).
#
# Gli scenari residui (post Task #148, niente più iframe HTML) hit-tano
# l'app su http://localhost:5000, quindi lo script aspetta (fino a ~30s)
# che il dev server risponda. Avvialo via il workflow "Start application"
# (npm run dev) prima di lanciare questo script.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[finplan-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  # Probe di readiness sull'endpoint /api/auth/user: in questa app esiste
  # sempre (Replit Auth, risponde 401 se non autenticato). Lo script
  # accetta qualsiasi codice HTTP != 000 come "server pronto", quindi
  # funziona anche se in futuro l'endpoint cambia comportamento o se
  # l'auth è configurata diversamente.
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[finplan-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[finplan-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[finplan-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/finplan-sync.test.mjs
