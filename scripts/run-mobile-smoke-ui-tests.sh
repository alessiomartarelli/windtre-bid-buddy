#!/usr/bin/env bash
# Run the mobile smoke UI test suite (tests/mobile-smoke-ui.test.mjs).
#
# Test UI Playwright su viewport mobile (375×812 + touch): blinda le
# fondamenta della versione mobile — Home senza overflow orizzontale,
# menu hamburger con touch target adeguati e navigazione a un modulo.
# Richiede:
#   - il workflow "Start application" attivo (app su localhost:5000);
#   - DATABASE_URL (signup/cleanup nel dev DB);
#   - chromium di sistema (Nix) trovato via `which chromium`.
# Attende fino a 30s che l'app risponda prima di lanciare i test.

set -euo pipefail

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[mobile-smoke-ui-tests] waiting for app at ${BASE} ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" 2>/dev/null || curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    echo "[mobile-smoke-ui-tests] app is reachable"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[mobile-smoke-ui-tests] ERROR: app not reachable at ${BASE} after 30s" >&2
    exit 1
  fi
  sleep 1
done

echo "[mobile-smoke-ui-tests] running suite ..."
exec node --import tsx --test tests/mobile-smoke-ui.test.mjs
