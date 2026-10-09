# Prestazioni della diagnostica SIM

## Scelta

Riutilizzare un contesto completo di classificazione, non pagine indipendenti.
Il contesto contiene solo proiezioni diagnostiche serializzate, conteggi, riepilogo
CJ e versione del contenuto. Non conserva `raw_data` né avvia riconciliazioni.

La chiave comprende organizzazione, associazioni addetto autorizzate, tutti i
filtri e periodo di inserimento. `null` (admin) e `[]` (operatore senza
associazioni) restano distinti. Ogni chiamata HTTP rilegge il profilo e mantiene
i controlli di modulo/permessi già presenti.

## Validazione prima di ogni riuso

Ogni richiesta apre una transazione `REPEATABLE READ READ ONLY`. Nello stesso
snapshot calcola quattro impronte SHA-256 ordinate degli identificativi e delle
versioni fisiche delle righe PostgreSQL (`xmin`, `ctid`):

- vendite della stessa organizzazione nel periodo di inserimento richiesto,
  con gli stessi estremi inclusivo/esclusivo della lettura sorgenti;
- tutti gli articoli CJ dell'organizzazione;
- tutte le journey dell'organizzazione;
- configurazione dell'organizzazione, compresa la data trigger.

Non vengono materializzati JSON delle vendite durante questa verifica.
Inserimenti, cancellazioni, sostituzioni a parità di conteggio e aggiornamenti
SQL che non toccano `updated_at` cambiano l'impronta. Una vendita spostata dentro
o fuori dal periodo cambia l'appartenenza all'insieme. Per prudenza anche
modifiche non visibili all'operatore o a categorie non mobile possono causare
un miss; non possono causare un hit obsoleto.

Questa impronta è **solo un token interno temporaneo**, mai un watermark
persistente: gli ID di transazione PostgreSQL non sono identificativi eterni.
La versione pubblica rimane l'hash SHA-256 di tutti gli input autorizzati e
proiettati, indipendente dalle pagine e dai batch. Se il contenuto viene
ripristinato esattamente, la versione pubblica torna la stessa anche se le tuple
fisiche sono cambiate. La route continua a rispondere 409
`CJ_DIAGNOSTICS_CHANGED` quando la versione richiesta è diversa.

Una scrittura che termina dopo l'apertura dello snapshot non contamina né un
cache hit né la ricostruzione tra batch; sarà vista dalla richiesta successiva.
Non serve aggiungere invalidazioni ai singoli scrittori CJ/BiSuite né cambiare
lo schema o la sincronizzazione BiSuite.

## Limiti

- Scadenza assoluta: 60 secondi, non estesa dalle letture.
- Massimo 8 contesti, 8 MiB stimati per contesto e 32 MiB totali per processo.
- La stima comprende UTF-8, UTF-16 e overhead dei contenitori.
- Evizione LRU e pulizia dei contesti scaduti agli accessi.
- Risposte ricostruite da stringhe immutabili: il chiamante non può modificare
  un contesto condiviso.
- Se dettaglio o riepilogo superano il limite, non si conserva un contesto
  parziale: la risposta continua con la paginazione streaming originale.

Il costo di validazione resta lineare nelle tuple CJ e nelle vendite del periodo,
ma non nel contenuto JSON né nella classificazione di ogni SIM. Non è una
soluzione O(1). Per tenant con moltissime tuple o cambiamenti continui il
vantaggio può essere inferiore; non è giustificato cambiare la pipeline BiSuite
prima di misurare quei casi. Non c'è cache distribuita tra processi.

## Misure e verifiche

Esecuzione nel DB di sviluppo il 9 ottobre 2026, dataset sintetici, nessun browser:

| Dataset | Richieste storage | Ricostruzione a ogni pagina | Contesto riusato e validato |
| --- | --- | --- | --- |
| 20.608 vendite, 1.210 articoli nel periodo | 25 pagine | 1.694 ms | 203 ms |
| storico precedente + 2.500 vendite, 5.001 articoli nel periodo | 10 pagine | 1.250 ms | 81 ms |

Sono confronti nello stesso processo, con lo stesso codice e gli stessi input:
il percorso freddo svuota il contesto prima di ogni richiesta. Non sono SLA
né misure di produzione. Nei percorsi caldi il test impedisce esplicitamente
di rileggere i report CJ o i batch delle sorgenti.

La misura HTTP prima dell'intervento era 1.048 ms per 25 pagine sul dataset
da 1.210 articoli; dopo l'intervento le misure HTTP hanno oscillato tra
823 e 1.618 ms per effetto delle altre componenti della richiesta e del carico.
Non si dichiara quindi un miglioramento del tempo HTTP complessivo sulla
base di quel confronto: il beneficio misurato riguarda il lavoro storage
ripetuto, più evidente aumentando gli articoli.

Comandi:

```sh
FINPLAN_BASE_URL="https://$REPLIT_DEV_DOMAIN" bash scripts/run-customer-journey-sim-diagnostics-tests.sh
bash scripts/run-typecheck.sh
```

La suite verifica conteggi e dettagli esatti, tutte le pagine, isolamento
tenant/operatori e permessi, assenza di riconciliazioni, scritture SQL dirette
su vendite/journey/articoli/configurazione, coerenza MVCC durante miss e hit,
immutabilità, scadenza, evizione e fallback per contesti troppo grandi.
