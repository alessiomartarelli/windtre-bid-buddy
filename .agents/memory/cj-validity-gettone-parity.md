---
name: Customer Journey validità ↔ gettone parity
description: Why the scheda timeline validity badges and the gettone count must share UTC month helpers and T0 rules.
---

The scheda cliente "Tracciamento temporale" shows per-contract VALIDO/NON VALIDO
badges (`computeItemValidity`, client/src/lib/customerJourneyTimeline.ts) that
must agree with the cross-sell gettone count (`buildGettoneJourneys`,
shared/customerJourney.ts). They are two separate functions on two different data
shapes, so parity is fragile.

**Rule:** both MUST use the same shared UTC helpers (`monthOfIso`,
`pisteInWindow`) and the same T0 month precedence
(`openedAt ?? min(active-mobile month) ?? min(all months)`). Never recompute
months with local-time `Date.getMonth()` on one side — boundary dates diverge.

**Why:** an earlier version used local month math + a different T0 fallback on the
validity side; badges disagreed with the number (the "30€ vs 40€" complaint). A
second gap: the "attivante" exclusion fired on the timeline `t0ItemId`
unconditionally, so a non-mobile T0 (fallback/dirty data) was wrongly excluded —
gettone excludes ONLY mobile drivers.

**How to apply:** keep `attivante` guarded by `it.driver === "mobile"`; any
non-mobile item flows through the normal pista classification. If you change the
gettone window/T0 logic, mirror it in `computeItemValidity` (or extract a single
shared predicate). The visual T0..T6 axis in `computeTimeline` still uses local
`monthIndex` — acceptable only because the audience is Italy (UTC+1/+2, never
shifts a midnight-UTC date backward).
