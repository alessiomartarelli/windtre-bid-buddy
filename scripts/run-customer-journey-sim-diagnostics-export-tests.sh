#!/usr/bin/env bash
set -euo pipefail
# Actual XLSX serialization and read-back; no browser, server or database.
exec node --import tsx --test tests/customer-journey-sim-diagnostics-export.test.mjs
