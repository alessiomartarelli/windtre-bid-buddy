#!/usr/bin/env bash
# Run the pure "Vista PDV Origine/Destinazione" suite
# (tests/pdv-origine-destinazione.test.mjs, Task #462).
#
# Copre shared/pdvView.ts (risoluzione origine/destinazione, mai cross-fallback),
# aggregateMappedSales con opts.pdvView (origine invariata; destinazione con
# bucket esplicito SENZA_DESTINAZIONE) e selectInGaraSales in vista destinazione
# (calendario del PDV di destinazione). Nessun DB, nessun dev server.

set -euo pipefail

echo "[pdv-origine-destinazione-tests] running suite ..."
exec node --import tsx --test tests/pdv-origine-destinazione.test.mjs
