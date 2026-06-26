---
name: Customer Journey virtual scrolling
description: How the CJ page virtualizes the schede grid and report table, and the constraint that keeps the UI tests stable.
---

# Customer Journey virtual scrolling

La pagina `/customer-journey` virtualizza due viste con `@tanstack/react-virtual`
(`useWindowVirtualizer`, scroll della finestra, non un contenitore interno):

- **Griglia schede**: virtualizzazione per RIGHE (ogni riga = `cols` card via
  `gridTemplateColumns: repeat(cols,1fr)`), `cols` calcolato da JS allineato ai
  breakpoint Tailwind (768/1024). Altezza riga misurata via `measureElement`
  (le card hanno altezza variabile per il sottotitolo referente).
- **Tabella Reportistica "Dettaglio"**: virtualizzata SOLO sopra una soglia di
  righe (la dimensione "cliente" = una riga per journey può fare migliaia).
  Sotto soglia renderizza normale.

**Why:** la soglia (gate) esiste per non toccare le viste piccole
(negozio/addetto) e soprattutto per tenere i test `cj-gettone-ui` byte-identici:
seminano poche righe e asseriscono `row-report-*`. Se abbassi la soglia sotto il
numero di righe seminate dai test, cambi il rendering della tabella piccola e
rischi di rompere i selettori.

**How to apply:**
- `scrollMargin` del window virtualizer = offset assoluto dal top del documento
  (`getBoundingClientRect().top + scrollY`), ricalcolato al resize/layout via un
  hook condiviso; serve per ancorare la finestra virtuale sotto i controlli/filtri.
- Spacer della tabella (righe `<tr>` con `<td>` height): paddingTop =
  `items[0].start - scrollMargin`; paddingBottom =
  `totalSize - items[last].end + scrollMargin`. Una sentinella `<tr>` a altezza 0
  in cima al `<tbody>` misura il top reale del corpo tabella.
