#!/usr/bin/env bash
# Run the DB-backed "Device tally + Accessori/Servizi dopo il refactor di
# aggregazione" suite (tests/devices-accessori-servizi-db.test.mjs, Task #293).
#
# Copre la parte di server/bisuiteMappedSales.ts (aggregateMappedSales) NON
# coperta dalla suite caring/CB: conteggio device (smartphone/smartDevice/
# internetDevice) con split finanziato/rate/altro dedotto dalle domandeRisposte,
# secchi Accessori/Servizi (pezzi + importo, con fallback prezzo) e separazione
# dei totali per PDV. DB-backed: NON serve il dev server, ma richiede
# DATABASE_URL.

set -euo pipefail

echo "[devices-accessori-servizi-tests] running suite ..."
exec node --import tsx --test tests/devices-accessori-servizi-db.test.mjs
