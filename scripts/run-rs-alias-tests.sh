#!/usr/bin/env bash
# Run the Ragione Sociale alias test suite (tests/rs-alias.test.mjs).
#
# Test DB-backed (Task #367): verifica l'unificazione delle varianti RS —
# normalizzazione automatica (punti/spazi/case) + alias espliciti sul
# registro cdg_ragioni_sociali — applicata SOLO in lettura su
# GET /api/bisuite-sales e sulle spese CdG, con anti-collisione alias e
# endpoint alias-impact. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed via SQL/API + cleanup org di test).
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[rs-alias-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[rs-alias-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[rs-alias-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[rs-alias-tests] running suite ..."
exec node --import tsx --test tests/rs-alias.test.mjs
