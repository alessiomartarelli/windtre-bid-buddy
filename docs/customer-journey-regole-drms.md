# Customer Journey e DRMS: regole implementate

**Data di verifica: 2 novembre 2026.** Documento riferito al codice e ai test presenti nel repository alla verifica, non a dati o configurazioni di produzione.

Questo testo descrive il comportamento attuale, non un regolamento commerciale futuro né una prova di liquidazione dei premi. Tutti gli identificativi degli esempi sono fittizi; `CF-DEMO-A` e `PIVA-DEMO-A` sono segnaposto, non codici fiscali o partite IVA reali. La verifica è stata svolta leggendo implementazione e test, senza interrogazioni di produzione, riconciliazioni o modifiche applicative.

## Indice

1. [Glossario essenziale](#1-glossario-essenziale)
2. [Accesso e perimetro](#2-accesso-e-perimetro)
3. [Identità, apertura e ricalcolo T0](#3-identità-apertura-e-ricalcolo-t0)
4. [Driver e vendite annullate](#4-driver-e-vendite-annullate)
5. [Acquisti successivi, finestra commerciale e validità](#5-acquisti-successivi-finestra-commerciale-e-validità)
6. [Stati operativi ed economici](#6-stati-operativi-ed-economici)
7. [Gettone base, maturato e conteggi](#7-gettone-base-maturato-e-conteggi)
8. [Smartphone iniziale e coppie aggiuntive](#8-smartphone-iniziale-e-coppie-aggiuntive)
9. [DRMS: dati, normalizzazione e righe ammesse](#9-drms-dati-normalizzazione-e-righe-ammesse)
10. [DRMS: priorità di abbinamento e finestra indipendente](#10-drms-priorità-di-abbinamento-e-finestra-indipendente)
11. [DRMS: saldo per competenza e transizioni](#11-drms-saldo-per-competenza-e-transizioni)
12. [Persistenza, stato manuale e assenza di esito](#12-persistenza-stato-manuale-e-assenza-di-esito)
13. [Riconciliazione, ricalcolo asincrono e diagnostica](#13-riconciliazione-ricalcolo-asincrono-e-diagnostica)
14. [Esempi DRMS sintetici](#14-esempi-drms-sintetici)
15. [Limiti attuali e distinzioni da conservare](#15-limiti-attuali-e-distinzioni-da-conservare)
16. [Fonti tecniche e casi di test](#16-fonti-tecniche-e-casi-di-test)

## 1. Glossario essenziale

| Termine | Significato in questo documento |
|---|---|
| Organizzazione / tenant | Perimetro dei dati. La stessa identità fiscale in organizzazioni diverse non costituisce un'unica CJ condivisa. |
| CJ / journey | Scheda persistita per una chiave cliente nell'organizzazione. |
| Item | Articolo/contratto derivato da una vendita BiSuite, distinto per organizzazione, vendita e articolo. Non coincide necessariamente con una pista premiabile. |
| Driver / pista | Famiglia di prodotto. Mobile apre la CJ; le altre cinque famiglie possono alimentare il gettone base. |
| Data trigger | Soglia configurata da cui una nuova SIM ammissibile può aprire una CJ. |
| T0 | Mese solare di apertura della CJ; `openedAt` conserva la data della vendita trigger. Non è la data di upload DRMS. |
| T1–T5 / T6 | I cinque mesi solari successivi a T0 / primo mese escluso dalla finestra commerciale. |
| Evento commerciale | Data attivazione dell'item, se disponibile, altrimenti data inserimento. Il reconcile imposta l'inserimento dalla data vendita e non inventa l'attivazione. |
| Competenza | Mese economico della singola riga DRMS; non necessariamente il mese principale del file che la contiene. |
| Esito DRMS | Stato economico calcolato dai movimenti agganciabili, separato dallo stato operativo e dall'eventuale scelta manuale. |
| Attivo | Item che supera il controllo degli stati; per contribuire deve superare anche eleggibilità, finestra e regole specifiche. |
| Stimato / maturato | Valori calcolati del gettone: il maturato richiede esiti positivi effettivi, anche presunti dove previsto. Nessuno dei due prova un pagamento del gettone CJ. |
| Ramo premio | Ramo iniziale del cliente qualificato oppure coppia successiva SIM–smartphone che dà diritto a un extra. Non è un nuovo cliente. |

## 2. Accesso e perimetro

- Le API CJ richiedono autenticazione e accesso al modulo `customer_journey`. Per gli utenti ordinari valgono abilitazione dell'organizzazione, eventuale vincolo di brand e permesso del profilo; il super admin bypassa il controllo modulo, non i controlli di organizzazione delle route CJ.
- Admin e super admin operano sull'organizzazione del proprio profilo. Le azioni di configurazione, **Rigenera da BiSuite** ed **Esita da DRMS** richiedono uno di questi ruoli.
- Un operatore vede le journey a cui è collegato tramite i nominativi BiSuite assegnati al profilo (`bisuiteAddetti`). Il dettaglio e le righe di report espongono i suoi item; le modifiche a stato, gettone e dettagli verificano l'appartenenza dell'item. Nessun addetto assegnato significa nessun perimetro operativo, non accesso a tutto il tenant.
- La lista può riassumere anche la fase di driver di altri addetti della stessa journey («altrui»); questo non autorizza a leggere o modificare quei contratti. Non interpretare un riepilogo di scheda come elenco completo dei propri item.
- DRMS Commissioning è riservato agli amministratori, con verifica dell'organizzazione dell'upload. L'esito CJ usa soltanto upload e item della stessa organizzazione.

Fonti: `requireModule` e route CJ/DRMS in [routes.ts](../server/routes.ts); interrogazioni CJ in [storage.ts](../server/storage.ts).

## 3. Identità, apertura e ricalcolo T0

### 3.1 Identità cliente

Il reconcile converte CF e P.IVA in stringhe, elimina gli spazi esterni e porta in maiuscolo. Non esegue una validazione fiscale, una correzione anagrafica o una fusione tramite telefono/email.

| Dati BiSuite disponibili | Chiave e tipo CJ |
|---|---|
| `clienteTipo` = `GIURIDICA` o `PROFESSIONISTA`, con P.IVA | P.IVA; tipo azienda. |
| Altrimenti CF presente | CF; tipo privato, anche se il tipo sorgente era professionista ma mancava la P.IVA. |
| CF assente, P.IVA presente | P.IVA; tipo azienda. |
| Entrambi assenti | Vendita non collegabile. Conteggiata negli scarti; separatamente si contano gli scarti contenenti almeno una categoria tracciata. |

L'unicità è **organizzazione + chiave cliente**. Non esiste una seconda CJ per la seconda SIM dello stesso cliente. Il raggruppamento usa la chiave scelta: avere lo stesso CF su vendite azienda con P.IVA differenti non equivale automaticamente alla stessa journey.

### 3.2 Apertura e scelta iniziale

Serve una vendita con:

1. identità fiscale utilizzabile;
2. almeno un articolo mobile ammissibile secondo le esclusioni della sezione 4;
3. stato vendita non annullato;
4. data vendita presente e maggiore o uguale alla data trigger.

La data trigger è per organizzazione, con fallback **1 luglio 2026** se la configurazione manca o non è interpretabile. L'interfaccia salva il primo giorno del mese scelto; l'API di configurazione accetta una data `AAAA-MM-GG`. Salvare la soglia non ricostruisce immediatamente le schede: la si applica con una successiva riconciliazione.

Si sceglie la prima vendita valida per data; a parità di data vince l'ID numerico BiSuite minore. Dentro quella vendita, la SIM ammissibile con ID articolo minore riceve il marker persistito di SIM iniziale (`cjTriggerMobile`). Un fisso presente nello stesso scontrino non diventa la SIM attivante.

### 3.3 Ricalcolo, non riapertura

Ogni reconcile ricalcola vendita trigger, `openedAt` e marker iniziale dalla copia locale corrente delle vendite:

- una SIM valida più vecchia, scaricata successivamente, può spostare T0 indietro;
- annullamento/rimozione della vecchia SIM o spostamento della soglia può spostarlo avanti;
- se non rimane nessun trigger ammissibile, la journey esce dal perimetro e viene rimossa;
- una normale SIM successiva non riapre la CJ e non avvia una nuova finestra.

La perdita economica DRMS della SIM iniziale non è l'annullamento della vendita BiSuite: di per sé non risceglie il trigger del reconcile. Può invece cambiare attivazione, coorte e gettone.

Per letture di dati incompleti, il mese T0 ha questi fallback: mese di `openedAt`, primo mese di una SIM ammissibile attiva, primo mese evento disponibile. Sono regole di tolleranza, non percorsi alternativi per aprire nuove journey. Se la SIM iniziale non è visibile all'operatore, una SIM successiva con marker falso non viene presentata come nuova iniziale.

## 4. Driver e vendite annullate

### 4.1 Categorie effettivamente mappate

Il confronto categoria è in maiuscolo con spazi esterni rimossi. La mappa CJ è distinta dalle regole di punteggio Gara/Canvass.

| Driver CJ | Categorie BiSuite riconosciute | Nota |
|---|---|---|
| Mobile | `UNTIED`, `TIED CF`, `TIED IVA`, `ALTRE GA`, `ADD-ON GA`, `VERY MOBILE` | Richiede anche il filtro mobile sotto descritto. |
| Fisso | `ADSL/FIBRA/FWA CF`, `ADSL/FIBRA/FWA IVA`, `FISSO VOCE`, `ADD-ON FISSI` | Una pista distinta, non una pista per contratto. |
| Energia | `ENERGIA W3`, `ACEA ENERGIA` | Luce e gas sono una sola pista; il dato POD/PDR viene conservato sull'item. |
| Assicurazioni | `ASSICURAZIONI`, `ASSICURAZIONI BUSINESS PRO`, `WINDTRE SECURITY PRO GA` | Distinte da Protetti. |
| Smartphone (`telefono`) | `TELEFONIA` | L'item è tracciato; solo `tipologia=SMARTPHONE` con associazione verificata è premiabile. |
| Windtre Protetti (`protetti`) | `ALLARMI` | Prodotto Protetti, non SIM per allarme. |
| Nessun driver CJ | Tutte le altre categorie | CB, MIA, rivincoli, ricariche e altre categorie non mappate non creano piste CJ. |

### 4.2 Esclusioni mobile

La sola appartenenza a una categoria mobile non basta. `isCjMobileEligible` esclude:

- segnali `TOURIST`, `TURISTICHE`, `TURISTICA`, `TURISTICO` in tipologia o descrizione;
- la tipologia esatta `ALTRE GA NON TURISTICHE`;
- segnali «SIM allarme», «SIM per allarmi», «allarme SIM» e varianti previste dal riconoscitore;
- tipologie contenenti la parola `DATI` o `DATA` senza la parola `VOCE`;
- descrizioni riconosciute come offerte dati, per esempio «SIM dati», «Professional Data 100», «Data Only».

Trattini e underscore vengono normalizzati a spazi nel riconoscimento. Una voce con «200 giga e dati inclusi» non è esclusa soltanto perché menziona dati: contano i pattern implementati, non una generica ricerca della parola. Queste SIM escluse possono restare item storici se la categoria è mappata, ma non aprono CJ, non anticipano T0 e non entrano nei conteggi SIM/coorti/premi.

### 4.3 Vendite annullate

Il reconcile considera annullato uno stato vendita il cui testo, in maiuscolo, contiene `ANNULL`.

| Caso | Comportamento |
|---|---|
| Item mobile di vendita annullata | Non viene importato nella CJ; se era già presente viene eliminato dalla ricostruzione. Non è una SIM valida né una caduta economica CJ. |
| Item non-mobile di vendita annullata | Può restare nello storico del cliente qualificato, con stato iniziale economico `annullato`. In aggiornamento l'annullato BiSuite riempie solo un economico vuoto e non manuale. |
| Item con annullamento/storno DRMS o manuale | Resta tracciato con il relativo esito, ma è inattivo; non viene rimosso per questo solo motivo. |
| Vendita annullata nella diagnostica sorgente | Può comparire fra gli scarti per spiegare il confronto con BiSuite; non rientra nei partecipanti. |

## 5. Acquisti successivi, finestra commerciale e validità

Una volta trovato il cliente con un trigger valido, il reconcile collega gli articoli delle categorie tracciate delle sue vendite presenti localmente, anche precedenti al trigger e successive alla finestra. **Essere nello storico non significa contribuire al gettone.** Sono esclusi gli item senza ID articolo necessario all'unicità; gli acquisti senza identità fiscale non vengono collegati per somiglianza.

La finestra commerciale è **T0–T5 inclusi, per mesi solari UTC**, cioè sei mesi contando T0:

| Esempio: apertura il 20 luglio 2026 | Contributo temporale |
|---|---|
| Prodotto del 30 giugno 2026 | Fuori finestra. |
| Prodotto del 5 luglio 2026 | Nel mese T0: può contare anche se precede il giorno della SIM. |
| Prodotto del 31 dicembre 2026 | T5: ancora incluso. |
| Prodotto del 1 gennaio 2027 | T6: escluso. |
| Nuova SIM di gennaio 2027 | Resta acquisto storico; non riavvia T0 e non entra nel volume SIM valido di quella finestra. |

Per la collocazione commerciale vale **data attivazione, altrimenti data inserimento**. Modificare manualmente la data attivazione può quindi cambiare la collocazione commerciale, non l'inizio della finestra DRMS.

`pisteInWindow` conserva una tolleranza: se manca un T0 collocabile o una data evento interpretabile, non esclude automaticamente l'item ordinario per il solo dato mancante. **Le associazioni smartphone sono più restrittive:** richiedono T0 e date verificabili di entrambi i membri.

| Indicazione di validità | Significato |
|---|---|
| Attivante | SIM iniziale, non pista cross-sell. Il marker identifica un ruolo, non prova che oggi la SIM sia attiva o pagata. |
| Conta | Primo item valido di un driver non-mobile nella finestra. |
| Non conta: driver duplicato | Un'altra fornitura dello stesso driver è già conteggiata, per esempio gas dopo luce. |
| Non conta: stato non valido | KO operativo oppure annullato/stornato economico. |
| Non conta: fuori periodo | Item datato prima di T0 o dopo T5. |
| Non conta: SIM aggiuntiva / SIM esclusa | Mobile non è una pista base; le SIM non ammissibili non sono neppure volume valido. |
| Extra +20 € | Coppia successiva valida: premio separato, non una sesta pista. |
| Smartphone escluso | Articolo non smartphone o collegamento, stato, periodo o unicità non sufficienti. |

Una pista è attivata quando esiste almeno un item attivo **e ammissibile per quella pista nella finestra**. La validità «Conta» distingue driver, non numero di contratti. Il badge dell'item rappresentativo non attribuisce a quell'item l'intero valore monetario dello scaglione.

## 6. Stati operativi ed economici

| Dimensione | Valori | Origine e precedenza |
|---|---|---|
| Operativa (`state`) | `inserito`, `in_lavorazione`, `attivato`, `ko` | BiSuite introduce `inserito`. Una scelta manuale è protetta dal reconcile. Il DRMS non modifica mai questo campo. |
| Economica (`economicState`) | assente, `pagato`, `annullato`, `stornato`, `riaccreditato` | Esito DRMS, scelta manuale oppure annullamento BiSuite nei casi ammessi. La scelta economica manuale prevale sul motore. |
| Conferma gettone (`gettoneConfirmed`) | sì/no, con autore e data | Spunta manuale separata: non è stato operativo, stato DRMS o prova di pagamento. |

La regola unica `isCjItemActive` richiede:

- stato operativo diverso da `ko`;
- stato economico diverso da `annullato` e `stornato`.

Per compatibilità, anche `annullato`/`stornato` legacy nel campo operativo rendono l'item inattivo. Al boot una migrazione separa gli stati economici legacy: pagato/riaccreditato diventano economico positivo e operativo attivato; annullato/stornato diventano economico negativo e operativo inserito.

Un item **inserito e senza esito** è attivo. `riaccreditato` è positivo sia per attività sia per maturato. `attivato + stornato` è inattivo; `ko + pagato` è inattivo. Lo stato della journey («aperta») non sostituisce i controlli sugli item e la scadenza commerciale non costituisce da sola una chiusura automatica della scheda.

## 7. Gettone base, maturato e conteggi

### 7.1 Base per cliente, non per SIM

Le cinque piste base sono Fisso, Energia, Assicurazioni, Smartphone iniziale qualificato e Protetti. Mobile è il prerequisito, non una pista cross-sell. Più contratti dello stesso driver non aggiungono scaglioni.

| Piste non-mobile distinte attive e valide | Gettone base stimato |
|---:|---:|
| 0 | 0 € |
| 1 | 20 € |
| 2 | 30 € |
| 3 | 40 € |
| 4 | 100 € |
| 5 | 120 € |

L'analisi stock include soltanto journey con almeno una SIM mobile **ammissibile, attiva e in finestra**. Non richiede che quella SIM sia già economicamente pagata per calcolare il gettone base. Se nessuna SIM supera i controlli, la journey è esclusa dall'analisi gettoni, anche se ha prodotti non-mobile.

### 7.2 Stimato, maturato, esplicito e presunto

| Misura | Calcolo effettivo |
|---|---|
| Stimato totale | Base sulle piste valide attive + 20 € per ogni coppia extra valida. |
| Base maturata | Stesso scaglione, ricalcolato sul numero di piste valide con stato economico effettivo `pagato` o `riaccreditato`. |
| Economico effettivo | Economico esplicito se presente; altrimenti `pagato` presunto per il driver `telefono`, e assente per gli altri. |
| Base esplicita | Scaglione sulle sole piste con esito positivo esplicito. Può provenire da DRMS o da scelta economica manuale. |
| Base presunta | Differenza fra base maturata comprensiva di presunti e base esplicita. Non una quota fissa per singolo smartphone. |
| Gettone confermato a mano | Scaglione sulle piste valide con la spunta manuale; resta distinto dal maturato economico. |
| Extra maturato / esplicito / presunto | Regole di coppia della sezione 8. Il presunto è maturato extra meno extra esplicito. |

L'etichetta smartphone **«Liquidato · da verificare»** indica una presunzione applicativa quando l'economico manca, non un movimento DRMS. Un economico manuale Annullato/Stornato prevale e lo esclude. Nessun valore sopra dimostra che il gettone CJ sia stato effettivamente versato.

Gli importi DRMS servono a determinare lo stato del contratto: il maturato CJ applica comunque la tabella a scaglioni, **non somma i compensi DRMS**.

**Esempio:** SIM attiva senza esito, Fisso pagato, Energia inserita senza esito: due piste attive, stimato base 30 €, maturato base 20 €. Se si aggiunge lo smartphone iniziale valido senza esito, le piste diventano tre: stimato 40 €, maturato 30 € (20 € espliciti + 10 € di differenza presunta).

### 7.3 Clienti, SIM, rami e filtri temporali

- **Clienti:** journey distinte qualificate. **SIM:** numero di item mobile ammissibili attivi in finestra, anche più di uno per cliente.
- **Rami premio:** un iniziale per cliente qualificato + coppie extra valide deduplicate. Una SIM sola non apre un ramo extra.
- La percentuale clienti con prodotti usa clienti distinti con almeno una pista base attiva; le SIM aggiuntive non moltiplicano il denominatore.
- La saturazione è piste base / 5. Incrementi e potenziale residuo riguardano la sola base: pieno residuo = `max(0, 120 € − base stimata)`. Gli extra non consumano piste e non riducono quel residuo. Gli scenari applicano prodotti aggiuntivi e percentuale di saturazione scelta a questa base.
- Nell'Analisi gettoni la soglia trigger si applica a `openedAt` per tutti i ruoli; il filtro da–a usa invece la **prima data inserimento disponibile tra le SIM attive valide** della journey. Non è un filtro su ogni acquisto successivo né un semplice volume venduto nel mese. Gli estremi sono inclusivi per data UTC; una data mancante non supera un intervallo impostato.
- Nelle aggregazioni per PDV il base resta sul PDV della SIM trigger; SIM ed extra seguono la propria vendita. La vista origine/destinazione sceglie la dimensione di attribuzione; la destinazione effettiva proviene dalla vendita sorgente, non dal solo campo manuale. Una journey può apparire in più negozi: i clienti dei gruppi non si sommano come clienti unici globali.
- L'analisi mensile delle coorti distingue mese apertura, mese inserimento acquisto e mese riconoscimento economico. Ricostruisce i riconoscimenti dalle competenze DRMS, non dagli istanti di upload; può mostrare variazioni negative da storno e quote non attribuibili quando manca storia. La coorte storica resta distinta dallo stock corrente con SIM attiva. «In attesa» è uno stock residuo, non generato del mese meno riconosciuto del mese.

## 8. Smartphone iniziale e coppie aggiuntive

### 8.1 Prova del collegamento

Serve categoria `TELEFONIA` e tipologia esatta `SMARTPHONE` (confronti maiuscolo/trim), più ICCID verificabile da `venditaInfo1..5` con etichetta ICCID.

L'ICCID resta stringa: si rimuovono spazi e trattini, si ammettono 18–22 cifre non tutte zero e si preservano gli zeri iniziali. Numeri JSON, valori mancanti o etichette con valori incompatibili non danno un collegamento certo. Cliente, numero telefonico e IMEI **non sostituiscono l'ICCID**. Un articolo SIM fisica non crea da solo una seconda attivazione CJ.

### 8.2 Iniziale ed extra

| Caso | Effetto |
|---|---|
| Smartphone della vendita trigger, stesso ICCID della SIM iniziale selezionata | Concorre alla pista Smartphone della base, se entrambi attivi e datati T0–T5. |
| Più SIM nello scontrino iniziale | Solo lo smartphone della SIM iniziale selezionata può essere pista base; le altre coppie dello stesso scontrino non generano extra. |
| Vendita successiva con nuova SIM ammissibile e smartphone nella stessa vendita, ICCID uguale nella coppia e diverso da quello iniziale | +20 € separati. Nessuna nuova CJ, pista base o riapertura di T0. |
| Smartphone in scontrino successivo con ICCID iniziale | Né pista iniziale né coppia extra, anche se il riferimento alla SIM è leggibile. |
| SIM sola, telefono solo, ICCID discordanti, più attivazioni distinte con lo stesso ICCID | Nessun extra. |
| Smartphone CB/rivincolo su SIM precedente alla CJ | Provenienza commerciale visibile se verificabile, ma non pista o coppia CJ. |

«Successiva» significa data evento della SIM maggiore di quella iniziale oppure, a pari data/istante, ID numerico BiSuite maggiore. Deve essere un'altra vendita; la data evento smartphone deve essere presente e non antecedente a quella SIM. Entrambi devono essere entro il T5 **originario** e attivi. Quando più copie rappresentano lo stesso contratto, il gruppo non può contenere un membro inattivo per ottenere il premio.

Il medesimo ICCID fisico non viene premiato due volte, neppure su scontrini diversi. Copie dello stesso contratto/associazione sono deduplicate; attivazioni distinte con uguale ICCID rendono l'abbinamento ambiguo. Più coppie successive verificabili con ICCID distinti possono generare più extra.

### 8.3 Maturazione e conferma della coppia

- **Iniziale:** lo smartphone valido usa il suo economico positivo esplicito o presunto per alimentare la pista maturata; la SIM deve essere attiva, non necessariamente pagata.
- **Extra stimato:** coppia valida = 20 €.
- **Extra maturato:** smartphone positivo effettivo **e tutte le SIM del gruppo associato positive effettive**. La presunzione telefono non basta da sola: la SIM non ha pagamento presunto.
- **Extra esplicito:** esiti positivi espliciti su entrambi i membri/gruppo. Se la SIM è pagata ma il telefono è solo presunto, l'extra maturato è presunto.
- **Extra confermato manualmente:** spunta gettone sul telefono e su tutte le SIM del gruppo; separata dai due stati economici.

**Esempio:** `CF-DEMO-A` apre a luglio con SIM A e telefono A, ICCID fittizio `89000000000000000001`. Ad agosto compra SIM B + telefono B, ICCID `89000000000000000002`, sulla stessa vendita. Se validi, base Smartphone 20 € + extra 20 € = stimato 40 €. Con telefoni presunti e SIM B senza esito: maturato 20 €, non 40 €. Se SIM B passa a pagato: maturato 40 €, con extra presunto finché il telefono B non ha un positivo esplicito. Un'ulteriore coppia a gennaio 2027 non vale extra.

I collegamenti visuali distinguono abbinamento valido, semplice corrispondenza ICCID, ambiguità e non verificabilità. Il canale commerciale Mobile/CB ricavato dagli articoli dello scontrino è informazione di provenienza: non modifica l'eleggibilità o le regole DRMS.

## 9. DRMS: dati, normalizzazione e righe ammesse

Il parser conserva, fra gli altri, `SEQ_ID`, `CODICE_CONTRATTO`, `FISCAL_CODE`, `P_IVA_CLIENTE`, `POD_PDR`, `NATURA`, `TIPO_FONIA`, `COMPETENZA`, `CAUSALE_STORNO`, `DATA_EVENTO`, `TIPO_TRANSAZIONE`, `DESCRIZIONE_EVENTO`, `IMPORTO_NUM`/`IMPORTO`. La classificazione nei capitoli di Commissioning non decide da sola l'esito CJ.

Nell'interfaccia Commissioning, ricaricare lo stesso periodo propone un'unione per `SEQ_ID`: le righe già note vengono aggiornate, quelle nuove aggiunte e quelle non presenti nel nuovo file conservate; le nuove righe senza SEQ_ID sono accodate. L'API salva il payload del periodo (con conferma di sovrascrittura se esiste già), non esegue da sola quell'unione. Il motore CJ analizza tutte le righe effettivamente salvate: non applica una deduplicazione globale aggiuntiva per SEQ_ID tra file diversi.

| Dato | Trattamento effettivo del motore |
|---|---|
| Codice contratto, CF, P.IVA, POD/PDR, fonia, natura e causali di confronto | Stringa, trim, maiuscolo. Spazi interni e punteggiatura non vengono rimossi: non è un confronto approssimativo. |
| Competenza | Formati riconosciuti come `2026-07`, `202607`, `2026-07-01`, `LUG-26`/`LUG-2026` e abbreviazioni previste anche inglesi; risultato `AAAA-MM`. Se non interpretabile la riga non entra nell'indice. Non equivale a una validazione completa di ogni data possibile. |
| Importo | Prima numero finito `IMPORTO_NUM`; altrimenti conversione testuale da `IMPORTO_NUM` o `IMPORTO`, con gestione della virgola decimale e del formato `1.234,56`. Vuoto/non numerico diventa zero. |
| Data evento DRMS | Stringa ordinata lessicograficamente, poi `SEQ_ID` come stringa per spareggio nella stessa competenza. Non determina il mese finestra. |

### Righe economiche ammesse

| Riga | Ammessa all'esito? |
|---|---|
| `NATURA=CONTRATTUALE` | Sì, se produce un evento secondo importo/causale e ha competenza e chiavi utilizzabili. |
| `NATURA=GARE` e `TIPO_FONIA=PROTECTA` | Sì: eccezione esplicita per Windtre Protetti. |
| Altre GARE | No, salvo l'eccezione storno compensi sottostante. |
| `TIPO_TRANSAZIONE` contiene `ADJUSTMENT` e `DESCRIZIONE_EVENTO` contiene `STORNO COMPENSI` | Ammessa come evento storno anche senza natura contrattuale. |
| Importo zero senza causale di annullamento e non adjustment storno | Nessun evento: non equivale a un annullamento. |

Per le righe ammesse: un importo positivo produce evento credito, un negativo evento storno, zero con causale ammessa evento annullamento. L'adjustment «Storno Compensi» viene classificato storno prima del controllo del segno, ma **il saldo usa comunque l'importo numerico originale**, senza forzarlo negativo.

Le causali di annullamento riconosciute a zero sono: `DINIEGO`, `POPI`, `POPI ESTESA`, `DISCONOSCIMENTO`, `KO_REITERO`, `KO REITERO`, `NP INTERNA`. Una riga contrattuale positiva con `NP INTERNA` è un credito, non un annullamento.

Le righe senza codice contratto, ma con CF o P.IVA, sono raggruppate sotto una chiave sintetica cliente+fonia (`__CF:…`). Questo vale nel codice per ogni evento ammesso senza codice, non soltanto per gli storni manuali. Senza codice e senza identità fiscale la riga non è indicizzabile. Le chiavi sintetiche non vengono mostrate nell'elenco dei codici contratto reali agganciati.

## 10. DRMS: priorità di abbinamento e finestra indipendente

### 10.1 Priorità per driver

Si costruiscono prima gli indici delle sole righe economiche ammesse e interpretabili. Le priorità sotto indicano **selezione di candidati**, non concatenazione indiscriminata di tutti gli abbinamenti.

| Driver item CJ | Prima priorità | Seconda | Ultima possibilità |
|---|---|---|---|
| Mobile | Codice contratto | CF e/o P.IVA + `MOBILE` | Nessun match. |
| Fisso | Codice contratto | CF e/o P.IVA + `FISSO` | Nessun match. |
| Assicurazioni | Codice contratto | CF e/o P.IVA + `ASSICURAZIONI` | Nessun match. |
| Protetti | Codice contratto | CF e/o P.IVA + `PROTECTA` | Nessun match; non usa `ALLARMI` come fonia DRMS. |
| Smartphone (`telefono`) | Solo codice contratto | Nessun fallback fiscale | Non prende i pagamenti `MOBILE` della SIM per somiglianza cliente. |
| Energia | POD e/o PDR dell'item | Codice contratto, se non ci sono candidati POD/PDR | CF e/o P.IVA + `ENERGIA`, se mancano anche candidati per codice. |

**Energia:** l'indice POD/PDR viene alimentato solo da righe con `TIPO_FONIA=ENERGIA`. Un POD scritto in una riga MOBILE non la rende una fornitura energia. POD e PDR dell'item vengono cercati entrambi e i contratti trovati sono uniti. Il codice BiSuite può essere diverso dal codice DRMS: non è un errore se il match avviene per POD/PDR.

Il match esatto per codice non impone ulteriormente uguaglianza di CF o di fonia. Il fallback fiscale, invece, impone la fonia prevista. Quando presenti, CF e P.IVA dell'item vengono cercati entrambi e i candidati si uniscono; non si valida che rappresentino un solo rapporto commerciale.

### 10.2 Finestra economica propria dell'item

Dopo la selezione dei candidati, gli eventi sono limitati alle competenze comprese fra **mese inserimento dell'item e cinque mesi successivi inclusi** (`DRMS_WINDOW_MONTHS=5`). Senza data inserimento interpretabile non viene applicato il limite.

Esempio: CJ aperta a luglio, energia inserita a novembre 2026. La sua vendita contribuisce commercialmente perché novembre è T4; il suo esito DRMS può usare competenze **novembre 2026–aprile 2027**, non solo fino al dicembre della CJ. La data attivazione manuale, la data upload, `DT_ATTIVAZIONE` DRMS e il periodo principale del file non sostituiscono l'inserimento per questa finestra.

**Limite importante:** si passa al fallback soltanto se la priorità superiore non ha candidati nell'indice. Se trova un codice/POD ma tutti i suoi eventi sono fuori finestra o non producono uno stato, il risultato è nessun esito: non viene ritentato il fallback fiscale. Anche un match preciso può quindi restare senza esito utile.

### 10.3 Più contratti candidati

Ogni candidato viene prima valutato separatamente nella finestra dell'item. I candidati senza esito utile vengono esclusi dalla scelta finale.

| Esiti dei candidati rimasti | Regola |
|---|---|
| Esiste almeno un `pagato` | Si sceglie un pagato. |
| Nessun pagato, almeno un `riaccreditato` | Si sceglie un riaccreditato. |
| Solo esiti negativi, almeno uno `stornato` | Si sceglie uno stornato. |
| Solo `annullato` | Si sceglie un annullato. |
| Stati finali differenti | `ambiguous=true`, anche se la preferenza produce uno stato finale. |
| Più contratti con lo stesso stato | Non sono marcati ambigui per il solo numero. |

L'ordine è dunque **pagato > riaccreditato > stornato > annullato**, non «contratto più recente». A parità di preferenza il motore prende il primo candidato incontrato: non esiste un ulteriore criterio commerciale documentabile di spareggio.

`competenza` è la più antica prima competenza utile fra i contratti con esito; `outcomeCompetenza`, importo, causale e storia appartengono al candidato scelto. La storia restituita non è la somma delle storie di tutti i candidati. Il motore non riserva un contratto a un unico item: il fallback fiscale può associare lo stesso contratto a più item compatibili.

## 11. DRMS: saldo per competenza e transizioni

Per ciascun codice/chiave sintetica, gli eventi già filtrati vengono raggruppati per competenza. Le competenze si applicano in ordine crescente. **Ogni mese si sommano gli importi dei soli eventi ammessi di quel mese**, non un saldo cumulativo dall'origine del contratto e non tutte le righe del file.

| Saldo del mese | Stato precedente | Risultato |
|---|---|---|
| Positivo | `stornato` | `riaccreditato`. |
| Positivo | Assente o qualsiasi altro stato | `pagato`. Anche dopo `annullato`; un successivo mese positivo dopo `riaccreditato` torna `pagato`. |
| Negativo | Qualsiasi / assente | `stornato`. |
| Zero con evento di causale annullamento | Assente | `annullato`. |
| Zero con annullamento | Stato già presente, incluso pagato | Non cambia lo stato. Non c'è addebito negativo da interpretare come storno. |
| Zero senza annullamento | Qualsiasi / assente | Non cambia nulla. Se non esisteva stato, continua a non esserci un esito. |

Esempio nello stesso mese: **+30 € attivazione −5 € opzione = +25 € ⇒ pagato**, anche se la riga negativa è successiva. **+30 € −30 € = zero**, senza causale annullamento e senza storia precedente, non produce né pagato né stornato.

Esempio su competenze diverse: luglio +30 € ⇒ pagato; agosto −30 € ⇒ stornato; settembre +30 € ⇒ riaccreditato. Non è necessario che il riaccredito pareggi tutto lo storico: conta il segno del nuovo mese e lo stato precedente.

### Riferimenti economici e storia

- Nel mese positivo la riga di riferimento è l'ultimo evento credito; nel negativo l'ultimo evento storno, ordinati per data evento e poi SEQ_ID. Per l'annullamento iniziale si prende l'ultimo evento annullamento del mese.
- `history.importo` è il **saldo mensile**; `outcome.importo` e l'importo persistito sull'item sono l'**importo della riga di riferimento**, che può essere diverso dal saldo.
- I mesi senza transizione utile non aggiungono una voce di storia. Lo stato finale è quello dell'ultima competenza che ha prodotto una transizione utile.
- La prima competenza restituita dal motore è quella del primo gruppo di eventi ammessi nella finestra del contratto, anche se quel gruppo non ha prodotto una transizione. Non è garantito che sia la prima attivazione o soltanto una riga strettamente `CONTRATTUALE`: esistono anche PROTECTA/GARE e adjustment.

Per questo la formula «vince sempre l'ultima riga» è sbagliata, così come «vince l'ultimo file caricato».

## 12. Persistenza, stato manuale e assenza di esito

Il ricalcolo legge tutti gli upload dell'organizzazione, calcola gli esiti e aggiorna gli item rilevati come cambiati. Conserva separatamente stato economico effettivo, ultimo esito DRMS, competenza, riferimento riga, criterio di match e incongruenza. Non modifica l'operativo.

| Situazione | Economico effettivo | Incongruenza DRMS |
|---|---|---|
| Non manuale, esito DRMS presente | Segue il DRMS. | No. |
| Manuale, DRMS uguale | Conserva il manuale. | No. |
| Manuale, DRMS diverso e presente | Conserva il manuale; conserva anche l'esito DRMS separato. | Sì, `drmsMismatch`. |
| Manuale, nessun esito DRMS | Conserva il manuale. | No: assenza non è discordanza con uno stato noto. |
| Esito DRMS scomparso, economico uguale al precedente esito DRMS, non manuale | Azzera l'economico e i riferimenti DRMS. | No. |
| Nessun esito DRMS, economico di altra origine | Lo preserva, per esempio annullato BiSuite senza precedente esito DRMS che lo giustificasse. | No. |
| Scelta manuale rimossa impostando economico automatico (`null` nella PATCH) | Toglie il flag manuale e applica l'ultimo esito DRMS persistito, oppure `null` se assente. Non rilegge i file in quella PATCH. | Ricalcolata/azzerata. |

L'azzeramento alla scomparsa dell'esito è basato su precedente `drmsOutcomeState` e uguaglianza di stato, non su un registro completo della provenienza. Non va trasformato nella promessa «qualsiasi annullato BiSuite resta sempre comunque».

**Nessun match non significa annullato.** Può mancare il file, la chiave, il tipo riga utile, una competenza utilizzabile o l'evento in finestra. La rimozione di un upload ricalcola ciò che rimane: un altro file può ancora sostenere l'esito. Se lo stato diventa assente, l'item inserito può tornare attivo; un telefono senza esito torna soggetto alla presunzione, non risulta «pagato da DRMS».

### Upload legacy

Un upload non vuoto è segnalato legacy se **nessuna sua riga possiede almeno una delle chiavi** `FISCAL_CODE`, `POD_PDR`, `CAUSALE_STORNO`. Conta la presenza della chiave JSON, anche con valore vuoto, non la completezza del dato. Un upload vuoto non è legacy; un upload misto non viene classificato interamente legacy se almeno una riga ha una di quelle chiavi.

I dati mancanti non sono ricostruibili dal database: serve ricaricare l'originale. Il riepilogo espone upload e numero righe legacy; l'interfaccia mostra avvisi dedicati e distingue nessun file, file legacy e nessuna riga agganciabile nella finestra.

**Segnalato legacy non significa escluso in blocco:** una riga legacy con codice contratto, natura, importo e competenza sufficienti può ancora produrre un esito per codice; non può usare chiavi che non sono state conservate o riconoscere causali mancanti. Il conteggio `notFound` resta item senza esito, con dettaglio per driver; l'avviso legacy si aggiunge, non è una certificazione che tutti i non trovati siano spiegati.

## 13. Riconciliazione, ricalcolo asincrono e diagnostica

### 13.1 Tre attività da non confondere

| Attività | Effetto |
|---|---|
| Consultare schede, dettaglio, report, diagnostica o esportare | Legge e mostra lo stato disponibile. Non rigenera le CJ e non applica esiti DRMS implicitamente. |
| Rigenera da BiSuite / percorso di sincronizzazione vendite | Ricostruisce journey e item dalla copia locale delle vendite, applicando soglia, identità e trigger. |
| Esita da DRMS / upload o eliminazione DRMS | Ricalcola gli economici dai DRMS salvati, senza riclassificare gli stati operativi. |

Il fetch BiSuite, anche schedulato, richiama il reconcile. Esiste inoltre un controllo di obsolescenza basato su watermark delle vendite e versione di eleggibilità; non è un ricalcolo nascosto nelle normali letture CJ. Il salvataggio della data trigger rende necessaria una nuova ricostruzione.

La riconciliazione è transazionale, serializzata per organizzazione e idempotente. Aggiorna le informazioni sorgenti e deduplica gli item per vendita/articolo. Sugli oggetti ancora qualificati preserva stati manuali, economici già presenti, conferme gettone e dettagli manuali (attivazione, destinazione, IMEI, rata e ragione sociale nei rispettivi campi). **La conservazione non vale per item/journey fuori perimetro:** cancellazioni sorgenti, SIM annullate o perdita di ogni trigger possono eliminare righe e relativi dati manuali.

### 13.2 Esiti asincroni

Upload DRMS, sostituzione del periodo salvato e cancellazione di upload richiedono il ricalcolo; è disponibile anche l'azione admin Esita da DRMS. Il server attende normalmente fino a **10 secondi**:

- se pronto, restituisce il riepilogo;
- se ancora in corso, Esita risponde `202` con `pending: true`; upload/delete segnalano `cjOutcomesPending`;
- il risultato o l'errore differito arriva nella campanella con notifica `cj_drms_outcome`.

Il runner esegue un solo calcolo per organizzazione alla volta nel processo e riunisce le richieste concorrenti in un successivo run. Scrive un marker persistito di esecuzione prima di partire; dopo un riavvio recupera i run rimasti pendenti, notifica l'interruzione e li rilancia. La scritta «in corso» non equivale a «tutto già eseguito».

Le query proiettano solo i campi necessari dalle righe DRMS invece di caricare l'intero documento JSON. Il riepilogo distingue abbinati, non trovati per driver, ambigui, stati finali, aggiornati, incongruenze e legacy.

### 13.3 Diagnostica in sola lettura

La diagnostica SIM confronta sorgente BiSuite e dati CJ nel perimetro autorizzato; deve spiegare scarti e discrepanze senza «aggiustarli» durante consultazione o export. È un confronto fra flusso di vendite e clienti/SIM della CJ, non un secondo motore di apertura.

Un esito mancante, una vecchia ricostruzione, un operatore senza la SIM iniziale visibile o un acquisto storico fuori finestra sono situazioni diverse: non chiamarle tutte «annullamenti». Un export fotografa i risultati letti/calcolati; non dimostra l'esecuzione di una riconciliazione o l'avvenuto pagamento.

## 14. Esempi DRMS sintetici

Salvo indicazione diversa, item inseriti a luglio 2026, righe `CONTRATTUALE`, competenza luglio e importi numerici; tutti i riferimenti sotto sono inventati.

| Caso | Dati di esempio | Risultato e ragione |
|---|---|---|
| Codice esatto Mobile | Item `C-DEMO-M1`; DRMS codice ` c-demo-m1 `, +30 € | `pagato`, match `contratto`: trim/maiuscolo. Un codice `C DEMO M1` non è invece la stessa chiave. |
| Energia POD/PDR | Item codice `BIS-DEMO-E1`, POD `IT-DEMO-POD-A`; DRMS codice `DRMS-DEMO-E9`, stesso POD, fonia ENERGIA, +12 € | `pagato`, match `pod_pdr`, nonostante i codici contratto differenti. Vale analogamente per il PDR. |
| POD sulla fonia sbagliata | Stesso POD soltanto su una riga MOBILE; nessun codice o fallback ENERGIA utile | Nessun esito energia: quella riga non alimenta l'indice POD energia. |
| Fallback fiscale | Item Fisso senza codice, CF `CF-DEMO-A`; DRMS stesso CF, FISSO, codice `C-DEMO-F2`, +25 € | `pagato`, match `cf`. Stesso CF con MOBILE non basta per il Fisso. |
| Protetti | Item senza codice, P.IVA `PIVA-DEMO-A`; DRMS stessa P.IVA, PROTECTA, natura GARE, +18 € | `pagato`, match `cf`, per l'eccezione PROTECTA/GARE. Una GARE MOBILE non avrebbe lo stesso effetto. |
| Telefono senza codice | Telefono con CF `CF-DEMO-A`; soltanto DRMS MOBILE pagato per quel CF | Nessun match DRMS del telefono. L'eventuale presunto è un'altra regola, non un match. |
| Nessun esito in finestra | Item luglio; unico candidato codice `C-DEMO-M1` con credito gennaio 2027 | Nessun esito: gennaio è oltre dicembre; non diventa annullato e non riprova automaticamente per CF. |
| Più candidati fiscali | Stesso CF+fonia, `C-DEMO-1` pagato e `C-DEMO-2` stornato | `pagato`, `ambiguous=true`; non somma i due contratti e non sceglie automaticamente il più recente. |
| Storno e riaccredito | Stesso codice: luglio +30 €, agosto −30 €, settembre +30 € | Storia pagato → stornato → riaccreditato, indipendente dall'ordine di caricamento dei file. |
| Manuale discordante | Operatore imposta `annullato`; DRMS calcola `pagato` | Effettivo annullato, DRMS pagato separato, incongruenza sì; l'item resta inattivo. |
| Upload eliminato | Economico automatico pagato uguale all'esito precedente; dopo delete nessuna riga residua | Economico assente e riferimenti DRMS rimossi, non annullato. |

**Storno senza contratto:** una riga adjustment negativa per `CF-DEMO-A|ENERGIA`, senza codice, può generare stornato tramite fallback fiscale. Se il POD dell'item ha già trovato un diverso contratto pagato, non si somma automaticamente quello storno sintetico al contratto trovato per POD. Gli eventi restano separati per chiave e per priorità; in fallback con più candidati vale comunque la preferenza degli stati.

## 15. Limiti attuali e distinzioni da conservare

Questi punti descrivono l'implementazione osservata, non modifiche approvate:

1. **Identità fiscale non validata:** chiave normalizzata non significa identità fiscale certificata; nessuna fusione fuzzy o per telefono.
2. **Fallback fiscale ampio:** più contratti o più item dello stesso cliente/fonia possono condividere un esito. Ambiguo segnala stati differenti, non ogni situazione con molti candidati.
3. **Priorità prima della finestra:** un candidato preciso non utile in finestra può impedire il fallback successivo. Nessuna promessa di ricerca esaustiva alternativa.
4. **Storni sintetici separati:** non sono automaticamente ripartiti su tutti i contratti dello stesso cliente.
5. **Normalizzazione limitata:** trim/maiuscolo non correggono spazi interni, punteggiatura, codici corrotti o arrotondamenti pregressi. Competenza e importi hanno i limiti di conversione descritti.
6. **Date mancanti:** tolleranza ordinaria diversa dall'abbinamento smartphone rigoroso; non dedurre un diritto al premio da una data assente.
7. **Provenienza economica non completa:** l'azzeramento DRMS usa i campi di stato disponibili; il mese di riconoscimento non va inventato se la storia manca.
8. **Riferimento economico non saldo:** l'importo della riga esito può differire dal netto del mese e dal gettone CJ.
9. **Conferma manuale, positivo DRMS e presunzione sono distinti:** nessuno prova da solo il pagamento del gettone.
10. **Persistenza degli aggiornamenti:** `applyDrmsOutcomes` decide se saltare una scrittura confrontando economico, mismatch, stato DRMS, SEQ_ID, upload e prima competenza; causale/importo/competenza esito/match non sono confrontati separatamente. Una correzione che lasci invariati quei discriminanti non garantisce l'aggiornamento di ogni metadato persistito.

Eventuali cambi a queste scelte richiedono una decisione e un intervento separati. Questo documento non introduce nuove regole, premi, prodotti futuri, classificazioni Gara o procedure operative su dati reali.

## 16. Fonti tecniche e casi di test

I collegamenti sono relativi al repository. I nomi dei simboli permettono di ritrovare le regole anche se cambiano i numeri di riga.

### Fonti primarie

| Fonte | Parti da consultare |
|---|---|
| [shared/customerJourney.ts](../shared/customerJourney.ts) | `driverFromCategory`, `isCjMobileEligible`, `cjT0Month`, `pisteInWindow`, `isCjItemActive`, `effectiveEconomicState`, `buildGettoneJourneys`, `cjPhoneEligibility`, `normalizeCjIccid`, filtri e aggregazioni. |
| [shared/customerJourneyDrms.ts](../shared/customerJourneyDrms.ts) | `classifyDrmsRow`, `buildDrmsIndex`, `resolveItemOutcome`, `outcomeForEvents`, `applyOutcomeToState`, `detectLegacyDrmsUploads`, costanti fonia/causali/finestra. |
| [server/storage.ts](../server/storage.ts) | `reconcileCustomerJourneysLocked`, `pruneStaleCustomerJourneys`, configurazione trigger, righe report/coorti/diagnostica, `updateCustomerJourneyItemEconomicState`, `applyDrmsOutcomes`. |
| [shared/schema.ts](../shared/schema.ts) | `customerJourneys`, `customerJourneyItems`, `drmsUploads`, `cjDrmsOutcomeRuns`: unicità, marker e separazione stati. |
| [server/routes.ts](../server/routes.ts) | Accesso modulo e ownership; GET/PATCH/POST CJ; upload/delete DRMS; avvio recupero run. |
| [server/bisuiteFetch.ts](../server/bisuiteFetch.ts) | Reconcile dopo il percorso di sincronizzazione delle vendite. |
| [server/cjDrmsOutcomeRunner.ts](../server/cjDrmsOutcomeRunner.ts) | Serializzazione, coalizzazione, limite inline, marker e recupero interruzioni. |
| [client/src/pages/CustomerJourney.tsx](../client/src/pages/CustomerJourney.tsx) | Applicazione soglia/filtro inserimento, viste, configurazione, azioni e presentazione presunto/mismatch. |
| [client/src/lib/customerJourneyTimeline.ts](../client/src/lib/customerJourneyTimeline.ts) | `computeTimeline`, `computeItemValidity`, `cjT5Deadline`: mesi UTC, marker e badge. |
| [shared/customerJourneyPhoneLink.ts](../shared/customerJourneyPhoneLink.ts) e [PhoneCommercial](../shared/customerJourneyPhoneCommercial.ts) | Collegamenti visuali e provenienza, senza modifica dell'eleggibilità. |
| [shared/customerJourneyCohorts.ts](../shared/customerJourneyCohorts.ts) | `buildCjCohortModel`, `summarizeCjCohort`: flussi vendite/riconoscimenti e stock residui. |
| [shared/customerJourneyDiagnostics.ts](../shared/customerJourneyDiagnostics.ts) | Confronto SIM sorgenti, appartenenza e motivi di esclusione. |
| [client/src/lib/drmsClassifier.ts](../client/src/lib/drmsClassifier.ts) | `classifyAndNormalize`: conservazione e normalizzazione dei campi di esito, distinta dai capitoli. |
| [client/src/pages/DrmsCommissioning.tsx](../client/src/pages/DrmsCommissioning.tsx) | Unione dei caricamenti del medesimo periodo per SEQ_ID prima del salvataggio. |

### Test consultati come specifiche eseguibili

Non sono stati eseguiti test che scrivono dati o avviano ricalcoli per redigere il documento.

| Test | Casi pertinenti |
|---|---|
| [drms-outcome](../tests/customer-journey-drms-outcome.test.mjs) | Righe ammesse, PROTECTA/GARE, saldi mensili, storni senza codice, riaccredito, priorità, più candidati, finestra, manuale, legacy. |
| [drms-outcome-db](../tests/customer-journey-drms-outcome-db.test.mjs) | Persistenza esiti dopo upload, manuale discordante, azione Esita e delete. |
| [window-eligibility](../tests/customer-journey-window-eligibility.test.mjs) | Esclusioni mobile, giorno prima della SIM nello stesso T0, T5/T6, SIM successiva senza reset. |
| [validity-gettone-parity](../tests/customer-journey-validity-gettone-parity.test.mjs) | Badge e piste coerenti, gas+luce, stati negativi, trigger non-mobile nei dati incompleti. |
| [smartphone](../tests/customer-journey-smartphone.test.mjs) | ICCID, iniziale/extra, più SIM, duplicati, KO/annulli, maturato esplicito/presunto/confermato, riferimento CB e perimetro operatore. |
| [eligibility-reconcile](../tests/customer-journey-eligibility-reconcile.test.mjs) | Vendite mobile annullate distinte da annulli economici; backfill ICCID, T0 e conservazione manuale; letture senza scritture. |
| [reconcile](../tests/customer-journey-reconcile.test.mjs) | Dettagli manuali, acquisto successivo, identità assente, trigger spostato, eliminazione fuori perimetro, SIM più vecchia scoperta dopo. |
| [trigger-date](../tests/customer-journey-trigger-date.test.mjs) | Configurazione soglia e apertura conseguente, input non valido. |
| [cohorts](../tests/customer-journey-cohorts.test.mjs) | Separazione temporale fra coorte, vendite e riconoscimenti, storni e storia incompleta. |
| [drms-runner](../tests/customer-journey-drms-runner.test.mjs) | Attesa limitata, richieste coalizzate, notifica e persistenza/recupero dei run. |

### Documentazione preesistente confrontata

[customer-journey.md](customer-journey.md) e [drms-commissioning.md](drms-commissioning.md) sono fonti di orientamento, non prevalgono sull'implementazione. In particolare:

- «GARE ignorate» va letto con eccezione PROTECTA e adjustment storno;
- «prima competenza CONTRATTUALE» è una sintesi: il codice considera gli eventi ammessi descritti sopra;
- «ultima riga/evento» non sostituisce saldo per competenza e preferenza fra contratti;
- «maturato solo pagato» va esteso al riaccreditato e al presunto telefono;
- il filtro da–a effettivo dell'Analisi gettoni è sull'inserimento delle SIM attive valide, con soglia separata su `openedAt`;
- «reconcile preserva i manuali» riguarda gli oggetti rimasti qualificati, non quelli rimossi;
- un file segnalato legacy non è necessariamente inutilizzabile per qualsiasi match per codice.

---

**Dove aprire o scaricare questo documento:** nel progetto, file **`docs/customer-journey-regole-drms.md`**. Il file è autonomo: indice, regole ed esempi sono qui; i link alle fonti servono ad approfondire la verifica tecnica.
