# Incentivazione interna (gare addetto)

Modulo dentro il menù **Performance** per gestire le gare incentivanti
per singolo addetto, convertito dal prototipo HTML
`dashboard_gara_giugno2026`. Combina due fonti dati:

1. **Valenze piste** — caricate da Excel (parse client-side via SheetJS).
2. **Accessori / Servizi live** — aggregati lato server dalle vendite
   BiSuite del periodo.

Modulo abilitabile per organizzazione con chiave
`incentivazione_interna` (super_admin bypassa sempre). Rotta SPA
`/incentivazione-interna`.

## Concetti

- **Sezione** (`Section`): una gara per operatore × tipologia. Le 4 di
  default rispecchiano il prototipo: `ss_w3`, `sm_w3` (W3) e `ss_vdf`,
  `sm_vdf` (VodafoneBusiness). Ogni sezione ha `op` (operatore),
  `label`, `base` (premio base €), `ready` (regolamento disponibile) e
  un elenco di **piste**.
- **Pista** (`Track`): un obiettivo con `target`, `unit`, flag:
  - `isLock` — lucchetto **bloccante**: concorre allo "sblocco gara".
  - `sub` — sotto-pista, non incide sullo stato complessivo.
  - `live` — valore preso dal connettore BiSuite (Accessori/Servizi),
    non dall'Excel.
  - `excelCol` — lettera colonna Excel per il mapping valenze. Quando
    assente, `parseValenzeAoa` prova un match per keyword sull'header (le
    colonne con header vuoto — es. il separatore — vengono saltate, mai
    catturate dal fallback).

### Mapping valenze Vodafone Store Specialist

Il file punti mensile Vodafone SS (`report_valenze`, foglio "Riepilogo")
ha un layout fisso: `A=Addetto`, `B=PISTA MOBILE`, `C=PISTA FISSO`,
`D=PISTA CB`, `E=ENERGIA FASTWEB`, `F=PISTA TNP (SOLO VIS)`,
`G=PISTA IVA`, `H=TOTALE PISTE CONSUMER`, colonna separatrice vuota,
poi le colonne "Proiezione". La sezione `ss_vdf` mappa via `excelCol`
**solo le 5 piste a punteggio** (`mobile_pt→B`, `fisso_pt→C`,
`energia→E`, `tnp→F`, `iva_voci→G`); CB (D) e Totale piste consumer (H)
sono esclusi di proposito. Le sotto-piste a pezzi (`fisso_pz`,
`mobile_pz`, `iva_fissi`) e i conteggi `live` arrivano da BiSuite e NON
sono nel file punti.
- **Calendario** (`buildCalendar`): giorni lavorativi del mese (esclusi
  weekend e festività italiane), con `el`/`tot`/`rem`, `pct` e `mult`
  (moltiplicatore di proiezione `tot/el`).
- **Semaforo** (`g|a|r|u`): per ogni pista, confronto tra valore
  **proiettato** (`projV`) e target → verde (raggiunto), ambra
  (raggiungibile a fine mese), rosso (a rischio), grigio (assente).
- **Sblocco gara**: un addetto "proietta sblocco" quando ha almeno un
  lucchetto e **tutti** i lucchetti bloccanti sono `g` o `a`
  (`unlockProjected`). Il contatore "🔓 Sblocco gara" è cliccabile e
  filtra la lista.

## Configurazione admin (in-app, per mese, multi-gara)

Tutta la config è **editabile in-app da admin/super_admin** e
persistita per `org + mese + anno + nome`. Dal Task #273 possono
coesistere **più configurazioni (gare) con nome** nello stesso periodo:

- la gestione avviene nella tab **"Incentivazione"** della pagina
  **Configurazione Gara** (`/configurazione-gara`, raggiungibile anche
  dal bottone "Configura" della dashboard incentivazione; la tab
  compare solo se il modulo `incentivazione_interna` è abilitato):
  elenco per periodo, **crea** (con nome, opzionalmente copiando le
  regole da una gara esistente), **duplica**, **rinomina**, **elimina**,
  **modifica regole** (stesso editor di prima, ora per-configurazione);
- il nome è unico (case-insensitive) per `org+mese+anno` (409 in caso
  di duplicato); le righe pre-esistenti sono migrate col nome di
  default **"Gara"**;
- nella dashboard, se il mese ha più di una gara compare un **selettore
  di configurazione** accanto a mese/anno (per tutti i ruoli); la prima
  gara creata (la più vecchia) è quella predefinita;
- le **valenze Excel restano per `org+mese+anno+sezione`**, condivise
  tra tutte le gare del periodo (eliminare una gara non le tocca).

L'editor regole permette di:

