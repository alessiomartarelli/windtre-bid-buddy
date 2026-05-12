# Prima Nota IVA (Amministrazione)

La tab Amministrazione → Prima Nota IVA usa due regole chiave per derivare un
registro IVA fiscalmente corretto dalle vendite BiSuite:

- **Article filter**: solo `art.tipo === "P"` (Prodotti) e `art.tipo === "S"`
  (Servizi). `tipo === "C"` (Canvass / Contracts: MIA TIED, ENERGIA W3,
  FIBRA CF, ASSICURAZIONI, ecc.) sono contratti di provvigione fatturati
  separatamente e sono esclusi dal registro IVA dei corrispettivi.
- **Aliquota derivation**: il campo BiSuite `dettaglio.aliquotaPrezzo` NON è
  la percentuale IVA — ha semantica variabile (a volte un codice interno,
  a volte l'IVA in euro). L'aliquota effettiva si calcola come
  `(importoScontrino − importoImponibile) / importoImponibile × 100`, poi
  snappata all'aliquota standard italiana più vicina (4 / 5 / 10 / 22%)
  entro ±0.5 pp. Vedi `classifyIvaArticolo` e `isArticoloFiscale` in
  `client/src/lib/incassoUtils.ts`.
- Righe con `dettaglio.natura` (N1–N7) sono raggruppate separatamente come
  non-imponibile / esente / fuori campo IVA. Righe con scontrino > 0 ma
  imponibile = 0 sono flaggate "Da verificare" ed escluse dai totali IVA.
