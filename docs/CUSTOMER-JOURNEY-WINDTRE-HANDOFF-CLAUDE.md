# Customer Journey WindTre — contesto funzionale e tecnico per Claude Code

Aggiornamento: 2 novembre 2026.

## 0. Come usare questo documento

Questo è un documento di passaggio del contesto del modulo Customer Journey (CJ) di **MyStoreDesk**, con particolare riferimento al brand **WindTre**.

È pensato per essere comprensibile anche senza la conversazione originale. Descrive:

- il significato commerciale della CJ;
- la popolazione ammessa, il T0 e la finestra T0–T5;
- il gettone base a scaglioni e gli extra SIM–smartphone;
- la differenza tra previsione, maturato, esito DRMS e conferma manuale;
- le decisioni e le conclusioni delle analisi già svolte;
- i riferimenti al codice e le verifiche necessarie prima di modificarlo;
- la futura proposta «Customer Journey — Il Gioco», separata dal modulo operativo.

**Non è un contratto commerciale WindTre, un tariffario ufficiale o una prova di incasso.** Gli importi descrivono le regole implementate in questo progetto. Non estenderli ad altri brand o moduli senza una decisione esplicita.

Se il repository disponibile a Claude Code è più recente, confrontare queste indicazioni con il codice. I commenti storici possono essere superati: verificare gli helper condivisi, i chiamanti e i test.

### Istruzione iniziale per Claude Code

> Usa questo file come contesto del modulo CJ WindTre. Prima di intervenire, ricostruisci dal codice la pipeline vendite → reconcile → journey/item → validità → gettone → report/export. Distingui regole implementate, decisioni commerciali confermate e proposte future. Non cambiare formule, finestre, attribuzioni o autorizzazioni per semplificare la UI. Se manca una fonte, dichiaralo; non inventare collegamenti, esiti o liquidazioni. Questo file non autorizza automaticamente modifiche, migrazioni o deploy.

---

## 1. Concetto commerciale

La Customer Journey segue il percorso di cross-sell di un cliente che entra con una **nuova attivazione mobile ammissibile**.

L’obiettivo non è sommare indistintamente tutte le vendite del cliente: è osservare quali piste commerciali aggiuntive vengono attivate nella finestra della CJ e calcolare il gettone corrispondente.

Esempio:

1. Il cliente attiva una SIM voce mobile ammissibile a luglio.
2. Si apre la sua CJ, con luglio come mese T0.
3. Nello stesso mese o nei cinque successivi può aggiungere Fisso, Energia, Assicurazioni, Smartphone ammissibile e WindTre Protetti.
4. Il numero di piste aggiuntive distinte determina il gettone base.
5. Coppie successive di nuova SIM e smartphone ammissibile possono generare extra separati.
6. Gli esiti economici modificano la parte considerata maturata, senza trasformare il gettone CJ in una commissione DRMS.

### Una CJ per cliente, non una per SIM

La chiave è organizzazione + identità fiscale normalizzata:

- CF per cliente privato;
- P.IVA per cliente aziendale;
- normalizzazione maiuscolo/trim.

Più SIM dello stesso cliente non generano automaticamente nuove journey.

Distinguere:

- **cliente unico**: anagrafica CJ;
- **SIM ammissibili attive**: volume degli item mobile, anche più di una per cliente;
- **rami premio**: ramo iniziale più eventuali coppie aggiuntive valide.

Non sommare i rami ai clienti unici per calcolare le percentuali di cross-sell.

## 2. Origine dei dati e pipeline

```text
Vendite BiSuite
  → importazione/sincronizzazione delle vendite nell’organizzazione
  → classificazione articoli e controllo identità fiscale
  → reconcile esplicito o legato alla sincronizzazione
  → customer_journeys + customer_journey_items
  → classificazione di validità condivisa
  → gettone base + extra
  → schede, timeline, analisi, diagnostica e PDF/Excel

DRMS caricati
  → parser che conserva le chiavi di match/esito
  → motore esiti per contratto e competenza
  → stato economico e relativo storico
  → ricalcolo delle componenti economiche CJ
```

