#!/usr/bin/env bash
# Run the CdG pivot-export UI test suite (tests/cdg-pivot-export-ui.test.mjs).
#
# Test UI Playwright (Task #358): verifica che il pulsante Excel della card
# "Pivot voci di costo" (Amministrazione → Controllo di Gestione) scarichi
# davvero un file .xlsx coerente con i filtri a schermo: default RS × Anno
# (foglio Totale con riga Totale + un foglio per RS) e toggle Punto Vendita
# + periodo Mese (importi limitati al mese, header "Punto Vendita", nome
# file pivot-costi-<mese>-<anno>-<vista>.xlsx). Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed via API + cleanup org di test);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[cdg-pivot-export-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[cdg-pivot-export-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[cdg-pivot-export-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[cdg-pivot-export-ui-tests] running suite ..."
exec node --import tsx --test tests/cdg-pivot-export-ui.test.mjs
