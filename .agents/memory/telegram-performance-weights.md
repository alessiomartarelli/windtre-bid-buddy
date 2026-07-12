---
name: Telegram performance weights wiring
description: How configurable performance-score weights reach the live Telegram report, and which verification scripts do/don't apply them
---

# Telegram report performance weights

Performance-score weights are per-org/per-mese in
`gara_config.config.performanceWeights`. The scheduled Telegram report loads
them and passes them into the daily aggregation; the message text and the HTML
attachment share the SAME aggregates object, so a weight change reorders BOTH
the "il migliore" standout in the message AND the "Per addetto"/"Per punto
vendita" rankings in the HTML at once. Missing/empty weights fall back to the
system defaults, applied per-field (each field independently).

**Why it matters:** verifying only the message, or only the HTML, is redundant —
they move together. Verify the *load path* (config → parse → aggregate), not
the two renderers separately.

## Verification
- `scripts/verify-performance-weights-effect.mts` — DB-backed, self-contained,
  no Telegram send, no real data: seeds a temp org + today's sales + a custom
  weight set, runs the scheduler load path, asserts standout + rankings
  reorder, then confirms empty config → defaults, and cleans up.

## Gotchas
- The read-only preview script does NOT apply `performanceWeights` (aggregates
  with defaults), so its standout/rankings can diverge from the live report
  when custom weights are configured. Trust the scheduler path / verify script.
- HTML order checks: never `indexOf` the whole document — a "migliori per KPI"
  summary panel cites the same names in a different order. Scope to the
  specific ranking card.
