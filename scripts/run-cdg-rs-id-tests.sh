#!/usr/bin/env bash
# Run the CdG RS-by-id linkage suite (tests/cdg-rs-id-linkage.test.mjs).
# Task #345: le tabelle CdG referenziano le Ragioni Sociali per id (registro
# cdg_ragioni_sociali); i nomi sono risolti in lettura e le rinomine non
# richiedono più propagazioni per nome. Richiede il dev server attivo.

set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:5000}"

echo "[cdg-rs-id-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/auth/user" || true)
  if [ "$code" != "000" ]; then
    echo "[cdg-rs-id-tests] server reachable after ${i}s (HTTP $code)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[cdg-rs-id-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/cdg-rs-id-linkage.test.mjs
