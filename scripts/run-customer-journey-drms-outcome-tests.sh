#!/usr/bin/env bash
# Run the Customer Journey DRMS outcome engine test suite
# (tests/customer-journey-drms-outcome.test.mjs).
#
# Logica pura di `shared/customerJourneyDrms.ts` (regole pagato/annullato/
# stornato/riaccreditato, match per driver, finestra T+5, stato manuale):
# NON serve né dev server né DB. Il modulo TS viene caricato via loader `tsx`.

set -euo pipefail

echo "[cj-drms-outcome-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-drms-outcome.test.mjs
