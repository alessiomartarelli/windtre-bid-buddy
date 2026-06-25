---
name: Customer Journey operator isolation
description: How per-operator data filtering is encoded across route + storage, and the empty-array trap to avoid.
---

# Per-operator filtering: null vs empty array

Operators must see only customers linked to their own BiSuite "addetto"
names (`profiles.bisuiteAddetti`); admin/super_admin see the whole tenant.

The filter is encoded as a nullable string array passed from route to
storage:

- `null` / `undefined` => **no filter** (admin/super_admin, return everything).
- an array (even **empty**) => **operator filter**; an empty array means the
  operator has no addetto associations and MUST return `[]`.

**Why:** A `if (filter && filter.length > 0)` guard is wrong — it collapses
"empty operator array" into "no filter", leaking the full tenant to any
operator without an addetto mapping. Guard on `filter != null` instead, then
handle the empty-array case as "return []".

**How to apply:** Any new operator-scoped list/query (e.g. customer journeys,
bisuite-sales) must follow this null-vs-empty contract. Routes set
`role === "operatore" ? (bisuiteAddetti ?? []) : null`. Add an authz test for
the empty-mapping operator case.

**Regression coverage:** `tests/customer-journey-authz.test.mjs` (validation
step `cj-authz-tests`) locks the CJ list + detail authz. The incentivazione
gare-addetto dashboard (`GET /api/incentivazione/dashboard/:month/:year`) uses
the SAME contract on both `live` (Accessori/Servizi sums) and
`valenze[sectionId].rows` — covered by
`tests/incentivazione-dashboard-authz.test.mjs` (validation step
`inc-dashboard-authz-tests`). Test trick: signup makes an `admin` profile and
the route re-reads the profile every request, so the test mutates
`profiles.role` / `bisuite_addetti` on the same signup profile (same cookie) to
exercise admin / operatore(empty) / operatore(match) / super_admin without
multiple logins.

**Calendar gotcha (dashboard test):** `buildCalendar` clamps "now" inside the
selected month, so a future/current month yields a partial date window. To make
seeded BiSuite sales fall inside the live aggregation range, pick a month fully
in the past (the test uses the previous calendar month).

## Facet/metadata paths leak too
Any per-journey aggregate exposed on the list response (e.g. facet sets `pdvs`/`addetti`/`states` for filter dropdowns) must apply the SAME operator `addettiFilter` as the row query. A journey can hold items from multiple addetti, so fetching items by journeyId alone leaks another operator's PDV/addetto/state values even when the row-level list is already filtered.
**Why:** code review caught this on the report feature — list rows were filtered but the facet helper queried items by journeyId with no addetto filter.
**How to apply:** thread `addettiFilter` into every helper that reads `customer_journey_items` for an operator-visible response; empty array => return empty.
