#!/usr/bin/env bash
# Run the Prima Nota IVA "Bilancio IVA" UI test suite (tests/bilancio-iva-ui.test.mjs).
#
# Test UI Playwright (Task #364): verifica la card Bilancio IVA (debito da
# vendite BiSuite vs credito da spese CdG, per Ragione Sociale con saldo e
# totale, join per nome normalizzato, spese fuori periodo escluse). Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed via SQL/API + cleanup org di test);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[bilancio-iva-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[bilancio-iva-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[bilancio-iva-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[bilancio-iva-ui-tests] running suite ..."
exec node --import tsx --test tests/bilancio-iva-ui.test.mjs
