---
name: CJ gettone analysis trigger floor
description: The Analisi gettoni cohort is floored by the org CJ trigger date for ALL roles; how it interacts with UI tests.
---

# Analisi gettoni — floor alla data trigger

L'Analisi gettoni (Customer Journey) mostra solo le SIM la cui attivazione (T0 /
`openedAt`) ricade dalla data trigger della config org in poi
(`customerJourneyTriggerDate`, default di sistema `2026-07-01`). Il filtro manuale
"dal/al" della stessa vista invece filtra per **data di inserimento** SIM, non per
attivazione — sono due concetti distinti.

**Why:** il floor deve valere per TUTTI i ruoli (admin e operatore), altrimenti gli
operatori vedrebbero SIM antecedenti al cutover e l'analisi divergerebbe da quella
admin sullo stesso org. Storicamente la query della config era caricata solo per
gli admin, quindi gli operatori bypassavano il floor.

**How to apply:**
- Quando la config trigger guida una vista visibile anche agli operatori, NON
  gating la query su `isAdmin`: caricala per tutti e lascia admin-only solo la
  *scrittura* (PUT/update del valore).
- Nei test UI/integration che seminano journey con data `now()` o pre-cutover, la
  cohort gettone le esclude col trigger di default: o semini date post-cutover, o
  abbassi il trigger via l'helper `setCjTriggerDate(pool, orgId, 'YYYY-MM-DD')`.
  Questo vale anche per gli scenari operatore (dopo il fix del floor per-ruolo).
