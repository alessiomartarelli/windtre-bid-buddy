#!/usr/bin/env bash
set -euo pipefail
# Self-contained React browser harness: no running app, authentication or DB seed needed.
exec node --import tsx --test tests/customer-journey-sim-diagnostics-ui.test.mjs
