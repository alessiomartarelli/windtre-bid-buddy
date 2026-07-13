#!/usr/bin/env bash
# Run the DB-backed "Dashboard: solo vendite in-gara del mese selezionato" suite
# (tests/dashboard-ingara-filter-db.test.mjs, Task #298).
#
# Copre il LAYER SOPRA l'aggregazione: il filtro della route
# GET /api/admin/bisuite-mapped-sales che decide QUALI righe bisuite_sales
# vengono passate ad aggregateMappedSales — la finestra mensile italiana
# (storage.getBisuiteSalesByItalianMonth) e il gating inGaraOnly + calendario
# (selectInGaraSales in server/bisuiteGaraFilter.ts, con override specialDays,
# fuso Europe/Rome e fallback quando i calendari mancano). DB-backed: NON serve
# il dev server, ma richiede DATABASE_URL.

set -euo pipefail

echo "[dashboard-ingara-filter-tests] running suite ..."
exec node --import tsx --test tests/dashboard-ingara-filter-db.test.mjs
