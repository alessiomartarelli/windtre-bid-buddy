---
name: Provenienza punti Dashboard per Ragione Sociale
description: Regola di aggregazione del drill-down punti nelle card Piste in gara.
---

Con il filtro “Tutti i PDV”, il pannello Provenienza punti deve mostrare una riga aggregata per Ragione Sociale, con totale pezzi, totale punti e categorie aggregate. Ogni componente deve riportare sia i pezzi sia i punti attribuiti. Non deve elencare i singoli negozi.

**Why:** L’utente vuole leggere il risultato complessivo della RS; l’elenco completo dei PDV rende il pannello lungo e nasconde il rapporto tra volume e punteggio.

**How to apply:** Mostrare il dettaglio del singolo negozio solo quando viene selezionato esplicitamente un PDV. Mantenere la riconciliazione dei punti con il totale della card.

Le componenti devono usare lo stesso perimetro di input del calcolatore della pista: non attribuire punti agli add-on che la card esclude. Se un PDV ha vendite ma non un modello valido e la card assegna zero punti, conservare i pezzi nel dettaglio ma mostrare zero punti sulle sue componenti. Gli override parziali vanno risolti per chiave una sola volta e riutilizzati sia dalla card sia dalla provenienza.

**Why:** Un calcolo parallelo sui dati grezzi può produrre righe categoria plausibili ma non riconciliabili, soprattutto con add-on, PDV senza soglie e override parziali.

**How to apply:** La somma dei punti delle categorie visibili deve uguagliare il subtotale PDV/RS e il totale card; testare esplicitamente anche coefficienti zero e frazionari.

Il formato `N pz · X,XX pt` non è limitato al pannello Provenienza: deve comparire anche nelle tabelle di dettaglio PDV/RS, inclusi riepiloghi e categorie Fisso.

**Why:** Punti presenti solo nel drill-down della card lasciano le tabelle non riconciliabili e fanno sembrare che il Fisso non produca punti.

**How to apply:** Le tabelle devono riusare i punti categoria già calcolati per la card, mostrando esplicitamente anche `0,00 pt`; i test UI devono aprire una tabella PDV e verificarne una riga Fisso.