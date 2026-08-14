#!/usr/bin/env bash
# Run the CdG category drill-down UI test suite (tests/cdg-cat-dettaglio-ui.test.mjs).
#
# Test UI Playwright (Task #359): verifica che il dialog "dettaglio spese di
# una categoria" della dashboard Controllo di Gestione mostri sempre le stesse
# spese dell'aggregato cliccato (legenda torta e riga riepilogo cat × RS), in
# entrambe le viste competenza/cassa e con periodo anno vs mese, con spese
# seminate a mese pagamento ≠ mese competenza. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed via API + cleanup org di test);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[cdg-cat-dettaglio-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[cdg-cat-dettaglio-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[cdg-cat-dettaglio-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[cdg-cat-dettaglio-ui-tests] running suite ..."
exec node --import tsx --test tests/cdg-cat-dettaglio-ui.test.mjs
