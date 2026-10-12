---
name: Privacy dei log Customer Journey in produzione
description: Come limitare le letture dei log remoti quando si verificano i riepiloghi Customer Journey.
---

Nei log di produzione, una ricerca ampia come `customer-journey` può includere le righe Express dei GET report, che serializzano parte del corpo della risposta con dati cliente. Per controllare i riallineamenti, filtrare solo il prefisso preciso dei riepiloghi `[customer-journey] org=... reconcile post-fetch:` e redigere l'org; non fare `tail` su risultati generici.

**Regola:** i body Customer Journey vanno esclusi integralmente dai log HTTP, non mascherati con una lista di campi personali. Anche gli identificativi nel percorso vanno sostituiti dal template della route. Conservare solo metadati operativi.

**Why:** report e diagnostiche possono introdurre campi personali nuovi o annidati che una lista di redazione non coprirebbe.

**How to apply:** estendere la stessa esclusione a eventuali nuove famiglie di API CJ. La protezione non ripulisce i log storici: continuare a filtrare le letture remote finché non è verificata la loro rimozione.

**Why:** Una ricerca ampia usata per trovare un reconcile ha incluso dati personali presenti nei log della risposta report.

**How to apply:** Prima di leggere log CJ remoti, restringere il filtro a messaggi scheduler noti e stampare solo conteggi/tempi; non mostrare righe HTTP report.