Un item CJ è derivato da un articolo di vendita, con unicità organizzazione + vendita BiSuite + articolo BiSuite.

La CJ è un modello derivato: **non inserire journey artificiali in produzione aspettandosi che il reconcile le conservi**.

### Consultazione e riconciliazione sono operazioni diverse

Lista, dettaglio, report, diagnostica ed export devono restare in sola lettura. Aprire una pagina non deve correggere o riconciliare implicitamente i dati.

Il reconcile:

- usa una transazione e un lock per organizzazione;
- applica la data trigger configurata;
- aggiorna clienti e item derivabili dalle vendite;
- ricalcola T0 e vendita/SIM iniziale;
- preserva gli override manuali previsti;
- rimuove gli elementi non più derivabili o fuori dal perimetro ammesso.

La potatura dei dati derivati è distinta dalla conservazione degli override sugli item ancora qualificati.

## 3. Quali vendite aprono una CJ

Serve una nuova attivazione mobile ammissibile, con identità fiscale e data compatibile con la configurazione.

La data trigger è configurabile per organizzazione; il default implementato è **01/07/2026**. Non assumere che sia la data effettiva di ogni tenant.

La selezione mobile non coincide con «qualsiasi articolo classificato Mobile».

Sono esclusi dall’ammissibilità, secondo gli helper correnti:

- CB, MIA, rivincoli: non sono nuove attivazioni CJ;
- offerte turistiche e altre GA non turistiche escluse;
- SIM per allarmi;
- offerte solo dati secondo le regole di tipologia/descrizione.

Non confondere una nuova attivazione commerciale con l’articolo fisico «SIM»: l’acquisto della tessera non è automaticamente un secondo contratto.

Le ricariche non aprono CJ e non diventano nuove SIM.

### Selezione del T0

Il reconcile individua deterministicamente la prima SIM valida: data vendita, ID BiSuite e articolo mobile sono usati per risolvere l’ordine.

La data di apertura e il marker della SIM iniziale vengono riallineati alle fonti: il T0 non è una data immutabile imposta alla prima importazione.

Una sincronizzazione può trovare una SIM precedente o rilevare che quella iniziale non qualifica più. L’interfaccia e i calcoli devono usare il T0 ricalcolato coerentemente.

## 4. Piste e finestra commerciale T0–T5

Driver gestiti:

| Driver tecnico | Significato | Ruolo nel gettone base |
|---|---|---|
| `mobile` | Nuova attivazione mobile ammissibile | Ingresso/qualificazione, non pista aggiuntiva |
| `fisso` | Fisso | Una pista |
| `energia` | Luce e/o gas | Una sola pista complessiva |
| `assicurazioni` | Assicurazioni | Una pista |
| `telefono` | Smartphone ammissibile e abbinato | Una pista iniziale, con condizioni specifiche |
| `protetti` | WindTre Protetti / classificazione ALLARMI | Una pista |

Le piste cross-sell massime sono **cinque**.

- Due contratti Fisso non sono due piste.
- Luce + gas non sono due piste.
- La SIM che apre la CJ non aggiunge una pista cross-sell.
- Un contratto può essere presente/attivo ma non valido ai fini del gettone.

### La finestra usa mesi solari, non 180 giorni

T0 è il mese di apertura. Si ammettono T0, T1, T2, T3, T4 e T5, inclusi.

Esempio: T0 luglio 2026 → termine commerciale 31 dicembre 2026, fine giornata UTC.

Una nuova SIM di settembre **non sposta la scadenza a febbraio** e non apre automaticamente una nuova CJ.

Per l’evento commerciale, le righe report usano la data di attivazione se presente, altrimenti la data di inserimento.

