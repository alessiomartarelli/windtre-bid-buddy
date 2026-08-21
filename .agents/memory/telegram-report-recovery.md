---
name: Telegram report recovery & PM2 memory
description: Recovery al boot delle run Telegram perse + dedup; limite PM2 900M e come cambiarlo
---

- Regola: ogni invio riuscito del report Telegram è registrato in `telegram_report_sends` (org+ymd Roma+slot, UNIQUE); al boot E a ogni reschedule (salvataggio orari) lo scheduler recupera TUTTI gli slot configurati scattati entro 90 min **dello stesso giorno Roma** (non solo il più recente: con orari per-org diversi ne servirebbe più d'uno) e reinvia solo alle org la cui fascia logica non è registrata.
- Le run (timer/recovery) sono serializzate in-process via promise-queue: il dedup è read-then-send-then-record e run concorrenti duplicherebbero prima dell'onConflictDoNothing.
- **Why:** PM2 `max_memory_restart` può uccidere l'app a metà run (dopo fetch+reconcile, prima dell'invio): senza recovery il report va perso.
- **How to apply:** errori di lettura/scrittura del registro non devono mai bloccare l'invio (solo warn). Il limite PM2 è 900M; cambiarlo richiede `pm2 delete` + `start ecosystem.config.cjs` + `save` (il restart non rilegge l'opzione, e resetta l'id pm2 — riferirsi sempre al nome).
- Regola: i salvataggi generici dell'organizzazione devono preservare integralmente `telegramReport`; solo l'endpoint Telegram dedicato può modificarlo.
  **Why:** un autosave della configurazione gara che ometteva il blocco ha cancellato flag e credenziali dopo il report parziale, facendo saltare la chiusura come “org senza bot”.
  **How to apply:** qualunque route che sostituisce l'intero JSON organizzazione deve re-iniettare i blocchi di trasporto/credenziali server-managed letti dallo stato corrente.
