#!/usr/bin/env bash
# Run the PDV brand endpoints API test suite
# (tests/pdv-brand-endpoints-api.test.mjs, Task #522).
#
# Test API senza browser: POST/PUT/bulk /api/admin/struttura/pdv devono
# rifiutare (400) brandIds non associati all'org senza salvare nulla, e
# deduplicare i brandIds validi. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed brand + verifica/cleanup nel dev DB).
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[pdv-brand-api-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[pdv-brand-api-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[pdv-brand-api-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[pdv-brand-api-tests] running suite ..."
exec node --import tsx --test tests/pdv-brand-endpoints-api.test.mjs
