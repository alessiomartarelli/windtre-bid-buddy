---
name: Accent primary-foreground dinamico
description: Il testo su --primary con preset/custom accent è calcolato a runtime (bianco vs inchiostro scuro) per WCAG 4.5.
---

Regola: quando un accent preset o custom sovrascrive `--primary`, anche `--primary-foreground` va sovrascritto scegliendo fra bianco e inchiostro scuro (222 47% 5%) quello con contrasto migliore (bianco se regge ≥4.5).

**Why:** i preset dark sono spesso troppo chiari per il bianco fisso di index.css (es. blu/violet in dark: pill nav attiva sotto WCAG 4.5). Violet è "mid-lightness": né bianco né un inchiostro l=11% raggiungono 4.5 — serve inchiostro molto scuro (l=5%).

**How to apply:** la logica vive in `primaryForegroundFor` (client/src/lib/appearance.ts) ED è duplicata nel pre-paint di client/index.html — tenerle allineate quando si aggiunge un preset. La suite tests/dark-contrast-accents-ui.test.mjs (workflow dark-contrast-accents-ui-tests) scandisce Home + Dashboard Gara Reale in dark per OGNI preset della whitelist; lo scanner condiviso sta in tests/helpers/contrastScan.mjs.
