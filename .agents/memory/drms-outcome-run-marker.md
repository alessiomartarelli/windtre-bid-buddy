---
name: DRMS outcome run marker
description: invarianti del marker persistito "Esita da DRMS in corso" (ripresa al boot) e trappole da evitare
---
Lo stato "in corso" del runner Esita da DRMS è persistito per org e ripreso al boot
(avviso + rerun idempotente). Invarianti non ovvie:

- start/end del marker serializzati per org: con query DB indipendenti il DELETE del run
  precedente può committare DOPO l'UPSERT del run successivo e cancellare il marker di un run vivo.
- Marker scritto (con retry) PRIMA del run; se fallisce il run non parte: mai un run
  "scoperto" che un riavvio perderebbe in silenzio.
- end e list-al-boot ritentati con backoff: un marker che resta orfano blocca il pulsante
  (outcomeRunning=true) finché un run/boot non lo riconcilia.
- Non usare bisuite_sync_notifications come marker: la campanella mostra qualsiasi status.

**Why:** un riavvio a metà ricalcolo perdeva l'esito in silenzio.
**How to apply:** ogni modifica al ciclo di vita del runner ⇒ test asincroni sull'interleaving
start/end e fault injection sulla persistenza; nuova tabella di stato ⇒ schema sync in prod.
