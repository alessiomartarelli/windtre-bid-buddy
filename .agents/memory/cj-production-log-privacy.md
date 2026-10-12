---
name: Privacy dei log Customer Journey in produzione
description: Come limitare le letture dei log remoti quando si verificano i riepiloghi Customer Journey.
---

Nei log di produzione, una ricerca ampia come `customer-journey` può includere le righe Express dei GET report, che serializzano parte del corpo della risposta con dati cliente. Per controllare i riallineamenti, filtrare solo il prefisso preciso dei riepiloghi `[customer-journey] org=... reconcile post-fetch:` e redigere l'org; non fare `tail` su risultati generici.

**Why:** Una ricerca ampia usata per trovare un reconcile ha incluso dati personali presenti nei log della risposta report.

**How to apply:** Prima di leggere log CJ remoti, restringere il filtro a messaggi scheduler noti e stampare solo conteggi/tempi; non mostrare righe HTTP report.
