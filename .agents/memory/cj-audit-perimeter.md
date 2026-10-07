---
name: Perimetro degli audit CJ per società
description: Evitare falsi conteggi vuoti distinguendo tenant, ragioni sociali e nomi PDV BiSuite
---

Negli audit CJ per società, identificare prima il tenant e poi il perimetro delle ragioni sociali. Non assumere che il nome commerciale sia il nome dell'organizzazione, né che i nomi PDV degli item coincidano letteralmente con quelli della struttura.

**Why:** l'audit per CMS ha incontrato entrambi i casi: società dentro un tenant condiviso, negozi BiSuite con prefissi e varianti rispetto ai nomi della struttura. Un confronto letterale produceva zero clienti pur in presenza di journey.

**How to apply:** risolvere l'associazione PDV con le regole dell'app e verificare i negozi non associati prima di comunicare un totale. Se il nome commerciale comprende più ragioni sociali, esplicitare il totale per società e quello inclusivo senza presumere il perimetro desiderato.
