#!/usr/bin/env bash
# Run the Customer Journey T0-on-SIM UI test suite
# (tests/customer-journey-t0-sim-ui.test.mjs).
#
# Test UI Playwright (Task #566): verifica nel browser che il badge T0 della
# scheda cliente stia sulla SIM di una vendita trigger multi-articolo. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (semina/cleanup dati nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[cj-t0-sim-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[cj-t0-sim-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[cj-t0-sim-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[cj-t0-sim-ui-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-t0-sim-ui.test.mjs
