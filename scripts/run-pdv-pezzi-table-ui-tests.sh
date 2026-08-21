#!/usr/bin/env bash
# Run the "Tabella PDV × Pista" UI test suites (Task #384 vista Pezzi,
# Task #387 export Pezzi, Task #388 export Punti, Task #391 export Vendite
# BiSuite, Task #423 card KPI di testata Dashboard, Task #474 contenuto
# PDF "Riepilogo Premi per RS"):
# tests/pdv-pezzi-extra.test.mjs + tests/pdv-pezzi-table-ui.test.mjs +
# tests/pdv-pezzi-vendite-export-ui.test.mjs +
# tests/dashboard-kpi-cards-ui.test.mjs + tests/premio-rs-pdf-ui.test.mjs
# (accorpati in un unico workflow per rispettare il limite di workflow —
# Task #393, Task #423).
#
# Test UI Playwright: semina gara_config + vendite BiSuite per il mese
# corrente, apre /dashboard-gara-reale, attiva il toggle Pezzi e verifica
# pezzi per PDV/RS per pista (Energia CF+P.IVA aggregati), colonna Totale
# per riga e riga di totale complessivo. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed + cleanup);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[pdv-pezzi-table-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[pdv-pezzi-table-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[pdv-pezzi-table-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[pdv-pezzi-table-ui-tests] running suites ..."
exec node --import tsx --test \
  tests/pdv-pezzi-extra.test.mjs \
  tests/pdv-pezzi-table-ui.test.mjs \
  tests/pdv-pezzi-vendite-export-ui.test.mjs \
  tests/dashboard-kpi-cards-ui.test.mjs \
  tests/premio-rs-pdf-ui.test.mjs
