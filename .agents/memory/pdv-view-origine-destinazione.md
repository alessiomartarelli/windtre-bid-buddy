---
name: Vista PDV Origine/Destinazione
description: Attribuzione PDV origine/destinazione per vendite, Dashboard Gara e gettoni Customer Journey
---

Il PDV di destinazione di una vendita BiSuite esiste SOLO nei dati grezzi
(`rawData.attivitaDestinazione`, stessa forma di `attivita`); i campi legacy
della vendita (`codicePos`/`nomeNegozio`) restano SEMPRE l'origine.

**Regole:**
- Resolver condiviso in `shared/pdvView.ts` (import relativi, testabile via tsx).
- Mai cross-fallback: destinazione ≠ fallback dell'origine e viceversa.
- In vista Destinazione, vendite senza destinazione → bucket esplicito
  `SENZA_DESTINAZIONE` (mai attribuite a un altro negozio); banner con conteggio
  sia in Vendite che in Dashboard.
- La Ragione Sociale segue sempre il PDV effettivo della vista: in Destinazione
  va risolta dal catalogo struttura/gara del periodo, mai ereditata dall'origine.
- Dashboard e Vendite devono derivare TUTTI i dati a valle dalla stessa vista:
  selector, filtri, KPI, tabelle, grafici, premi, proiezioni, riepiloghi RS ed export.
- Il catalogo mensile della gara integra/sovrascrive la struttura generale: una
  destinazione censita solo nella gara deve comunque avere nome e RS corretti.
- I client possono riscrivere in memoria codicePos/nomeNegozio/RS per la vista;
  i dati memorizzati non cambiano mai. Gli altri moduli restano ancorati
  all'origine finché non viene richiesto esplicitamente.
- In Customer Journey, origine e destinazione di una vendita possono essere
  PDV diversi e vanno mostrate in viste distinte. Nella vista Origine i gettoni
  si attribuiscono al PDV d'origine; nella vista Destinazione al PDV di
  destinazione. Non collassare le due attribuzioni.

**Why:** una vendita trasferita deve poter essere analizzata sul negozio di
destinazione senza alterare l'attribuzione storica usata dagli altri moduli.
Rimappare solo codice e nome lascia RS, filtri e aggregati incoerenti.

**How to apply:** qualsiasi nuova feature "per destinazione" passa da
`resolveSalePdvForView`/`extractPdvDestinazione`; vista origine deve restare
byte-identica (in aggregatore l'origine bypassa il resolver apposta).
Per l'attribuzione dei gettoni CJ, usare il PDV effettivo della vista selezionata
(origine o destinazione), senza alterare i dati storici delle vendite BiSuite.
