---
name: Disattivazione reversibile della Struttura
description: Perché PDV e ragioni sociali devono conservare sempre le relazioni e i dati storici
---

**Regola:** per PDV e ragioni sociali l'azione ordinaria è disattivare/riattivare; non cancellare fisicamente neppure tramite il modulo CdG o il ripristino di una vecchia versione. L'inattività è anagrafica: non ricalcolare o cancellare retroattivamente vendite, spese, categorie e fornitori. Distinguere eventuali filtri per le nuove operazioni dai report storici.

**Why:** un'eliminazione dalla Gestione Organizzazione ha rimosso insieme una ragione sociale, il suo unico punto vendita e centinaia di spese CdG, richiedendo un recupero mirato da backup. Un semplice blocco nella UI non protegge dai vecchi client o dalle route parallele.

**How to apply:** quando si introduce una nuova azione su RS/PDV, controllare sia le route Admin sia quelle CdG, il salvataggio generico e il restore. Preservare le chiavi di stato da payload generici parziali o obsoleti. Non filtrare lo storico in base allo stato attuale.