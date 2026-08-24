#!/usr/bin/env bash
# Run the "soglie gara rimovibili" UI test suite
# (tests/gara-config-soglie-rimovibili-ui.test.mjs).
#
# Protegge il flusso di rimozione/ripristino di un blocco pista per RS e dei
# singoli livelli in Configurazione Gara (button-rimuovi-*-rs-*, dialog di
# conferma button-rimozione-blocco-*, banner-*-rs-rimossa-*,
# button-ripristina-*-rs-*, toggle button-energia-rs-livello-*), la
# persistenza dei flag rimosso/livelliRimossi nel JSONB e il fatto che gli
# initializer non ricreino i blocchi rimossi dopo un reload. Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (verifica/cleanup nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[gara-soglie-rimovibili-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[gara-soglie-rimovibili-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[gara-soglie-rimovibili-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[gara-soglie-rimovibili-ui-tests] running suite ..."
exec node --import tsx --test tests/gara-config-soglie-rimovibili-ui.test.mjs
