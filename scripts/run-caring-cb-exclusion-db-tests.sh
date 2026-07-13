#!/usr/bin/env bash
# Run the DB-backed "Coupon Caring esclusi dai totali CB via sync live" suite
# (tests/caring-cb-exclusion-db.test.mjs).
#
# A differenza della suite pura omonima (run-caring-cb-exclusion-tests.sh), qui
# si esercita il VERO percorso di aggregazione server-side: semina righe
# `bisuite_sales` per un'org effimera, le rilegge con lo storage usato dalla
# route GET /api/admin/bisuite-mapped-sales e le passa a `aggregateMappedSales`
# (funzione estratta dalla route), verificando che il caring finisca SOLO su
# cb:coupon_caring senza gonfiare i veri eventi CB né generare gemelli
# partnership. DB-backed: NON serve il dev server, ma richiede DATABASE_URL.

set -euo pipefail

echo "[caring-cb-exclusion-db-tests] running suite ..."
exec node --import tsx --test tests/caring-cb-exclusion-db.test.mjs
