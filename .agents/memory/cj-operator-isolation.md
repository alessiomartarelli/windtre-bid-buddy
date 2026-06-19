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
