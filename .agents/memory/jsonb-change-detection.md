---
name: jsonb change detection
description: Comparing jsonb values from Postgres against fresh JS objects needs a key-order-insensitive serializer.
---

Rule: never detect "did this jsonb value change?" with a naive `JSON.stringify(a) !== JSON.stringify(b)` when one side was read back from a Postgres `jsonb` column.

**Why:** jsonb re-orders object keys (by length, then bytewise), so a round-tripped object stringifies differently from the original even when semantically identical. This produced false "changed" positives (e.g. spurious archive rows on every save) until replaced with a stable serializer.

**How to apply:** use a recursive serializer that sorts object keys before comparing (see the archive logic in `upsertOrgConfig`), or compare in SQL with `a::jsonb = b::jsonb`.
