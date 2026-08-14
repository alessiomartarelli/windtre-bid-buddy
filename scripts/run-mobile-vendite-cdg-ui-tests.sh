#!/usr/bin/env bash
# Run the mobile Vendite BiSuite / CdG UI test suite
# (tests/mobile-vendite-cdg-ui.test.mjs).
#
# Test UI Playwright a 375×812 (touch) per il task #376: verifica che
# Vendite BiSuite (lista vendite + dettaglio addetto in ScrollableTable con
# header sticky), Controllo di Gestione, Gestione DTS e Configurazione Gara
# non abbiano overflow orizzontale su smartphone.
# Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (signup/cleanup + seed bisuite_sales nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[mobile-vendite-cdg-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[mobile-vendite-cdg-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[mobile-vendite-cdg-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[mobile-vendite-cdg-ui-tests] running suite ..."
exec node --import tsx --test tests/mobile-vendite-cdg-ui.test.mjs
