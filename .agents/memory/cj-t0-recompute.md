---
name: CJ T0 recompute on reconcile
description: Why the journey opening date/trigger must be recomputed on every reconcile, and how the dev DB differed from prod
---

Rule: il reconcile Customer Journey ricalcola SEMPRE opened_at + vendita trigger dalla prima
attivazione mobile valida (>= data trigger, non annullata); mai upsert "solo anagrafica".

**Why:** con l'upsert che non toccava opened_at, journey nate quando la SIM di luglio non era
ancora scaricata (o con un'altra data trigger) restavano congelate su una SIM di agosto: le
piste di luglio finivano "Non conta" e il gettone era sottostimato. Il DB dev aveva 6 casi
(+113 journey con T0 di giugno sotto trigger luglio); prod NON aveva il problema.

**How to apply:** t0MovedBack/t0MovedForward nel risultato reconcile (toast + log): se dopo un
fetch salgono a caso, indaga. Tie-break a parità di data: bisuiteId più basso. Il marker T0 in
timeline va sulla SIM della vendita trigger (uno scontrino BiSuite può avere SIM+fisso+telefono),
fallback qualsiasi articolo della vendita trigger solo per dati sporchi.
