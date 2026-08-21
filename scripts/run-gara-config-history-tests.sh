#!/usr/bin/env bash
# Run the "gara config history & propagation" suite
# (tests/gara-config-history-db.test.mjs, Task #14).
#
# Copre via API HTTP + DB: archiviazione delle revisioni precedenti in
# gara_config_history al salvataggio (con confronto stabile, niente revisioni
# spurie), storico come record nominati non collassati per mese/anno,
# GET /api/gara-config/revisions, propagazione import-from-simulator che
# preserva tabelleCalcolo / extraGaraIvaSogliePerRS / venditeForecast /
# performanceWeights, e persistenza delle soglie Extra Gara P.IVA.
# Richiede il dev server attivo (workflow "Start application") e DATABASE_URL.

set -euo pipefail

echo "[gara-config-history-tests] running suite ..."
exec node --test tests/gara-config-history-db.test.mjs
