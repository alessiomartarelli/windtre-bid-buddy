#!/usr/bin/env bash
# Run the PDV brand persistence UI test suite
# (tests/pdv-brand-persistence-ui.test.mjs, Task #521).
#
# Test UI Playwright: protegge il ciclo brand-per-PDV del dialog Struttura in
# Amministrazione (Task #519): creazione PDV con più brand, persistenza dopo
# reload, edit di un campo diverso che NON azzera i brandIds, e la
# normalizzazione (dedup + scarto brand estranei) del PUT generico
# /api/organization-config. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed brand + verifica/cleanup nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[pdv-brand-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[pdv-brand-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[pdv-brand-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[pdv-brand-ui-tests] running suite ..."
exec node --import tsx --test tests/pdv-brand-persistence-ui.test.mjs
