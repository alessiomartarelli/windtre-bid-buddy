#!/usr/bin/env bash
# Run the Customer Journey badge↔gettone parity test suite
# (tests/customer-journey-validity-gettone-parity.test.mjs).
#
# Test incrociato (Task #216): il numero di badge "Conta" della scheda
# (`computeItemValidity` in client/src/lib/customerJourneyTimeline.ts) DEVE
# eguagliare `pisteAttive` del gettone (`buildGettoneJourneys` in
# shared/customerJourney.ts) sullo stesso dataset sintetico. Sono funzioni pure:
# NON serve né dev server né DB, i moduli TS sono caricati via loader `tsx`.

set -euo pipefail

echo "[cj-validity-gettone-parity-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-validity-gettone-parity.test.mjs
