---
name: Energia per-RS target/premi semantics
description: Semantica dei valori in energiaRSConfig.configPerRS (target aggregati, premi per-PDV) vs config globale nel simulatore.
---

Regola: nei blocchi per-RS Energia (energiaRSConfig.configPerRS) i target soglia targetS1..S3 sono AGGREGATI (Configurazione Gara li salva già moltiplicati per i PDV della RS) e i premi soglia premioS1..S3 sono per-PDV: vanno moltiplicati per pdvInGara della RS. La config Energia globale nel Preventivatore per_rs invece è trattata per-PDV (target × n° PDV della RS) con premio flat.

**Why:** una code review ha bocciato un fix di parità Dashboard↔Preventivatore che ri-moltiplicava i target per-RS per i PDV e non moltiplicava il premio: con RS multi-PDV soglie raggiunte a metà e premi dimezzati.

**How to apply:** ogni calcolo che consuma configPerRS (Preventivatore, Dashboard, export) deve confrontare i pezzi RS direttamente coi target per-RS e moltiplicare il premio per pdvInGara (fallback n° PDV reali); non riusare la semantica ×numPdv del fallback globale.
