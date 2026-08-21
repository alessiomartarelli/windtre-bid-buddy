---
name: Icona date nei temi scuri
description: Gestione affidabile dell’indicatore dei campi date quando il browser ignora i filtri CSS nei temi scuri.
---

Non fare affidamento su `filter`, `opacity` o `color-scheme` per rendere chiaro `::-webkit-calendar-picker-indicator`: Chromium può continuare a disegnare l’icona nativa nera e non esporre gli stili attesi.

**Why:** Il filtro CSS risultava presente nel foglio ma l’indicatore rimaneva nero nella resa reale. Un’icona chiara sovrapposta risolve la visibilità, purché non intercetti il puntatore.

**How to apply:** Nei campi data scuri, sovrapponi un’icona con fondo uguale all’input, `aria-hidden` e `pointer-events: none`; lascia sotto il vero `input[type=date]`. Verifica visivamente l’icona e testa un click sul bordo destro confermando che l’input riceva il focus.