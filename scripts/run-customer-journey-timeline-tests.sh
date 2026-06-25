#!/usr/bin/env bash
# Run the Customer Journey timeline test suite
# (tests/customer-journey-timeline.test.mjs).
#
# Logica pura del tracciamento temporale della scheda cliente
# (`client/src/lib/customerJourneyTimeline.ts`): asse mesi T0–T6, rilevamento
# T0, stati attenuati, raggruppamento per PDV. Sono funzioni pure: NON serve
# né il dev server né il DB, il modulo TS viene caricato via loader `tsx`.

set -euo pipefail

echo "[cj-timeline-tests] running suite ..."
exec node --import tsx --test tests/customer-journey-timeline.test.mjs
