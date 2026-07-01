---
name: CJ schede date filter semantics & chip counts
description: Which date the Customer Journey "Schede clienti" range filters on, and how the type-chip counters must be derived
---

# Customer Journey "Schede clienti" — date filter & chip counters

## Date filter semantics
The dal–al date range in the **Schede clienti** view (inputs `input-schede-date-from`/`-to`)
filters journeys by **`insertedAt` = data inserimento SIM** (`customer_journey_items.data_inserimento`
of the oldest active mobile SIM), via `filterGettoneByInsertDate` in `shared/customerJourney.ts`.
The gettone Analisi view uses the SAME function for its dal–al range, so the two views stay consistent.

**Why:** each card shows the **activation** date ("aperta il" = `openedAt`), but the filter
compares the **hidden insertion** date. Asked whether to switch to the visible openedAt, the user
explicitly chose to **keep the SIM insertion-date semantics**. Do NOT "fix" this to `openedAt`.

## Type-chip counters (Tutti / Privati / Business)
The chips ARE the customer-type filter, so their badge counts must be derived from the set with
**all other filters applied (search/PDV/addetto/stato + insert-date range) but NOT the type filter**.
Pattern: build `filteredNoType` (shared filters with `typeFilter:"tutti"`) → apply insert-date to get
`simInsertNoType` → counts come from `simInsertNoType`; the visible list applies the type chip on top.

**Why:** a bug had the badges show the raw unfiltered `journeys.length` (e.g. "Tutti 1148") while the
date filter had narrowed the cards to 4. Counters must track the current filter context.