**Particolarità implementata da conoscere:** l’helper generico `pisteInWindow` non esclude una pista se mancano T0 o la data evento; le coppie smartphone richiedono invece date e abbinamento verificabili. Non sostituire questa tolleranza con una regola diversa senza valutarne l’impatto.

## 5. Due stati indipendenti

### Stato operativo

`inserito` · `in_lavorazione` · `attivato` · `ko`.

Il reconcile normalmente inserisce l’item come `inserito`. Gli override operativi manuali vengono preservati. Il DRMS non deve trasformarsi nel motore dello stato operativo.

### Stato economico

Nessun esito (`null`) · `pagato` · `annullato` · `stornato` · `riaccreditato`.

È alimentato dal DRMS o da un override manuale. Reconcile BiSuite e cancellazione degli upload hanno regole specifiche: non azzerare indiscriminatamente lo stato economico a ogni sincronizzazione.

### Contratto attivo secondo la CJ

L’helper condiviso `isCjItemActive` esclude:

- KO operativo;
- annullato/stornato economico;
- equivalenti legacy ancora presenti nel campo operativo.

Quindi:

- `inserito` senza esito può contribuire allo **stimato**;
- `pagato` o `riaccreditato`, se il contratto è attivo e ammissibile, può contribuire al **maturato**;
- uno stato operativo `attivato` non prova che il contratto sia stato pagato;
- un esito economico positivo non fa rientrare un prodotto fuori finestra o non ammissibile.

## 6. Gettone base a scaglioni

Tabella implementata:

| Piste cross-sell distinte ammesse | Gettone base |
|---:|---:|
| 0 | 0 € |
| 1 | 20 € |
| 2 | 30 € |
| 3 | 40 € |
| 4 | 100 € |
| 5 | 120 € |

**È una tabella sul totale delle piste, non 20 € per prodotto.**

Il passaggio 3 → 4 vale +60 €; il passaggio 4 → 5 vale +20 €.

### Formule principali

```text
n_attive = numero di driver NON-mobile distinti:
           attivi, ammessi e nella finestra,
           con filtro specifico per lo smartphone iniziale

n_maturate = sottoinsieme delle piste ammesse
             con stato economico effettivo pagato/riaccreditato

base_stimata = tabella[n_attive]
base_maturata = tabella[n_maturate]

totale_stimato = base_stimata + extra_stimati
totale_maturato = base_maturata + extra_maturati
```

La coorte del calcolo gettoni corrente richiede almeno una SIM mobile ammissibile attiva nella finestra. I clienti non più qualificati vanno consultati separatamente, non aggiunti artificiosamente al gettone corrente.

### Componenti economiche: non sono sinonimi

Il modello distingue:

- **esplicito**: piste con esito economico positivo esplicito, DRMS oppure manuale;
- **presunto**: quota aggiunta dalla liquidazione presunta degli smartphone senza esito;
- **gettone confermato manualmente**: spunta dedicata, distinta dallo stato economico.

In particolare:

```text
base_esplicita = tabella[numero piste con esito positivo esplicito]
base_presunta = base_maturata - base_esplicita
base_confermata = tabella[numero piste con spunta gettoneConfirmed]
```

Il calcolo è non lineare: con tre piste esplicite e una smartphone presunta, la base passa da 40 € a 100 €; la componente presunta è **60 €**, non necessariamente 20 €.

**“Esplicito” non significa “certificato esclusivamente dal DRMS”.** La provenienza DRMS/manuale va mantenuta distinta.

La spunta `gettoneConfirmed` non deve essere usata come sostituto dello stato economico per gonfiare il maturato.

## 7. Smartphone iniziale e coppie aggiuntive

### Ammissibilità e abbinamento

Qualifica solo un articolo:

- categoria `TELEFONIA`;
- tipologia `SMARTPHONE`;
- ICCID disponibile e normalizzabile;
- abbinabile senza ambiguità a una SIM commerciale ammissibile;
- con stati e date validi.

