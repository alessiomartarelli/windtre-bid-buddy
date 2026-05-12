# Moduli per organizzazione

Ogni `organizations.enabledModules` (jsonb) è un `Record<ModuleKey, boolean>`.
Chiave assente o `true` = modulo abilitato; `false` = disabilitato.
`super_admin` bypassa sempre i flag. Lista canonica delle chiavi (solo pagine
top-level, simulatore incluso come on/off unico) in `shared/modules.ts`.
Helper: `isModuleEnabled(record, key)`.

- API super-admin: `GET/PUT /api/super-admin/organizations/:id/modules`.
- Backend: `requireModule(key)` middleware (es. applicato a `/api/drms*`).
- Frontend: hook `useEnabledModules()`, componente `<ModuleRoute>` in
  `App.tsx` (redirect → `/` + toast), filtro voci in `AppNavbar.tsx`,
  dialog di gestione in `SuperAdminPanel.tsx` (`ModulesDialog`).
- Wizard `Preventivatore.tsx`: il modulo `simulatore` è on/off unico; non ci
  sono più flag per singolo prodotto. Logica `prod_*` legacy lasciata in
  `Preventivatore.tsx` come no-op (le chiavi non esistono più, quindi
  `isModuleEnabled` ritorna sempre true).
- `/admin`, `/super-admin`, `/profile`, `/dashboard` (sim) restano sempre core.
