---
name: Sicurezza salvataggi Configurazione Gara
description: Vincoli non negoziabili per evitare che caricamenti concorrenti o form parziali azzerino configurazioni salvate
---

Le configurazioni nominate devono essere selezionate e idratate esclusivamente per ID. Ogni continuazione asincrona di lista/config/PDV deve verificare una generazione di caricamento; gli array persistiti vuoti sono valori validi, non assenze da sostituire con default.

**Why:** un salvataggio da stato parzialmente idratato ha azzerato contemporaneamente Energia, Assicurazioni, Protetti e decurtazioni, mentre altre sezioni e i PDV sono rimasti presenti. Il record era recuperabile dallo storico, ma la selezione per solo mese non era un'identità stabile.

**How to apply:** ogni update e ogni restore di un record esistente deve includere la versione `updatedAt` caricata e usare un compare-and-swap atomico nella stessa transazione che archivia lo storico. Mantieni il guard che rifiuta crolli simultanei di più blocchi indipendenti. Poiché PostgreSQL conserva microsecondi ma l'API espone millisecondi, confronta alla precisione API e fai avanzare ogni nuova versione di almeno 1 ms.