L’ICCID va trattato come **stringa**, preservando gli zeri iniziali. Non ricostruirlo da un numero già arrotondato o da altri dati del cliente.

Non dedurre la coppia dal solo CF, telefono, IMEI, nome o vicinanza temporale.

### Smartphone iniziale

Nella vendita che apre la CJ, lo smartphone deve avere l’ICCID della SIM iniziale e appartenere alla stessa vendita.

Questo smartphone alimenta la pista base Smartphone.

Un telefono comprato in una vendita successiva e riferito alla vecchia SIM iniziale, senza nuova SIM nella stessa vendita, non ottiene automaticamente né pista iniziale né extra.

### Extra da vendita successiva

Una vendita successiva con:

1. nuova SIM ammissibile;
2. smartphone nella stessa vendita;
3. ICCID coincidente all’interno della coppia;
4. data successiva rispetto all’apertura secondo l’ordine deterministico;
5. entrambi attivi e in T0–T5;
6. assenza di ambiguità e duplicazioni;

genera **+20 €**.

L’ICCID della nuova coppia può essere diverso da quello iniziale: questa è una scelta commerciale confermata dall’utente.

- Non si apre una seconda CJ.
- Non si aggiunge una sesta pista.
- Più coppie valide con ICCID distinti possono generare più extra.
- Lo stesso ICCID non deve essere premiato nuovamente tramite un altro scontrino.
- SIM aggiuntiva senza smartphone: può contribuire al volume SIM, ma non genera questo extra.
- Smartphone da solo, CB/rivinculo o associazione ambigua: nessun extra automatico.

### Quando matura l’extra

Per ogni coppia aggiuntiva, devono risultare economicamente positivi lo smartphone e tutte le righe SIM dell’evento commerciale deduplicato.

Lo smartphone può essere positivo per presunzione; la SIM no.

Quindi una coppia può essere:

- stimata ma non maturata;
- maturata con componente smartphone presunta;
- interamente esplicita;
- confermata attraverso le spunte previste, che restano una misura separata.

## 8. Liquidazione presunta smartphone

Per il driver `telefono`, in assenza di stato economico, `effectiveEconomicState` restituisce `pagato` presunto.

L’interfaccia lo distingue come **“Liquidato · da verificare”**.

Un esito esplicito, anche manuale, prevale: uno smartphone annullato non deve tornare pagato per effetto della presunzione.

Questa convenzione consente il calcolo gestionale del maturato, ma non dimostra che:

- il contratto sia stato liquidato dal DRMS;
- il gettone CJ sia stato incassato;
- un addetto abbia diritto a un premio personale;
- una ragione sociale abbia ricevuto il premio Gara.

La tonalità verde scuro **“Liquidato DRMS”** è invece riservata alla conferma automatica DRMS positiva coerente con lo stato corrente, senza override economico manuale o mismatch; non equivale alla liquidazione presunta.

## 9. Esiti DRMS: motore e finestra indipendente

### Unità economica e righe ammesse

Il motore aggrega per codice contratto e competenza.

In generale usa:

- righe `NATURA = CONTRATTUALE`;
- Adjustment Manuali di Storno Compensi riconosciuti;
- eccezione Protetti: `TIPO_FONIA = PROTECTA`, `NATURA = GARE`.

Non usare tutte le righe GARE come se fossero contrattuali.

### Saldo per competenza

Le competenze vengono percorse in ordine temporale:

- netto mensile > 0 → pagato;
- netto > 0 dopo uno storno → riaccreditato;
- netto < 0 → stornato;
- netto = 0 con causale di annullamento ammessa, senza stato precedente → annullato.

Un annullamento a zero dopo un pagamento non equivale automaticamente a uno storno economico: conta il saldo e la logica del motore.

Una riga negativa di opzione non annulla da sola un contratto se il saldo mensile complessivo resta positivo.

### Match dei contratti

