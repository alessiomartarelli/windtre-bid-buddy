#!/usr/bin/env bash
# Regressioni pure Assicurazioni:
# - Pagamento Annuale: mapping, Dashboard Gara e Simulatore per RS;
# - Impianto OK: gettone separato, escluso dai pezzi/punti Assicurazioni.

set -euo pipefail

echo "[assicurazioni-pagamento-annuale-tests] running suite ..."
exec node --import tsx --test \
  tests/assicurazioni-pagamento-annuale.test.mjs \
  tests/impianto-ok-exclusion.test.mjs