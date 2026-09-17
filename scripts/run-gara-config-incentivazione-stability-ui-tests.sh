#!/usr/bin/env bash
# Regressione UI del tab Incentivazione in Configurazione Gara:
# resta montato e visibile, non rilancia gara-config e carica una sola volta
# /api/incentivazione/configs.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[gara-incentivazione-stability-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[gara-incentivazione-stability-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[gara-incentivazione-stability-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[gara-incentivazione-stability-ui-tests] running suite ..."
exec node --import tsx --test tests/gara-config-incentivazione-stability-ui.test.mjs