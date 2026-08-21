#!/usr/bin/env bash
# Run the "Dashboard Gara RS/PDV filter" UI suite
# (tests/dashboard-rs-pdv-filter-ui.test.mjs, Task #14).
#
# Playwright (playwright-core + chromium di sistema) contro la Dashboard Gara
# Reale: filtri RS e PDV nell'header (selezioni dipendenti, scoping di card e
# dettaglio PDV), ordinamento multi-RS deterministico (alfabetico, non per
# performance) e coerenza dei punti Mobile per-PDV (nessun doppio conteggio
# PDV/RS). Richiede il dev server attivo e DATABASE_URL.

set -euo pipefail

echo "[dashboard-rs-pdv-filter-ui-tests] running suite ..."
exec node --test tests/dashboard-rs-pdv-filter-ui.test.mjs
