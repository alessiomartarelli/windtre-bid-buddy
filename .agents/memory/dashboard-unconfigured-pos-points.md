---
name: Punti Dashboard da POS non censiti
description: Semantica dei punti prodotto e dei bonus gara quando una vendita mappata arriva da un POS assente dalla struttura
---

Le vendite correttamente mappate devono contribuire ai pezzi e ai punti prodotto anche quando il loro codice POS non è ancora censito nella struttura aziendale. I bonus, moltiplicatori e premi legati alla partecipazione in gara restano invece riservati ai PDV configurati.

**Why:** BiSuite può contenere vendite valide associate a codici POS non ancora presenti nella configurazione. Mostrare i pezzi ma perdere i relativi punti rende inconciliabili dettaglio e totale; attribuire anche i bonus gara al POS sintetico sarebbe però scorretto.

**How to apply:** nelle aggregazioni per-PDV usa l'unione tra struttura e sorgenti mappate per i punti prodotto, mantenendo un controllo separato sull'appartenenza alla struttura prima di applicare bonus o soglie di gara.