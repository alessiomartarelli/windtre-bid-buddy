# Replit.md

## Overview

This project is a WindTre sales quoting/estimating platform ("Preventivatore") designed for Italian telecom retail operators. Its core purpose is to enable organizations to create, configure, and manage sales forecasts ("preventivi") across various product lines: Mobile, Fixed-line, Energy, Insurance, Partnership Rewards, Protecta, and Extra Gara P.IVA. Each product line incorporates its own calculation engine, aligning with WindTre's incentive structures through thresholds, bonuses, and point systems. The platform supports multi-tenant organizations, offering role-based access (super_admin, admin, operatore) and per-store configurations for retail points of sale (PDV), including calendars, clusters, and sales targets.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React with TypeScript, bundled by Vite.
- **Routing**: `wouter`.
- **State Management**: TanStack React Query for server state; local React state and custom hooks for UI state.
- **UI Components**: `shadcn/ui` (New York style) with Radix UI primitives and Tailwind CSS for styling. Glassmorphism is applied globally.
- **Charts**: Recharts for data visualization.
- **Design Patterns**: Multi-step wizard for quote building, complex calculation engines for each product line, local storage persistence for wizard state, and remote config synchronization.

### Backend
- **Framework**: Express.js with TypeScript.
- **Architecture**: Monolithic server providing RESTful JSON APIs and serving the frontend SPA.
- **Build**: esbuild for server, Vite for client.

### Authentication
- **Method**: Replit Auth via OpenID Connect (OIDC).
- **Session Storage**: PostgreSQL-backed sessions using `connect-pg-simple`.
- **Auth Flow**: Passport.js with OIDC strategy.
- **User Management**: Profiles auto-created on first login, linked to organizations with `super_admin`, `admin`, and `operatore` roles.

### Database
- **Database**: PostgreSQL.
- **ORM**: Drizzle ORM with `drizzle-zod` for schema validation.
- **Key Tables**: `sessions`, `organizations`, `profiles`, `preventivi` (quotes with JSONB data), `organization_config` (per-org config as JSONB), `gara_config` (per-org, per-month competition config as JSONB).
- **Migrations**: `drizzle-kit push` for schema synchronization.

### Business Logic
- Core calculation engines are located in `client/src/lib/`, handling product-specific point/premium calculations, thresholds, and bonuses (e.g., `calcoliMobile.ts`, `calcoloPistaFisso.ts`, `calcoloEnergia.ts`).
- Centralized configuration for calculation parameters is managed via the "Tabelle Calcolo" UI, leveraging a hierarchy of system defaults and organization-specific overrides.

### Prima Nota IVA (Amministrazione)
The Amministrazione → Prima Nota IVA tab uses two key rules to derive a fiscally
correct VAT register from BiSuite sales:
- **Article filter**: only `art.tipo === "P"` (Prodotti) and `art.tipo === "S"`
  (Servizi) are included. `tipo === "C"` (Canvass / Contracts: MIA TIED, ENERGIA
  W3, FIBRA CF, ASSICURAZIONI, etc.) are procurement contracts billed separately
  and are excluded from the receipt-based VAT register.
- **Aliquota derivation**: the BiSuite `dettaglio.aliquotaPrezzo` field is NOT the
  VAT percentage — it has variable semantics (sometimes an internal code, sometimes
  the VAT amount in euros). The actual aliquota is computed as
  `(importoScontrino − importoImponibile) / importoImponibile × 100`, then snapped
  to the nearest Italian standard rate (4 / 5 / 10 / 22%) within ±0.5 pp.
  See `classifyIvaArticolo` and `isArticoloFiscale` in `client/src/lib/incassoUtils.ts`.
- Rows with `dettaglio.natura` (N1–N7) are grouped separately as non-imponibile /
  esente / fuori campo IVA. Rows with scontrino > 0 but imponibile = 0 are
  flagged "Da verificare" and excluded from VAT totals.

### DRMS Commissioning Dashboard
Admin-only section under `/drms-commissioning` for analyzing the WindTre DRMS
(Estratto conto provvigionale) Excel exported monthly. Uploads are persisted in
the `drms_uploads` table per organization+month (latest wins via overwrite
confirm on conflict). Logic:
- Excel parsing (SheetJS) is client-side: reads sheet `Estratto conto`, detects
  the period from the most frequent `COMPETENZA` value (e.g. "MAR-26"), then
  classifies every row across 13 capitoli (Energia, Mobile, Fisso, Partnership
  Reward, CB, PR Assicurazioni, Extra PR Energia, Assicurazioni, Reload, SOS
  Caring, PR Reload, Pinpad, Ass. Tecnica). Unmatched rows fall into "Altro".
- Classification rules in `client/src/lib/drmsClassifier.ts`:
  `classificaRiga(row, periodComp)` evaluates 9 ordered rules — ASSTTCN,
  PR Reload set, PR Assicurazioni, SOS Caring, special PC ADJUSTMENT MANUALI
  override (regex against DESCRIZIONE_ITEM), PR Customer Base set (in-period
  → Partnership Reward, out-of-period → Extra PR Energia), Reload set,
  CB attivazione for Mobile/Fisso non-PR, then base TIPO_FONIA mapping.
- 4 dashboard tabs: Overview (KPI + ripartizione), Matrix (PV × capitolo
  heatmap), Driver (drill-down per capitolo), PV (search + per-store metriche
  Mobile incl. Tied/Untied/MNP/MIB/soglia and Fisso incl. FTTH/FWA/LNA/LA/
  convergenti/soglia, deduplicato sui contratti contrattuali in periodo).
- API: GET `/api/drms` (list), GET `/api/drms/by-period?month&year`, GET
  `/api/drms/:id`, POST `/api/drms` (409 + `existingId` on conflict, accepts
  `overwrite=true`), DELETE `/api/drms/:id`. All gated by `requireAdminRole`
  with org-ownership check.

### Production Deployment
- **Environment**: VPS 85.215.124.207 with Nginx reverse proxy, app on port 3001.
- **Base Path**: `/incentivew3` for all production assets and API calls.
- **VPS directory**: `/var/www/incentive-w3/` (con trattino!). NON `/var/www/incentivew3/`.
- **PM2 process**: id 0 (`incentive-w3`). NEVER touch pm2 id 9 (easycashflows) o 10 (protecta).
- **Deploy recipe**: `npm run build` → `tar czf /tmp/incentivew3-deploy.tgz -C dist public index.cjs` → `scp` su VPS → ssh: `cd /var/www/incentive-w3 && rm -rf dist_old && mv dist dist_old && mkdir dist && tar xzf /tmp/incentivew3-deploy.tgz -C dist && pm2 restart 0 --update-env`.
- **Mechanism**: Client-side `BASE_PATH` constant and `apiUrl()` helper, server-side sub-app mounting, and base href injection for asset resolution.

## External Dependencies

- **PostgreSQL**: Primary database.
- **Replit Auth (OIDC)**: Authentication provider.
- **BiSuite Sales API**: External service for fetching sales data, configured per-organization with OAuth2 client credentials. Includes a global rules engine for mapping sales articles to competition categories.
- **Google Fonts CDN**: For custom fonts (Outfit, Inter).
- **npm packages**: `recharts` (charts), `jspdf` and `jspdf-autotable` (PDF export), `xlsx` (Excel export), `framer-motion` (animations), `date-fns` (date utilities), `zod` (validation).