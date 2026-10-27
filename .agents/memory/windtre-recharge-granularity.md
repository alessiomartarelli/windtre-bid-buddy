---
name: Granularità riconciliazione ricariche WindTre
description: Perché gli scontrini BiSuite non sono l'unità di confronto delle Keycode WindTre.
---

Per WindTre confrontare la singola ricarica dello scontrino, mantenendo l’ID
vendita come riferimento visibile. Non trasferire automaticamente questa regola
all’aggregazione Vodafone/Fastweb.

Per Vodafone/Fastweb l’unità di confronto è la transazione: righe salvate con lo
stesso ID transazione vanno sommate prima del match BiSuite, così anche i report
storici restano coerenti con quelli aggregati durante l’import.

**Why:** il confronto con il report CMS reale ha mostrato che uno scontrino può
contenere più ricariche sullo stesso telefono o su numeri diversi. Sommare tutto
lo scontrino crea incongruenze e mancanti anche quando ogni Keycode ha un
articolo corrispondente.

**How to apply:** tenere distinta l’identità dell’articolo da quella della vendita
nei consumi uno-a-uno, verificare la conservazione degli importi e non eliminare
le righe ripetute solo perché condividono l’ID vendita.
