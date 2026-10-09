---
name: Diagnostica CJ in sola lettura
description: Perché il confronto SIM deve mostrare le discrepanze senza correggere i dati durante la consultazione.
---

La diagnostica SIM deve restare in sola lettura, anche quando i dati CJ sono obsoleti. Consultare riepilogo, dettaglio o pagine successive non deve avviare una riconciliazione.

**Why:** Il confronto serve a rendere visibili articoli non agganciati e discrepanze; correggere implicitamente i dati ne cambia l'esito e aggiunge costi alla consultazione dello storico.

**How to apply:** Nei nuovi percorsi diagnostici o negli export usare letture autorizzate senza aggiornamenti automatici. Conservare il filtro sulla data di inserimento della vendita, distinto dalla data di attivazione.

Le pagine diagnostiche devono condividere una versione del contenuto autorizzato, inclusi dati CJ e data trigger; se cambia, chiedere un ricaricamento esplicito. Ogni singola richiesta deve inoltre leggere un contesto coerente anche tra batch.

**Why:** Una sincronizzazione può inserire, cancellare o sostituire articoli senza cambiare i conteggi; gli esiti manuali possono cambiare senza nuove vendite. Conteggio e data massima non bastano a rilevare questi cambiamenti.

**How to apply:** Non combinare riepiloghi diagnostici con il report CJ caricato separatamente e non servire pagine dalla cache senza verificarne la versione. Il ricaricamento deve restare una lettura, non una riconciliazione.

Per riutilizzare un contesto diagnostico, validare anche le versioni fisiche delle
tuple nello snapshot della richiesta; le date di aggiornamento applicative non
sono una garanzia sufficiente. Un token PostgreSQL basato su tuple è solo
temporaneo: non sostituisce la versione pubblica del contenuto né un watermark
persistente.

**Why:** Le modifiche CJ possono provenire anche da SQL diretto senza aggiornare
le date; l'invalidazione non deve dipendere dall'elenco dei percorsi di scrittura.
Gli ID di transazione PostgreSQL non sono eterni.

**How to apply:** Tenere separati token interno di riuso e hash pubblico del
contenuto; limitare durata/dimensione del contesto e ricostruirlo se la verifica
fallisce. Non estendere questa ottimizzazione a cache persistenti senza un nuovo
meccanismo di validazione.
