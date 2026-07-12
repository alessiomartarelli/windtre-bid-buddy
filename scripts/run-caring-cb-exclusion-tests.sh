#!/usr/bin/env bash
# Run the "Coupon Caring esclusi dai totali CB" test suite
# (tests/caring-cb-exclusion.test.mjs).
#
# Logica pura di `shared/bisuiteMapping.ts` (mapping BiSuite, retarget caring,
# gemelli partnership) e `client/src/lib/calcoloCB.ts` (calcoloCBPerPdv,
# risolto via alias @/ dal loader tsx): verifica che le offerte coupon caring
# restino fuori da conteggio/premio/punti Customer Base, siano contate nella
# card "Caring utilizzate" per PDV/RS, non generino gemelli partnership, e che
# un'org con regole DB vecchie migri senza duplicati. Sono funzioni pure: NON
# serve né il dev server né il DB, il modulo TS viene caricato via loader `tsx`.

set -euo pipefail

echo "[caring-cb-exclusion-tests] running suite ..."
exec node --import tsx --test tests/caring-cb-exclusion.test.mjs
