# Tab Analisi — FinPlan Studio

Tab dentro Amministrazione che monta la **shell React** di FinPlan Studio
(`<FinplanApp>`) come default, con persistenza per-organizzazione su un
blob JSONB su Postgres. Nel cutover finale (Task #148) sono stati rimossi:

- l'iframe HTML standalone (`client/public/finplan/index.html`, ~10k righe);
- il modulo `server/finplanStatic.ts` di static-serving compresso;
- le route `/api/finplan/preload` e `/api/finplan/preload/status`;
- la cache in-memory + il file `server/data/finplan-preload.json`;
- l'allowlist env `FINPLAN_PRELOAD_ORGS`;
- il flag DB `organizations.finplanPreloadEnabled` e la PUT super-admin
  `/api/super-admin/organizations/:id/finplan-preload`.

La storia di tutti questi file resta in git per riferimento.

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
  GET/PUT `/api/finplan` (debounce 3s, conflict guard server-authoritative,
  latest-wins).
- `client/src/pages/Amministrazione.tsx` — `TabKey` `analisi` con
  `<TabsTrigger>`. La shell `<FinplanApp>` è lazy-loaded e montata
  appena il tab viene attivato (gating: setup wizard se org vergine).
- `client/src/components/FinPlanSetupWizard.tsx` — wizard di import
  iniziale, mostrato al posto della shell la prima volta che un'org
  apre il tab Analisi senza dati salvati.
- `shared/schema.ts` — tabella `finplan_data` (`organization_id` UNIQUE,
  `data` JSONB, `updated_by`, `updated_at`).
- `server/storage.ts` — `getFinplanData(orgId)` /
  `upsertFinplanData(orgId, data, updatedBy)`.
- `server/routes.ts` — `GET /api/finplan` e `PUT /api/finplan`. Tutti
  `isAuthenticated` + `requireModule(["amministrazione",
  "controllo_gestione"])`.

## Persistenza

`useFinplanData(orgId)` fa GET autenticato di `/api/finplan` e ritorna
`{ snapshot, parsed, updatedAt, isLoading, isError }`. `useFinplanMutation`
espone `scheduleSave(snapshot)` con debounce 3s e conflict guard
server-authoritative (preflight `GET /api/finplan` per confrontare
`updatedAt` prima di sovrascrivere ciò che un'altra sessione ha scritto;
latest-wins via `pendingRef` per non perdere l'ultima versione su
unmount/flush).

Il salvataggio passa SEMPRE per `/api/finplan` PUT e React Query invalida
la cache dopo ogni mutation. `localStorage` resta solo per memorizzare
la tab attiva (`finplan_react_active__org_<orgId>`) e i flag di dismiss
del setup wizard.

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

## Setup wizard

`FinPlanSetupWizard` (`client/src/components/FinPlanSetupWizard.tsx`)
viene mostrato al posto della shell React la prima volta che un'org
apre il tab Analisi senza dati salvati. Si dismette via "Salta" o al
completamento del salvataggio (flag in localStorage scoped per orgId:
`finplan_setup_done__org_<orgId>` / `finplan_setup_skipped__org_<orgId>`).

Predicato `finplanNeedsSetup` (replica testata in
`tests/finplan-sync.test.mjs` scenario 5):

```
wizard mostrato sse !updatedAt && !dismissed
```

## Test (`tests/finplan-sync.test.mjs`)

5 scenari, run via `bash scripts/run-finplan-tests.sh` (richiede il
workflow "Start application" attivo):

1. PUT/GET autenticato round-trip su `/api/finplan` (path che la shell
   React percorre via `useFinplan`).
2. Latest-wins su PUT consecutivi: il secondo payload vince e
   `updatedAt` non regredisce.
3. Conflict-guard: il preflight GET osserva immediatamente l'ultimo PUT
   (canale che la shell React usa per evitare di clobberare scritture
   altrui).
4. Route legacy rimosse → 404 (`/api/finplan/preload`,
   `/api/finplan/preload/status`,
   `/api/super-admin/organizations/:id/finplan-preload`).
5. Setup wizard gating: (a) fresh org → wizard, (b) org con dati
   salvati → no wizard, (c) dismiss → no wizard.

Lo script `scripts/run-finplan-tests.sh` aspetta fino a 30s che l'app
risponda su `localhost:5000` (probe su `/api/auth/user`, qualsiasi HTTP
code != 000 indica server pronto).

## Note operative

- Aggiornamenti alla shell React: edit normale di
  `client/src/components/finplan/*` + `client/src/lib/finplan/*`. HMR
  via Vite, nessun reload manuale.
- Migrazione DB: la colonna `organizations.finplan_preload_enabled` è
  stata rimossa dallo schema; il deploy di prod la elimina via
  `drizzle-kit push` come parte di `scripts/deploy-prod.sh`.
