---
name: Obiettivo report CJ per coorte e mese
description: Esigenza commerciale di misurare acquisti successivi e valore economico dei clienti aperti nei mesi precedenti
---

La reportistica deve consentire di scegliere il mese di apertura delle CJ e un mese di osservazione successivo, mostrando quanti e quali clienti continuano ad acquistare, la percentuale e il valore economico relativo al mese osservato. La stessa lettura serve per addetto, per capire chi continua a convertire clienti aperti prima.

**Perimetro economico confermato:** solo il gettone CJ, non le commissioni complessive dei contratti.

**Why:** l'utente ha scelto esplicitamente «Solo il gettone CJ» tra le alternative economiche.

**Mese delle vendite successive confermato:** usare la data di vendita/inserimento, non la data di attivazione del prodotto. Non confondere questa scelta con il mese di apertura CJ o con il riconoscimento economico.

**Why:** l'utente ha scelto esplicitamente la data di vendita/inserimento per identificare l'attività del mese osservato.

**Lettura addetti confermata:** mantenere separate entrambe le viste: addetto che ha aperto la CJ e addetto che ha effettuato le vendite successive.

**Why:** l'utente ha scelto esplicitamente «Entrambe le letture, separate». Un'unica attribuzione nasconderebbe il lavoro commerciale di chi prosegue la vendita sui clienti acquisiti da colleghi.

**Attribuzione economica approvata:** associare al venditore successivo l'incremento marginale prodotto dalla sua vendita, mantenendo il percorso completo nella vista dell'addetto di apertura. Affiancare clienti distinti e nuove piste agli euro: gli scaglioni non misurano proporzionalmente il merito e non sono commissioni individuali.

**Why:** dopo l'esempio delle piste con incrementi diversi, l'utente ha approvato lo sviluppo dell'impostazione consigliata. Una ripartizione percentuale tra colleghi non è stata richiesta.

**How to apply:** separare sempre mese apertura, mese vendita e mese riconoscimento economico. Non sommare i risultati delle due viste addetti e non ricontare l'intero gettone ogni mese; non ampliare il valore alle commissioni DRMS o interpretarlo come utile netto.

**Confronto richiesto:** mantenere fissa la coorte CJ e affiancare la sua progressione cumulativa nei mesi successivi: clienti con zero, uno, due o più prodotti aggiuntivi e differenze rispetto al mese precedente.

**Why:** l'utente ha rifiutato il solo totale attuale dei clienti con un prodotto, chiedendo «le differenze tra un mese e l'altro dello stesso periodo customer journey». Non basta confrontare coorti diverse o mostrare un mese isolato.

**How to apply:** distinguere la distribuzione cumulativa dai nuovi acquisti del mese e dalle transizioni tra livelli. Dichiarare se il confronto è ricalcolato sulla validità attuale anziché una fotografia storica degli stati.

**Uscite dalla coorte:** affiancare numero e identità delle SIM cadute al numero e all'elenco dei clienti senza più alcuna SIM eleggibile valida. Un cliente con altre SIM valide resta qualificato; chi esce resta nel denominatore della coorte, separato da chi ha zero prodotti aggiuntivi.

**Why:** l'utente ha chiesto di sapere «quante SIM sono cadute e quali» e «quali clienti non sono più nella customer journey». Le due quantità non sono equivalenti e rimuovere gli usciti dal denominatore nasconde l'abbandono.

**How to apply:** distinguere perdite correnti e perdite documentate poi recuperate. Non attribuire una caduta al mese di un aggiornamento tecnico. Esplicitare la copertura sulle sole schede conservate se precedenti riconciliazioni ne hanno eliminate altre.

**SIM annullate nelle vendite:** non devono comparire nella CJ, nemmeno negli elenchi delle cadute o nel denominatore. La presenza di un'altra SIM valida non rende ammissibile quella annullata nelle vendite. Restano distinti gli esiti economici DRMS/manuali su vendite non annullate.

**Why:** l'utente ha precisato «Le sim annullate dalle vendite non devono comparire proprio nella cj», correggendo l'inclusione delle annullate di origine BiSuite tra le SIM cadute.

**How to apply:** verificare lo stato della vendita di origine, non dedurre l'esclusione dal solo stato economico `annullato`. Se manca ogni altra SIM eleggibile nelle vendite, il cliente non fa parte della coorte CJ.

**Schede clienti separate:** i clienti attivi in CJ e i non più qualificati devono avere schede/elenchi distinti e conteggi separati, anche nella consultazione dei clienti delle coorti. Gli elenchi operativi non devono mescolarli.

**Why:** l'utente ha chiesto «i non più qualificati vanno separati dai clienti attivi in cj e mostrati in schede separate».

**How to apply:** l'appartenenza dipende da almeno una SIM eleggibile ancora valida, non dalla presenza di prodotti cross-sell. Un'altra SIM valida mantiene il cliente fra gli attivi. La separazione degli elenchi non modifica il denominatore fisso del confronto storico delle coorti.

**Vista principale essenziale:** mostrare una tabella con i livelli di prodotti aggiuntivi oltre alla SIM sulle righe e i mesi sulle colonne, seguita da clienti con almeno un prodotto e percentuale della coorte. Le analisi economiche e gli elenchi approfonditi restano secondari e chiusi inizialmente.

**Why:** l'utente ha segnalato troppe informazioni nelle coorti e fornito come riferimento una semplice tabella «Evoluzione della coorte di luglio».

**How to apply:** preservare il confronto cumulativo a coorte fissa senza riportare nella vista principale KPI, movimenti economici o diagnostica estesa. I non più qualificati non diventano clienti con zero prodotti.
