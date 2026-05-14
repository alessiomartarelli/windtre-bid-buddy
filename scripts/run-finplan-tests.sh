#!/usr/bin/env bash
# Run the FinPlan sync test suite (tests/finplan-sync.test.mjs).
#
# Scenarios 1 and 1b hit the running app on http://localhost:5000, so this
# script first waits (up to ~30s) for the dev server to be reachable. Start
# it via the "Start application" workflow (npm run dev) before invoking this.

set -euo pipefail

BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"

echo "[finplan-tests] waiting for $BASE_URL ..."
for i in $(seq 1 30); do
  if curl -sSf -o /dev/null "$BASE_URL/finplan/index.html"; then
    echo "[finplan-tests] server reachable after ${i}s"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[finplan-tests] ERROR: $BASE_URL not reachable after 30s." >&2
    echo "[finplan-tests] Start the 'Start application' workflow (npm run dev) and retry." >&2
    exit 1
  fi
  sleep 1
done

exec node --test tests/finplan-sync.test.mjs
