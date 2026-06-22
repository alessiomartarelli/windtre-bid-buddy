#!/usr/bin/env bash
# Run the Incentivazione "Accessori/Servizi live" test suite
# (tests/incentivazione-accessori-servizi.test.mjs).
#
# Verifica `aggregateAccessoriServizi` (server/storage.ts): conteggio live
# Accessori/Servizi BiSuite per addetto nelle gare addetto (Task #174).
#
# È DB-backed ma NON passa dall'HTTP: chiama direttamente la funzione di
# storage via loader `tsx`, usando lo stesso pool `pg` del server per inserire
# le vendite di test. Richiede SOLO DATABASE_URL (non il dev server). Il modulo
# TS viene caricato via loader `tsx`.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[accessori-servizi-tests] ERROR: DATABASE_URL not set." >&2
  exit 1
fi

echo "[accessori-servizi-tests] running suite ..."
exec node --import tsx --test tests/incentivazione-accessori-servizi.test.mjs
