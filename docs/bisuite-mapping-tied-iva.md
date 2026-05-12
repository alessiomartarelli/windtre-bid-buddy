# Mapping BiSuite — TIED IVA (Extra Gara IVA)

Le offerte SIM P.IVA (categoria BiSuite "TIED IVA") sono mappate in
`shared/bisuiteMapping.ts` con regole `priority: 15` basate sul prefisso di
`descrizioneBiSuite` (matching via `String.includes`, case-insensitive — vedi
riga ~427 di `bisuiteMapping.ts`). Il fallback senza match resta `SIM_IVA`
(0 punti Extra Gara IVA), quindi ogni descrizione non gestita causa
undercount.

## Tassonomia
Definita in `client/src/lib/calcoloExtraGaraIva.ts`, `PUNTI_EXTRA_GARA`:
- `PROFESSIONAL_WORLD` / `PROFESSIONAL_STAFF` → 1.5 punti (worldStaff).
- `ALTRE_SIM_IVA` → 1 punto (fullPlusData60_100, tier "Full"/voce business).
- `PROFESSIONAL_FLEX` / `PROFESSIONAL_SPECIAL` / `PROFESSIONAL_DATA_10` → 0.5
  punti (flexSpecialData10, entry tier).
- `SIM_IVA` (fallback) → 0 punti.

## Inventario TIED IVA
Review eseguita Task #79, query distinct `descrizione` su tutti i
`bisuite_sales` di tutte le org, lifetime. Stato per ogni `descrizioneBiSuite`
osservata:

| Descrizione (BiSuite)         | Categoria target       | Note                                  |
|-------------------------------|------------------------|---------------------------------------|
| `PROFESSIONAL WORLD`          | `PROFESSIONAL_WORLD`   | Top tier — 1.5 pt                     |
| `PROFESSIONAL STAFF`          | `PROFESSIONAL_STAFF`   | Top tier — 1.5 pt                     |
| `PROFESSIONAL FULL PLUS`      | `ALTRE_SIM_IVA`        | Tier Full — 1 pt (Task #78)           |
| `PROFESSIONAL DATA 60` (GIGA) | `ALTRE_SIM_IVA`        | Tier Full — 1 pt (Task #78)           |
| `PROFESSIONAL DATA 100` (GIGA)| `ALTRE_SIM_IVA`        | Tier Full — 1 pt (Task #78)           |
| `PROFESSIONAL COUNTRY`        | `ALTRE_SIM_IVA`        | Tier Full voce internazionale — 1 pt (Task #79) |
| `PROFESSIONAL FULL RESTART`   | `ALTRE_SIM_IVA`        | Variante Full — 1 pt (Task #79)       |
| `PROFESSIONAL FLEX`           | `PROFESSIONAL_FLEX`    | Entry tier — 0.5 pt                   |
| `PROFESSIONAL SPECIAL`        | `PROFESSIONAL_SPECIAL` | Entry tier — 0.5 pt                   |
| `PROFESSIONAL DATA 10`        | `PROFESSIONAL_DATA_10` | Entry tier — 0.5 pt                   |

**Decisione "resta SIM_IVA"**: nessuna descrizione TIED IVA osservata viene
intenzionalmente lasciata sul fallback. Il fallback `SIM_IVA` resta come
guardia per offerte future non ancora classificate.

**Enterprise**: nessuna offerta con prefisso `ENTERPRISE` è mai apparsa nei
dati BiSuite reali (lifetime, tutte le org). Il catalogo WindTre attualmente
ricondotto sotto categoria BiSuite "TIED IVA" è esclusivamente la famiglia
`PROFESSIONAL *`. Quando/se compariranno SKU `ENTERPRISE *`, vanno
classificate esplicitamente prima del merge (regola priority:15 in
`bisuiteMapping.ts` ~righe 243-257) — il fallback `SIM_IVA` causerebbe
undercount sull'Extra Gara IVA.
