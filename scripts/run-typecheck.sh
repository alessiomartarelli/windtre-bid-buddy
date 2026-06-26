#!/usr/bin/env bash
# Run the TypeScript type-checker over the whole repo (Task #219).
#
# Esegue `npx tsc --noEmit` usando la config di progetto (tsconfig.json,
# target ES2020, strict). Non serve né dev server né DB: è un check statico
# puro. Esce con codice != 0 se compare anche un solo errore di tipo, così
# lo step di validation "typecheck" fallisce e blocca la ricomparsa di
# errori di tipo nel codice (la regressione che Task #218 aveva ripulito).

set -euo pipefail

echo "[typecheck] running npx tsc --noEmit ..."
exec npx tsc --noEmit
