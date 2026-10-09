#!/usr/bin/env bash
set -euo pipefail
exec node --import tsx --test tests/customer-journey-sim-diagnostics.test.mjs tests/customer-journey-sim-diagnostics-export.test.mjs tests/customer-journey-sim-diagnostics-authz.test.mjs tests/customer-journey-sim-diagnostic-cache.test.mjs
