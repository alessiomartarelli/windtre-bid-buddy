#!/usr/bin/env bash
# Run the Bilancio IVA export-sheet test suite (tests/bilancio-iva-export.test.mjs).
# Test di logica pura su shared/bilancioIvaExport.ts: non richiede il dev server.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "[bilancio-iva-export-tests] running suite ..."
exec node --import tsx --test tests/bilancio-iva-export.test.mjs
