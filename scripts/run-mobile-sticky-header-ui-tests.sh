#!/usr/bin/env bash
# Run the mobile sticky-header UI test suite
# (tests/mobile-sticky-header-ui.test.mjs).
#
# Test UI Playwright (Task #375): verifica che su smartphone l'header della
# "Tabella Dettaglio PDV" (Dashboard) e della timeline Customer Journey resti
# visibile durante lo scroll verticale e che le frecce di ScrollableTable
# funzionino davvero. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (semina/cleanup dati nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[mobile-sticky-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[mobile-sticky-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[mobile-sticky-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[mobile-sticky-ui-tests] running suite ..."
exec node --import tsx --test --test-concurrency=1 \
  tests/mobile-sticky-header-ui.test.mjs \
  tests/canvass-mobile-align-ui.test.mjs \
  tests/canvass-detail-mobile-align-ui.test.mjs
