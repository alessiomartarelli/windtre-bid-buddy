#!/usr/bin/env bash
# Run the Simulatore autosave struttura-guard UI test suite
# (tests/simulatore-autosave-struttura-ui.test.mjs).
#
# Test UI Playwright (Task #340): riproduce il percorso esatto dell'incidente
# 13/08/2026 (autosave del Preventivatore con PDV scheletro) e verifica che
# organization_config.puntiVendita non venga mai degradato. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (semina/cleanup dati nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[sim-autosave-struttura-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[sim-autosave-struttura-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[sim-autosave-struttura-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[sim-autosave-struttura-tests] running suite ..."
exec node --import tsx --test tests/simulatore-autosave-struttura-ui.test.mjs
