#!/usr/bin/env bash
# Run the Customer Journey "Esita da DRMS" async runner test suite
# (tests/customer-journey-drms-runner.test.mjs).
#
# Runner di `server/cjDrmsOutcomeRunner.ts` (serializzazione per org,
# coalescing, attesa inline → 202 pending, notifica cj_drms_outcome):
# NON serve né dev server né DB. Il modulo TS viene caricato via loader `tsx`.

set -euo pipefail

echo "[cj-drms-runner-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-drms-runner.test.mjs
