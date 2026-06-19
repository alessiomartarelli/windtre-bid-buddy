# Modulo Customer Journey (CJ)

Modulo per-org abilitabile (`customer_journey`) per il cross-sell strutturato
sui clienti che effettuano una **nuova attivazione mobile dal 01/07/2026**.
Per ogni cliente si apre una "journey" che mostra i driver già attivati e
quelli ancora attivabili, e traccia ogni contratto attraverso i suoi stati.

## Concetti

- **Journey**: una per cliente per organizzazione, identificata dalla
  `customerKey` (CF per i privati, P.IVA per le aziende, normalizzata
  uppercase/trim). Si apre quando il cliente fa una nuova attivazione mobile
  con data di vendita ≥ `2026-07-01` (`CJ_TRIGGER_DATE`).
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

La **formula del gettone NON è cablata** in questa fase. Ogni item ha solo un
flag di **conferma manuale** (`gettoneConfirmed`) con relativi
`gettoneConfirmedAt` / `gettoneConfirmedBy`. È l'unico punto di conferma
manuale previsto.

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
| GET | `/api/customer-journeys` | lista (operatore: filtrata sui suoi addetti) |
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

### Campi mancanti / inaffidabili (Fase 1)

Questi campi non sono forniti in modo affidabile dal connettore e restano
NULL/vuoti finché non arriva una sorgente migliore:

- **DATA ATTIVAZIONE**: il connettore espone solo `dataFine`; non è una vera
  data di attivazione → lasciata `null`.
- **PDV DESTINAZIONE**: non disponibile.
- **IMEI del telefono**: spesso assente nei `venditaInfo`.
- **RATA**: disponibile solo `importoFinanziato` (usato come `rata` solo per le
  vendite in finanziamento).

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
