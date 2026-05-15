# Tab Analisi — FinPlan Studio

Tab dentro Amministrazione che monta la **shell React** di FinPlan Studio
(`<FinplanApp>`) come default, con persistenza per-organizzazione su un
blob JSONB su Postgres. L'iframe HTML standalone storico è stato rimosso
nel cutover finale (Task #148): la storia del file
`client/public/finplan/index.html` resta in git per riferimento.

## File coinvolti

- `client/src/components/finplan/FinplanApp.tsx` — shell React principale
  (CompanyNav 5 RS + Consolidato, sezioni Overview / Costi & Incassi /
  Transazioni / Mensile / IVA / Obiettivi / Proiezioni / Debiti /
  Categorie / Budget / Personale / Partitari / CdG per PDV / Consolidato).
- `client/src/components/finplan/sections/*` — singole sezioni montate
  da `<FinplanApp>` come tab interni.
- `client/src/lib/finplan/*` — motori di calcolo (proiezioni,
  partitari, personale, ecc.).
- `client/src/hooks/useFinplan.ts` — hook React Query per
  GET/PUT `/api/finplan` (debounce 3s, conflict guard, latest-wins).
- `client/src/pages/Amministrazione.tsx` — `TabKey` `analisi` con
  `<TabsTrigger>`. La shell `<FinplanApp>` è lazy-loaded e montata
  appena il tab viene attivato (gating: setup wizard se org vergine).
- `shared/schema.ts` — tabella `finplan_data` (`organization_id` UNIQUE,
  `data` JSONB, `updated_by`, `updated_at`).
- `server/storage.ts` — `getFinplanData(orgId)` /
  `upsertFinplanData(orgId, data, updatedBy)`.
- `server/routes.ts` — `GET /api/finplan` e `PUT /api/finplan`,
  più `GET /api/finplan/preload(/status)` per le org allowlistate
  (Cms Group). Tutti `isAuthenticated` + `requireModule(["amministrazione",
  "controllo_gestione"])`.

## Persistenza

`useFinplanData(orgId)` fa GET autenticato di `/api/finplan` e ritorna
`{ snapshot, parsed, updatedAt, isLoading, isError }`. `useFinplanMutation`
espone `scheduleSave(snapshot)` con debounce 3s e conflict guard
server-authoritative (preflight `GET /api/finplan` per confrontare
`updatedAt`).

Niente più shim VM-loaded da HTML statico, niente più `localStorage` come
canale di sync remota: il salvataggio passa SEMPRE per `/api/finplan` PUT
e React Query invalida la cache dopo ogni mutation. `localStorage` resta
solo per memorizzare la tab attiva (`finplan_react_active__org_<orgId>`)
e i flag di dismiss del setup wizard.

## Sicurezza e limiti

- Le route usano `isAuthenticated + requireModule(["amministrazione",
  "controllo_gestione"])`: stesso gate della pagina Amministrazione.
  `super_admin` bypassa il check come nel resto del sistema.
- Scoping per organizzazione: la riga è univoca per `organization_id`,
  nessuna possibilità di vedere/scrivere dati di altre org.
- Limite payload server-side: 12 MB per `JSON.stringify(data)`. Oltre
  → HTTP 413. La `express.json` globale è già a 50 MB.
- Il blob è opaco lato server: nessuna validazione di forma, nessuna
  trasformazione. Sicuro perché reso solo a chi appartiene all'org.

## PRELOAD multi-tenant (Cms Group only)

Il file `server/data/finplan-preload.json` (~5 MB) contiene i dati
finanziari REALI di Cms Group (movimenti CC, transazioni, debiti delle
5 società del gruppo). È vincolato a un'allowlist di organizzazioni —
gli altri tenant non vedono mai un solo byte:

- **Endpoint gated**: `GET /api/finplan/preload`
  (`isAuthenticated` + `requireModule(["amministrazione",
  "controllo_gestione"])`). Solo gli `organization_id` abilitati via
  flag DB (`organizations.finplanPreloadEnabled`) o presenti in
  `FINPLAN_PRELOAD_ORGS` (`server/routes.ts`) ricevono 200 + JSON;
  gli altri 204. Default allowlist env: `["org-admin-windtre"]`.
  Override via env `FINPLAN_PRELOAD_ORGS=csv,di,org,id` senza redeploy.
  Risposta autorizzata: ETag + `Cache-Control: private, must-revalidate`
  + supporto `If-None-Match` → 304 (cache in-memory mtime-based,
  niente rilettura di 5 MB ad ogni request).
- **File statico server-only**: vive in `server/data/` (fuori da
  `client/public/`), così non viene mai esposto da Vite/Nginx.
  Lo script `scripts/deploy-prod.sh` lo copia in `dist/server-data/`
  prima del tar; il resolver in `server/routes.ts` cerca in entrambi i
  path (dev = repo root, prod = `dist/server-data/`).
- **Status check leggero**: `GET /api/finplan/preload/status` risponde
  `{ hasPreload: boolean }` senza body pesante. Usato dal setup wizard
  in `Amministrazione.tsx` per decidere se mostrarsi: per le org Cms
  Group (`hasPreload: true`) il wizard non appare mai.

## Setup wizard

`FinPlanSetupWizard` (`client/src/components/FinPlanSetupWizard.tsx`)
viene mostrato al posto della shell React la prima volta che un'org
senza preload e senza dati FinPlan apre il tab Analisi. Si dismette
via "Salta" o al completamento del salvataggio (flag in localStorage
scoped per orgId: `finplan_setup_done__org_<orgId>` /
`finplan_setup_skipped__org_<orgId>`).

Predicato `finplanNeedsSetup` (replica testata in
`tests/finplan-sync.test.mjs` scenario 4):
```
wizard mostrato sse !hasPreload && !updatedAt && !dismissed
```

## Test (`tests/finplan-sync.test.mjs`)

4 scenari, run via `bash scripts/run-finplan-tests.sh` (richiede il
workflow "Start application" attivo):

1. PUT/GET autenticato round-trip su `/api/finplan` (path che la shell
   React percorre via `useFinplan`).
2. Preload gating: org NON allowlisted → 204; senza auth → 401/403.
3. Preload allowlistato: 200 + JSON; conditional GET con `If-None-Match`
   → 304.
4. Setup wizard gating: (a) fresh org → wizard, (b) allowlisted preload
   → no wizard, (c) org con dati salvati → no wizard.

Lo script `scripts/run-finplan-tests.sh` aspetta fino a 30s che l'app
risponda su `localhost:5000` (probe su `/api/auth/user`, qualsiasi HTTP
code != 000 indica server pronto).

## Note operative

- Aggiornamenti alla shell React: edit normale di
  `client/src/components/finplan/*` + `client/src/lib/finplan/*`. HMR
  via Vite, nessun reload manuale.
- Il file `server/data/finplan-preload.json` è server-only: NON metterlo
  in `client/public/` (lo esporrebbe via Nginx).
