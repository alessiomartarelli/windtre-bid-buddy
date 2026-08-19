#!/usr/bin/env bash
# Regressione pura per Pagamento Annuale nelle Assicurazioni:
# mapping BiSuite SI/NO, Dashboard Gara e Simulatore per Ragione Sociale.

set -euo pipefail

echo "[assicurazioni-pagamento-annuale-tests] running suite ..."
exec node --import tsx --test tests/assicurazioni-pagamento-annuale.test.mjs