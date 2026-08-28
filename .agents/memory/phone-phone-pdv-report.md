---
name: Phone&Phone PDV nel report Telegram
description: Regola dati produzione per distinguere gli store Phone&Phone quando BiSuite non valorizza il codice POS.
---

Per Phone&Phone, BiSuite può lasciare vuoto `codicePos` pur valorizzando `nomeNegozio`: sia il report Telegram sia la pagina Vendite BiSuite (KPI, filtro, tabella, riepiloghi ed export) devono raggruppare per nome negozio, non accorpare tutto in “N/D”. Vanno esclusi i nomi “BANCHETTO”; Back Office e gli altri nomi restano.

**Why:** in produzione tutti gli store Phone&Phone avevano codice POS vuoto, ma nomi distinti; il precedente fallback “N/D” li fondeva in un solo punto vendita.

**How to apply:** il fallback nome-negozio è generale negli aggregatori; l’esclusione BANCHETTO resta limitata a Phone&Phone per non cambiare silenziosamente i dati delle altre aziende.