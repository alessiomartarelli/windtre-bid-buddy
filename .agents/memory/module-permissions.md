---
name: Per-user module permissions
description: How module visibility is resolved (org ∩ brand ∩ user) and a gotcha when authz-testing requireModule.
---

# Per-user module permissions

Module visibility/access is the intersection of three layers, all in
`shared/modules.ts` via `isModuleAccessible`:
`org (enabledModules) ∩ brand gating ∩ user whitelist (profiles.moduli_consentiti)`.
`super_admin` bypasses all three.

`profiles.moduli_consentiti` (`text[]`, nullable):
- `null` = no restriction (inherits org — retro-compat for existing users);
- array (incl. empty) = explicit whitelist. Empty ≠ "no restriction"; it means
  "no non-core modules". Always distinguish `null` from `[]` (same trap as
  cj-operator-isolation).

**Why:** whitelist must never accidentally open access when empty, and existing
users must keep seeing everything until an admin restricts them.

**How to apply:**
- Server `requireModule` ANDs `isModuleGrantedToUser` into its `.some()`.
- `update-user` clamps a granted list to the org∩brand perimeter via
  `sanitizeGrantableModules` (drops unknown keys, `superOnly`, org-disabled,
  brand-gated-without-brand) and 403s if the target is a super_admin.

**Authz-test gotcha:** when testing `requireModule` end-to-end, pick a gated
route whose handler role check your test session already satisfies. `/api/drms`
is gated on `drms_commissioning` BUT its handler also calls `requireAdminRole`,
so an `operatore` gets 403 from the handler (not the middleware) and you can't
tell the two apart. Use an `admin` session so only the module whitelist varies.
