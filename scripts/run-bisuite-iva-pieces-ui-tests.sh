#!/usr/bin/env bash
# Run the "Pezzi IVA per pista canvass — UI" test suite (Task #379):
# tests/bisuite-iva-pieces-ui.test.mjs.
#
# Test Playwright su /vendite-bisuite con vendite BiSuite seminate: verifica
# il badge "di cui N IVA" (text-iva-<pista>) nel riquadro Canvass e la tabella
# "Categorie canvass" nei dettagli espansi per PDV e Addetto.
# Richiede dev server attivo su :5000 e DATABASE_URL.

set -euo pipefail

echo "[bisuite-iva-pieces-ui-tests] running suite ..."
exec node --import tsx --test tests/bisuite-iva-pieces-ui.test.mjs
