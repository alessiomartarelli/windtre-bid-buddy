---
name: Telegram report recovery & PM2 memory
description: Recovery al boot delle run Telegram perse + dedup; limite PM2 900M e come cambiarlo
---

- Regola: ogni invio riuscito del report Telegram è registrato in `telegram_report_sends` (org+ymd Roma+slot, UNIQUE); al boot lo scheduler recupera lo slot 13:30/22:30 scattato entro 90 min **dello stesso giorno Roma** e reinvia solo alle org non registrate.
- **Why:** PM2 `max_memory_restart` può uccidere l'app a metà run (dopo fetch+reconcile, prima dell'invio): senza recovery il report va perso.
- **How to apply:** errori di lettura/scrittura del registro non devono mai bloccare l'invio (solo warn). Il limite PM2 è 900M; cambiarlo richiede `pm2 delete` + `start ecosystem.config.cjs` + `save` (il restart non rilegge l'opzione, e resetta l'id pm2 — riferirsi sempre al nome).
