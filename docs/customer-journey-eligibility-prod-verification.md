# Verifica Customer Journey in produzione — 7 ottobre 2026

## Stato

Deploy autorizzato completato alle 11:20 UTC (13:20 Europe/Rome).
**Riallineamento verificato dopo il normale reconcile alle 11:33 UTC (13:33 Europe/Rome).**
Nessun reconcile forzato e nessuna modifica diretta ai dati Customer Journey.

## Controlli del deploy

- Passati tutti i controlli puri e di integrazione previsti dallo script
  di deploy, compresa la suite sull'upgrade di eleggibilità.
- Passati i quattro test specifici di eleggibilità e finestra T0–T6.
- Build e precompressione completate.
- Sincronizzazione schema eseguita; verifica delle 30 tabelle superata.
- Riavviato soltanto `incentive-w3`; precedente bundle conservato sul VPS.
- `/mystoredesk/`: HTTP 200. `/incentivew3/`: HTTP 301.
- Bundle pubblicato contenente versione di eleggibilità e regole di esclusione.
- Nessuna nuova riga nel log errori nei primi minuti dopo il riavvio.

## Fotografia in sola lettura prima e subito dopo il deploy

Il confronto utilizza gli articoli BiSuite e la logica condivisa CJ:
prima SIM ammessa non annullata dalla data trigger, tie-break per ID BiSuite;
contribuzioni e coorte secondo eleggibilità, stati operativi/economici e
finestra mensile T0–T6. Le date evento preferiscono l'attivazione all'inserimento,
come la reportistica applicativa. Nessuna identità cliente viene stampata.

| Misura | Prima | Subito dopo |
| --- | ---: | ---: |
| Organizzazioni con schede CJ analizzate | 1 | 1 |
| Vendite BiSuite | 45.934 | 45.934 |
| Articoli nelle categorie mobile CJ | 13.673 | 13.673 |
| Articoli dati esclusi dalle nuove regole | 926 | 926 |
| Articoli Tourist esclusi dalle nuove regole | 641 | 641 |
| Articoli SIM allarme nel perimetro mobile | 0 | 0 |
| Schede salvate | 4.451 | 4.451 |
| Clienti con trigger ammesso atteso | 3.983 | 3.983 |
| Schede senza trigger ammesso | 468 | 468 |
| Schede con T0/vendita trigger da riallineare | 20 | 20 |
| Organizzazioni con marcatore di eleggibilità aggiornato | 0 | 0 |
| Contratti presenti sulle schede | 9.655 | 9.655 |

Il deploy non costituisce da solo un reconcile: queste difformità erano
già presenti prima e non sono una regressione del riavvio.
Il fetch notturno è programmato per le 00:00 italiane dell'8 ottobre;
anche il normale accesso autenticato alla lista CJ può riallineare l'organizzazione.
Non sono stati invocati questi percorsi dalla verifica.

Con la nuova logica condivisa, i 779 articoli mobile esclusi ancora presenti
come storico non contribuiscono ai riepiloghi. La coorte attiva calcolata è
di 3.959 schede; i contratti ammessi attivi sono 7.887 dentro T0–T6 e 882 fuori.
Il confronto dei riepiloghi per driver con il conteggio item-level non rileva
difformità. Il controllo diagnostico di segnali espliciti Tourist/allarme/solo
dati negli articoli ancora ammessi non ha prodotto segnalazioni; non rappresenta
una garanzia di copertura di ogni possibile nuova denominazione.

Non essendoci esempi reali di SIM allarme nel perimetro osservato, la relativa
regola è verificata dai test, **non** da un campione reale.

## Esito dopo il normale reconcile

| Misura | Esito |
| --- | ---: |
| Vendite BiSuite | 45.935 |
| Schede salvate / clienti con trigger ammesso atteso | 3.983 / 3.983 |
| Schede senza trigger ammesso | 0 |
| Schede con T0 o vendita trigger errati | 0 |
| Organizzazioni con marcatore di eleggibilità aggiornato | 1 su 1 |
| Date di apertura modificate sulle schede conservate | 12 |
| Schede rimosse perché senza trigger ammesso | 468 |
| Contratti precedenti su schede conservate | 8.957 |
| Contratti mancanti sulle schede conservate | 0 |
| Contratti rimossi insieme alle schede non ammesse | 698 |
| Stati economici già presenti modificati sui contratti conservati | 0 |
| Articoli mobile esclusi conservati come storico | 229 |
| Contribuzioni mobile escluse nei riepiloghi | 0 |
| Difformità dei riepiloghi per driver | 0 |
| Coorte attiva | 3.959 |
| Contratti ammessi attivi dentro / fuori T0–T6 | 7.810 / 813 |

Le coorti salvate risultano: luglio 1.291, agosto 1.197, settembre 1.264,
ottobre 231. I 20 casi precedenti con data o vendita trigger non allineati
sono ora tutti corretti; in 12 casi è cambiata la data di apertura.
La conservazione degli stati economici è confrontata con la fotografia
precedente al deploy, che conteneva 4.618 contratti con stato economico
valorizzato, limitando il confronto ai contratti delle schede mantenute.

**Limite del campione reale:** nella fotografia iniziale non c'erano contratti
con stato operativo manuale, stato economico manuale o dettagli manuali.
Le variazioni rilevate per questi campi sono quindi zero su un campione
vuoto, non una prova empirica della loro conservazione.
La conservazione manuale è coperta dal test di upgrade di eleggibilità
eseguito e superato prima del deploy, non dal campione di produzione.
Anche per le SIM allarme manca un campione reale. Nessuna regola è stata
allargata e nessun dato di produzione è stato creato per colmare questi limiti.

## Ripetibilità della verifica

Eseguire `npx tsx scripts/verify-cj-eligibility-prod.ts after`.
La fotografia tecnica precedente è in `/tmp/cj-eligibility-prod-baseline.json`:
non sovrascriverla con un nuovo `before` finché il confronto non è terminato.
Il comando apre sul DB esterno del VPS una transazione `READ ONLY`,
non importa lo storage applicativo e non chiama endpoint dell'app.
Stampa esclusivamente aggregati.

Il risultato distingue le rimozioni appartenenti a schede prive di trigger
dai contratti mancanti su schede mantenute. Non pubblicare la fotografia
tecnica: il resoconto contiene soltanto aggregati, senza chiavi o ID di clienti.
