#!/usr/bin/env bash
# Run the Incentivazione dashboard authorization test suite
# (tests/incentivazione-dashboard-authz.test.mjs).
#
# Verifica l'isolamento per-operatore della route
#   GET /api/incentivazione/dashboard/:month/:year   (server/routes.ts)
# sia sui dati live Accessori/Servizi (`live`) sia sulle righe valenze
# (`valenze[sectionId].rows`): admin/super_admin vedono tutti gli addetti,
# un operatore solo i propri (`profiles.bisuiteAddetti`), un operatore senza
# addetti vede 0 (no leak del tenant). Task #175.
#
# Gli scenari hit-tano l'app su http://localhost:5000, quindi lo script
# aspetta (fino a ~30s) che il dev server risponda. Avvialo via il workflow
# "Start application" (npm run dev) prima di lanciare questo script.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[inc-dashboard-authz-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[inc-dashboard-authz-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[inc-dashboard-authz-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[inc-dashboard-authz-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/incentivazione-dashboard-authz.test.mjs
