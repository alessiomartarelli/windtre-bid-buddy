# Replit.md

## Overview

**MyStoreDesk** (ex "Incentive W3") — piattaforma di gestione punto vendita
per operatori retail telecom italiani (brand visibile: "MyStoreDesk"; i nomi
tecnici di prod restano `incentive-w3`/`incentivew3`). Crea, configura e gestisce preventivi su varie linee
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

## Production Deployment

Sintesi — il dettaglio operativo completo (deploy script, quality gate,
cache, backup, logrotate) è in [`docs/deploy-prod.md`](docs/deploy-prod.md).

- **VPS**: 85.215.124.207, Nginx reverse proxy, app su porta 3001, base
  path `/mystoredesk` (il vecchio `/incentivew3` è solo redirect 301).
- **Directory VPS**: `/var/www/incentive-w3/` (con trattino!). NON
  `/var/www/incentivew3/`.
- **PM2**: riferirsi sempre al **nome** `incentive-w3` (l'id può
  cambiare). NEVER toccare easycashflows (id 9), protecta (id 12),
  easystripe (id 14).
- **Env vars di prod**: in `/var/www/incentive-w3/ecosystem.config.cjs`
  (NON `.env` — l'app non usa dotenv). `SMTP_SECRET_KEY` è la chiave AES
  dei segreti cifrati nel DB — **mai cambiarla**.
- **Deploy**: `scripts/deploy-prod.sh` (richiede `VPS_PASSWORD`): quality
  gate (test puri + integration, bypass `SKIP_QUALITY_GATE=1` /
  `SKIP_INTEGRATION_TESTS=1`) → build → precompressione asset → scp →
  schema sync sul DB prod via tunnel SSH → swap dist → pm2 restart.
- **Backup DB prod**: cron 03:30 con retention 7 giorni; **rotazione log**
  via logrotate (copytruncate). Procedure e restore in
  `docs/deploy-prod.md`.

## Documentazione di dettaglio

Le seguenti aree dell'app hanno documentazione separata in `docs/` per
mantenere snello questo file:

- [`docs/deploy-prod.md`](docs/deploy-prod.md) — Deploy e gestione
  produzione: script di deploy, quality gate pre-deploy (step 1a/1b),
  cache anti-pagina-bianca, backup DB, rotazione log.
- [`docs/testing.md`](docs/testing.md) — Dettaglio completo di tutte le
  suite di test (scenari coperti, setup, prerequisiti).
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
- [`docs/telegram-report.md`](docs/telegram-report.md) — Report vendite
  giornaliero su Telegram: bot per-org (token cifrato), scheduler
  13:30/22:30 Europe/Rome, aggregati condivisi con Vendite BiSuite,
  report HTML navigabile allegato, API admin + card di config, test puri.
- [`docs/incentivazione-interna.md`](docs/incentivazione-interna.md) —
  Modulo Incentivazione interna (gare addetto): valenze piste da Excel +
  Accessori/Servizi live BiSuite, config admin per-mese multi-gara
  (più configurazioni con nome per periodo, pagina admin dedicata
  `/incentivazione-interna/config`, selettore in dashboard), calendario
  lavorativo, sblocco gara, isolamento per operatore.

## Testing

Il dettaglio completo di ogni suite (scenari, setup, prerequisiti) è in
[`docs/testing.md`](docs/testing.md). Ogni suite è uno step di validation
registrato e fa parte del quality gate pre-deploy (step 1a = pure,
1b = integration; vedi `docs/deploy-prod.md`).

Riepilogo — suite → script → prerequisiti:

| Suite | Script | Prerequisiti | Run |
|---|---|---|---|
| FinPlan sync (5) | `run-finplan-tests.sh` | app attiva | ~1s |
| CJ authz (2) | `run-customer-journey-authz-tests.sh` | app attiva | ~1s |
| Admin authz (4) | `run-admin-authz-tests.sh` | app attiva | ~1s |
| CJ reconcile (4) | `run-customer-journey-reconcile-tests.sh` | app attiva | ~4s |
| CJ trigger date | `run-customer-journey-trigger-date-tests.sh` | app attiva | ~1s |
| CJ timeline (16) | `run-customer-journey-timeline-tests.sh` | — (puri) | ~1s |
| CJ badge↔gettone parity (8) | `run-customer-journey-validity-gettone-parity-tests.sh` | — (puri) | ~1s |
| CJ export PDF/Excel (26) | `run-customer-journey-export-tests.sh` | — (puri) | ~1s |
| CJ report + filtri (28) | `run-customer-journey-report-tests.sh` | — (puri) | ~1s |
| Telegram report (70) | `run-telegram-report-tests.sh` | — (puri) | ~1s |
| Incentivazione (18) | `run-incentivazione-tests.sh` | — (puri) | ~1s |
| Inc. Acc/Servizi live (4) | `run-incentivazione-accessori-servizi-tests.sh` | `DATABASE_URL` | ~5s |
| Inc. dashboard authz | `run-incentivazione-dashboard-authz-tests.sh` | app attiva | ~1s |
| CJ gettone UI (5, Playwright) | `run-customer-journey-gettone-ui-tests.sh` | app + DB + chromium | ~25s |
| Inc. sort UI (2, Playwright) | `run-incentivazione-sort-ui-tests.sh` | app + DB + chromium | ~25s |
| Type-check | `run-typecheck.sh` | — (statico) | ~10-20s |
| Integration orchestrator | `run-deploy-integration-tests.sh` | `DATABASE_URL` | ~70-90s |

Lancio: `bash scripts/<script>` oppure via lo step di validation omonimo.
"App attiva" = workflow "Start application" su `localhost:5000`.

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
