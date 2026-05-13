# Vendite BiSuite — Stato vendite

## Data della vendita
Le API BiSuite restituiscono il campo `dataVendita` come istante UTC
(`"2026-03-31T22:00:00.000Z"` = mezzanotte italiana del 01/04 in CEST).
Il sistema lo normalizza al **wall-time italiano** (Europe/Rome) tramite
l'helper `toItalianWallTime` (vedi `server/bisuiteFetch.ts`) e lo persiste
in `bisuite_sales.data_vendita` (`timestamp without time zone`). Quindi
la riga sopra viene salvata come `2026-04-01 00:00:00`, allineata a quello
che l'utente vede in negozio e in BiSuite. Fallback: `createdAt` se
`dataVendita` è assente (con stessa normalizzazione).

L'helper gestisce: stringhe con `Z`, stringhe con offset esplicito (`+02:00`),
stringhe naive senza fuso (trattate come già wall-time italiano), date-only
(`YYYY-MM-DD`), e valori vuoti/null. Senza questa normalizzazione, le
vendite del primo giorno di ogni mese venivano memorizzate al
`giorno_precedente 22:00` e finivano nel mese sbagliato per i filtri
mensili (Task #101).

**Nota sull'orario**: BiSuite restituisce sempre `dataVendita` alla mezzanotte
italiana (verificato 12/05/2026 su 20.741 record: 100% a `00:00:00`). Di
conseguenza i consumer server-side che usano `Intl({ timeZone: 'Europe/Rome' })`
sulla colonna letta dal DB (Dashboard Gara `isSaleInGara`) e il client che
formatta con `date-fns` continuano a estrarre la data corretta anche dopo
la normalizzazione, perché `00:00 UTC` formattato in Europe/Rome dà sempre
lo stesso giorno (`02:00 CEST` o `01:00 CET`). Se in futuro l'API
iniziasse a restituire orari reali, sarà necessario serializzare
`dataVendita` come stringa "naive" (senza Z) all'API boundary.

## Sync non distruttivo + chunk mensili (Task #102)
La sync BiSuite (`runBisuiteFetchForOrg` in `server/bisuiteFetch.ts`,
endpoint `POST /api/bisuite-fetch` e `POST /api/admin/bisuite-import`,
scheduler giornaliero `bisuiteScheduler`) è **non distruttiva**: NON
cancella più i record esistenti per l'org prima del fetch. L'`upsert`
è basato sull'unique constraint `(organization_id, bisuite_id)` con
`ON CONFLICT DO UPDATE` su tutti i campi mutabili (incluso `fetched_at`).
Il trick `xmax = 0` di Postgres è usato in `RETURNING` per distinguere
record inseriti vs aggiornati e popolare il riepilogo della risposta
(`inserted`, `updated`, `chunks`, `failedChunks`).

L'API BiSuite tronca silenziosamente le risposte oltre ~13-14 giorni:
una singola chiamata con `from=2026-01-01&to=2026-05-13` restituisce
solo gli ultimi giorni e omette i mesi precedenti. Per evitare questo,
la sync spezza il range richiesto in **chunk mensili** allineati al
1°/ultimo del mese (`buildMonthlyChunks`) e fa una chiamata per ogni
mese. Il fallimento di un singolo chunk non interrompe gli altri e non
cancella nulla: l'errore finisce in `failedChunks`. Default range se
non specificato: `${anno_corrente}-01-01` → domani.

Recovery storico: `node runBisuiteFetch.cjs <orgId> [startYMD] [endYMD]`
(CLI omonimo); oppure POST `/api/admin/bisuite-import` con `start_date`,
`end_date`. La constraint `UQ_bisuite_sales_org_bisuite_id` rende le
ri-esecuzioni idempotenti.

## Esclusione vendite ANNULLATA
Le query `getBisuiteSales*` in `server/storage.ts` aggiungono per default la
condizione `upper(stato) <> 'ANNULLATA'`. Il chiamante può passare
`includeAnnullate=true` per disattivare il filtro.

In tutta l'app (Dashboard Gara, calcolo punti/soglie/proiezioni, Prima Nota
IVA, premi, ecc.) sono escluse. **Eccezione**: la pagina `/vendite-bisuite`
chiama `/api/bisuite-sales?includeAnnullate=true` per mostrarle nella
tabella grezza con badge "ANNULLATA"; il filtro UI "Stato"
(`Solo finalizzate` default | `Solo annullate` | `Tutte`) controlla cosa
viene mostrato in tabella. Tutti gli aggregati della stessa pagina
(statistiche, classificazioni per articolo, export Excel) usano la lista
`sales` filtrata che esclude le annullate.
