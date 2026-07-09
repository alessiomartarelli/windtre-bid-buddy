#!/usr/bin/env bash
# Run the brand gating test suite (tests/brand-gating.test.mjs).
#
# Logica pura di `shared/modules.ts` (isWindtreBrandName,
# isModuleAllowedForBrands): NON serve né il dev server né il DB.
# Il modulo TS viene caricato via loader `tsx`.

set -euo pipefail

echo "[brand-gating-tests] running suite ..."
exec node --import tsx --test tests/brand-gating.test.mjs
