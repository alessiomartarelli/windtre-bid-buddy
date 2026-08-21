#!/usr/bin/env bash
# Run the DB-backed "Perimetro RS/PDV su vendite mappate" suite
# (tests/mapped-sales-perimeter-db.test.mjs, Task #478).
#
# Copre filterSalesByPerimeter (server/bisuiteMappedSales.ts): il filtro
# opzionale codicePos/ragioneSociale della route
# GET /api/admin/bisuite-mapped-sales che scala daily/totalSales/totalImporto
# al perimetro RS/PDV scelto sulla Dashboard Gara Reale, coerente con la
# vista PDV origine/destinazione. DB-backed: NON serve il dev server, ma
# richiede DATABASE_URL.

set -euo pipefail

echo "[mapped-sales-perimeter-tests] running suite ..."
exec node --import tsx --test tests/mapped-sales-perimeter-db.test.mjs
