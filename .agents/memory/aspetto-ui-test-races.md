---
name: Aspetto UI test races
description: Trappole nei test Playwright delle preferenze aspetto (sync iniziale che sovrascrive, click concorrenti persi)
---

Due trappole scoperte testando tema/palette per-utente in UI:

1. **Sync iniziale in volo**: al primo accesso di un utente UiPrefsSync applica i default e ogni setTheme/setAccent spara una PATCH fire-and-forget. Se il test clicca subito, la PATCH del default (es. theme "system") può atterrare DOPO e sovrascrivere la scelta del test.
   **How to apply:** prima di interagire, aspetta il marker locale `mystoredesk-prefs-user` + la comparsa di theme+accent di default in `profiles.ui_prefs`.

2. **Click Playwright concorrenti**: `Promise.all([page.click(a), page.click(b)])` sulla stessa pagina non è supportato — le azioni pointer si disturbano e un click può andare perso silenziosamente.
   **How to apply:** click sequenziali senza attese intermedie; la concorrenza vera (merge jsonb atomico) va testata con fetch PATCH paralleli via HTTP.
