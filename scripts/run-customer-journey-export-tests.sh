#!/usr/bin/env bash
# Run the Customer Journey export (PDF/Excel) test suite
# (tests/customer-journey-export.test.mjs).
#
# Logica pura di costruzione righe/colonne degli export
# (`shared/customerJourneyExport.ts`, estratta da
# `client/src/lib/customerJourneyExport.ts`): intestazioni, mapping campi,
# valori driver/stato, filterLabel, nomi file. Sono funzioni pure: NON serve
# né il dev server né il DB, il modulo TS viene caricato via loader `tsx`.

set -euo pipefail

echo "[cj-export-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-export.test.mjs
