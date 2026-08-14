#!/usr/bin/env bash
# Test UI mobile (viewport 375×812) per le pagine gara: Dashboard Gara,
# Configurazione, Tabelle Calcolo, Mappatura BiSuite, DRMS.
# Richiede app attiva su localhost:5000, DATABASE_URL e chromium di sistema.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[mobile-gara-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[mobile-gara-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[mobile-gara-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

exec node --import tsx --test tests/mobile-gara-ui.test.mjs
