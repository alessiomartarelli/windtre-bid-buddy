#!/usr/bin/env bash
# Run the Configurazione Gara "Pesi punteggio performance" UI test suite
# (tests/gara-config-weights-ui.test.mjs).
#
# Test UI Playwright: protegge il wiring fra gli input `input-weight-*` della
# card `card-performance-weights`, il salvataggio in
# `gara_config.config.performanceWeights` e il ricaricamento (reload pagina +
# cambio mese). Verifica che i valori digitati persistano, che i campi vuoti
# ricadano sui default (payload null), e che cambiando mese i pesi si azzerino
# e tornino ricaricati al mese salvato. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (verifica/cleanup della config nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[gara-weights-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[gara-weights-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[gara-weights-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[gara-weights-ui-tests] running suite ..."
exec node --import tsx --test tests/gara-config-weights-ui.test.mjs
