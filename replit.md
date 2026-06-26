# Replit.md

## Overview

WindTre sales quoting/estimating platform ("Preventivatore") per operatori
retail telecom italiani. Crea, configura e gestisce preventivi su varie linee
prodotto: Mobile, Fisso, Energia, Assicurazioni, Partnership Rewards,
Protecta, Extra Gara P.IVA. Ogni linea ha il suo motore di calcolo allineato
agli incentivi WindTre (soglie, bonus, punti). Multi-tenant con ruoli
`super_admin`, `admin`, `operatore` e config per-store (PDV) con calendari,
cluster, target.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React + TypeScript, bundle Vite.
- **Routing**: `wouter`.
- **State**: TanStack React Query per server state; React state + custom hooks per UI.
- **UI**: `shadcn/ui` (New York) + Radix UI + Tailwind CSS. Glassmorphism globale.
- **Charts**: Recharts.
- **Pattern**: wizard multi-step, motori di calcolo per linea, localStorage per stato wizard, sync remota della config.

### Backend
- **Framework**: Express.js + TypeScript.
- **Architettura**: server monolitico con REST JSON + serve frontend SPA.
- **Build**: esbuild (server), Vite (client).

### Authentication
- **Method**: Replit Auth via OIDC.
- **Session**: PostgreSQL via `connect-pg-simple`.
- **Auth Flow**: Passport.js con OIDC strategy.
- **User**: profili auto-creati al primo login, legati a organizzazioni con ruoli `super_admin`/`admin`/`operatore`.

### Database
- **DB**: PostgreSQL.
- **ORM**: Drizzle ORM + `drizzle-zod`.
- **Tabelle chiave**: `sessions`, `organizations`, `profiles`, `preventivi` (quotes JSONB), `organization_config` (config per-org JSONB), `gara_config` (config gara per-org/per-mese JSONB), `bisuite_sales`, `drms_uploads`, `cdg_*` (Controllo di Gestione).
- **Migrations**: `drizzle-kit push`.

### Business Logic
- Motori di calcolo in `client/src/lib/`: `calcoliMobile.ts`,
  `calcoloPistaFisso.ts`, `calcoloEnergia.ts`, ecc. Gestiscono punti,
  soglie, bonus per linea prodotto.
- Config calcoli centralizzata via UI "Tabelle Calcolo": gerarchia di
  default di sistema + override per organizzazione.

