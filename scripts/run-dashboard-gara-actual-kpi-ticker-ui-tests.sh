#!/usr/bin/env bash
# Run the "Dashboard Gara: € Incentivi = premio gara + ticker Piste" UI test suite
# (Task #426): tests/dashboard-gara-actual-kpi-ticker-ui.test.mjs.
#
# Test Playwright su /dashboard-gara-reale con vendite BiSuite e gara_config
# seminati: verifica che la card € Incentivi mostri la somma dei premi di gara
# (non il fatturato) e che il ticker "Piste in gara" mostri solo piste attive,
# con btn-ticker-pause visibile solo con ≥ 3 piste (pausa via click e tastiera).
# Richiede dev server attivo su :5000 e DATABASE_URL.

set -euo pipefail

echo "[dashboard-gara-actual-kpi-ticker-ui-tests] running suite ..."
exec node --import tsx --test tests/dashboard-gara-actual-kpi-ticker-ui.test.mjs
