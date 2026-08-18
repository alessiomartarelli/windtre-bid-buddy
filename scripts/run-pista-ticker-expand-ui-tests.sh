#!/usr/bin/env bash
# Suite UI Playwright per l'espansione delle card Shorts delle piste nella
# Dashboard Gara Reale (sezione PistaTicker, Task #432).
#
# Copre:
#   - click su ticker-pista-{p} apre ticker-detail-{p};
#   - blocco "totale" in gara standard (singola RS);
#   - blocchi per ragione sociale in gara per-RS (tipologiaGara=gara_operatore_rs);
#   - secondo click chiude il pannello;
#   - piste a zero attività escluse dal ticker.
#
# Richiede:
#   - workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (seed e cleanup nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[pista-ticker-expand-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[pista-ticker-expand-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[pista-ticker-expand-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[pista-ticker-expand-ui-tests] running suite ..."
exec node --import tsx --test tests/pista-ticker-expand-ui.test.mjs