- Mobile/Fisso/Assicurazioni/Protetti: codice contratto, altrimenti CF/P.IVA + tipo fonia quando previsto.
- Energia: POD/PDR; il codice BiSuite può differire da quello DRMS. Il motore ammette anche codice coincidente e fallback CF/P.IVA + ENERGIA.
- Smartphone: nessun fallback CF + MOBILE, che lo confonderebbe con la SIM; solo eventuale match per codice.
- Gli indici POD/PDR devono essere alimentati da righe Energia, non da righe di altri driver.

Più contratti candidati con esiti diversi producono ambiguità. La preferenza implementata è `pagato > riaccreditato > stornato > annullato`; non nascondere la presenza di un match ambiguo.

### Finestra DRMS diversa da quella commerciale

La finestra DRMS va dal mese di **inserimento del singolo item** ai cinque mesi successivi inclusi.

Esempio:

- CJ aperta a luglio: acquisizioni cross-sell fino a dicembre;
- contratto Energia inserito a dicembre: osservazione economica da dicembre fino a maggio successivo.

**Non tagliare gli esiti di tutti i contratti alla scadenza della CJ.**

Un match identificativo esistente ma senza eventi economici utilizzabili nella finestra non equivale a un esito trovato.

Un file mensile può contenere rettifiche riferite a competenze precedenti: la competenza della riga è distinta dal mese di caricamento e dal nome del file.

### Override e mancanza di esito

- Un override economico manuale prevale sullo stato automatico.
- Il motore conserva l’esito DRMS e segnala il mismatch.
- Tornare su automatico riapplica l’esito disponibile.
- Cancellare un upload può far scomparire un esito; lo stato non va azzerato indiscriminatamente se deriva da altra fonte.
- Upload legacy privi delle chiavi necessarie devono essere segnalati come tali e possono richiedere i file originali: non si ricostruiscono colonne mancanti con supposizioni.

La rielaborazione è asincrona per organizzazione, con marker persistente, richieste concorrenti accorpate e notifica finale. Una risposta “in corso” non significa esito già aggiornato.

## 10. Esempi numerici da preservare

| Caso | Base stimata | Extra stimati | Totale stimato | Nota |
|---|---:|---:|---:|---|
| Solo SIM iniziale | 0 € | 0 € | 0 € | Mobile non è cross-sell |
| SIM + Fisso | 20 € | 0 € | 20 € | Una pista |
| SIM + Fisso + Luce + Gas | 30 € | 0 € | 30 € | Energia conta una volta |
| SIM + Fisso + Assicurazione + Smartphone iniziale valido | 40 € | 0 € | 40 € | Tre piste |
| Quattro piste base | 100 € | 0 € | 100 € | Non 80 € |
| Cinque piste + due coppie successive valide | 120 € | 40 € | 160 € | Extra fuori dal limite delle cinque piste |
| Solo SIM iniziale + una coppia successiva valida | 0 € | 20 € | 20 € | Lo smartphone successivo non diventa pista iniziale |
| Vecchia SIM + telefono successivo senza nuova SIM nella vendita | 0 € | 0 € | 0 € | Nessuna associazione inventata |

Esempio di maturato: Fisso, Energia e Assicurazione esplicitamente positivi + smartphone iniziale presunto → base maturata 100 €, di cui base esplicita 40 € e quota presunta 60 €.

Esempio extra: coppia successiva valida con SIM senza esito e smartphone presunto → extra stimato 20 €, extra maturato 0 €. Dopo esito positivo della SIM → extra maturato 20 €, ancora non interamente esplicito finché lo smartphone è presunto.

Gli esempi presuppongono coorte qualificata, contratti attivi, date nella finestra e abbinamenti verificati.

## 11. KPI, filtri e attribuzione

### Indicatori diversi

- **SIM**: volume degli item mobile ammissibili attivi.
- **Clienti**: journey distinte qualificate.
- **Clienti con cross-sell**: almeno una delle cinque piste base attiva.
- **Saturazione base**: piste attive / 5 × 100.
- **Extra coppie**: premi aggiuntivi separati; non aumentano la saturazione base.
- **Potenziale base residuo**: max(0, 120 € − base stimata), prima dell’eventuale scenario di saturazione.
- **Incremento simulato**: differenza tra scaglione base futuro e base corrente, senza sommare di nuovo gli extra.

