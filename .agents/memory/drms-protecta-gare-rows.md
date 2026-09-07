---
name: DRMS Protecta (WindTre Protetti) rows
description: perché il driver protetti non si agganciava ai DRMS e come vanno trattate le righe PROTECTA
---
Nei DRMS reali WindTre Protetti compare SOLO con `TIPO_FONIA = PROTECTA` e `NATURA = GARE`
("Gara Protecta", codice contratto `OW…`, IMPORTO_NUM valorizzato): non esiste una riga
CONTRATTUALE. Il motore esito tratta le GARE di quel TIPO_FONIA come contrattuali
(`DRMS_GARE_AS_CONTRATTUALE_FONIE`) e mappa `protetti → PROTECTA` (non ASSICURAZIONI).

**Why:** con la mappatura ASSICURAZIONI + solo CONTRATTUALE nessuna vendita Protecta
otteneva mai un esito (verificato su prod: 6 item, 0 match → 3 match dopo il fix).

**How to apply:** le vendite BiSuite Protecta (categoria ALLARMI) NON hanno codice
contratto nei venditaInfo: il match reale passa quasi sempre dal fallback CF/P.IVA.
Non estendere le GARE ad altri TIPO_FONIA (per mobile/fisso le GARE duplicherebbero il
contrattuale). Dopo un cambio del motore in prod serve rilanciare "Esita DRMS".
Dry-run senza scrivere: tsx + tunnel prod chiamando `computeDrmsOutcomes` sulle righe/item letti via pg.
