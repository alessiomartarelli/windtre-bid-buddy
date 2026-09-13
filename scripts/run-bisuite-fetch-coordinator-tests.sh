#!/usr/bin/env bash
set -euo pipefail

echo "[bisuite-fetch-coordinator-tests] running suite ..."
exec node --import tsx --test tests/bisuite-fetch-coordinator.test.mjs