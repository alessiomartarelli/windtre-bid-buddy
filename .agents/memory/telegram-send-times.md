---
name: Telegram send times configurabili
description: Orari di invio del report Telegram per-org, scheduling e dedup per fascia logica
---

- Orari per-org in `organization_config.config.telegramReport.send_times = { parziale, chiusura }` ("HH:MM"); default 13:30/22:15. Parsing/validazione in `shared/telegramSendTimes.ts` (pura, testabile con tsx).
- **Regola**: la fascia 02:00–02:59 è vietata come orario di invio.
  **Why:** col cambio ora legale quell'ora può non esistere o esistere due volte; la conversione wall-time→epoch diventerebbe ambigua.
  **How to apply:** qualunque nuovo orario schedulato su Europe/Rome deve passare da `normalizeTimeLabel`.
- **Regola**: il dedup degli invii (telegram_report_sends) confronta la FASCIA logica (parziale/chiusura via `fasciaForLabel`), non il label orario.
  **Why:** se un'org cambia orario a metà giornata, il label registrato non coincide più con lo slot nuovo: dedup per label produce doppioni o sopprime la chiusura.
- Lo scheduler pianifica sull'unione degli orari di tutte le org abilitate e rilegge la config a ogni giro; il POST della config chiama `rescheduleTelegramReports()` per ri-armare subito il timer (altrimenti un nuovo orario futuro di oggi verrebbe perso). Generation counter per invalidare i giri superati.
