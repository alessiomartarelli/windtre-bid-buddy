#!/usr/bin/env bash
# Run the DB-backed "Tally piste/addon dopo il refactor di aggregazione" suite
# (tests/pista-addon-tally-db.test.mjs, Task #297).
#
# Copre il CUORE del mapping per pista di server/bisuiteMappedSales.ts
# (aggregateMappedSales) NON coperto dalle suite caring/CB e device/accessori:
# item BASE (pezzi + canone per pista/targetCategory), percorso ADDITIONAL/addon
# (occorrenze + canone, con canone SOLO per il set CANONE_BASED_ADDONS),
# descrizioni SIM_IVA, rollup totaliPerPista / totaliAddonsPerPista e conteggi
# globali totalMapped/totalUnmapped/totalArticoli. DB-backed: NON serve il dev
# server, ma richiede DATABASE_URL.

set -euo pipefail

echo "[pista-addon-tally-tests] running suite ..."
exec node --import tsx --test tests/pista-addon-tally-db.test.mjs
