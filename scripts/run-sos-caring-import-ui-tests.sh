#!/usr/bin/env bash
# Run the SOS Caring simulator-import regression UI test suite
# (tests/sos-caring-import-ui.test.mjs).
#
# Test UI Playwright (Task #328): verifica che importando una configurazione
# dal simulatore i dati SOS Caring già caricati NON restino attivi
# (`setSosCaring(cfg.sosCaring || null)` in handleImport): upload Excel ->
# save persiste sosCaring; import da organization_config -> card svuotata;
# re-save -> il record NON contiene più sosCaring. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed organization_config + verifica gara_config + cleanup);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[sos-caring-import-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[sos-caring-import-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[sos-caring-import-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[sos-caring-import-ui-tests] running suite ..."
exec node --import tsx --test tests/sos-caring-import-ui.test.mjs
