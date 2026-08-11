---
name: Telegram report — netto IVA e vendite annullate
description: Perché i numeri del report differiscono da BiSuite e come sono nettati accessori/servizi
---

- **Regola**: nel report Telegram i fatturati di Accessori (categoria ACCESSORI) e di TUTTI i Servizi sono al netto dell'IVA (÷1.22). Telefonia e altri prodotti restano lordi.
  **Why:** richiesta esplicita dell'utente (ago 2026): "accessori e servizi al netto dell'iva".
  **How to apply:** trasformazione `applyNettoIvaAccessoriServizi` applicata agli aggregati SUBITO dopo `aggregateDailyReport` (oggi, Totale mese E ogni entry di `buildDailyHistory`), così proiezione, top-KPI, tabelle categoria, chip pagamenti e drill-down restano coerenti. Non nettare dentro l'aggregazione: è condivisa e i prezzi sorgente restano lordi.
- **Lezione riconciliazione**: i totali visti in BiSuite includono le vendite ANNULLATE; il report le esclude. Es. luglio 2026: 1005 telefoni lordi = 998 attivi + 7 su vendite annullate. Prima di dichiarare un bug sui conteggi, contare sul DB prod distinguendo per `stato`.