Non usare `120 − totale comprensivo extra` per misurare il potenziale delle piste.

### Date: tre concetti distinti

1. Data trigger organizzativa: eleggibilità all’apertura.
2. Apertura/T0: finestra commerciale e coorte di apertura.
3. Data inserimento SIM: filtro dal–al delle Schede e intervallo dell’Analisi gettoni.

La scelta di mantenere il filtro per **data inserimento SIM** è stata confermata dall’utente. Non “correggerlo” per farlo coincidere con la data di apertura mostrata sulla scheda.

Il pavimento legato alla data trigger si applica anche ai ruoli non admin.

Il pannello dei non più qualificati conserva il riferimento di inserimento della SIM eleggibile originaria: non escluderli perché ora non esistono SIM attive.

### PDV origine e destinazione

Sono viste distinte. I calcoli e i dettagli devono rispettare quella selezionata:

- la base rimane attribuita al negozio della SIM di apertura;
- volumi SIM e coppie extra seguono le rispettive vendite nella vista scelta;
- un cliente condiviso può comparire nei dettagli di più negozi;
- non duplicare il gettone base sommando i dettagli.

Gli aggregati per addetto usano l’attribuzione della CJ prevista dal motore: non presumere che valga universalmente il venditore dell’ultimo prodotto.

### Analisi mensile

Separare:

- mese di apertura del cliente;
- mese dell’acquisto successivo;
- mese di riconoscimento economico.

La storia commerciale può essere ricalcolata con la validità attuale: non presentarla come fotografia immutabile della situazione nota allora.

Un importo corrente senza prova del mese di riconoscimento resta non attribuibile temporalmente; non inventare una competenza dal timestamp di aggiornamento.

## 12. Risultati e decisioni delle analisi già svolte

### Acquisti successivi apparentemente mancanti

Le analisi precedenti hanno verificato che la pipeline può già collegare le vendite successive alla CJ dello stesso cliente. Non partire dal presupposto che serva una nuova journey per ogni mese o SIM.

La percezione di pochi avanzamenti può dipendere da:

- cross-sell effettivamente poco frequente;
- categorie non tracciate dal modulo;
- mancanza di identità fiscale;
- prodotti fuori finestra, non validi o non abbinati;
- assenza di esiti economici utilizzabili.

Prima di cambiare il reconcile, confrontare vendite originali, identità normalizzate, classificazione, item ed eleggibilità. I contatori `skippedNoIdentity` e `skippedNoIdentityWithDriver` aiutano a distinguere vendita anonima non pertinente da perdita di un prodotto CJ.

Le percentuali misurate in analisi storiche non costituiscono una misura aggiornata del portafoglio attuale.

### Diagnostica non significa correzione

Il confronto SIM deve mostrare anche gli scarti e le discrepanze, non farli sparire avviando una riconciliazione durante la lettura.

Pagine ed export diagnostici devono condividere un contesto/versione coerente. Se cambiano vendite, CJ o configurazione, chiedere un aggiornamento esplicito invece di mescolare snapshot.

### Ragione sociale cliente ≠ addetto ≠ società proprietaria del negozio

Per i clienti business BiSuite può non fornire una ragione sociale strutturata affidabile. Il progetto prevede suggerimento dall’email e correzione manuale, senza sovrascrivere la scelta manuale al reconcile.

Non usare come denominazione cliente il nome dell’addetto o la ragione sociale del dealer.

### Uno stesso significato in tutte le viste

Scheda, badge, timeline, gettone, diagnostica e PDF/Excel devono riutilizzare la stessa eleggibilità. Non implementare una seconda versione “più semplice” delle regole nel frontend o negli export.

