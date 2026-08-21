#!/usr/bin/env bash
# Run the "Amministrazione filtri" UI test suites:
#   - tests/amministrazione-pdv-filter-ui.test.mjs (Task #467, filtro multi-PDV)
#   - tests/amministrazione-rs-filter-ui.test.mjs  (Task #468, filtro Ragione Sociale)
#   - tests/amministrazione-search-filter-ui.test.mjs (Task #469, casella Cerca)
#
# Test UI Playwright: semina vendite BiSuite su 3 PDV nel mese corrente,
# apre /amministrazione, seleziona 2 PDV col MultiSelectFilter condiviso
# (testid select-pdv) e verifica che Prima Nota Contabile, Prima Nota IVA
# e i totali riflettano il filtro; poi torna a "Tutti i PDV". Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed + cleanup);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[amministrazione-pdv-filter-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[amministrazione-pdv-filter-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[amministrazione-pdv-filter-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[amministrazione-pdv-filter-ui-tests] running suite ..."
exec node --import tsx --test \
  tests/amministrazione-pdv-filter-ui.test.mjs \
  tests/amministrazione-rs-filter-ui.test.mjs \
  tests/amministrazione-search-filter-ui.test.mjs
