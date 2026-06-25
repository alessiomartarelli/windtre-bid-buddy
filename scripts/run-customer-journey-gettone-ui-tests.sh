#!/usr/bin/env bash
# Run the Customer Journey gettone-analysis UI test suite
# (tests/customer-journey-gettone-ui.test.mjs).
#
# Test UI Playwright (Task #194): protegge l'espansione/chiusura del dettaglio
# dell'Analisi gettoni e l'isolamento per operatore di quella vista. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (semina/cleanup dati nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[cj-gettone-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[cj-gettone-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[cj-gettone-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[cj-gettone-ui-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-gettone-ui.test.mjs
