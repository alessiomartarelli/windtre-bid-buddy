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
# Task #489: include anche la suite del pannello "Provenienza punti" delle
# card pista (stessa pagina, stesso seed pattern) per rispettare il limite
# di workflow.
# --test-concurrency=1: due file browser-heavy in parallelo esauriscono i
# thread del container (pthread_create) — esecuzione sequenziale deterministica.
exec node --import tsx --test --test-concurrency=1 \
  tests/dashboard-gara-actual-kpi-ticker-ui.test.mjs \
  tests/pista-provenienza-ui.test.mjs
