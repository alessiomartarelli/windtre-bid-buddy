---
name: Dark theme contrast layer
description: How app-wide dark contrast and soft borders are structured (dark-contrast.css, --border-soft tokens)
---

Il livello di contrasto scuro app-wide vive in client/src/dark-contrast.css, importato per ULTIMO in main.tsx: vince per ordine a parità di specificità su index.css e vendite-midnight.css.

**Regole chiave:**
- Midnight Violet imposta comunque la classe `.dark` su `<html>`: le regole scoped a `.dark` coprono entrambi gli schemi scuri. Le differenze vivono nei token (`--border-soft`, `--border-soft-strong`) ridefiniti da `html[data-skin="midnight-violet"]`.
- Bordi card/overlay/sidebar/header: SEMPRE via `hsl(var(--border-soft…))`, mai rgb viola hard-coded. Chi aggiunge un nuovo bordo viola in vendite-midnight.css rompe l'assert "hue 190–250" di tests/dark-contrast-ui.test.mjs (che controlla anche le card reali della pagina, incluso `header.sticky` che è un `.glass-panel`).
- Badge `bg-<hue>-500/10` e testi semantici -600/-700 sono rialzati globalmente in dark con !important (estratti da .vendite-dark-contrast); le pagine con varianti dark: ricevono valori equivalenti, nessun doppio lavoro necessario.

**Why:** la skin midnight aveva bordi viola netti (rgb 196/210 172/193 255) sparsi in più selettori con !important; centralizzare nei token evita regressioni a ogni ritocco.
**How to apply:** nuovo componente scuro → usa i token; nuovo colore semantico → aggiungilo a dark-contrast.css, non alla singola pagina.
