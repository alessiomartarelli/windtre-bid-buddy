#!/usr/bin/env bash
# Run the "Tabella PDV × Pista — vista Pezzi" UI test suite (Task #384):
# tests/pdv-pezzi-table-ui.test.mjs.
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

echo "[pdv-pezzi-table-ui-tests] running suite ..."
exec node --import tsx --test tests/pdv-pezzi-table-ui.test.mjs