“Attivo”, “valido per il gettone” e “liquidato” restano tre informazioni diverse.

## 13. Sicurezza e separazione dei moduli

- Dati sempre isolati per organizzazione.
- Operatore limitato agli addetti BiSuite associati al proprio profilo.
- Array addetti vuoto = nessun dato, non intero tenant.
- Ogni endpoint, dettaglio, export e riferimento commerciale deve mantenere il controllo lato server.
- Abilitazione modulo, brand e permessi dell’utente vanno rispettati insieme.
- Le regole CJ WindTre non sono automaticamente regole Vodafone/Fastweb.
- Non trasferire la presunzione smartphone o l’extra coppie a Gara, Vendite, Canvass o Incentivazione.
- Non introdurre accessi a dati di altri addetti solo per completare una coppia o migliorare una classifica.

Gli operatori possono modificare alcuni stati dei propri item: questo non li rende autorità indipendente per certificare un premio personale.

## 14. Analisi futura: «Customer Journey — Il Gioco»

**Stato: analisi e specifica, non funzionalità implementata automaticamente.**

Il concetto discusso è un’esperienza per addetti adulti in contesto business:

- area personale con giornata e priorità;
- missioni giornaliere predefinite;
- sezione distinta per missioni create dall’admin e assegnate a utenti specifici;
- progressione dei clienti, attività, sfide, punti e classifiche;
- premi facoltativi, anche fisici; il gioco deve funzionare senza premi;
- estetica e interazioni importanti per l’adozione, non decorazione aggiunta alla fine.

Le condizioni premio possono combinare classifica, attachment, percentuale del premio RS maturato e altri criteri documentati. Non imporre un’unica attribuzione valida per tutte le campagne.

Restano da approvare: punti, definizioni dell’attachment, volumi minimi, beneficiari, attribuzioni, stile visivo, budget e politiche degli esiti tardivi.

### T6: non confonderlo con una regola già automatizzata

Nella proposta, T6 è il mese successivo a T5, destinato alla verifica/consolidamento secondo un futuro regolamento. Non equivale a un pagamento automatico già implementato e non accorcia la finestra economica DRMS del singolo contratto.

### Separazioni economiche obbligatorie

```text
punti attività del gioco
≠ risultati commerciali
≠ maturato gestionale del gettone CJ
≠ premio Gara della ragione sociale
≠ denaro effettivamente incassato
≠ premio personale approvato/consegnato
```

La Dashboard Gara espone un premio attuale/proiettato per RS: non è automaticamente un registro di liquidazioni certificate.

Un contratto DRMS pagato non prova che sia stato pagato il gettone CJ o un premio alla RS.

Per il gioco serviranno nuovi registri: attività, missioni, regole versionate, accrediti/rettifiche punti, approvazioni e consegne. Non dedurre contatti e appuntamenti storici da una vendita.

La simulazione economica su dati reali non è stata svolta dalla sola analisi di fattibilità. Va pianificata e dichiarata separatamente.

La specifica estesa è in `docs/customer-journey-il-gioco-specifica.html`; questa sezione ne riporta i vincoli essenziali senza richiedere quel file per comprendere la distinzione.

## 15. Mappa del codice da leggere

| File | Responsabilità |
|---|---|
| `shared/schema.ts` | Modello dati CJ, stati e metadati manuali/DRMS |
| `shared/customerJourney.ts` | Classificazione, ammissibilità mobile, finestra, gettone, coppie smartphone, aggregazioni |
| `shared/customerJourneyMembership.ts` | Qualificazione della popolazione CJ |
| `shared/customerJourneyDrms.ts` | Parsing economico, indici, match, finestra item e stati DRMS |
| `shared/customerJourneyCohorts.ts` | Coorti e riconoscimenti economici per competenza |
| `shared/customerJourneyProgression.ts` | Avanzamento commerciale dei clienti |
| `shared/customerJourneyDiagnostics.ts` | Confronto delle vendite/SIM e motivi delle discrepanze |
| `server/storage.ts` | Reconcile, letture e applicazione degli esiti |
| `server/routes.ts` | API, controlli autorizzativi, aggiornamenti manuali |
| `server/cjDrmsOutcomeRunner.ts` | Elaborazione asincrona DRMS per organizzazione |
| `client/src/pages/CustomerJourney.tsx` | Schede, filtri, dettaglio, reportistica e controlli UI |
| `client/src/lib/customerJourneyTimeline.ts` | Timeline, validità e scadenza T5 |
| `client/src/lib/customerJourneyExport.ts` | PDF/Excel coerenti con il modulo |
| `docs/customer-journey.md` | Documentazione tecnica storica da confrontare col codice |

