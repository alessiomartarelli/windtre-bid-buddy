#!/usr/bin/env bash
# Run the Vendite BiSuite "Tabella PDV × Pista (Pezzi)" export UI test suite
# (Task #391): tests/pdv-pezzi-vendite-export-ui.test.mjs.
#
# Test UI Playwright: semina vendite BiSuite di oggi (incluse due varianti
# della stessa Ragione Sociale che normalizeRsName deve unificare), apre
# /vendite-bisuite e clicca i pulsanti Excel/CSV/PDF della card
# "Tabella PDV × Pista (Pezzi)": i file Excel e CSV vengono aperti con
# SheetJS e confrontati riga per riga (header, righe RS/PDV, riga TOTALE);
# per il PDF si verifica download + file non vuoto (%PDF). Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed + cleanup org di test);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.
#
# NOTA (Task #393): questa suite gira anche automaticamente nel workflow
# "pdv-pezzi-table-ui-tests" (scripts/run-pdv-pezzi-table-ui-tests.sh),
# accorpata alla suite tabella per rispettare il limite di workflow.
# Questo script resta per il lancio manuale della sola suite export.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[pdv-pezzi-vendite-export-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[pdv-pezzi-vendite-export-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[pdv-pezzi-vendite-export-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[pdv-pezzi-vendite-export-ui-tests] running suite ..."
exec node --import tsx --test tests/pdv-pezzi-vendite-export-ui.test.mjs
