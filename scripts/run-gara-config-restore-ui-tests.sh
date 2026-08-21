#!/usr/bin/env bash
# Run the Configurazione Gara "ripristino revisione" UI test suite
# (tests/gara-config-restore-ui.test.mjs).
#
# Test UI Playwright (Task #480): protegge il flusso Cronologia -> espansione
# revisioni (button-revisions-*) -> Ripristina (button-restore-*) -> conferma
# (button-restore-confirm) e il ricaricamento dello stato mostrato in pagina
# (input-weight-*) dopo il ripristino. Il flusso API/DB è coperto da
# tests/gara-config-restore-db.test.mjs; qui si coprono i selettori del dialog
# e il reload React. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (verifica/cleanup nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[gara-restore-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[gara-restore-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[gara-restore-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[gara-restore-ui-tests] running suite ..."
exec node --import tsx --test tests/gara-config-restore-ui.test.mjs
