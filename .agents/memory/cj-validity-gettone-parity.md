---
name: Customer Journey validità ↔ gettone parity
description: Why the scheda timeline validity badges and the gettone count must share UTC month helpers and T0 rules.
---

**Rule:** scheda, timeline, riepiloghi, analisi gettoni ed export devono concordare:
finestra solare T0–T6 inclusi, anche giorni precedenti alla SIM nello stesso mese.
Una journey parte dalla prima nuova SIM voce ammessa dalla data configurata
(default 1 luglio 2026). SIM dati, Tourist e SIM allarme non aprono journey, non
anticipano T0 e non alimentano SIM/coorti/gettoni. I prodotti Protetti/ALLARMI
sono distinti dalle SIM allarme e restano validi.

**Why:** an earlier version used local month math + a different T0 fallback on the
validity side; badges disagreed with the number (the "30€ vs 40€" complaint). A
second gap: the "attivante" exclusion fired on the timeline `t0ItemId`
unconditionally, so a non-mobile T0 (fallback/dirty data) was wrongly excluded —
gettone excludes ONLY mobile drivers.

**How to apply:** usare UTC ovunque, compreso l'asse della timeline; fallback T0
comune: apertura, prima SIM ammessa attiva, primo evento. L'attivante può essere
solo mobile: un fallback non-mobile resta pista. Conservare lo storico fuori
finestra senza contributo economico e non inventare esclusioni per date mancanti.
Le modifiche sono solo CJ: non cambiare classificazioni/punteggi degli altri moduli.
