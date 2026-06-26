---
name: Test org cleanup leak
description: Why integration/UI test cleanup must delete every org-scoped child row before deleting the org
---

# Test org cleanup must delete ALL org-scoped children first

The shared `cleanupOrg` helper (signup-based integration/UI tests) runs each
`DELETE` with `.catch(() => {})` so it is safe inside `finally`. Because of
that, if it deletes the org while ANY org-scoped child row still references it,
the `DELETE FROM organizations` FK-fails (FKs are `NO ACTION`, not cascade),
the error is swallowed, and an **empty** test org leaks into the dev DB. This
is how dozens of `UITestOrg_*` / `CJGettoneUI_*` orgs (0 profiles) accumulated.

**Rule:** any test cleanup that removes an org must first delete from every
table with a `NO ACTION` FK to `organizations` (by `organization_id`), then the
org. Only `finplan_data` and `bisuite_sync_notifications` are `ON DELETE
CASCADE` and self-clean.

**Why:** silent `.catch` + non-cascade FKs turn a partial cleanup into a
permanent leak; tests pass but the DB rots.

**How to apply:** keep `cleanupOrg` in `tests/helpers/uiTest.mjs` as the single
cleanup path for signup-based suites; when a new org-scoped table is added to
`shared/schema.ts`, add it to that helper's child-table list. To find the full
set: query `information_schema` FKs referencing `organizations` and include
every `delete_rule = NO ACTION` table.
