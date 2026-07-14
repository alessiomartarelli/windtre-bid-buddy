#!/usr/bin/env bash
# Test PURI del modulo Gestione DTS (Task #321): parsing Excel lead
# drive-to-store e aggregazioni report incidenza (shared/dtsReport.ts) +
# sezione DTS nell'allegato HTML Telegram. NON serve né dev server né DB.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Gestione DTS tests (pure) ==="
node --import tsx tests/dts-report.test.mjs
echo "=== OK ==="
