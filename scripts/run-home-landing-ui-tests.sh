#!/usr/bin/env bash
# Run the Home landing UI test suite (tests/home-landing-ui.test.mjs).
#
# Test UI Playwright: blinda l'atterraggio post-login sulla Home hub. Il bug
# originale era il rimbalzo continuo su `/` per le org senza moduli WindTre
# (redirect verso un modulo disabilitato). Ora `/` rende la Home hub per
# admin/operatore e reindirizza SOLO super_admin a `/super-admin`. La suite
# verifica che:
#   - un admin atterri sulla Home (non su un modulo) e veda le scorciatoie ai
#     moduli attivi;
#   - un'org senza moduli WindTre (operatore + brand non-WindTre) veda la Home
#     e il messaggio "Nessun modulo attivo" senza restare bloccata;
#   - un super_admin sia reindirizzato a `/super-admin`.
# Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (signup/cleanup + brand di test nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[home-landing-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[home-landing-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[home-landing-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[home-landing-ui-tests] running suite ..."
exec node --import tsx --test tests/home-landing-ui.test.mjs
