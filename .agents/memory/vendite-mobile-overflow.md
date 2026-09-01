---
name: Vincolo mobile pagine dense
description: le pagine dati principali hanno un vincolo verificato di zero overflow orizzontale su viewport mobile stretti.
---
Regola: nelle intestazioni delle pagine dati dense, ogni testo o badge non essenziale su mobile va nascosto sui breakpoint stretti o reso wrappabile; niente etichette non spezzabili aggiunte liberamente.
**Why:** esiste un vincolo verificato di assenza di overflow orizzontale su viewport mobile; un'etichetta non spezzabile lo viola e blocca la validazione.
**How to apply:** pensa mobile-first quando aggiungi elementi a header/toolbar e verifica la resa su schermo stretto prima di chiudere.
