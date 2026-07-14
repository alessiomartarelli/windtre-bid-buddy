# Mapping canvass Vodafone / Fastweb

Modulo di **categorizzazione** delle vendite BiSuite per le offerte
**canvass Vodafone/Fastweb**, separato e indipendente dalla mappatura
WindTre (`bisuite_mapping` / regole `shared/bisuiteMapping.ts`).

Obiettivo: dato il codice articolo di una vendita BiSuite, ricavare
**pista → categoria → tipologia → canone → brand** consultando il listino
canvass del periodo, più la consultazione degli **step di vendita** (le
domande dello script commerciale per pista).

Fuori scope (per scelta di task): integrazione con dashboard gara /
incentivazione, motori di calcolo Energia/Assicurazioni/Verisure, modifica
della tassonomia WindTre.

## Sorgenti dati

Due Excel forniti per il periodo (attualmente **LUGLIO 2026**):

- **Listino** — 306 offerte. Colonne chiave: codice, nome etichetta, pista,
  categoria, tipologia, canone.
- **Step di vendita** — 76 domande, ciascuna legata a una pista.

### Struttura del codice offerta

Ogni codice è di **12 caratteri**: `CAN` + `offerId`(5) + `edizione`(4
cifre).

- Il **codice completo** è univoco (306/306).
- L'**offerId centrale** (5 char) è anch'esso univoco → usato come fallback
  quando cambia solo il suffisso edizione.
- Il suffisso a 4 cifre **varia per offerta**: NON è un'edizione condivisa.
  (Assunzione iniziale errata, poi corretta.)

## Catalogo baked + import

Il default deployato è il **catalogo baked** `shared/canvassCatalog.ts`
(`CANVASS_CATALOG`), rigenerabile dagli Excel con:

```bash
node scripts/generate-canvass-catalog.mjs <listino.xlsx> <step.xlsx>
```

Lo script legge i buffer con `XLSX.read(buf,{type:"buffer"})` (in ESM
`XLSX.readFile` non esiste) e riscrive `shared/canvassCatalog.ts`.

Un **super_admin** può "importare" il catalogo baked in `system_config`
(chiave `canvass_reference`) tramite il pulsante **Importa catalogo**: è un
**upsert idempotente** (re-import = sovrascrittura, non duplica). L'engine e
le route usano `system_config` se presente, altrimenti il baked.

L'aggiornamento mensile del listino si fa **dalla UI** (Task #303, solo
super_admin): la card "Carica listino aggiornato" legge i due Excel nel
browser (`xlsx`, nessun `multer`), li converte con
`buildCanvassReferenceFromRows` e li salva via
`POST /api/admin/canvass-catalog/import` con body `{ reference }` (zod).
Le colonne dei fogli sono validate PRIMA del salvataggio con
`validateCanvassColumns` (Task #305): colonne mancanti/sbagliate =>
messaggio d'errore con l'elenco delle colonne e salvataggio bloccato; il
server rifiuta comunque con 400 un reference senza offerte. Il pulsante
"Ripristina catalogo di sistema" (Task #306) rimuove l'override e torna al
baked.

## Engine puro — `shared/canvassMapping.ts`

Funzioni pure, senza dipendenze da server/DB/React:

- `normalizeCodice` — uppercase, niente spazi.
- `extractOfferId` — 5 char centrali di `CAN·····dddd` (null se forma non
  valida o suffisso non numerico).
- `deriveBrandFromPista` — `FASTWEB` nella pista → `fastweb`, altrimenti
  `vodafone` (incluse `ENERGIA VODAFONE`, `VERISURE`).
- `buildCanvassIndex` — costruisce `byCodice`, `byOfferId`, `byCatTip`.
  Le coppie **categoria|tipologia ambigue** (presenti in più piste) sono
  **escluse** da `byCatTip` per non introdurre match errati. Coppia ambigua
  nota: `FASTWEB ENERGIA | LUCE FASTWEB` (in 2 piste).
- `categorizeCanvassArticle` — match in cascata: **codice esatto → offerId →
  categoria/tipologia → null**.
- `aggregateCanvassSales` — aggrega le vendite per pista/categoria/tipologia
  (pezzi + canone), lista `items`, elenco `unmapped` (per codice), conteggi
  `matchCounts` per tipo di match.
- `groupStepsByPista` — raggruppa e ordina gli step per pista.

## API (gate modulo `mappatura_bisuite`)

| Metodo | Route | Ruolo | Descrizione |
|---|---|---|---|
| GET  | `/api/admin/canvass-catalog` | super_admin/admin | Listino + step raggruppati per pista + `source` (`saved`/`default`). |
| POST | `/api/admin/canvass-catalog/import` | super_admin | Con body `{reference}`: salva il listino caricato da UI (zod). Senza body: upsert idempotente del baked in `system_config`. |
| POST | `/api/admin/canvass-catalog/reset` | super_admin | Rimuove l'override caricato e torna al catalogo baked. |
| GET  | `/api/admin/canvass-mapped-sales` | super_admin (qualsiasi org) / admin (propria org) | Categorizza le vendite dell'org per `month`/`year`. |

**Brand gating**: `canvass-mapped-sales` applica la categorizzazione solo
alle org con brand **Vodafone** e/o **Fastweb** associato; le altre org
ricevono `hasCanvassBrand:false` e aggregati vuoti (in prod le org canvass
sono tipo *phone&phone*; il dev ha solo "Cms Group" WindTre).

## UI — pagina admin

`client/src/pages/CanvassVodafoneFastweb.tsx`, route
`/canvass-vodafone-fastweb` (gate `mappatura_bisuite`), voce di navigazione
**Canvass VF** (admin/super_admin). Tre tab:

- **Listino** — tabella offerte con filtro pista + ricerca codice/nome.
- **Step di vendita** — card per pista con l'elenco ordinato delle domande.
- **Vendite categorizzate** — selettore org (super_admin), navigazione
  mese/anno, KPI, tabella per pista/categoria/tipologia e elenco codici non
  mappati.

Pagina **read-only** (l'unica azione di scrittura è l'import catalogo, per
super_admin).

## Validazione dev

La categorizzazione end-to-end su org reali **non è verificabile in dev**:
le org Vodafone/Fastweb esistono solo in **produzione** (il DB dev ha solo
"Cms Group", WindTre). La logica è coperta dai test puri.

## Test

Suite pura `tests/canvass-mapping.test.mjs` (17 test) via
`scripts/run-canvass-mapping-tests.sh` — validation/workflow
`canvass-mapping-tests`. Non richiede né dev server né DB (moduli TS via
loader `tsx`).

Suite authz `tests/canvass-authz.test.mjs` (3 scenari, Task #302) via
`scripts/run-canvass-authz-tests.sh` — validation `canvass-authz-tests`:
operatore => 403 su tutte le route, admin limitato alla propria org e senza
import/reset, import senza offerte => 400. Richiede app attiva + DB.

Vedi `docs/testing.md`.
