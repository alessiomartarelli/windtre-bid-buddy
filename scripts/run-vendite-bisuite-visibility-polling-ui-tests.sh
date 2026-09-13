#!/usr/bin/env bash
# Verifica UI del polling automatico nella vista Oggi di Vendite BiSuite:
# stop a pagina nascosta, ripresa nel rispetto dell'intervallo e nessun polling
# sugli intervalli storici. Richiede dev server su :5000 e DATABASE_URL.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[vendite-bisuite-visibility-polling-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[vendite-bisuite-visibility-polling-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[vendite-bisuite-visibility-polling-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[vendite-bisuite-visibility-polling-ui-tests] running suite ..."
exec node --import tsx --test tests/vendite-bisuite-visibility-polling-ui.test.mjs