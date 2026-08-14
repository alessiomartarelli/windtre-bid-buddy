#!/usr/bin/env bash
# Run the CdG pivot Excel-export shaping test suite
# (tests/cdg-pivot-export.test.mjs) — Task #357.
#
# Logica pura in shared/cdgPivotExport.ts (nomi foglio sanificati/dedup,
# foglio Totale + foglio per RS, modalità RS/PDV, coerenza totali).
# NON serve né dev server né DB: i moduli TS sono caricati via loader tsx.

set -euo pipefail

echo "[cdg-pivot-export-tests] running suite ..."
exec node --import tsx --test tests/cdg-pivot-export.test.mjs
