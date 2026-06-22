#!/usr/bin/env bash
# Run the Incentivazione interna (gare addetto) test suite
# (tests/incentivazione.test.mjs).
#
# Logica pura di `shared/incentivazione.ts` (calendario giorni lavorativi,
# proiezione, semaforo, sblocco gara) + parsing del file Excel valenze REALE
# (fixture stabile tests/fixtures/valenze-w3.xlsx, foglio "Riepilogo"): NON
# serve né il dev server né il DB. Il modulo TS viene caricato via loader `tsx`.

set -euo pipefail

echo "[incentivazione-tests] running suite ..."
exec node --import tsx --test tests/incentivazione.test.mjs
