---
name: CustomerJourney page perf — memoization
description: Why client/src/pages/CustomerJourney.tsx keeps every derived value memoized, and the empty-array pitfall.
---

The Customer Journey page derives a lot of heavy data in the component body
(filtered/sorted lists, report groups/totals, gettone journeys/groups/detail,
filter options). Without memoization the page recomputes ALL of it on every
render — opening a scheda, switching view/tab, or typing in a filter would
"inchiodare" (freeze) the UI.

**Rule:** keep all derived computations wrapped in `useMemo` and the handlers
passed to memoized sub-components in `useCallback`. Sub-views
(`ReportView`/`AnalisiView`/`JourneyDetailView`) are `memo(...Impl)` wrappers.

**Why:** the freeze was the PARENT recomputing the whole dataset on every
render — not the sub-components (they already had their own local `useState`
for row-expand). Memoizing the parent's derived data is what fixes it.

**Empty-array pitfall:** never feed memos `query.data ?? []`. A fresh `[]` is a
new reference each render and busts every downstream memo while the query is
loading. Use stable module constants (`EMPTY_JOURNEYS`, `EMPTY_REPORT_ROWS`)
as the fallback instead.

**memo effectiveness:** `React.memo` on a sub-view only helps if its props are
referentially stable — inline arrow callbacks defeat it, so the detail-view
handlers must be `useCallback` (react-query `mutate` fns are already stable).

Out of scope (still a real lever for very large datasets): server-side
pagination / virtual scrolling — deliberately not done here.