API principali:

- `GET /api/customer-journeys`
- `GET /api/customer-journeys/:id`
- `GET /api/customer-journeys/report`
- `GET /api/customer-journeys/report-cohorts`
- `GET /api/customer-journeys/drms-status`
- `POST /api/customer-journeys/reconcile`
- `POST /api/customer-journeys/esita-drms`
- `GET` / `PUT /api/customer-journey-config`
- `PATCH /api/customer-journey-items/:id/state`
- `PATCH /api/customer-journey-items/:id/economic-state`
- `PATCH /api/customer-journey-items/:id/gettone`
- `PATCH /api/customer-journey-items/:id/details`

Sono percorsi logici: usare l’helper URL e il base path dell’app. In produzione MyStoreDesk utilizza `/mystoredesk`; non inviare le sue richieste accidentalmente alla radice API di altre applicazioni.

## 16. Verifiche minime per sviluppi successivi

Prima di modificare calcoli:

1. Testare tutti e sei gli scaglioni base e le differenze 3→4 e 4→5.
2. Verificare che luce+gas restino una pista e Mobile non aggiunga una pista.
3. Provare nuove SIM escluse, identità assente e trigger diverso da quello di default.
4. Verificare mesi UTC, ultimo giorno T5, primo giorno T6 e dati mancanti.
5. Provare smartphone iniziale, coppia successiva, ICCID diverso dall’iniziale, zeri iniziali, duplicato e match ambiguo.
6. Separare stimato, maturato, esplicito, presunto e spunta gettone.
7. Provare KO, annullamento, storno e riaccredito anche dopo una precedente liquidazione.
8. Verificare la finestra DRMS del singolo item, non soltanto quella CJ.
9. Provare override manuale, ritorno automatico, upload legacy e nessun esito.
10. Controllare cliente condiviso, PDV origine/destinazione e riconciliazione dei totali con i dettagli.
11. Verificare isolamento di tenant, operatore senza addetti e autorizzazioni export.
12. Confermare che aprire diagnostica/report non scriva dati.

Suite esistenti da individuare nel repository, evitando di inventare nomi o lanciare indiscriminatamente tutti i browser:

```bash
rg --files tests scripts | rg 'customer-journey|cj-'
```

Riferimenti noti:

- `scripts/run-customer-journey-report-tests.sh`
- `scripts/run-customer-journey-timeline-tests.sh`
- `scripts/run-customer-journey-validity-gettone-parity-tests.sh`
- `scripts/run-customer-journey-drms-outcome-tests.sh`
- `scripts/run-customer-journey-export-tests.sh`
- script di riconciliazione, autorizzazioni, trigger, diagnostica e test UI mirati.

Le verifiche dei dati reali devono essere autorizzate e separate dai test sintetici. Non incorporare dati cliente, credenziali o configurazioni private in un file di handoff.

---

## 17. Errori da evitare in una frase

**Non trasformare una CJ per cliente in tante CJ per SIM; non trasformare cinque piste in cinque prodotti qualsiasi; non trasformare lo scaglione in 20 € per prodotto; non trasformare una presunzione o un esito DRMS in prova di pagamento del gettone; non trasformare il progetto del Gioco in una funzionalità già esistente.**
