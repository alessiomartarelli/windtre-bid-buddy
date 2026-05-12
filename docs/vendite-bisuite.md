# Vendite BiSuite — Stato vendite

## Data della vendita
Le API BiSuite restituiscono il campo `dataVendita`. Il sistema lo persiste
in `bisuite_sales.data_vendita` come timestamp wall-time italiano (senza
fuso orario). Fallback: `createdAt` (data di creazione record in BiSuite)
se `dataVendita` non è presente. Vedi `extractSaleFields` in
`server/bisuiteFetch.ts`.

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
