# Modulo Customer Journey (CJ)

Modulo per-org abilitabile (`customer_journey`) per il cross-sell strutturato
sui clienti che effettuano una **nuova attivazione mobile** a partire da una
**data trigger configurabile per organizzazione** (default `01/07/2026`).
Per ogni cliente si apre una "journey" che mostra i driver già attivati e
quelli ancora attivabili, e traccia ogni contratto attraverso i suoi stati.

## Concetti

- **Journey**: una per cliente per organizzazione, identificata dalla
  `customerKey` (CF per i privati, P.IVA per le aziende, normalizzata
  uppercase/trim). Si apre quando il cliente fa una nuova attivazione mobile
  con data di vendita ≥ alla data trigger dell'org (default `2026-07-01`,
  `CJ_DEFAULT_TRIGGER_DATE`). La data trigger è memorizzata in
  `organization_config.config.customerJourneyTriggerDate` (stringa
  `YYYY-MM-DD`); se assente o non valida si usa il default. Un admin la
  imposta dalla pagina Customer Journey (card "Configurazione modulo") via
  `GET`/`PUT /api/customer-journey-config`; dopo la modifica serve un
  "Rigenera da BiSuite" per applicarla. La modifica è admin-only.
- **Item**: un contratto/driver dentro la journey, derivato da un articolo di
  una vendita BiSuite. Unico per `(org, bisuiteSaleId, bisuiteArticleId)`.
- **Driver** (`CJ_DRIVERS` / `CJ_DRIVER_ORDER`):
  `mobile`, `fisso`, `energia` (gas oppure luce), `assicurazioni`,
  `telefono` (categoria TELEFONIA), `protetti` (Windtre Protetti / ALLARMI).
  La classificazione categoria→driver è in `shared/customerJourney.ts`
  (`driverFromCategory`) e rispecchia `bisuiteClassification.ts`. CB / MIA /
  rivincoli sono esclusi (non sono nuove attivazioni).
- Un driver risulta **attivato** se ha almeno un item in stato attivo
  (`inserito`, `in_lavorazione`, `attivato`, `pagato`, `riaccreditato`);
  altrimenti è **attivabile**.

## Stati item (`CJ_ITEM_STATES`)

`inserito` · `in_lavorazione` · `attivato` · `ko` · `pagato` · `stornato` ·
`riaccreditato`.

- Lo stato iniziale è derivato dalla vendita BiSuite durante il reconcile:
  vendita `ANNULLATA` → `stornato`; `FINALIZZATA` → `attivato`; altrimenti
  `inserito`.
