#!/usr/bin/env bash
# Run the Customer Journey reportistica + filtri condivisi test suite
# (tests/customer-journey-report.test.mjs).
#
# Logica pura di `shared/customerJourney.ts` (aggregateReport, matchesCjFilters,
# cjSearchMatches): NON serve né dev server né DB. Il modulo TS viene caricato
# via loader `tsx`.

set -euo pipefail

echo "[cj-report-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-report.test.mjs