- modificare le **categorie connettore** Accessori (`catAcc`, default
  `[13,3]`) e Servizi (`catServ`, default `[4,27]`) — sono `categoria.id`
  BiSuite;
- per ogni sezione: toggle `ready`, `base` €, e CRUD piste
  (nome, target, unità, colonna Excel, flag lock/sub/live).

Le **festività** vengono calcolate automaticamente (fisse + Pasquetta
via algoritmo di Gauss) e usate come default; sono persistite nella
config e modificabili a livello dati.

Quando non esiste config salvata per il periodo si usa
`defaultConfig(year)` (fedele al prototipo).

## Isolamento per operatore

`GET /api/incentivazione/dashboard/:month/:year` filtra valenze e dati live
in base al ruolo:

- `admin` / `super_admin` → vedono tutti gli addetti dell'org;
- `operatore` → solo gli addetti presenti nei propri `bisuite_addetti`
  (match case-insensitive via `normN`). **Filtro `null` = admin** (vede
  tutto); **array vuoto = nessun dato** (mai leak del tenant), come per
  Customer Journey.

## API

Tutte sotto `requireModule("incentivazione_interna")`; le mutazioni
richiedono `requireAdminRole`.

- `GET /api/incentivazione/config?month&year` → `{ config, updatedAt, isDefault }`
  (legacy: opera sulla **prima** config del periodo).
- `PUT /api/incentivazione/config` (admin) — body `{ month, year, config }`
  (legacy: aggiorna la prima config del periodo, o la crea col nome default).
- `GET /api/incentivazione/configs[?month&year]` (admin) → elenco
  `{ id, month, year, name, updatedAt, createdAt }`.
- `GET /api/incentivazione/configs/:id` (admin) → dettaglio con `config`
  normalizzata.
- `POST /api/incentivazione/configs` (admin) — body
  `{ month, year, name, sourceId? | config? }`; `sourceId` duplica le
  regole di una gara esistente; nome duplicato nel periodo → 409.
- `PATCH /api/incentivazione/configs/:id` (admin) — body
  `{ name?, config? }` (rinomina e/o aggiorna regole).
- `DELETE /api/incentivazione/configs/:id` (admin).
- `GET /api/incentivazione/dashboard/:month/:year[/:configId]` →
  `{ config, calendar, valenze, live, lastBisuiteSync, configId,
  configName, configs }` (filtrato per operatore). Senza `:configId`
  usa la prima gara del periodo; `configId` sconosciuto → 404;
  `configs` = `[{ id, name }]` del periodo (alimenta il selettore).
  `lastBisuiteSync` = `max(bisuite_sales.last_seen_at)` dell'org
  (data dell'ultima sincronizzazione vendite dal connettore; `null` se nessuna
  vendita), mostrata nel riquadro Accessori/Servizi.
- `POST /api/incentivazione/valenze` (admin) — body
  `{ month, year, sectionId, fileName, rows }` (rows già parsate dal
  client via SheetJS).
- `DELETE /api/incentivazione/valenze?month&year&sectionId` (admin).

## Aggregazione Accessori/Servizi

`storage.aggregateAccessoriServizi(org, from, to, catAcc, catServ)`
somma `dettaglio.prezzo` degli articoli in `bisuite_sales.raw_data`
filtrando per `categoria.id` in `catAcc`/`catServ`, raggruppando per
`lower(trim(nome_addetto))`, escludendo le vendite ANNULLATA. Il
risultato è mergeato con le valenze Excel da `buildEmps` sulle piste
con flag `live`.

## File chiave

- `shared/incentivazione.ts` — tipi + logica pura (default config,
  festività, calendario, parse Excel, compute semafori/sblocco).
- `server/storage.ts` — get/upsert config (legacy), CRUD multi-config
  (`listIncentivazioneConfigs`, `getIncentivazioneConfigById`,
  `create/update/deleteIncentivazioneConfig`), list/upsert/delete
  valenze, `aggregateAccessoriServizi`.
- `server/routes.ts` — gli endpoint sopra.
- `client/src/pages/IncentivazioneInterna.tsx` — dashboard (period
  picker, selettore gara, tab sezioni, calendario, upload valenze, card
  riepilogo, card addetti, filtri, contatore sblocco gara).
- `client/src/pages/IncentivazioneConfigAdmin.tsx` — sezione admin
  `IncentivazioneConfigSection`, embeddata come tab "Incentivazione"
  in `/configurazione-gara` (elenco gare per periodo, crea/
  duplica/rinomina/elimina, editor regole).
- Tabelle: `incentivazione_config` (unique `org+month+year+name`),
  `incentivazione_valenze` (unique `org+month+year+sectionId`).
