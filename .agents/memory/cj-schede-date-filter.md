---
name: CJ schede date filter semantics
description: Which date the Customer Journey "Schede clienti" dal–al range filters on, and why it looks like it does nothing
---

# Customer Journey "Schede clienti" date filter — filters by INSERIMENTO SIM, not "aperta il"

The dal–al date range in the **Schede clienti** view (inputs `input-schede-date-from`/`-to`)
filters journeys by **`insertedAt` = data inserimento SIM** (`customer_journey_items.data_inserimento`
of the oldest active mobile SIM), via `filterGettoneByInsertDate` in `shared/customerJourney.ts`.
The gettone Analisi view uses the SAME function for its dal–al range, so the two views are consistent.

**This is intended.** A user report of "le date non filtrano" was diagnosed as NOT a bug:
- The shared functions filter correctly (isolated tsx repro) and a headless-browser test on the
  real UI narrows the schede list 2→1 when a from-date is set.
- The confusion is that each card shows the **activation** date ("aperta il" = `openedAt`), but the
  filter compares the **hidden insertion** date. On real data the insertion dates cluster, so a
  month-wide range shows no visible change.

**Why:** asked whether to switch the schede filter to the visible "aperta il" (openedAt) date, the
user explicitly chose to **keep the SIM insertion-date semantics as-is**.

**How to apply:** do NOT "fix" this by switching the schede dal–al filter to `openedAt`/filterGettoneByDate.
If revisiting, confirm with the user first — the insertion-date behavior is a deliberate choice.
