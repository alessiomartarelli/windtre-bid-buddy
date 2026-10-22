---
name: Perimetro provider ricariche
description: Regola di visibilità e caricamento dei report ricariche WindTre e Vodafone/Fastweb per organizzazione.
---

Un tenant WindTre non deve vedere né caricare report Vodafone/Fastweb; un tenant Vodafone/Fastweb non deve vedere né caricare report WindTre. Ogni report resta inoltre isolato per organizzazione e provider.

**Why:** l’utente ha richiesto il perimetro separato per evitare che i tenant importino o consultino report del brand sbagliato.

**How to apply:** applicare il controllo sia nell’interfaccia sia nelle API di lettura e upload; non basarsi solo sul filtro visuale del client.
