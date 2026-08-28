---
name: Phone&Phone PDV nel report Telegram
description: Regola dati produzione per distinguere gli store Phone&Phone quando BiSuite non valorizza il codice POS.
---

Per Phone&Phone, BiSuite può lasciare vuoto `codicePos` pur valorizzando `nomeNegozio`: il report deve raggruppare per nome negozio, non accorpare tutto in “N/D”. Nel perimetro Telegram Phone&Phone vanno esclusi i nomi “BANCHETTO”; Back Office e gli altri nomi restano.

**Why:** in produzione tutti gli store Phone&Phone avevano codice POS vuoto, ma nomi distinti; il precedente fallback “N/D” li fondeva in un solo punto vendita.

**How to apply:** il fallback nome-neg​​ozio è generale nell’aggregatore; l’esclusione BANCHETTO resta limitata all’organizzazione Phone&Phone per non cambiare silenziosamente i report delle altre aziende.