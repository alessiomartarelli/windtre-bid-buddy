# Riconciliazione WindTre CMS — ottobre 2026

## Perimetro e metodo

Report fornito dall’utente come **CMS dal 9 all’11 ottobre**: foglio `Report`,
108 righe BURNED, 108 Keycode distinte. Il contenuto effettivo va dal **9 al
12 ottobre 2026**: le 8 transazioni del 12 valgono 133 €. Non è un report mensile
e non è stata presunta la completezza della giornata del 12.

Consultazione del database BiSuite di produzione in **transazione READ ONLY**,
senza sincronizzare, importare report, ricalcolare o modificare dati. Organizzazione
WindTre che contiene le vendite CMS (`org-admin-windtre`), stesso perimetro della
route, giorni italiani inclusivi tramite `data_vendita::date`. Snapshot di 619
vendite dal 9 al 12 ottobre; 176 scontrini con ricariche, di cui 2 annullati.
Le 198 ricariche positive non annullate sommano 3.436 €.

Abbinamento per giorno, telefono normalizzato e importo. WindTre richiede un
candidato per **articolo ricarica**, non per scontrino: più Keycode possono
corrispondere a ricariche dello stesso scontrino, senza riutilizzare un articolo.
L’ID vendita mostrato rimane quello BiSuite. VF conserva l’aggregazione storica.
VSC e SIM ATTIVA sono entrambe incluse come nel parser esistente.

## Risultati sul periodo richiesto, 9–11 ottobre

| Stato | Righe | Importo WindTre | Importo BiSuite |
|---|---:|---:|---:|
| VERIFICATO | 100 | 1.708 € | 1.708 € |
| INCONGRUENZA IMPORTO | 0 | 0 € | 0 € |
| NON PRESENTE SU BISUITE | 0 | 0 € | 0 € |
| NON PRESENTE SU FILE | 34 | — | 591 € |
| **Totale** | **134** | **1.708 €** | **2.299 €** |

## Risultati sull’intero contenuto del file, 9–12 ottobre

| Stato | Righe | Importo WindTre | Importo BiSuite |
|---|---:|---:|---:|
| VERIFICATO | 108 | 1.841 € | 1.841 € |
| INCONGRUENZA IMPORTO | 0 | 0 € | 0 € |
| NON PRESENTE SU BISUITE | 0 | 0 € | 0 € |
| NON PRESENTE SU FILE | 90 | — | 1.595 € |
| **Totale** | **198** | **1.841 €** | **3.436 €** |

| Giorno | Verificate / importo | Solo BiSuite / importo |
|---|---:|---:|
| 9 ottobre | 48 / 808 € | 6 / 115 € |
| 10 ottobre | 44 / 754 € | 18 / 329 € |
| 11 ottobre | 8 / 146 € | 10 / 147 € |
| 12 ottobre | 8 / 133 € | 56 / 1.004 € |

**Interpretazione:** ogni riga del report trova una ricarica BiSuite con lo stesso
giorno, telefono e importo. La copertura inversa non è completa: “NON PRESENTE
SU FILE” non prova una vendita errata. Il 12 è fuori dal periodo dichiarato e
potrebbe essere parziale; per le 34 righe del 9–11 servirebbe verificare il
perimetro dell’estrazione WindTre/canale prima di attribuire una causa.

## Casi limite emersi e regressione

- BiSuite memorizza `NUMERO TELEFONO: …` in `venditaInfo1`, con
  `domandeRisposte` vuoto: prima della correzione tutte le 174 vendite aggregate
  risultavano senza telefono e nessuna delle 108 Keycode veniva abbinata.
- Dopo la sola lettura del telefono, l’aggregazione per scontrino produceva
  ancora 7 incongruenze e 12 falsi mancanti. Si trattava di scontrini con più
  ricariche, sullo stesso numero o su numeri diversi. La separazione per articolo
  elimina tutti questi falsi scarti e conserva gli importi.
- Due scontrini annullati rimangono esclusi; le ricariche aggiuntive non possono
  riutilizzare uno stesso candidato. Gli ID delle righe residue sono distinti.

La fixture `tests/fixtures/windtre-cms-recharges-anonymized.json` è una
proiezione ridotta del confronto: telefoni sostituiti da identificatori sintetici
700…, Keycode e ID riscritti, nessun nome, ICCID, codice POS o ordine originale.
Date, importi e relazioni tra gli articoli sono conservati per riprodurre i casi.
Non contiene il file Excel originale né copie integrali delle vendite.

## Ripetere la verifica

```sh
# Riproduzione offline sullo snapshot pseudonimizzato già ricavato dai dati reali:
npx tsx scripts/verify-windtre-recharges.mts \
  --snapshot tests/fixtures/windtre-cms-recharges-anonymized.json

# Nuovo confronto, solo con un collegamento DB già configurato e attendibile:
npx tsx scripts/verify-windtre-recharges.mts \
  --workbook /percorso/report.xlsx --org org-admin-windtre \
  --from 2026-10-09 --to 2026-10-11
node --import tsx --test tests/ricariche-analysis.test.mjs
```

La modalità offline usa esclusivamente lo snapshot locale: non è una nuova
lettura della produzione. Le 619 vendite della prima lettura sono ridotte nello
snapshot ai 176 scontrini con ricariche; conteggi e importi di riconciliazione
restano invariati.

Un nuovo confronto usa il database indicato da `DATABASE_URL` tramite un
collegamento già configurato e attendibile. Lo script non apre connessioni SSH,
non legge password VPS, non recupera credenziali remote e non configura tunnel.
La modalità di accesso SSH diretto è stata rimossa dopo il controllo di sicurezza:
la prima lettura dei dati reali non è stata ripetuta con una chiave host autenticata.
La riproduzione offline conferma gli esiti di quello snapshot, non l’identità del
server della lettura iniziale. Nessun controllo SSH viene aggirato.
Lo script stampa solo aggregati in centesimi e controlla conservazione degli
importi e unicità delle righe. Non stampa telefoni o credenziali.
`--fixture percorso.json` genera, se richiesta, solo la proiezione pseudonimizzata;
interrompe la generazione se il formato dei campi testuali è inatteso.

## Verifiche eseguite

- 16 test della logica ricariche superati, inclusa la regressione sul report
  pseudonimizzato completo e sul solo periodo richiesto.
- Test API HTTP superato: due Keycode sullo stesso telefono e scontrino vengono
  verificate separatamente; la terza ricarica non presente nel file resta distinta,
  senza duplicare l’importo dello scontrino.
- `npx tsc --noEmit` superato.
- Test della procedura offline: riproduzione degli aggregati senza credenziali,
  rifiuto della vecchia opzione SSH e separazione esplicita tra snapshot e DB.
- Applicazione riavviata e avviata correttamente. Nessuna pubblicazione eseguita.
