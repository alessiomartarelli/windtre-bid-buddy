#!/usr/bin/env bash
# Run the Customer Journey export (PDF/Excel) test suite
# (pure rows + actual smartphone PDF/Excel downloads).
#
# Logica pura di costruzione righe/colonne degli export
# (`shared/customerJourneyExport.ts`, estratta da
# `client/src/lib/customerJourneyExport.ts`): intestazioni, mapping campi,
# valori driver/stato, filterLabel, nomi file. Il test dei file usa Chromium
# con un harness effimero: NON serve il dev server né il DB.
# I file sintetici scaricati restano in generated-artifacts/cj-smartphone-files.

set -euo pipefail

echo "[cj-export-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-export.test.mjs tests/customer-journey-smartphone-files.test.mjs
