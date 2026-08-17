#!/usr/bin/env bash
# Run the "Andamento KPI nel periodo" chart UI test suite (Task #414):
# tests/andamento-pezzi-ui.test.mjs.
#
# Test UI Playwright: semina vendite BiSuite (inclusa una a mezzanotte
# italiana), apre /vendite-bisuite con browser in timezone America/New_York
# e verifica parità grafico↔Tabella PDV × Pista (Pezzi), bucketizzazione per
# giorno di calendario italiano, zero-fill, toggle serie e contatori extra
# IVA/CB/Telefoni. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed + cleanup);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[andamento-pezzi-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[andamento-pezzi-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[andamento-pezzi-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[andamento-pezzi-ui-tests] running suite ..."
exec node --import tsx --test tests/andamento-pezzi-ui.test.mjs
