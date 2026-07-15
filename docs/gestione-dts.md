# Modulo Gestione DTS (Task #321)

Gestione dei lead **drive-to-store** (appuntamenti fissati dai consulenti
telefonici) e report di **incidenza sulle vendite BiSuite**.

## Flusso

1. L'admin carica l'export Excel dei lead (pagina `/gestione-dts`, bottone
   "Carica Excel"). Il **parsing avviene nel browser** (come Canvass VF):
   al server arrivano solo i lead già normalizzati.
2. I lead sono salvati in `dts_leads` (una riga per lead, chiave stabile
   `lead_key` per il merge idempotente su re-upload).
3. La dashboard incrocia `ID VENDITA` ↔ **codice esterno** della vendita
   (`raw_data->>'codiceEsterno'`, Task #324 — NON il `bisuiteId` interno,
   che è un id BiSuite ~1.1M mentre gli ID del file sono ~250k) e mostra
   KPI e incidenza; la stessa aggregazione alimenta la sezione
   "Drive to Store" nell'allegato HTML del report Telegram.

## Formato Excel

Colonne richieste (ordine libero, header case-insensitive):
`Source.Name`, `CAMPAGNA`, `NOMINATIVO`, `EMAIL`, `CODICE FISCALE`,
`TELEFONO`, `IN CARICO`, `STATO`, `DATA` (gg/mm/aaaa o seriale Excel),
`ID VENDITA` (vuoto se non convertito), `ADDETTO VENDITA`, `ORIGINE LEAD`.

- Il consulente è ricavato da `Source.Name` senza estensione file
  ("DALIA BOLES.csv" ⇒ "DALIA BOLES").
- Righe senza nominativo/telefono/codice fiscale sono scartate.
- Chiave lead: `data|telefono→CF→nominativo|nominativo|campagna`
  (Task #324: il nominativo è sempre incluso, così due lead con lo stesso
  telefono/data/campagna ma persone diverse non collassano). Dentro lo
  stesso file i duplicati di chiave si fondono e un `ID VENDITA` presente
  non è mai sovrascritto da uno vuoto; ma se la stessa persona ha DUE
  `ID VENDITA` diversi (doppio acquisto lo stesso giorno) i lead restano
  distinti (chiave estesa con l'ID).

## Logica pura (`shared/dtsReport.ts`)

Parsing (`validateDtsHeaders`, `parseDtsRows`, `mergeDtsLeads`), filtri
(`filterDtsLeads`: mese `YYYY-MM` sulla colonna DATA + consulente) e
aggregazione (`aggregateDtsReport`): KPI lead (fissati, con ID, convertiti,
tasso), incidenza vendite DTS/totali (ANNULLATA escluse; % a 1 decimale,
`null` se totale 0), dettaglio per pista canvass / categoria canvass /
categoria prodotto (via `classifySaleArticles`), per negozio (con filtro
`codicePos`) e per consulente. Import solo relativi ⇒ testabile via tsx.

## Backend

- Tabella `dts_leads` (unique `(organization_id, lead_key)`), storage
  `getDtsLeads`/`replaceDtsLeads` (Task #324: l'upload è sempre il file
  completo ⇒ delete+insert transazionale, chunk da 200; niente duplicati
  da chiavi legacy)/`deleteDtsLeads`.
- Route (tutte `requireModule("gestione_dts")` — modulo NON WindTre-gated):
  - `GET /api/dts/leads` — lista lead dell'org.
  - `GET /api/dts/sales/:from/:to` — vendite del periodo in forma minima
    (bisuiteId, codiceEsterno, stato, codicePos, nomeNegozio, nomeAddetto,
    rawData), ANNULLATA escluse. Range in path (convenzione queryKey→path).
  - `POST /api/dts/upload` (admin) — `{ fileName, leads[] }` validati Zod.
  - `DELETE /api/dts/leads` (admin) — svuota i lead dell'org.

## Frontend

`client/src/pages/GestioneDts.tsx` (route `/gestione-dts`, lazy,
`<ModuleRoute moduleKey="gestione_dts">`): upload/cancellazione admin-only,
filtri mese (dai lead)/consulente/negozio, 4 KPI, bar chart Recharts
incidenza per pista (DTS vs altre, stacked), tabelle per consulente e per
negozio, incidenza per categoria canvass e per prodotto. Nav: menu
Performance in `AppNavbar` + shortcut nella Home.

## Report Telegram

`buildVenditeReportHtml` accetta `dts?: DtsReportAggregates`: la sezione
"Drive to Store · incidenza sulle vendite" compare SOLO nella pagina
"Totale mese" (KPI + righe con barra verde). Lo scheduler
(`sendDailyReportForOrg`) la calcola dai lead dell'org filtrati sul mese
corrente + `monthRows`; assenza di lead o errori ⇒ sezione assente, il
report parte comunque.

## Test

`tests/dts-report.test.mjs` (19 test puri, `node --import tsx`), script
`scripts/run-dts-tests.sh`, validation step `dts-tests`. Coprono parsing
(date, ID, dedup, merge), filtri, aggregazioni (incidenza, per negozio/
consulente, arrotondamenti) e presenza/assenza della sezione HTML.
