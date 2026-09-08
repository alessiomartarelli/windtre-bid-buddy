---
name: DRMS file period versus row competence
description: A monthly DRMS includes historical adjustments; threshold analysis must respect row competence.
---

Il mese del file DRMS non identifica la competenza di tutte le sue righe. Non interpretare il massimo flag soglia dell'intero file come soglia del mese.

**Why:** La verifica del DRMS di luglio 2026 in produzione ha trovato righe di competenza fino a dicembre 2025: flag storici più alti producevano differenze apparenti tra negozi a parità di soglia del mese corrente.

**How to apply:** Per mostrare soglie mensili, separare per competenza; nel consolidato non comprimere mesi diversi in un unico massimo etichettato come risultato corrente. Non uniformare artificialmente i PDV: differenze reali possono restare tra società/dealer.