---
name: CJ gettone (cross-sell) cohort & KPI semantics
description: Business rules for the Customer Journey "Analisi gettoni" report — who's in the cohort and how SIM volume vs customers are counted.
---

The Reportistica "Analisi gettoni" sub-view counts cross-sell potential per
mobile-SIM-driven journey. Keep acquisition-cohort analysis distinct from
the flow of SIM sales in a calendar month.

Rules (decided):
- **Cohort = only journeys with ≥1 ACTIVE mobile SIM.** Exclude journeys whose
  mobile is ko/stornato/annullato or that have no mobile at all. The whole
  analysis is "what cross-sell happened on top of a real new SIM activation",
  so a journey with no live SIM has no denominator.
- **SIM volume ≠ customers.** Report both: SIM volume = count of active mobile
  items, customers = distinct journeys. Multiple SIMs for one customer inflate
  volume but count as one customer.
- **% with/without extra products** is over distinct customers (≥1 active
  non-mobile pista).
- Date filter compares **date-only in UTC**; `openedAt` is stored at midnight
  UTC so the UTC calendar date equals the sale date.
- pdv/addetto attribution is **order-independent**, taken from the mobile item
  with fallback to any item.
- The gettone analysis groups **only by negozio or addetto** (the "ragione
  sociale/cliente" grouping was explicitly removed). The separate report
  "Dettaglio" view keeps its own cliente dimension — they are different views.
- Per-row drill-down shows **% saturazione cross-sell per single SIM** =
  active piste / max piste.

**Why:** initial impl conflated SIM count with customers and let no-mobile /
inactive-mobile journeys into the cohort, producing misleading cross-sell
percentages. Code review rejected it twice until cohort + volume/customer split
were made explicit.

**How to apply:** any future change to gettone aggregation must preserve the
cohort filter (`simAttive ≥ 1`) and keep `simAttivate`/`clienti` as distinct
metrics. Gettone is pure client logic over the already-isolated
`/api/customer-journeys/report` rows — do not add a separate endpoint.

## Reconciliation with monthly sales

An audit comparing sales with a client-acquisition cohort must distinguish
SIM sold in the selected month from subsequent SIM bought by those clients.
Do not interpret the cohort's cumulative SIM count as monthly sales volume.

**Why:** checking the live report against BiSuite showed that later purchases
contribute correctly to the selected clients' total, making a direct comparison
with the month's sales misleading even when no eligible article is missing.

**How to apply:** reconcile monthly sale articles and exclusions first, then
show later purchases separately. Also distinguish a gettone calculated from
contracts with positive DRMS outcomes from proof that the gettone itself was
paid; presumed smartphone liquidation is not payment confirmation.
