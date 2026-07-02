# Report vendite giornaliero su Telegram (Task #239)

Invio automatico del riepilogo vendite BiSuite del giorno corrente in un
gruppo Telegram, due volte al giorno alle **13:30** e alle **22:30** ora
italiana (Europe/Rome, corretto anche col cambio ora legale).

## Architettura

- **`shared/bisuiteClassification.ts`** — la classificazione articoli
  (tipo Canvass/Prodotti/Servizi + pista) è stata spostata da
  `client/src/lib/` a `shared/` perché serve anche al server; il vecchio
  path client resta come re-export, gli import esistenti non cambiano.
- **`shared/venditeReport.ts`** — logica PURA: `aggregateDailyReport`
  (aggregati del giorno: vendite/importo totale, per tipo, per pista, per
  PDV; ANNULLATA escluse, coerente con la pagina Vendite BiSuite) e
  `buildTelegramReportMessage` (messaggio HTML compatto per Telegram, con
  escape dei caratteri speciali e sezioni solo per le voci > 0).
- **`server/telegram.ts`** — `sendTelegramMessage(token, chatId, text)`:
  fetch nativo verso `api.telegram.org/bot<token>/sendMessage`
  (parse_mode HTML, troncamento a 4096 caratteri). Non lancia mai:
  ritorna `{ ok, error }`.
- **`server/telegramReportScheduler.ts`** — scheduler con lo stesso
  pattern Intl/Europe/Rome di `bisuiteScheduler.ts`: `msUntilNextSend`
  calcola il prossimo orario fra 13:30/22:30, setTimeout ricalcolato dopo
  ogni run (`.unref()`). Per ogni org con bot abilitato: sync BiSuite del
  giorno corrente (se le credenziali sono configurate; un errore di sync
  NON blocca l'invio) → lettura vendite di oggi dal DB → invio. Errori
  loggati per-org senza bloccare le altre. Avviato da `server/index.ts`
  SOLO in produzione (come lo scheduler BiSuite).

## Config per-organizzazione

In `organization_config.config.telegramReport`:
`{ enabled, bot_token, chat_id }`. Il token è cifrato at-rest con la
stessa AES di SMTP/BiSuite (`server/cryptoSecret.ts`, chiave
`SMTP_SECRET_KEY`); mai in chiaro nel DB.

## API admin (`server/routes.ts`)

Tutte con `isAuthenticated + requireModule("vendite_bisuite")` + ruolo
admin/super_admin; l'admin è vincolato alla propria org, il super_admin
sceglie l'org.

- `GET /api/admin/telegram-report?org_id=` — config per il form: `{enabled,
  has_token, chat_id}`. Il token **non viene mai restituito in chiaro**
  (il logger API serializza i body delle risposte): la UI riceve solo il
  flag `has_token`.
- `POST /api/admin/telegram-report` — salva `{organization_id, enabled,
  bot_token, chat_id, clear_token?}`; token cifrato al salvataggio;
  **token vuoto nel payload = mantieni quello già salvato**;
  `clear_token: true` = rimozione esplicita del token (pulsante "Rimuovi
  token salvato" nella card); per abilitare servono token (nuovo o
  salvato) + chat id.
- `POST /api/admin/telegram-report-test` — invia SUBITO il report di oggi
  usando le credenziali nel body (o quelle salvate come fallback), senza sync.

Difesa in profondità: il logger delle risposte `/api/*` in
`server/index.ts` usa `logJsonReplacer` (`server/logRedact.ts`) che
maschera con `[redacted]` i valori di chiavi sensibili
(token/secret/password/api key/cookie/credential, case-insensitive) oltre
a troncare i data URL immagine, così nessuna route può spillare segreti
nei log runtime.

## UI

`client/src/components/TelegramReportForm.tsx` — card "Report vendite su
Telegram" (pattern BiSuiteConnectionForm) in AdminPanel (tab credenziali,
org propria) e SuperAdminPanel (selettore org). Campi token (mascherato) e
chat ID con istruzioni BotFather/getUpdates, switch invio automatico,
pulsanti "Invia report di prova" e "Salva configurazione".

## Test

`tests/telegram-report.test.mjs` (15 test puri, niente server né DB, via
loader tsx): aggregazione (ANNULLATA escluse, tipi/piste/PDV, input
malformati), formattazione euro/date, messaggio (sezioni, escape HTML,
giorno vuoto), orari scheduler (`msUntilNextSend` a cavallo dei due orari
e di mezzanotte) e `resolveTelegramConfig`. Lancio:
`bash scripts/run-telegram-report-tests.sh`. La suite è inclusa nello
step 1a del quality gate di `scripts/deploy-prod.sh`. (Niente workflow
dedicato: limite workflow del workspace raggiunto.)
