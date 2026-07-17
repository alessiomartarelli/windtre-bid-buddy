#!/usr/bin/env bash
# Test PURI della Gara SOS Caring (Task #327): parsing Excel caring PDV,
# aggregazione per Ragione Sociale e fasce premio/malus sulla % Balance RS
# (shared/sosCaring.ts). NON serve né dev server né DB.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Gara SOS Caring tests (pure) ==="
node --import tsx tests/sos-caring.test.mjs
echo "=== OK ==="
