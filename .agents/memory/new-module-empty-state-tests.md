---
name: New module breaks Home empty-state test
description: Adding a new non-brand-gated module makes it default-enabled and breaks the home-landing "Nessun modulo attivo" scenario.
---

Rule: every time a new module key is added to `MODULES` that is NOT
WindTre-gated, the home-landing UI test scenario "org without modules"
must explicitly disable it in the seeded org's `enabled_modules`
(pattern already used for vendite_bisuite/customer_journey/... after
Task #314).

**Why:** modules default to enabled when absent from `enabled_modules`,
so the new Home shortcut appears and `text-home-no-modules` never shows;
the suite fails with a timeout that looks unrelated to the new feature.

**How to apply:** when adding a module + Home shortcut, grep the
home-landing test for the `enabled_modules` JSON and add `<key>: false`.
