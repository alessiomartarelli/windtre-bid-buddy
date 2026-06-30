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

## Configurazione admin (in-app, per mese)

Tutta la config è **editabile in-app da admin/super_admin** e
persistita per `org + mese + anno`. Il dialog "Configura" permette di:

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

- `GET /api/incentivazione/config?month&year` → `{ config, updatedAt, isDefault }`.
- `PUT /api/incentivazione/config` (admin) — body `{ month, year, config }`.
- `GET /api/incentivazione/dashboard/:month/:year` →
  `{ config, calendar, valenze, live, lastBisuiteSync }` (filtrato per
  operatore). `lastBisuiteSync` = `max(bisuite_sales.last_seen_at)` dell'org
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
- `server/storage.ts` — get/upsert config, list/upsert/delete valenze,
  `aggregateAccessoriServizi`.
- `server/routes.ts` — i 5 endpoint sopra.
- `client/src/pages/IncentivazioneInterna.tsx` — UI (period picker, tab
  sezioni, calendario, upload valenze, card riepilogo, card addetti,
  filtri, contatore sblocco gara, dialog config admin).
- Tabelle: `incentivazione_config`, `incentivazione_valenze`
  (unique `org+month+year[+sectionId]`).
