#!/usr/bin/env bash
set -euo pipefail
# Component regression plus DB-backed version/cache lifecycle regression.
# Requires Start application, DATABASE_URL and system Chromium.
BASE="${FINPLAN_BASE_URL:-http://localhost:5000}"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${BASE}/" 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[cj-sim-diagnostics-ui-tests] app not reachable at ${BASE}" >&2
    exit 1
  fi
  sleep 1
done
exec node --import tsx --test tests/customer-journey-sim-diagnostics-ui.test.mjs tests/customer-journey-sim-diagnostics-version-ui.test.mjs
