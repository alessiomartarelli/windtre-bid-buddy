---
name: lucide icons in jsPDF/Excel exports
description: how to put the same UI lucide icons into PDF/Excel exports
---
Per mostrare in un export PDF la **stessa** icona lucide della UI: renderizza il
componente lucide a stringa SVG con `renderToStaticMarkup(createElement(Icon,{width,height,color,xmlns}))`,
caricala come `<img>` da un Blob `image/svg+xml`, disegnala su un `<canvas>` e
prendi `canvas.toDataURL("image/png")`. Pre-rasterizza tutte le icone (async,
Promise.all) PRIMA di chiamare `autoTable`, poi nel hook `didDrawCell`
(sincrono) usa `doc.addImage(png,"PNG",x,y,w,h)` centrata nella cella.

**Why:** jsPDF font default (Helvetica) non rende le emoji/glifi icona; e
`addImage` dentro `didDrawCell` richiede i PNG già pronti perché il callback è
sincrono.
**How to apply:** export client-side con jspdf+jspdf-autotable. Per Excel
(SheetJS/`xlsx`) non si possono incorporare immagini nelle celle: usa un'emoji
testuale come indicatore visivo. Tieni la mappatura icona↔dominio in UN solo
file condiviso (es. `client/src/lib/customerJourneyIcons.ts`).
