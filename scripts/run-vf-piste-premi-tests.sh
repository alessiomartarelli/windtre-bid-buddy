#!/usr/bin/env bash
# Run the VF piste obiettivi/soglie/premi test suite
# (tests/vf-piste-premi.test.mjs).
#
# Task #528 — logica pura in shared/vfPisteCalc.ts: risoluzione della RS
# effettiva del perimetro dashboard, precedenza override RS vs config
# globale (incluso blocco `rimosso`), calcolo soglia/premio/prossimo
# target. Funzioni pure: NON serve né il dev server né il DB, i moduli TS
# vengono caricati via loader `tsx`.

set -euo pipefail

echo "[vf-piste-premi-tests] running suite ..."
exec node --import tsx --test tests/vf-piste-premi.test.mjs
