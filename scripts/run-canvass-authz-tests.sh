#!/usr/bin/env bash
# Run the Canvass Vodafone/Fastweb authz test suite
# (tests/canvass-authz.test.mjs).
#
# Verifica i confini di ruolo/org sulle route canvass (Task #302):
#   - operatore => 403 su catalog, mapped-sales, import, reset;
#   - admin => solo la propria org su mapped-sales, niente import/reset;
#   - import di un reference senza offerte => 400 (Task #305 lato server).
#
# Prerequisiti: app attiva su localhost:5000 (workflow "Start application")
# e DATABASE_URL (i test creano/puliscono org di test via SQL).

set -euo pipefail

echo "[canvass-authz-tests] running suite ..."
exec node --test tests/canvass-authz.test.mjs
