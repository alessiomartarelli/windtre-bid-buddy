---
name: Webkit date indicator pseudo
description: Come nascondere/testare l'indicatore nativo del calendario nei campi input[type=date]
---
Il controllo nativo `::-webkit-calendar-picker-indicator` sta nel content box: un `padding-right` lo spinge verso il centro del campo, disallineandolo dall'icona overlay a destra.

**Regola:** per un pulsante calendario custom a destra, nascondi l'indicatore nativo con `display:none` e apri il picker via un vero `<button>` che chiama `input.showPicker()` (con `focus()` + try/catch: senza gesto utente può lanciare).

**Test (Playwright/Chromium):** `getComputedStyle(el, '::-webkit-calendar-picker-indicator')` NON è affidabile — ritorna gli stili dell'input stesso (es. display:flex). Verifica invece: classe sull'input + regola `display:none` presente in `document.styleSheets`, e stub di `HTMLInputElement.prototype.showPicker` per dimostrare che il click sul pulsante invoca il picker sul vero input.
