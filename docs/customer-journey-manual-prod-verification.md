# Verifica delle modifiche manuali Customer Journey — 12 ottobre 2026

## Stato e decisione

**Verifica parziale, chiusa su autorizzazione dell'utente.**
Il salvataggio in produzione è stato osservato; la conservazione dopo un
successivo ciclo automatico non è ancora stata verificata. L'utente ha
autorizzato a separare il controllo residuo per non mantenere aperto il task
in attesa del ciclo notturno. Questa chiusura non certifica il riallineamento.

Nessun codice applicativo modificato, deploy, scrittura al database di
produzione, dato di prova creato dall'agente o reconcile manuale.

## Metodo e riservatezza

Letture sul database esterno del VPS, non sul database gestito di Replit:
connessione `pg` configurata dall'applicazione remota, credenziali mai
stampate, transazione `REPEATABLE READ READ ONLY` e timeout query di 30 secondi.
Nessuna importazione dello storage applicativo o chiamata a endpoint dell'app.

La selezione è limitata alla scheda indicata dall'utente e alle sue due righe.
Gli output e questo resoconto non contengono nomi, codici fiscali, ID
cliente/contratto/organizzazione, IMEI, negozi o identità degli operatori.
Il confronto dei dettagli e della conferma usa impronte calcolate nel database,
senza riportare nell'output i valori identificativi sottostanti.

## Risultato del salvataggio

Sulla scheda indicata dall'utente sono presenti una SIM e uno smartphone.
I due salvataggi osservati riguardano lo **smartphone**, non la SIM:

- dettagli manuali registrati alle **12:39:37 UTC** (14:39:37 Europe/Rome);
- data di attivazione salvata: **31 luglio 2026**;
- conferma gettone registrata alle **12:39:38 UTC** (14:39:38 Europe/Rome).

La lettura di riferimento è stata acquisita alle **12:41:14 UTC**
(14:41:14 Europe/Rome).

| Campo | SIM | Smartphone |
| --- | --- | --- |
| Stato operativo | inserito | inserito |
| Stato operativo manuale | no | no |
| Stato economico | pagato | nessun esito |
| Stato economico manuale | no | no |
| Dettagli manuali | no | sì |
| Data di attivazione | assente | 31 luglio 2026 |
| Gettone confermato | no | sì |

Salvare la data e confermare il gettone non modifica automaticamente lo stato
operativo. La permanenza di “Inserito” non indica quindi la perdita di quei
due salvataggi. Non è stato impostato “Attivato” dall'agente.

## Seconda lettura e limite della verifica

La seconda lettura, alle **12:45:29 UTC** (14:45:29 Europe/Rome),
ha trovato entrambe le righe presenti e tutti i confronti invariati:

- stato operativo e relativo flag manuale;
- stato economico e relativo flag manuale;
- flag e impronta dei dettagli (IMEI, rata, PDV destinazione, data attivazione,
  data e autore del salvataggio);
- valore, data e autore della conferma gettone.

Tuttavia, il marcatore `customerJourneyReconciledAt` era ancora
**12:33:30 UTC**, precedente alla lettura di riferimento. Non è stato
osservato un ciclo successivo: la seconda lettura dimostra la persistenza
del salvataggio, **non** la conservazione dopo il riallineamento.

In questo caso non erano presenti override manuali dello stato operativo
o economico. Il loro valore e i relativi flag sono stati confrontati,
ma la resistenza di tali override resta coperta dai test di sviluppo,
non da questo caso di produzione.

## Controllo residuo

Confrontare le stesse righe dopo un normale ciclo automatico, usando
esclusivamente query in sola lettura. Richiedere un marcatore di
riallineamento successivo alla lettura di riferimento e controllare anche
che gli item siano stati effettivamente aggiornati dal ciclo; distinguere
eventuali modifiche successive dell'utente da sovrascritture automatiche.
Se servono log di conferma, filtrare soltanto i riepiloghi del reconcile,
redigendo l'organizzazione e senza leggere risposte HTTP con dati cliente.

Le fotografie tecniche locali, non pubblicabili, sono:

- `/tmp/cj-confirmation-preservation-baseline.json`;
- `/tmp/cj-confirmation-preservation-result.json`.

La prima contiene riferimenti tecnici opachi necessari a selezionare le
stesse righe e le impronte, non il codice fiscale o il nome cliente;
i file hanno permessi `0600`. Non sovrascrivere la fotografia precedente.
I file in `/tmp` possono non sopravvivere a una nuova sessione: se la
fotografia manca, dichiarare il limite e acquisire una nuova lettura
precedente a un ciclo successivo, senza inventare un confronto storico.

Riferimenti per il controllo:
`server/storage.ts`, `server/bisuiteScheduler.ts`, `server/bisuiteFetch.ts`,
`scripts/verify-cj-eligibility-prod.ts`,
`tests/customer-journey-eligibility-reconcile.test.mjs`.
Lo script di eleggibilità usa una fotografia diversa e non confronta la
conferma gettone separatamente: non usarlo da solo per certificare questo caso.

## Controlli dell'ambiente di sviluppo

La prima validazione automatica della chiusura ha rilevato uno schema di
sviluppo non allineato al codice (colonna `iccid` mancante), causando errori
nelle suite Customer Journey. Eseguito `npm run db:push` esclusivamente sul
database di sviluppo; nessun intervento sul database di produzione.
Le suite `run-customer-journey-authz-tests.sh` e
`run-customer-journey-reconcile-tests.sh`, rieseguite dopo il riallineamento
di sviluppo, sono passate. Questo non sostituisce il confronto residuo
sui dati reali dopo il ciclo automatico di produzione.

Nella seconda validazione, tutti i 55 comandi shell tranne
`bash scripts/run-cdg-cat-dettaglio-ui-tests.sh` sono passati, incluso
typecheck e tutte le suite Customer Journey; anche la revisione di
completamento è passata. L'unico fallimento è stato un timeout sulla chiusura
di un dialog CdG durante il carico parallelo. Lo stesso comando, rieseguito
da solo senza modifiche al codice, ha superato tutti e quattro i test.
Il risultato individuale è conservato come conferma, senza introdurre
modifiche CdG fuori dall'ambito di questa verifica.