- Lo stato può essere modificato manualmente dall'UI. Una volta impostato a
  mano (`stateManual = true`), il reconcile **non lo sovrascrive più**
  (preservato via SQL CASE nell'upsert).

## Gettone

A livello **item** la formula del gettone NON è cablata: ogni item ha solo un
flag di **conferma manuale** (`gettoneConfirmed`) con relativi
`gettoneConfirmedAt` / `gettoneConfirmedBy`.

A livello **reportistica** (analisi gettoni cross-sell, Task #192) il gettone è
calcolato per **cliente** (journey) in base a quante piste NON-mobile sono
attive oltre alla SIM che ha aperto la journey. La tabella a scaglioni
(`CJ_GETTONE_TABLE` in `shared/customerJourney.ts`) è:

| Nº piste cross-sell attive | Gettone |
|---|---|
| 0 (solo mobile) | 0 € |
| 1 | 20 € |
| 2 | 30 € |
| 3 | 40 € |
| 4 | 100 € |
| 5 | 120 € |

- Le 5 piste cross-sell sono `fisso`, `energia`, `assicurazioni`, `telefono`,
  `protetti` (`CJ_NON_MOBILE_DRIVERS`). L'`energia` (gas/luce) conta come una
  sola pista.
- Una pista è "attiva" se ha ≥1 item in uno stato attivo (`CJ_ACTIVE_STATES`:
  inserito/in_lavorazione/attivato/pagato/riaccreditato; ko/annullato/stornato
  esclusi).
- **Cohort** = solo i clienti con **SIM mobile attiva** la cui attivazione cade
  nel periodo: le journey con mobile non attivo (ko/stornato/annullato) o senza
  mobile sono escluse (`buildGettoneJourneys` filtra `simAttive ≥ 1`).
- **KPI** (riferiti alla coorte): **N. SIM attivate** = volume item-level delle
  SIM mobile attive (`simAttivate`), distinto da **N. clienti con SIM attiva** =
  journey distinte (`clienti`); **% clienti con +prodotti** (≥1 pista cross-sell
  attiva) vs **% senza +prodotti** (`crossSellPercentuali`).
- **Fatturato maturato** = somma dei gettoni as-is. **Potenziale non espresso**
  = `(gettone pieno a 5 piste − gettone attuale)` per journey, scalato per una
  **percentuale di saturazione attesa** (25/50/75/100%) scelta dall'utente.
- L'analisi è guidata da un filtro **da–a sulla data di attivazione SIM**
  (`customerJourneys.openedAt`, la coorte T0; confronto per sola data UTC) e
  aggrega per **negozio**, **addetto** o **ragione sociale/cliente** oltre ai
  totali, rispettando l'isolamento per operatore (riusa
  `GET /api/customer-journeys/report`). Logica pura in
  `shared/customerJourney.ts` (`buildGettoneJourneys`, `filterGettoneByDate`,
  `aggregateGettone`, `gettoneTotals`, `crossSellPercentuali`), UI nella
  sotto-vista *Analisi gettoni* della tab Reportistica.

## Visibilità (per ruolo)

- **operatore**: vede SOLO le journey dei propri clienti. Il legame è dato dal
  campo `profiles.bisuiteAddetti` (array di nominativi addetto BiSuite): un
  item è "suo" se `item.addetto` ∈ `bisuiteAddetti` (match case-insensitive).
  Lo stesso filtro è applicato anche a `GET /api/bisuite-sales`.
- **admin** / **super_admin**: vedono tutte le journey del tenant. Solo gli
  admin possono lanciare il reconcile.

## Configurazione

- **Addetti per operatore**: Amministrazione → tab *Utenti* → icona "Addetti
  BiSuite" sulla riga dell'operatore. La lista di nominativi proviene dalle
  vendite BiSuite (`/api/admin/bisuite-dipendenti`).
- **Credenziali BiSuite**: configurabili sia dal **super_admin**
  (SuperAdminPanel, per qualsiasi org) sia dall'**admin di tenant**
  (AdminPanel → tab *BiSuite*, solo per la propria org).

## API

| Metodo | Endpoint | Note |
|---|---|---|
| GET | `/api/customer-journeys` | lista (operatore: filtrata sui suoi addetti); ogni journey porta `drivers` (riepilogo 6 driver attivato/conteggio) + le facet `pdvs`/`addetti`/`states` (valori distinti fra gli item) per i filtri Negozio/Operatore/Stato della lista schede |
| GET | `/api/customer-journeys/report` | reportistica (Task #187/#192): righe item-level `CjReportRow` (journey + cliente + pdv/addetto/stato/driver/valore + `openedAt` data attivazione SIM) aggregabili lato client per negozio/addetto/cliente **e** per l'analisi gettoni cross-sell; **stessa regola di isolamento operatore** della lista (deve precedere `/:id`) |
| GET | `/api/customer-journeys/:id` | dettaglio: `{ journey, items, drivers }` |
| POST | `/api/customer-journeys/reconcile` | rigenera dalle vendite (solo admin) |
| PATCH | `/api/customer-journey-items/:id/state` | `{ state }` |
| PATCH | `/api/customer-journey-items/:id/gettone` | `{ confirmed: boolean }` |
| POST | `/api/admin/profile-addetti` | `{ user_id, addetti: string[] }` |

Tutte le route CJ sono protette da `requireModule("customer_journey")`.

## Mappatura campi (ITEM_CJ → BiSuite `rawData`)

| Campo CJ | Sorgente |
|---|---|
| NOME / COGNOME | `cliente.nome` / `cliente.cognome` |
| CF / P.IVA | `cliente.codiceFiscale` / `cliente.piva` |
| TELEFONO | `cliente.tel1` |
| CODICE CLIENTE | `cliente.codiceEsterno` |
| CATEGORIA / TIPOLOGIA / DESCRIZIONE | `articoli[].*` |
| CANONE | `dettaglio.canone` |
| DATA INSERIMENTO | `createdAt` / `dataVendita` |
| ADDETTO | `addetto.nominativo` |
| PDV ORIGINE | `attivita.nominativo` |
| IMPORTO | `dettaglio.prezzo` (fallback `importoScontrino`) |
| MOD. VENDITA | `dettaglio.tipologiaVendita` |
| CODICE CONTRATTO / POD / PDR / ICCID / IMEI | parse da `venditaInfo1..5` (free-text) |

> **Nota anagrafica journey**: i campi a livello di journey `NOMINATIVO` /
> `RAGIONE SOCIALE` provengono dal **cliente** (`cliente.nominativo`, con
> fallback `denominazione`/`ragioneSociale`), **non** dall'addetto vendita.
> L'addetto vendita (`addetto.nominativo`) popola solo il campo per-item
> `ADDETTO`. Il titolo della scheda business usa quindi la ragione sociale /
> nominativo del cliente, mai il nome dell'addetto.

> **Scheda cliente business (azienda)**: BiSuite **non** fornisce la ragione
> sociale del cliente in modo strutturato — `cliente.ragioneSociale` /
> `denominazione` sono vuoti e il top-level `rawData.ragioneSociale` è il
> **dealer**, non il cliente. Quindi per i clienti azienda:
> - il reconcile propone una ragione sociale ricavata dalla parte locale
>   dell'email del cliente (`suggestRagioneSocialeFromEmail` in
>   `shared/customerJourney.ts`: scarta gli alias generici tipo
>   `info`/`amministrazione`/`pec`, toglie le cifre finali, restituisce
>   MAIUSCOLO);
> - la scheda mostra come titolo la **ragione sociale** e, come riga
>   secondaria "in secondo piano", il **referente amministrativo**
>   (Nome Cognome del cliente, `journeySubtitle`/`journeyReferente` in
>   `CustomerJourney.tsx`). Se la ragione sociale manca, il titolo è il
>   referente e non c'è riga secondaria (niente duplicati);
> - dal dettaglio l'operatore può inserire/correggere la ragione sociale a
>   mano (PATCH `/api/customer-journeys/:id/ragione-sociale`). Il salvataggio
>   marca `ragioneSocialeManual = true` e da quel momento il reconcile **non**
>   sovrascrive più il valore (pattern `CASE WHEN ragioneSocialeManual THEN …
>   ELSE excluded …`). Svuotare il campo azzera valore e flag, ripristinando
>   il suggerimento automatico al reconcile successivo.

### Campi non forniti da BiSuite → compilazione manuale

BiSuite non fornisce in modo affidabile alcuni campi. Sono quindi **compilabili
a mano** dall'UI (Task #161): nel dettaglio journey, ogni contratto ha
un'icona matita ("Modifica") che apre un dialog per editare:

- **DATA ATTIVAZIONE**: il connettore espone solo `dataFine`, non una vera data
  di attivazione → il reconcile la lascia `null`, l'utente la imposta a mano.
- **PDV DESTINAZIONE**: non disponibile da BiSuite → solo manuale.
- **IMEI del telefono**: spesso assente nei `venditaInfo` → auto-derivato se
  presente, altrimenti compilabile a mano.
- **RATA/CANONE**: campo unico mostrato nella colonna "RATA/CANONE". La rata
  non è disponibile da BiSuite (`importoFinanziato` è il valore totale
  finanziato del prodotto, non la rata mensile) → il reconcile lascia `rata`
  `null`. La colonna mostra `rata` (manuale) se presente, altrimenti il
  `canone` derivato dalla vendita (`dett.canone`, utile per le offerte
  mobile/fisso). Il fallback al `canone` è **escluso per il driver `telefono`
  (Smartphone)**: lì il `canone` corrisponde al prezzo del dispositivo, non a
  un canone ricorrente, quindi la colonna resta in bianco finché non si compila
  a mano. L'utente può comunque scrivere a mano rata o canone nel campo
  "RATA/CANONE (€)". Il valore totale del prodotto resta in `importo` (usato
  per il "valore cliente").

Il salvataggio imposta `detailsManual = true` sull'item: da quel momento il
reconcile **non sovrascrive più** questi quattro campi (IMEI e RATA via SQL
CASE nell'upsert; DATA ATTIVAZIONE e PDV DESTINAZIONE non sono nell'upsert, già
preservati). Permessi: gli operatori possono editare solo i propri item
(match su `addetto`), come per stato e gettone. Endpoint:
`PATCH /api/customer-journey-items/:id/details`
con body `{ dataAttivazione?, pdvDestinazione?, imei?, rata? }` (valori `null`
o stringa vuota azzerano il campo).

## Ordinamento lista

La lista delle schede cliente ha un selettore di ordinamento con 4 chiavi —
**Data apertura**, **Nome cliente**, **% completamento** (driver attivati/6) e
**Valore cliente** — più un toggle crescente/decrescente. L'ordinamento è
client-side sulla lista già filtrata (ricerca + privato/business) e si riflette
anche negli export PDF/Excel (l'ordine corrente è incluso nella label del
filtro). Il **valore cliente** è la somma degli `importo` degli item della
journey, calcolata lato server in `getCustomerJourneyValues` e allegata a ogni
scheda dalla route `GET /api/customer-journeys` come campo `valore`; in card è
mostrato formattato in euro (0 ⇒ "—").

## Export PDF/Excel (Task #179)

Dal dettaglio di una journey i pulsanti **PDF** e **Excel** esportano il
riepilogo Driver + la tabella Contratti. L'indicatore di categoria di ogni
driver è coerente con la UI: nel PDF è la stessa icona lucide (rasterizzata
in PNG via `renderToStaticMarkup` → canvas), nell'Excel è l'emoji equivalente
(SheetJS non incorpora immagini nelle celle). La mappatura icona↔driver è
centralizzata in `client/src/lib/customerJourneyIcons.ts`
(`CJ_DRIVER_ICONS` + `CJ_DRIVER_EMOJI`), unica fonte per UI ed export. La
logica di export sta in `client/src/lib/customerJourneyExport.ts`.

## Dati di esempio (stato al 19/06/2026)

Al momento il tenant ha vendite solo Apr–Mag 2026 (tutte **precedenti** alla
trigger date 01/07/2026): il reconcile restituisce quindi `0` journey. È il
comportamento atteso finché non arrivano vendite dal 01/07/2026.

## Schema

- `profiles.bisuiteAddetti` (`text[]`).
- `customer_journeys` — unique `(organizationId, customerKey)`.
- `customer_journey_items` — unique `(organizationId, bisuiteSaleId, bisuiteArticleId)`.

Vedi `shared/schema.ts` e l'engine `reconcileCustomerJourneys` in
`server/storage.ts`.
