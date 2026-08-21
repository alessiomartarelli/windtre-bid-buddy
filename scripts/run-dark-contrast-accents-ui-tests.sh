#!/usr/bin/env bash
# Task #484 — Suite UI contrasto scuro per ogni accent preset in whitelist
# (tests/dark-contrast-accents-ui.test.mjs).
# Prerequisiti: workflow "Start application" attivo (npm run dev su :5000),
# DATABASE_URL impostata, Chromium di sistema disponibile.
set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "Attendo che l'app risponda su ${BASE}..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/api/auth/me" || curl -sf -o /dev/null "${BASE}/"; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERRORE: l'app non risponde su ${BASE}. Avvia il workflow 'Start application'." >&2
    exit 1
  fi
  sleep 1
done

exec node --import tsx --test tests/dark-contrast-accents-ui.test.mjs
