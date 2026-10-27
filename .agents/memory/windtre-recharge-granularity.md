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

## Date Vodafone/Fastweb

Una data diversa tra file e vendita BiSuite non deve rendere la ricarica assente:
il confronto può cercare lo stesso numero nel tenant anche fuori dal periodo del
file, mantenendo visibili separatamente entrambe le date.

**Why:** l’utente ha segnalato ricariche presenti nelle vendite API registrate in
un giorno diverso rispetto al report del fornitore.

**How to apply:** preservare prima gli abbinamenti dello stesso giorno e il
consumo uno-a-uno; il periodo confermato continua a delimitare le vendite da
segnalare come assenti dal file. Non estendere questa regola a WindTre.
