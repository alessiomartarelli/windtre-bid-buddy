---
name: BiSuite CB/IVA per categoria sorgente
description: I contatori CB (cambi piano) e pezzi IVA vanno derivati dalla categoria BiSuite di origine, mai dalla pista post-regole.
---

Regola: CB = MIA TIED / MIA UNTIED (non Coupon Caring) + RIVINCOLO + migrazioni identificate da categoria o tipologia. Le migrazioni denominate esattamente «MIGRAZIONE BUSINESS 1928» e «RICHIESTA INSERIMENTO MIGRAZIONE SU TOOL ASK» sono escluse anche se il testo compare in descrizione. IVA e CB si calcolano dalla categoria BiSuite sorgente, non dalla pista finale dell'articolo classificato.

**Why:** regole KPI custom e listino canvass VF possono rimappare la pista finale su/da 'cb' per categorie arbitrarie; usare la pista post-regole conta articoli sbagliati o perde veri cambi piano. La allowlist Upselling VF resta separata e non deve ereditare il conteggio migrazioni. Le viste devono applicare le stesse esclusioni e non contare Coupon Caring.

**How to apply:** ogni nuovo contatore CB/pezzi IVA (tabelle, export, report) deve condividere le regole per categoria sorgente, Coupon Caring e le due eccezioni migrazione; mai basarsi su `art.pista` post-regole. Nel modello VF mantenere i volumi CB limitati ai segnali Upselling ammessi.
