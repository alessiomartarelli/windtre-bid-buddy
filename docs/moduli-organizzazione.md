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

## Permessi moduli per-utente (Task #311)

Oltre a org (`enabledModules`) e brand gating, ogni profilo può avere una
whitelist per-utente `profiles.moduli_consentiti` (`text[]`, nullable) gestita
dall'admin dell'org. La visibilità/accesso effettivo di un modulo è
l'intersezione: **org ∩ brand ∩ utente**.

- **Semantica del campo**:
  - `NULL` = nessuna restrizione: l'utente eredita i moduli dell'org
    (retro-compatibile; utenti pre-esistenti vedono tutto);
  - array (anche vuoto) = whitelist esplicita: solo le chiavi elencate. Un
    array vuoto significa "nessun modulo non-core", **non** "nessuna
    restrizione": distinguere sempre `null` da `[]`.
- `super_admin` bypassa tutto; i suoi permessi non sono modificabili
  (`update-user` con `moduliConsentiti` su un super_admin ⇒ 403).
- Helper condivisi in `shared/modules.ts`: `isModuleGrantedToUser(granted, key)`,
  `isModuleAccessible({isSuperAdmin, enabledModules, brandNames, moduliConsentiti, key})`
  e `sanitizeGrantableModules(requested, enabledModules, brandNames)` (filtra le
  richieste al perimetro org∩brand, esclude chiavi ignote e `superOnly`).
- Backend: `requireModule` interseca anche `moduliConsentiti`; `POST
  /api/admin/update-user` accetta un campo opzionale `moduliConsentiti`
  (`null` azzera, array = whitelist sanitizzata al perimetro org∩brand).
- Frontend: `useEnabledModules()` usa `isModuleAccessible` (`<ModuleRoute>` e
  `AppNavbar` ereditano); il dialog "Modifica Utente" in `AdminPanel.tsx` ha il
  toggle "Limita moduli visibili" + checkbox dei moduli concedibili.
- Test: puri + authz in `tests/module-permissions.test.mjs` e
  `tests/module-permissions-authz.test.mjs`
  (`scripts/run-module-permissions-tests.sh`).
