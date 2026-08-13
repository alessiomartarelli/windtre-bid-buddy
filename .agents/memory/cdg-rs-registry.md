---
name: CdG RS registry by id
description: Controllo di Gestione — Ragioni Sociali collegate per id via registro; invariante da non violare quando si toccano rename/reassign.
---

# CdG: RS collegate per id (registro)

Invariante: nel CdG il registro RS è la fonte canonica; le colonne nome sulle
tabelle figlie sono solo cache denormalizzata risolta in lettura. Ogni
rinomina/riassegnazione di RS deve selezionare le righe figlie **per id
registro** (nome solo come fallback per righe scollegate) e aggiornare id+cache
insieme; anchor `origine='auto'` portano l'id per le RS ereditate e vanno
promossi (non duplicati/409) se l'utente crea la stessa RS manualmente.

**Why:** la propagazione delle rinomine per nome su più tabelle mancava righe
("RS fantasma", incidente CMS Evolution Srl) e bloccava le voci; la cache nomi
può essere stantia, quindi un predicato per nome riproduce lo stesso bug.

**How to apply:** qualsiasi nuovo percorso che rinomina o sposta RS/PDV nel CdG
passa dal registro (helper di storage), mai nuovi UPDATE per nome; nuove
scritture figlie popolano sempre l'id. Regressioni coperte dalla suite
cdg-rs-id (workflow cdg-rs-id-tests).
