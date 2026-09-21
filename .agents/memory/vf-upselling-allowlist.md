---
name: VF Upselling allowlist
description: Regola commerciale per nome e conteggio della pista CB nel modello Vodafone/Fastweb.
---

Nel modello Vodafone/Fastweb la pista tecnica `cb` è presentata come **Upselling**. Conta esclusivamente domande o offerte esplicitamente ammesse: vecchie voci CB generiche e regole KPI troppo ampie non possono farle superare l'allowlist.

Gli articoli identificati come **TNP IN CB** o **SOLO TNP IN CB** sono sempre esclusi per intero da Upselling, anche quando contengono risposte positive che su altri articoli sarebbero ammesse.

Le offerte **Vodafone Mobile * Special/Plus** e i **Change Order Fastweb in Upgrade** (Mobile Start, Mobile Pro, Power, Ultra) appartengono alla pista Mobile e non costituiscono da sole un volume Upselling.

Ogni segnale positivo distinto vale un volume; più segnali sulla stessa offerta contano separatamente, mentre lo stesso segnale trovato sia nell'etichetta sia nelle risposte va deduplicato. Un articolo può contribuire contemporaneamente alla pista base e a Upselling. Un target KPI `escludi` sopprime ogni contributo.

Nei breakdown Upselling mostrare il nome del segnale commerciale (Rete Sicura, Club, Kasko, Trade In, Extender...), mai l'etichetta dell'offerta base Mobile/Fisso che lo contiene.

**Why:** nei dati Vodafone/Fastweb i componenti Upselling sono spesso risposte dentro un articolo base, non articoli separati; le categorie CB storiche e alcune offerte Mobile includono voci che il business non vuole conteggiare come Upselling.

**How to apply:** preservare la stessa semantica e le etichette dei segnali in UI, aggregazioni server, export e report Telegram/HTML. Per organizzazioni WindTre mantenere label `CB` e comportamento storico.