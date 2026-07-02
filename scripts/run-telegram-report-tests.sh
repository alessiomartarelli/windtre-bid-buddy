#!/usr/bin/env bash
# Test PURI del report vendite Telegram (Task #239): logica di aggregazione
# e messaggio (shared/venditeReport.ts) + orari scheduler e risoluzione
# config (server/telegramReportScheduler.ts). NON serve né dev server né DB.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Telegram report tests (pure) ==="
node --import tsx tests/telegram-report.test.mjs
echo "=== OK ==="
