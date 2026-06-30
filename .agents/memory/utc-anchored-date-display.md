---
name: UTC-anchored date display rollover
description: How to display dates that are stored at end-of-day UTC without rolling to the next day in Italian locale.
---

# UTC-anchored dates must be formatted in UTC

Dates that are *conceptually a calendar date* but stored anchored to a UTC
instant (e.g. the Customer Journey **T6 deadline** = last day of the T6 month at
`23:59:59.999 UTC`) will **roll forward one day** when formatted with the
browser default `toLocaleDateString("it-IT")`, because Italy is UTC+1/UTC+2.
A June journey then shows `01/01/2027` instead of `31/12/2026`.

**Rule:** format such dates with `{ timeZone: "UTC" }` (a `fmtDateUTC` helper),
NOT the generic `fmtDate` that re-parses through local time. And compute any
"days remaining" by comparing **UTC calendar dates** (`Date.UTC(getUTCFullYear,
getUTCMonth, getUTCDate)` on both sides) instead of `Math.ceil` over raw
timestamps — the `23:59:59.999` anchor otherwise inflates the count by a day.

**Why:** the underlying window/T6 logic was already correct in UTC; only the
*display* and the day-count used local-time formatting / timestamp-ceil, so they
were the only things skewed. Keep the deadline anchored at `23:59:59.999 UTC`
(its UTC date components are the intended calendar date) and fix presentation.

**How to apply:** any new place that shows a UTC-anchored calendar date (badges,
exports, tooltips) must use the UTC formatter; pure-logic regression tests can
assert with `toLocaleDateString("it-IT", { timeZone: "UTC" })` vs
`{ timeZone: "Europe/Rome" }` to lock the no-rollover behavior independent of the
test runner's TZ.
