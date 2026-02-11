# Replit.md

## Overview

This is a **WindTre sales quoting/estimating platform** ("Preventivatore") built for telecom retail operators in Italy. The application allows organizations to create, configure, and manage sales forecasts ("preventivi") across multiple product lines: Mobile, Fixed-line (Fisso), Energy, Insurance (Assicurazioni), Partnership Rewards, Protecta, and Extra Gara P.IVA. Each product line has its own calculation engine with thresholds, bonuses, and point systems tied to WindTre's incentive structures.

The platform supports multi-tenant organizations with role-based access (super_admin, admin, operatore), where each organization manages its own set of retail points of sale (PDV - Punti di Vendita) with per-store configurations including calendars, clusters, and sales targets.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (React + Vite)
- **Framework**: React with TypeScript, bundled by Vite
- **Routing**: `wouter` (lightweight router, not React Router)
- **State Management**: TanStack React Query for server state; local React state and custom hooks for form/wizard state
- **UI Components**: shadcn/ui (new-york style) with Radix UI primitives, Tailwind CSS for styling
- **Charts**: Recharts for data visualization in dashboards
- **Path Aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`
- **Key Design Patterns**:
  - Multi-step wizard pattern for the Preventivatore (quote builder) with ~15+ steps
  - Complex calculation engines in `client/src/lib/calcolo*.ts` files handle business logic for each product line (Mobile, Fisso, Energia, Assicurazioni, Partnership, Protecta, Extra Gara)
  - Local storage persistence via `use-preventivatore-storage` hook for saving wizard state between sessions
  - Remote config sync via `useOrganizationConfig` hook with debounced auto-save

### Backend (Express + Node.js)
- **Framework**: Express.js with TypeScript, run via `tsx` in dev
- **Architecture**: Monolithic server serving both API routes and the Vite-built SPA
- **API Pattern**: RESTful JSON APIs under `/api/*` prefix
- **Build**: esbuild for server bundling, Vite for client; output to `dist/`
- **Server entry**: `server/index.ts` creates HTTP server, registers routes, serves static files in production or Vite dev middleware in development

### Authentication
- **Method**: Replit Auth via OpenID Connect (OIDC)
- **Session Storage**: PostgreSQL-backed sessions using `connect-pg-simple`
- **Auth Flow**: Passport.js with OIDC strategy; sessions stored in `sessions` table
- **User Management**: Profiles auto-created on first login, linked to organizations
- **Role System**: Three roles - `super_admin` (manages all orgs), `admin` (manages their org's users), `operatore` (standard user)
- **Important**: There are two auth hook files - `useAuth.ts` (custom fetch-based, primary) and `use-auth.ts` (React Query-based, secondary/legacy). The main app uses `useAuth.ts`.

### Database
- **Database**: PostgreSQL (required, provisioned via Replit)
- **ORM**: Drizzle ORM with `drizzle-zod` for schema validation
- **Schema Location**: `shared/schema.ts`
- **Key Tables**:
  - `sessions` - Auth session storage
  - `organizations` - Multi-tenant org support
  - `profiles` - User profiles linked to Replit Auth and organizations
  - `preventivi` - Saved quotes with JSONB `data` column storing all calculation state
  - `organization_config` - Per-org configuration (PDV setup, thresholds, calendars) stored as JSONB
- **Migrations**: `drizzle-kit push` for schema sync (no migration files workflow)
- **Storage Layer**: `server/storage.ts` implements `IStorage` interface with `DatabaseStorage` class

### External Integrations
- **BiSuite API**: Integration for fetching sales data from an external system (endpoint at `http://85.94.215.97/api/v1/sales/full`), configured per-organization with client credentials
- **PDF Generation**: `jsPDF` with `jspdf-autotable` for exporting quotes
- **Excel Export**: `xlsx` library for spreadsheet generation
- **Google Fonts**: Outfit (display) and Inter (body) font families

### Business Logic Architecture
The calculation engines are the core of the application, located in `client/src/lib/`:
- `calcoliMobile.ts` - Mobile line point/premium calculations with threshold tiers
- `calcoloPistaFisso.ts` - Fixed-line calculations with 5-tier thresholds
- `calcoloPartnershipReward.ts` - Partnership reward with target-based bonuses
- `calcoloEnergia.ts` - Energy contract commissions with per-category rates
- `calcoloAssicurazioni.ts` - Insurance product point/premium calculations
- `calcoloProtecta.ts` - Protecta insurance product calculations
- `calcoloExtraGaraIva.ts` - Extra competition P.IVA calculations with multi/mono-POS thresholds

Each engine takes per-PDV configurations and activated volumes, returning structured results with breakdowns by product, threshold reached, and total premiums.

## External Dependencies

- **PostgreSQL**: Primary database, connected via `DATABASE_URL` environment variable
- **Replit Auth (OIDC)**: Authentication provider, uses `ISSUER_URL`, `REPL_ID`, and `SESSION_SECRET` environment variables
- **BiSuite Sales API**: External sales data API at `http://85.94.215.97/api/v1/sales/full`, configured per-organization with `clientId` and `clientSecret`
- **Google Fonts CDN**: Outfit, Inter, DM Sans, Fira Code, Geist Mono, Architects Daughter fonts
- **npm packages of note**: `recharts` (charts), `jspdf` + `jspdf-autotable` (PDF export), `xlsx` (Excel export), `framer-motion` (animations), `date-fns` (date formatting with Italian locale), `zod` (validation)