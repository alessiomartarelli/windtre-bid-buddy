---
name: BiSuite CB/IVA per categoria sorgente
description: I contatori CB (cambi piano) e pezzi IVA vanno derivati dalla categoria BiSuite di origine, mai dalla pista post-regole.
---

Regola: CB = SOLO MIA TIED / MIA UNTIED (non Coupon Caring) + RIVINCOLO, e pezzi IVA, si calcolano da `classifyCategory(categoriaNome)` (categoria sorgente) + flag coupon-caring — NON dalla `pista` finale dell'articolo classificato.

**Why:** regole KPI custom e listino canvass VF possono rimappare la pista finale su/da 'cb' per categorie arbitrarie; usare la pista post-regole conta articoli sbagliati o perde veri cambi piano. La dashboard (bisuiteMappedSales) usa già la categoria sorgente; le altre viste devono coincidere.

**How to apply:** ogni nuovo contatore "cambio piano"/"pezzo IVA" (tabelle, export, report) deve passare per `shared/pdvPezziExtra.ts` o comunque per `classifyCategory` + `isCouponCaring`, mai per `art.pista`.
