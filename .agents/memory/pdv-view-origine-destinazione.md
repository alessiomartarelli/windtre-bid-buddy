---
name: Vista PDV Origine/Destinazione
description: Come funziona la doppia attribuzione PDV (origine vs destinazione) per Vendite BiSuite e Dashboard Gara
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
- SOLO la route GET /api/admin/bisuite-mapped-sales accetta `pdvView`
  (aggregazione + calendario in-gara sul lato scelto). Tutti gli altri consumer
  (CJ, CdG, incentivi, report Telegram) restano ancorati all'origine — non
  estendere il parametro altrove senza richiesta esplicita.
- Il client Vendite deriva la vista riscrivendo in memoria codicePos/nomeNegozio
  dell'array vendite; i dati memorizzati non cambiano mai.

**Why:** una vendita trasferita deve poter essere analizzata sul negozio di
destinazione senza alterare l'attribuzione storica usata dagli altri moduli.

**How to apply:** qualsiasi nuova feature "per destinazione" passa da
`resolveSalePdvForView`/`extractPdvDestinazione`; vista origine deve restare
byte-identica (in aggregatore l'origine bypassa il resolver apposta).
