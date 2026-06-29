#!/usr/bin/env bash
# Run the Incentivazione interna sort/filter UI test suite
# (tests/incentivazione-sort-ui.test.mjs).
#
# Test UI Playwright (Task #226): protegge il wiring fra i controlli di
# ordinamento (`select-sort-key`, `button-sort-dir`, `button-reset-filters`) e
# la griglia di schede addetto. Verifica che scelta criterio + toggle direzione
# convivano coi filtri, che "Azzera filtri" ripristini Stato/desc e che, al
# cambio sezione, un criterio-pista non valido ricada su "Stato" senza crash.
# Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (semina/cleanup valenze nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[inc-sort-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[inc-sort-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[inc-sort-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[inc-sort-ui-tests] running suite ..."
exec node --import tsx --test tests/incentivazione-sort-ui.test.mjs
