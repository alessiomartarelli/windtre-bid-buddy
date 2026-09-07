---
name: DRMS legacy uploads & prod esito run
description: Perché gli upload DRMS vecchi non esitano energia e come eseguire applyDrmsOutcomes su prod
---

Regola: un upload DRMS è "legacy" se NESSUNA riga ha le CHIAVI (non il valore)
FISCAL_CODE/POD_PDR/CAUSALE_STORNO nel jsonb; il motore lo elenca in
`legacyUploads`, mai lo conta in silenzio fra i non trovati. Le colonne non sono
ricostruibili dal DB: servono i file originali (re-upload stesso periodo,
merge per SEQ_ID).

**Why:** in prod (set 2026) i 2 upload (giu/lug 2026, ~50k righe) erano legacy:
mobile/fisso matchavano per codice contratto, ma energia (WT-… BiSuite ≠ codice
DRMS) mai, e sembrava un bug del match. Il codice contratto BiSuite energia
(WT-0001210742) è lo stesso per luce e gas dello stesso cliente.

**How to apply:** per verificare l'esito su prod NON aspettare la UI: tsx da dev
con tunnel al DB prod (`scripts/_tmp-*.mts` che importa server/storage), ma
`applyDrmsOutcomes` su ~50k righe via tunnel dura >4 min: lanciarlo con
ShellExec run_in_background + log su file (un `&`/setsid dentro la call muore
con la call). `timeout 900`. Dopo il deploy del motore la migrazione legacy ha
loggato `[cj] migrati 51 item`.

**Perf (set 2026):** il costo di applyDrmsOutcomes NON era il motore ma il
trasferimento/parsing del jsonb intero (55k righe ⇒ +70MB heap). Regola: le
route non leggono mai `drms_uploads.rows` intero; proiezione SQL delle sole
colonne del motore (presenza chiavi legacy via `?|`) + runner asincrono per
org (coalescing, 10s inline poi 202 + notifica `cj_drms_outcome`). Se aggiungi
un campo al motore, aggiungilo ANCHE alla proiezione SQL in storage o verrà
letto sempre null. Leggi i tempi per fase dal log `[cj] applyDrmsOutcomes`
prima di ottimizzare altro (l'update per item è il prossimo sospetto via tunnel).
