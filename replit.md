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
