#!/usr/bin/env bash
# Run the dark-mode print/PDF readability UI test suite
# (tests/dark-mode-print-ui.test.mjs, Task #417).
#
# Verifica che le regole @media print in client/src/index.css cancellino
# aurora e gradienti vetro del tema scuro, rendendo body/shell/card opachi
# e leggibili in export stampa/PDF anche quando l'utente è in dark mode.
#
# Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (signup/cleanup nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[dark-mode-print-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[dark-mode-print-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[dark-mode-print-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[dark-mode-print-ui-tests] running suite ..."
exec node --import tsx --test tests/dark-mode-print-ui.test.mjs
