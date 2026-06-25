---
name: Customer Journey reconcile-on-load performance
description: Why reconcileCustomerJourneys must use batched upserts, and the constraint on auto-reconcile in the list endpoint.
---

# Reconcile-on-load must stay cheap

`GET /api/customer-journeys` auto-reconciles (stale-check via watermark) before
returning the list, so sales already in the DB appear without manual "Rigenera".
Because this runs on the page-load path, `reconcileCustomerJourneys` MUST be fast.

**Rule:** reconcile upserts journeys and items in **batched** multi-row
`INSERT ... ON CONFLICT DO UPDATE` (chunked ~500 rows to stay under Postgres'
65535 param limit), NOT one query per journey + one per item in a sequential
await loop.

**Why:** the original per-row loop did O(journeys + items) DB round-trips. For a
real org that is hundreds/thousands of sequential queries; once it ran on the
list-load path it made the schede painfully slow.

**How to apply (batch gotchas):**
- Multi-row conflict SET must use `excluded.*`, not per-row literal values
  (a literal would set every conflicting row to the same value).
- `.returning()` on a DO UPDATE batch returns updated rows too — use it to build
  a `customerKey -> journeyId` map to link items.
- Dedupe items by the conflict key (org::saleId::articleId) before inserting:
  Postgres errors "cannot affect row a second time" if one statement targets the
  same conflict row twice.
- Manual-field preservation stays in the SET via CASE on `detailsManual` /
  `stateManual` / `ragioneSocialeManual`.

The watermark (`customerJourneyReconciledAt` in org config) gates whether
reconcile runs at all; the frontend list query has no polling, so the reconcile
must stay synchronous (background would not reflect on the current load).
