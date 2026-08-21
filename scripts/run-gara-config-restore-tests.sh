#!/usr/bin/env bash
# Run the "gara config revision restore" suite
# (tests/gara-config-restore-db.test.mjs, Task #477).
#
# Copre via API HTTP + DB: POST /api/gara-config/revisions/restore riporta la
# configurazione alla revisione scelta, archivia a sua volta la versione
# sostituita, espone changedByName nella lista revisioni e rifiuta
# revisionId mancanti/inesistenti/di altre organizzazioni.
# Richiede il dev server attivo (workflow "Start application") e DATABASE_URL.

set -euo pipefail

echo "[gara-config-restore-tests] running suite ..."
exec node --test tests/gara-config-restore-db.test.mjs
