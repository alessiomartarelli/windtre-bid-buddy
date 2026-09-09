#!/usr/bin/env bash
# Verifica il riepilogo visibile Extra Gara IVA del Preventivatore:
# prima e seconda linea separate, pezzi/punti riconciliati e FRITZ non duplicato.
# Richiede dev server attivo su :5000 e DATABASE_URL.

set -euo pipefail

echo "[preventivatore-extra-gara-iva-ui-tests] running suite ..."
exec node --import tsx --test tests/preventivatore-extra-gara-iva-ui.test.mjs