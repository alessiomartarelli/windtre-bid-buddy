#!/usr/bin/env bash
# Run the "spesa ricorrente atomica: nessuna mensilità orfana" suite
# (tests/cdg-spese-ricorrenza-rollback.test.mjs, Task #353).
#
# Copre la transazione master+cloni di POST /api/cdg/spese
# (cdgStorage.createSpesaConRicorrenza): happy path, rollback totale su
# occorrenza invalida (0 righe in cdg_spese) e — via HTTP con fault injection
# di test — il cleanup automatico dell'allegato sul ramo d'errore della route.
# Richiede il dev server su http://localhost:5000 e DATABASE_URL.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[cdg-spese-ricorrenza-rollback-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/user" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "[cdg-spese-ricorrenza-rollback-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[cdg-spese-ricorrenza-rollback-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    exit 1
  fi
  sleep 1
done

echo "[cdg-spese-ricorrenza-rollback-tests] running suite ..."
exec node --import tsx --test tests/cdg-spese-ricorrenza-rollback.test.mjs
