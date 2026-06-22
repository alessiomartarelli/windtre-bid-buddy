#!/usr/bin/env bash
# Run the Incentivazione interna (gare addetto) pure-logic test suite
# (tests/incentivazione.test.mjs).
#
# Sono funzioni pure di `shared/incentivazione.ts` (calendario giorni
# lavorativi, proiezione, semaforo, sblocco gara): NON serve né il dev server
# né il DB. Il modulo TS viene caricato via loader `tsx`.

set -euo pipefail

echo "[incentivazione-tests] running pure-logic suite ..."
exec node --import tsx --test tests/incentivazione.test.mjs
