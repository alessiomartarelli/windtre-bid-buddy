---
name: Preventivatore per_rs removal tests
description: Quirks when seeding preventivi via API to test removed RS blocks in the Preventivatore
---

# Preventivatore per_rs removal tests

Rule: when seeding a preventivo via POST /api/preventivi to assert text-premio-totale, pick volumes whose premio is independent of soglie/cluster, and beware auto-resync effects.

**Why:**
- A useEffect in Preventivatore re-syncs Partnership `target100/target80` from cluster-CB defaults (tipoPosizione not in {strada, centro_commerciale} → fallback 300/240) as soon as the page loads: seeded targets are silently overwritten, so seeded punti must exceed the DEFAULT target, not the seeded one. `premio100` is preserved.
- Deterministic per-pista volumes: Mobile → TIED (5 €/pezzo gettone contrattuale, set `canoneMedio: 0` on the RS entry to kill premioCanone); Fisso → MIGRAZIONI_FTTH_FWA (80 €/pezzo totale: 40 gettone + 40 euro/pezzo, 0 punti so no soglia multiplier); Partnership → puntiPartnership ≥ 300 with gettoni 0.
- Removal flags live in different places: Mobile/Fisso as `rimosso` on `pistaMobileRSConfig/pistaFissoRSConfig.sogliePerRS` entries (gated by the `!rimosso` find); Partnership/Energia/Assic in the `*RSConfig.configPerRS` entries (gated by is*RSRimossa).

**How to apply:** tests/gara-config-soglie-rimovibili-ui.test.mjs is the reference suite; the wizard summary card exists twice (mobile + sidebar), wait for `attached`, not visible.
