---
name: Energy Privati/Business split vs prod BiSuite data
description: Empirical confirmation that saleCustomerKind matches real prod energy-sale customer data
---

Confirmed against real prod DB (VPS, ~2455 energy sales — categoria.nome IN
'ENERGIA W3' / 'ACEA ENERGIA') that the Energia Privati (CF) vs Business
(P.IVA) split in `shared/venditeReport.ts` `saleCustomerKind` matches actual
BiSuite customer data.

Empirical facts about BiSuite energy `rawData.cliente` (do not re-derive):
- `clienteTipo` is populated on 100% of energy sales (0 empty/absent). BiSuite
  does NOT expose customer type via any other field/shape — `clienteTipo` is
  canonical and reliable. The `cliente` block is never missing; `codiceFiscale`
  and `piva` keys always present (piva often empty string).
- Distribution: FISICA+CF-only (~2358) → privato; PROFESSIONISTA+piva (~53) and
  GIURIDICA+piva (~42) → business. Every azienda (GIURIDICA/PROFESSIONISTA) also
  carries a piva, so the `isAzienda ||` clause is effectively redundant vs `piva`.
- The task's feared failure mode (missing/empty cliente block or empty
  clienteTipo silently bucketed as privato) does NOT occur in prod.

Two negligible edge cases (design ambiguity, left unchanged — 4/2455 = 0.16%):
- FISICA + piva (2 sales): `saleCustomerKind` → business (via `|| piva`), which
  matches the report label "Business (P.IVA)". The WindTre energy *mapping*
  engine keys purely on clienteTipo (FISICA→CONSUMER), so it would call these
  consumer. Report label vs gara-mapping semantics diverge here by design.
- ASSOCIAZIONE + CF-only (2 sales): → privato (no piva, not azienda). No P.IVA
  so consistent with "Business (P.IVA)" label; WindTre mapping has no rule.

**Why:** verification-only task; the heuristic is already correct for 99.8%+ of
real data and matches the report's own "Privati (CF) / Business (P.IVA)" label,
so no code change was warranted.

**How to apply:** if a future task wants the split to mirror the WindTre gara
Consumer/Business incentive categories exactly (not the CF/PIVA label), switch
`saleCustomerKind` to key purely on clienteTipo. Otherwise leave as-is.
