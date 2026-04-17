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

### Production Deployment
- **Environment**: VPS with Nginx reverse proxy.
- **Base Path**: `/incentivew3` for all production assets and API calls.
- **Mechanism**: Client-side `BASE_PATH` constant and `apiUrl()` helper, server-side sub-app mounting, and base href injection for asset resolution.

## External Dependencies

- **PostgreSQL**: Primary database.
- **Replit Auth (OIDC)**: Authentication provider.
- **BiSuite Sales API**: External service for fetching sales data, configured per-organization with OAuth2 client credentials. Includes a global rules engine for mapping sales articles to competition categories.
- **Google Fonts CDN**: For custom fonts (Outfit, Inter).
- **npm packages**: `recharts` (charts), `jspdf` and `jspdf-autotable` (PDF export), `xlsx` (Excel export), `framer-motion` (animations), `date-fns` (date utilities), `zod` (validation).