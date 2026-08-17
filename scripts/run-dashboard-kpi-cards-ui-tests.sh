#!/usr/bin/env bash
# Run the "4 card KPI di testata Dashboard Gara Reale" UI test suite (Task #423):
# tests/dashboard-kpi-cards-ui.test.mjs.
#
# Verifica le card € Actual, Telefoni, € Accessori e € Servizi con i loro
# valori attuali (dati seminati) e le proiezioni a fine mese basate sui
# giorni lavorativi (letti dalla stessa pagina).
#
# Test UI Playwright: richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed + cleanup via pg);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare il test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[dashboard-kpi-cards-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[dashboard-kpi-cards-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[dashboard-kpi-cards-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[dashboard-kpi-cards-ui-tests] running suite ..."
exec node --import tsx --test tests/dashboard-kpi-cards-ui.test.mjs
