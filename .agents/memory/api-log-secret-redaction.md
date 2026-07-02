---
name: API log secret redaction
description: The /api/* response logger serializes full JSON bodies — routes must never return plaintext secrets; shared redactor exists.
---

Il logger delle risposte in `server/index.ts` serializza l'intero body
JSON di ogni risposta `/api/*` nei log runtime.

**Regola:** nessuna route deve MAI restituire segreti in chiaro
(token bot, client secret, password) — nemmeno "solo per il form
admin". Restituire un flag `has_token`/preview e usare la semantica
"campo vuoto = mantieni il salvato" + `clear_token: true` per la
rimozione esplicita.

**Why:** review architetturale ha bocciato una GET che restituiva il
bot token Telegram decifrato: sarebbe finito nei log via il logger API.

**How to apply:** difesa in profondità già in piedi — `logJsonReplacer`
in `server/logRedact.ts` maschera chiavi sensibili
(token/secret/password/api key/cookie/credential, case-insensitive) nei
log; è testato nei test puri telegram-report. Ma la prima linea resta:
non mettere il segreto nella risposta.
