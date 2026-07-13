#!/usr/bin/env bash
# Run the Canvass Vodafone/Fastweb mapping test suite
# (tests/canvass-mapping.test.mjs).
#
# Logica pura di categorizzazione delle vendite BiSuite canvass
# Vodafone/Fastweb (`shared/canvassMapping.ts` + catalogo baked
# `shared/canvassCatalog.ts`): parsing catalogo, estrazione offerId,
# indici, match per codice/offerId/categoria-tipologia, aggregazione,
# raggruppamento step. Sono funzioni pure: NON serve né il dev server né
# il DB, i moduli TS vengono caricati via loader `tsx`.

set -euo pipefail

echo "[canvass-mapping-tests] running suite ..."
exec node --import tsx --test tests/canvass-mapping.test.mjs
