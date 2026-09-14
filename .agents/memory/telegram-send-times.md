---
name: Telegram send times configurabili
description: Quattro slot di invio Telegram per-org, compatibilità legacy, scheduling e dedup
---

- **Regola:** ogni tenant può configurare tre slot parziali e uno di chiusura; i default sono 13:30, 16:00, 19:00 e 22:15.
  **Why:** servono più aggiornamenti intermedi, tutti gestibili dall'admin del tenant.
  **How to apply:** nuovi salvataggi usano quattro orari distinti; le configurazioni storiche a due slot restano a due finché l'admin non salva il nuovo form.
- **Regola**: la fascia 02:00–02:59 è vietata come orario di invio.
  **Why:** col cambio ora legale quell'ora può non esistere o esistere due volte; la conversione wall-time→epoch diventerebbe ambigua.
  **How to apply:** qualunque nuovo orario schedulato su Europe/Rome deve passare da `normalizeTimeLabel`.
- **Regola:** i tre invii parziali condividono il contenuto di fascia “parziale”, ma vengono deduplicati separatamente per orario.
  **Why:** deduplicare soltanto per fascia sopprimerebbe il secondo e il terzo invio parziale dello stesso giorno.
  **How to apply:** l'identità di invio resta distinta dal tipo di contenuto; spostare un orario crea un nuovo slot recuperabile entro la finestra prevista.
- Lo scheduler pianifica sull'unione degli orari di tutte le org abilitate e rilegge la config a ogni giro; il POST della config chiama `rescheduleTelegramReports()` per ri-armare subito il timer (altrimenti un nuovo orario futuro di oggi verrebbe perso). Generation counter per invalidare i giri superati.
