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

## Brand gating (brand associati → moduli visibili)

Oltre a `enabledModules`, i moduli WindTre-specifici sono visibili solo se
l'org ha il brand WindTre associato (`organization_brands`). Lista in
`WINDTRE_GATED_MODULES` (`shared/modules.ts`): `simulatore`,
`tabelle_calcolo`, `gara_dashboard`, `gara_configurazione`,
`drms_commissioning`, `incentivazione_interna`, `vendite_bisuite`,
`customer_journey`.

- **Fallback sicuro**: org SENZA alcun brand associato ⇒ nessun filtro
  (comportamento pre-esistente). Il filtro scatta solo quando l'org ha
  almeno un brand ma NON WindTre.
- Match tollerante sul nome brand: `isWindtreBrandName()` riconosce
  "WindTre", "Wind Tre", "WIND3", "W3", ecc.
- Helper condiviso: `isModuleAllowedForBrands(brandNames, key)`, applicato
  sia nel middleware `requireModule` (server, con fetch brand solo se la
  chiave è gated) sia in `useEnabledModules()` (client, brand da
  `/api/user` → `organizationBrands` in `useAuth`).
- `super_admin` bypassa anche il brand gating.
- Test puri: `tests/brand-gating.test.mjs`
  (`scripts/run-brand-gating-tests.sh`).
