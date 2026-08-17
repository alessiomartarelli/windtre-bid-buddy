#!/usr/bin/env bash
# Run the Aspetto (theme+palette) UI test suite (tests/aspetto-ui.test.mjs).
#
# Test UI Playwright per le preferenze aspetto per-utente (Task #407):
#   - cambio preset palette e colore personalizzato dalla card Aspetto
#     (/profile): CSS var --primary aggiornata subito;
#   - toggle dark/light: classe .dark su <html>;
#   - persistenza server: PATCH /api/auth/ui-prefs -> profiles.ui_prefs;
#   - reload: scelte riapplicate (localStorage + pre-paint script);
#   - "nuovo dispositivo": contesto senza localStorage con lo stesso cookie
#     riceve tema+palette dal server (sync AUTH_PROFILE_EVENT);
#   - race tema+palette ravvicinati: merge jsonb atomico, nessun lost update;
#   - parità statica pre-paint PRESETS (index.html) vs appearance.ts.
# Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (signup/cleanup + verifica ui_prefs nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[aspetto-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[aspetto-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[aspetto-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[aspetto-ui-tests] running suite ..."
exec node --import tsx --test tests/aspetto-ui.test.mjs
