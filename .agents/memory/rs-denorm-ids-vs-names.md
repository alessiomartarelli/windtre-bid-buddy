---
name: RS denorm — id canonici senza perdere i nomi
description: Come risolvere ragioniSociali da ragione_sociale_ids senza far sparire associazioni salvate solo per nome; cast varchar[] vs text[]
---

Regola: quando una riga (categorie/fornitori CdG) ha sia `ragioni_sociali`
(nomi denormalizzati) sia `ragione_sociale_ids`, la risoluzione API deve fare
l'UNIONE: nomi risolti dagli id + nomi salvati il cui id di registro NON è già
coperto dagli id della riga (o assente dal registro). Mai sostituire i nomi
con la sola risoluzione da id.

**Why:** in prod gli id possono essere incompleti (associazioni aggiunte per
nome prima del backfill, RS ereditate 'auto'): sostituire i nomi con i soli
id-resolti ha fatto "sparire" categorie/fornitori dai dropdown Nuova spesa.
Scartare un nome è corretto SOLO se il suo id è già negli id della riga
(allora la risoluzione id dà il nome canonico post-rinomina).

**How to apply:** vedi `resolveMultiRs` in server/cdgStorage.ts. Il backfill
al boot ripara gli id incompleti (condizione `NOT (derivati <@ esistenti)`),
non solo gli array vuoti.

Trappola PG: le colonne array di Drizzle `text(...).array()` possono essere
`character varying[]` in DB reali; `varchar[] <@ text[]` NON esiste → castare
esplicitamente entrambi i lati `::text[]` (incluso `array_agg(col)::text[]`).
L'errore emerge solo a runtime nel backfill, con log ma senza crash: dopo un
deploy che tocca i backfill, controllare error.log per "[cdg] backfill".