### Production Deployment
- **VPS**: 85.215.124.207 con Nginx reverse proxy, app su porta 3001.
- **Base Path**: `/incentivew3` per assets e API.
- **Directory VPS**: `/var/www/incentive-w3/` (con trattino!). NON `/var/www/incentivew3/`.
- **PM2**: usa il **nome** `incentive-w3` (id storico 0, oggi 13 dopo un `pm2 delete`+`start` necessario per ricaricare env). Riferirsi sempre al nome, non all'id, perché può cambiare. NEVER toccare pm2 id 9 (easycashflows) o 12 (protecta).
- **Env vars di prod**: caricate da `/var/www/incentive-w3/ecosystem.config.cjs` (NON da `.env` — l'app non usa dotenv). Per modificarle: editare ecosystem + `pm2 delete incentive-w3 && pm2 start ecosystem.config.cjs && pm2 save`. Variabili presenti: `NODE_ENV`, `PORT=3001`, `DATABASE_URL`, `SESSION_SECRET`, `SMTP_SECRET_KEY` (chiave AES per cifrare password SMTP e `client_secret` BiSuite — **mai cambiarla**, altrimenti i segreti cifrati nel DB diventano illeggibili).
- **Deploy**: usa `scripts/deploy-prod.sh` (richiede `VPS_PASSWORD`). Lo script: build → tar → scp → **sync schema sul DB di prod via tunnel SSH (`drizzle-kit push`) PRIMA del restart** → swap dist → `pm2 restart incentive-w3 --update-env`. Lo step di schema sync evita i 500 "column does not exist" che si presentavano quando il `db:push` post-merge in dev non veniva replicato in prod.
- **Deploy manuale (fallback)**: `npm run build` → `tar czf /tmp/incentivew3-deploy.tgz -C dist public index.cjs` → scp → ssh: `cd /var/www/incentive-w3 && rm -rf dist_old && mv dist dist_old && mkdir dist && tar xzf /tmp/incentivew3-deploy.tgz -C dist && pm2 restart incentive-w3 --update-env`. Se il deploy include modifiche a `shared/schema.ts`, applica anche a mano le ALTER/CREATE sul DB prod (`PGPASSWORD=… psql -U incentive_w3 -d incentive_w3 -h localhost`).
- **Mechanism**: client `BASE_PATH` constant + `apiUrl()` helper, server sub-app mounting, base href injection.
- **Backup DB prod (Task #153)**: sorgenti in repo:
  `scripts/incentive-w3-backup.sh` (lo script che gira sul VPS) e
  `scripts/install-prod-backup.sh` (deploy idempotente — richiede
  `VPS_PASSWORD` + `sshpass`, carica lo script in
  `/usr/local/bin/incentive-w3-backup.sh`, scrive
  `/etc/incentive-w3-backup.env` mode 600 con `PGPASSWORD`, garantisce
  la riga di crontab). Cron root `30 3 * * *` esegue `pg_dump` del
  **solo** db `incentive_w3` (NON tocca easycashflows pm2 id 9 né
  protecta pm2 id 12) in
  `/var/backups/incentive-w3/incentive_w3_YYYYMMDD_HHMMSS.sql.gz` con
  retention 7 giorni (`find -mtime +7 -delete`) e log su
  `backup.log`. Verifica post-install eseguita Task #153:
  `ls -lh` mostra `incentive_w3_20260515_152151.sql.gz` da 15M (ben
  >1MB), log `dump complete, size=15457480 bytes` + `done`.
  Restore: `gunzip -c <file>.sql.gz | PGPASSWORD=… psql -U incentive_w3 -d <target> -h localhost`.
  Run manuale: `ssh root@85.215.124.207 /usr/local/bin/incentive-w3-backup.sh`.

## Documentazione di dettaglio

Le seguenti aree dell'app hanno documentazione separata in `docs/` per
mantenere snello questo file:

- [`docs/prima-nota-iva.md`](docs/prima-nota-iva.md) — Regole IVA e
  classificazione articoli per il registro corrispettivi.
- [`docs/drms-commissioning.md`](docs/drms-commissioning.md) — Dashboard
  DRMS Commissioning (admin), parsing Excel WindTre, classificazione
  capitoli, API.
- [`docs/controllo-gestione.md`](docs/controllo-gestione.md) — Modulo
  spese (CdG): RS/PDV/Categorie/Fornitori multi-RS, IVA, ricorrenze,
  allegati, write-through su org config.
- [`docs/moduli-organizzazione.md`](docs/moduli-organizzazione.md) —
  Sistema dei moduli abilitabili per organizzazione
  (`enabledModules`, `requireModule`, `<ModuleRoute>`).
- [`docs/struttura-organizzazione.md`](docs/struttura-organizzazione.md) —
  CRUD RS/PDV admin con propagazione cross-modulo, banner sync
  incongruenze, wizard storage scoping per orgId.
- [`docs/bisuite-mapping-tied-iva.md`](docs/bisuite-mapping-tied-iva.md) —
  Mapping offerte SIM P.IVA (TIED IVA) → categorie Extra Gara IVA,
  inventario completo descrizioni.
- [`docs/analisi-finplan.md`](docs/analisi-finplan.md) — Tab Analisi
  (FinPlan Studio) embeddato in Amministrazione, persistenza per-org
  via `finplan_data`.
- [`docs/vendite-bisuite.md`](docs/vendite-bisuite.md) — Data vendita
  dalle API BiSuite, esclusione default delle vendite ANNULLATA, filtro
  Stato nella pagina Vendite BiSuite.
- [`docs/customer-journey.md`](docs/customer-journey.md) — Modulo Customer
  Journey: cross-sell per cliente da nuova attivazione mobile (≥01/07/2026),
  driver attivati/attivabili, stati item, gettone manuale, addetti per
  operatore, gap campi BiSuite, reconcile automatico al load (le vendite già
  scaricate da altre pagine compaiono senza "Rigenera", via watermark).
- [`docs/incentivazione-interna.md`](docs/incentivazione-interna.md) —
  Modulo Incentivazione interna (gare addetto): valenze piste da Excel +
  Accessori/Servizi live BiSuite, config admin per-mese (sezioni/piste/
  lucchetti/base/categorie), calendario lavorativo, sblocco gara,
  isolamento per operatore.

## Testing

- **FinPlan sync tests** (`tests/finplan-sync.test.mjs`): 5 scenari
  post-cutover Task #148: (1) PUT/GET autenticato round-trip,
  (2) latest-wins su PUT consecutivi (mirror del debounce React),
  (3) preflight GET conflict-guard, (4) route legacy `/api/finplan/preload(/status)`
  + super-admin `finplan-preload` + `/finplan/index.html` ⇒ 404 (no SPA
  fallback), (5) setup wizard gating (`!updatedAt && !dismissed`).
  Lanciali via lo step di validation registrato `finplan-tests`
  (`bash scripts/run-finplan-tests.sh`). Lo script aspetta fino a 30s che
  l'app sia raggiungibile su `localhost:5000`, quindi richiede che il
  workflow "Start application" sia già attivo. Run completo in ~1s.
- **Customer Journey authz tests** (`tests/customer-journey-authz.test.mjs`):
  2 scenari security-critical (Task #160) sull'isolamento per-operatore:
  (1) `GET /api/customer-journeys` filtrata per ruolo — admin/super_admin
  vedono tutte le journey dell'org, operatore senza addetti ⇒ 0 (no
  leakage del tenant), operatore con addetto corrispondente ⇒ solo la sua
  (match case-insensitive); (2) `GET /api/customer-journeys/:id` enforce
  l'ownership — proprietario ⇒ 200, non proprietario / operatore senza
  addetti ⇒ 403, admin ⇒ 200 su qualunque journey. La route rilegge il
  profilo ad ogni richiesta, così i test mutano `role`/`bisuite_addetti`
  dello stesso profilo signup per coprire i vari ruoli. Lanciali via lo
  step di validation `cj-authz-tests`
  (`bash scripts/run-customer-journey-authz-tests.sh`); richiede il
  workflow "Start application" attivo. Run completo in ~1s.
- **Admin role/org boundary tests** (`tests/admin-authz.test.mjs`):
  2 scenari security-critical (Task #211) che bloccano la regressione dei
  controlli aggiunti in Task #207 contro l'escalation di ruolo/org da parte
  di un admin di tenant. (1) `POST /api/admin/create-user` fatta da un admin:
  `role="super_admin"` forzato nel payload ⇒ 403 e nessun super_admin creato;
  un `organization_id`/`organizationId` di un'altra org nel payload viene
  ignorato e l'utente è creato nella org dell'admin. (2)
  `POST /api/admin/bisuite-api` con un `organization_id` di un'altra org ⇒
  403 per l'admin (cross-org negato), mentre il super_admin supera il
  controllo cross-org e raggiunge il lookup credenziali (400 perché la org
  estranea non ha credenziali BiSuite ⇒ prova che non è bloccato dal vincolo
  di org). Stessa strategia degli altri authz test: signup admin + cookie, la
  route rilegge il profilo ad ogni richiesta quindi si muta `role` via
  `setRole`; una seconda org "estranea" è creata via SQL per i tentativi
  cross-org e ripulita nel `finally`. Lanciali via lo step di validation
  `admin-authz-tests` (`bash scripts/run-admin-authz-tests.sh`); richiede il
  workflow "Start application" attivo. Run completo in ~1s.
- **Customer Journey reconcile tests** (`tests/customer-journey-reconcile.test.mjs`):
  4 scenari (Task #164 + Task #180) sul reconcile.
  Setup: signup admin + org, inserisce una vendita BiSuite (`bisuite_sales`)
  con un'attivazione mobile (categoria UNTIED, `data_vendita ≥ 01/07/2026`,
  innesca la journey) e due dispositivi TELEFONIA finanziati (IMEI + RATA
  derivati). Guida `reconcileCustomerJourneys` e PATCH dettagli via HTTP,
  legge lo stato finale degli item dal DB. (1) i 4 campi manuali (DATA
  ATTIVAZIONE, PDV DESTINAZIONE, IMEI, RATA) salvati via
  `updateCustomerJourneyItemDetails` (`details_manual = true`) NON vengono
  sovrascritti da un reconcile successivo anche se cambiano IMEI/importo
  finanziato della vendita; (2) gli item NON modificati a mano vengono
  comunque aggiornati con IMEI/RATA derivati da BiSuite (ramo `ELSE excluded`).
  (3) cliente AZIENDA (GIURIDICA, keyed by piva): la journey salva
  `nominativo`/`ragione_sociale` dal CLIENTE (non dall'addetto vendita) e
  ogni item conserva `addetto` = addetto vendita; (4) cliente PRIVATO
  (FISICA): regressione che la journey salvi Nome+Cognome del cliente e
  l'item l'addetto distinto. Gli scenari 3-4 (Task #180) proteggono il fix
  Task #178 che separa l'anagrafica journey dall'addetto per-item.
  Lanciali via lo step di validation `cj-reconcile-tests`
  (`bash scripts/run-customer-journey-reconcile-tests.sh`); richiede il
  workflow "Start application" attivo. Run completo in ~4s.
- **Customer Journey timeline tests**
  (`tests/customer-journey-timeline.test.mjs`): 16 test sulla logica pura del
  tracciamento temporale della scheda cliente (Task #185/#186). La logica è
  stata estratta dal componente React in `client/src/lib/customerJourneyTimeline.ts`
  (solo `import type`, nessun import a runtime) così è caricabile via loader
  `tsx` senza dev server né DB. Coprono i rami delicati: (1) contratti senza
  alcuna data ⇒ timeline vuota (`empty`); (2) driver sconosciuto ⇒ fallback
  colore grigio `cjDriverColor` + nessun crash; (3) rilevamento T0 — trigger
  BiSuite (`triggerSaleId`/`triggerBisuiteId`), fallback prima attivazione
  mobile, fallback primo evento in assoluto, `openedAt` esplicito; (4) stati
  ko/stornato/annullato attenuati (`isFadedState`); (5) asse mesi esteso oltre
  T0–T6 (eventi dopo T6 e prima di T0) + label mese a cavallo d'anno;
  (6) raggruppamento per PDV (destinazione→origine→N/D) ordinato per conteggio;
  (7) `itemEventDate` (attivazione→inserimento→null, data malformata ⇒ null).
  Lanciali via lo step di validation `cj-timeline-tests`
  (`bash scripts/run-customer-journey-timeline-tests.sh`). Run completo in ~1s.
- **Customer Journey export (PDF/Excel) tests**
  (`tests/customer-journey-export.test.mjs`): 26 test sulla logica pura di
  costruzione righe/colonne degli export (Task #190). La logica è stata
  estratta da `client/src/lib/customerJourneyExport.ts` in
  `shared/customerJourneyExport.ts` (import RELATIVI, niente runtime
  jsPDF/xlsx/react) così è caricabile via loader `tsx` senza dev server né DB;
  il file di rendering ora consuma quei builder. Coprono: (1) helper di
  formattazione (`fmtDate` it-IT/"—", `journeyTitle` azienda↔privato con
  fallback, `safeFileName`/`detailFileBase`, `driverLabel`/`itemStateLabel`/
  `itemDescription` con fallback, `rataCanone` con canone escluso per
  `telefono`, `activeDriverCount`, `detailMeta` CF↔P.IVA); (2) dettaglio —
  `driverTableHead/Body` (ordine `CJ_DRIVER_ORDER`, col 0 vuota nel PDF vs
  emoji nell'Excel), `contractsHead/Body` (12 colonne, PDV destinazione→origine,
  gettone Sì/No), `detailExcelHeaderRows`; (3) elenco — `listSubtitle`/
  `listExcelHeaderRows` con `filterLabel` opzionale, `listPdfHead/Body`
  (5 colonne fisse + driver, "Si"/""), `listExcelHead/Body` (colonna Telefono +
  emoji, "Sì"/""). I test bloccano le differenze volute di shape fra PDF ed
  Excel così che un cambio accidentale alle colonne non rompa silenziosamente
  gli export. Lanciali via lo step di validation `cj-export-tests`
  (`bash scripts/run-customer-journey-export-tests.sh`). Run completo in ~1s.
- **Incentivazione interna tests** (`tests/incentivazione.test.mjs`):
  18 test sulla logica pura di `shared/incentivazione.ts` (gare addetto nel
  tempo). Sono funzioni pure: NON serve né dev server né DB, il modulo TS è
  caricato via loader `tsx`. Coprono: (1) `buildCalendar` per mese futuro
  (regressione del bug dei giorni trascorsi != 0 ⇒ el/mult/pct = 0),
  corrente (el parziale, mult = tot/el) e passato (el == tot, pct 100), più
  l'esclusione delle festività infrasettimanali; (2) `projV` (proiezione
  lineare con guard su valore nullo ed `el === 0`); (3) `semOf` (semaforo
  g/a/r/u inclusi i casi limite); (4) `buildEmps` con `unlockProjected`
  (sblocco gara solo se TUTTI i lucchetti sono g|a), il caso senza dati, il
  merge dei dati live BiSuite e l'ordinamento per stato; (5) `colIdx` (lettera
  colonna ⇒ indice 0-based) e `parseValenzeAoa` (lettura file Excel valenze) sia
  con AOA sintetici sia sul file REALE. Casi sintetici: mapping per `excelCol`
  esplicita (template W3), fallback per keyword sull'header (template Vodafone,
  prefisso "Pista " ignorato), scarto righe Totale/Media/senza nome, parsing con
  virgola decimale ("1,5" ⇒ 1.5), celle vuote/assenti ⇒ null e celle non
  numeriche ⇒ 0. Caso REALE (fixture stabile `tests/fixtures/valenze-w3.xlsx`,
  foglio "Riepilogo"): verifica il layout header, il mapping per-posizione delle
  8 piste W3 con `excelCol` (col B–H + J), che la col J sia "Extra Marginalità"
  (non più "Smartphone") e che separatore vuoto, 2ª "PISTA FISSO" (col I) e le 9
  colonne "Proiezione" siano ignorati. Lanciali via lo step
  di validation `incentivazione-tests`
  (`bash scripts/run-incentivazione-tests.sh`). Run completo in ~1s.
- **Incentivazione Accessori/Servizi live tests**
  (`tests/incentivazione-accessori-servizi.test.mjs`): 4 scenari DB-backed
  (Task #174) su `aggregateAccessoriServizi` (`server/storage.ts`), il
  conteggio live Accessori/Servizi BiSuite per addetto nelle gare addetto.
  È DB-backed ma NON passa dall'HTTP: chiama direttamente la funzione di
  storage via loader `tsx`, usando lo stesso pool `pg` del server per
  inserire le vendite di test (crea org al volo, niente signup). Richiede
  solo `DATABASE_URL`, non il dev server. Coprono: (1) somma per addetto
  separata catAcc vs catServ su più vendite (una sola riga per addetto);
  (2) esclusione delle vendite ANNULLATA dalle somme; (3) addetto con sole
  categorie non mappate ⇒ acc/serv = 0 e vendite fuori intervallo di date
  escluse del tutto; (4) più addetti distinti con grouping case-insensitive
  sul nominativo (le grafie diverse dello stesso addetto si fondono).
  Lanciali via lo step di validation `incentivazione-accservizi-tests`
  (`bash scripts/run-incentivazione-accessori-servizi-tests.sh`). Run
  completo in ~5s.
- **Customer Journey reportistica + filtri condivisi tests**
  (`tests/customer-journey-report.test.mjs`): 28 test sulla logica pura di
  `shared/customerJourney.ts` (Task #189 + Task #192). Sono funzioni pure: NON serve né
  dev server né DB, il modulo TS è caricato via loader `tsx`. La pagina
  Customer Journey ha due viste ("Schede clienti" e "Reportistica") che
  condividono gli stessi filtri (tipo cliente, negozio/PDV, addetto, stato,
  ricerca); la logica era inline in `CustomerJourney.tsx` ed è stata estratta
  in shared per essere testabile e usata da entrambe le viste. Coprono:
  (1) `CJ_ACTIVE_STATES` (gli stati che contano come "attivati");
  (2) `aggregateReport` per dimensione negozio/addetto/cliente — `clienti` =
  journey distinte (Set su journeyId, non item), `contratti` = numero item,
  `attivati` = item in stato attivo (ko/annullato/stornato esclusi), `valore`
  = somma importi; ordinamento per valore↓ poi contratti↓ poi label (it),
  tie-break e input vuoto ⇒ []; (3) `cjSearchMatches` (ricerca
  case-insensitive, vuota ⇒ match); (4) `matchesCjFilters` — predicato
  condiviso che agisce sia su una journey (array di facet PDV/addetti/stati,
  match per `includes`) sia su una riga report (singolo valore wrappato in
  array), filtri "tutti" = nessun vincolo, combinazione AND, facet vuoti
  esclusi da filtro specifico; (5) coerenza schede/report: stesso predicato,
  granularità journey vs item. Task #192 aggiunge 10 test sull'analisi
  gettoni cross-sell: (6) `gettoneForPiste` (tabella a scaglioni
  `[0,20,30,40,100,120]`, clamp 0..5, round dei decimali, NaN ⇒ 0);
  (7) `buildGettoneJourneys` (piste = driver NON-mobile distinti in stato
  attivo, energia gas/luce conta una volta, stati ko/annullato/stornato non
  contano, attribuzione pdv/addetto dalla SIM mobile con fallback al primo
  item); (8) `filterGettoneByDate` (coorte per data attivazione SIM, estremi
  inclusi, solo-from/solo-to/nessun range, journey senza `openedAt` passa solo
  senza limiti); (9) `aggregateGettone` (somma fatturato + potenziale alla
  saturazione, ordinamento per fatturato↓, la saturazione scala solo il
  potenziale e viene clampata a 0..100); (10) `gettoneTotals` + input vuoto.
  (11) `simSaturationPct` (% saturazione cross-sell per singola SIM =
  `pisteAttive/CJ_MAX_PISTE`, con clamp 0..100); (12) `gettoneDetailByKey`
  (dettaglio per riga PDV/addetto col click: clienti/SIM per gruppo + %
  saturazione, ordinati per saturazione↓). L'analisi gettoni aggrega solo per
  **negozio** o **addetto** (la dimensione "ragione sociale/cliente" è stata
  rimossa). Lanciali via lo step di validation
  `cj-report-tests` (`bash scripts/run-customer-journey-report-tests.sh`).
  Run completo in ~1s.
- **Customer Journey Analisi gettoni UI tests**
  (`tests/customer-journey-gettone-ui.test.mjs`): 3 scenari Playwright
  (Task #194 + Task #195) sulle tabelle report interattive. A
  differenza dei test puri, questo guida un vero browser headless (chromium
  di sistema via Nix + `playwright-core`) per proteggere il rendering React
  che la logica pura non copre: il toggle `useState` che apre/chiude la
  sotto-tabella in `AnalisiView` e la proiezione delle colonne (Cliente /
  SIM attive / Piste attive / % saturazione / Fatturato). Setup: signup
  admin+org, poi semina DIRETTAMENTE via SQL due journey con item (mobile
  attiva + cross-sell) — deterministico e con pieno controllo su
  driver/stato/PDV/addetto, così i valori attesi (Mario: 2 piste ⇒ 40%
  saturazione / 30€; Luigi: 1 pista ⇒ 20€) sono prevedibili; la vista
  gettone consuma comunque l'output di `/api/customer-journeys/report`,
  identico al percorso reconcile (già coperto altrove). I PDV sono nomi
  univoci per evitare collisioni di test-id nella dimensione negozio. Il
  cookie di sessione viene iniettato nel context Playwright. Coprono:
  (1) admin — Analisi gettoni: espande la riga **addetto** E la riga
  **negozio/PDV** (`button-gettone-dim-negozio`, Task #195), verifica per
  entrambe i valori aggregati e la sotto-tabella (nome cliente, %
  saturazione, piste 2/5, intestazioni), poi le richiude
  (`row-gettone-detail-*` rimossa); (2) operatore con `bisuite_addetti`
  associato a un solo addetto — vede SOLO la propria riga, niente leakage
  dell'altro addetto; (3) admin — tab **"Dettaglio"** (ReportView,
  Task #195): verifica che le righe aggregate `row-report-*` rendano i
  valori attesi (label/clienti/contratti/attivi) e che il selettore di
  dimensione (`button-report-dim-*`) cambi il grouping a runtime
  (negozio⇒addetto, le righe PDV spariscono). Task #199 aggiunge 2 scenari
  che verificano il wiring dei filtri condivisi con le tabelle renderizzate
  (la logica pura del predicato è già coperta da `cj-report-tests`):
  (4) il filtro Negozio/PDV (`select-filter-negozio`) applicato via il
  controllo `<Select>` restringe SIA la tab Dettaglio (la riga PDV non
  selezionata sparisce) SIA l'Analisi gettoni — il filtro è condiviso fra le
  viste — e `button-reset-filters` ripristina tutte le righe; (5) il filtro
  per data attivazione SIM dell'Analisi gettoni
  (`input-gettone-date-from`/`input-gettone-date-to`) restringe la coorte:
  due journey seminate con `opened_at` (T0) a marzo vs gennaio, un "dal
  2026-02-01" tiene solo marzo, un "al 2026-02-01" solo gennaio,
  `button-gettone-reset-date` ripristina entrambe. Lo scenario 5 sfrutta il
  parametro `openedAt` aggiunto a `seedJourney` in `tests/helpers/uiTest.mjs`.
  Cleanup completo del dev DB alla fine. Lanciali via lo step di validation `cj-gettone-ui-tests`
  (`bash scripts/run-customer-journey-gettone-ui-tests.sh`); richiede il
  workflow "Start application" attivo, `DATABASE_URL` e chromium di sistema.
  Run completo in ~25s.

## External Dependencies

- **PostgreSQL**: database primario.
- **Replit Auth (OIDC)**: provider autenticazione.
- **BiSuite Sales API**: servizio esterno per fetch vendite, configurato
  per-organizzazione con OAuth2 client credentials. Include rules engine
  globale per il mapping articoli → categorie gara.
- **Google Fonts CDN**: font Outfit, Inter.
- **npm packages chiave**: `recharts` (charts), `jspdf` + `jspdf-autotable`
  (PDF export), `xlsx` (Excel export), `framer-motion` (animations),
  `date-fns` (date utilities), `zod` (validation).
