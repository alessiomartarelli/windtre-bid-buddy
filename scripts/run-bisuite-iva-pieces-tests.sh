#!/usr/bin/env bash
# Run the "Pezzi IVA per pista canvass" test suite (Task #377):
# tests/bisuite-iva-pieces.test.mjs.
#
# Verifica la regola pura `isPezzoIva` (shared/bisuiteClassification.ts) e la
# coerenza col classificatore articoli. Funzioni pure: NON serve né dev server
# né DB, i moduli TS vengono caricati via loader tsx.

set -euo pipefail

echo "[bisuite-iva-pieces-tests] running suite ..."
exec node --import tsx --test tests/bisuite-iva-pieces.test.mjs
