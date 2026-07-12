---
name: BiSuite partnership twins double-count trap
description: consuming mergeWithDefaultRules output must filter by pista or CB/partnership twins double counts
---
`mergeWithDefaultRules` synthesizes a partnership twin for every real CB rule
(same conditions, `pista:'partnership'`, `synthetic:true`). So `mapBiSuiteSale`
returns the SAME `targetCategory` under both `cb` and `partnership` for a real
CB event (e.g. cambio_offerta_rivincoli). `coupon_caring` is the exception — it
is excluded from twin synthesis, so it appears only under `cb`.

**Why:** any code (or test) that aggregates mapped articles by `targetCategory`
alone and feeds them to a per-pista engine (e.g. `calcoloCBPerPdv`) will double
the count of real CB events.

**How to apply:** when building CB items from `mapBiSuiteSale`/`mergeWithDefaultRules`,
filter to `item.pista === 'cb'` first. The presence/absence of a partnership
twin is itself the discriminator between real CB events and caring.
