---
name: Drill-down vendite riconciliato
description: Vincoli di coerenza e autorizzazione per espansioni da aggregati PDV alle singole vendite.
---

Un drill-down dalle righe aggregate PDV deve mostrare esclusivamente vendite e contributi che compongono davvero i valori visibili. Totali, dettagli e conteggi grezzi devono partire dallo stesso insieme di vendite già filtrato per ruolo, addetti, periodo e perimetro PDV/RS.

**Why:** filtrare solo il payload di dettaglio protegge i dati personali, ma crea una riconciliazione falsa se il totale rimane più ampio; ricostruire i dettagli con una tassonomia parallela può inoltre includere articoli non contributivi.

**How to apply:** applica il perimetro autorizzativo prima dell'aggregazione e genera i contributi per vendita riusando gli stessi classificatori, mapping e contatori extra usati dalla tabella. Per gli operatori, lista addetti vuota significa nessuna vendita, non intera organizzazione.