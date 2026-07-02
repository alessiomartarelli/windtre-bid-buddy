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
  PDV, breakdown `categorieByPista` per le card pista; ANNULLATA escluse,
  coerente con la pagina Vendite BiSuite) e
  `buildTelegramReportMessage` (messaggio HTML compatto per Telegram, con
  escape dei caratteri speciali e sezioni solo per le voci > 0).
  Per il trend (Task #250): `buildDailyTrend(rows, fromYMD, toYMD)`
  (serie per-giorno zero-filled, `TrendDay {ymd, vendite, importo,
  countByPista}`, ANNULLATA e righe senza data/fuori intervallo escluse),
  `trendYmdOf` (giorno YYYY-MM-DD da Date con getter locali o prefisso
  stringa), `addYmdDays` (aritmetica giorni UTC) e `pctDelta` (variazione
  % arrotondata, base non positiva ⇒ null).
- **`shared/venditeReportHtml.ts`** (Task #248, redesign Task #250) —
  logica PURA: `buildVenditeReportHtml` genera il **file HTML allegato**
  in stile dashboard mobile: hero con gradiente arancione (numero grande
  vendite + importo), KPI comparativi oggi/ieri/media 7 gg con chip
  delta ▲/▼%, grafico di andamento 14 giorni ad area (SVG inline via
  `svgAreaChart`), una card per pista con bordo/tinta a tema
  (`PISTA_THEME`), pezzi, delta vs media 7 gg, importo, breakdown per
  categoria (top 5 da `categorieByPista`) e sparkline dedicata; mini-card
  per tipo, classifiche PDV e addetti (medaglie top 3) con barre
  proporzionali all'importo. Documento standalone: CSS + SVG inline,
  nessuna risorsa esterna, escape HTML di tutti i valori dinamici. Il
  parametro `trend?: TrendDay[]` è opzionale: con meno di 2 giorni le
  sezioni comparative e i grafici semplicemente non compaiono. Giorno
  senza vendite ⇒ hero a 0 + card "Nessuna vendita" (+ grafico andamento
  se c'è il trend). `reportHtmlFileName` produce il nome file
  `report-vendite-<org-slug>-<YYYY-MM-DD>[-<hhmm>].html`. La sezione per
  addetto usa l'aggregato `perAddetto` di `aggregateDailyReport`
  (grouping case-insensitive sul nominativo, `N/D` per mancante).
- **`server/telegram.ts`** — `sendTelegramMessage(token, chatId, text)`:
  fetch nativo verso `api.telegram.org/bot<token>/sendMessage`
  (parse_mode HTML, troncamento a 4096 caratteri). Non lancia mai:
  ritorna `{ ok, error }`. `sendTelegramDocument(token, chatId, fileName,
  content, {caption})` (Task #248): invio allegato via `sendDocument`
  con FormData/Blob nativi (multipart, nessuna dipendenza nuova), stessa
  semantica never-throw.
- **`server/telegramReportScheduler.ts`** — scheduler con lo stesso
  pattern Intl/Europe/Rome di `bisuiteScheduler.ts`: `msUntilNextSend`
  calcola il prossimo orario fra 13:30/22:30, setTimeout ricalcolato dopo
  ogni run (`.unref()`). Per ogni org con bot abilitato: sync BiSuite del
  giorno corrente (se le credenziali sono configurate; un errore di sync
  NON blocca l'invio) → lettura vendite di oggi dal DB → invio. Errori
  loggati per-org senza bloccare le altre. Avviato da `server/index.ts`
  SOLO in produzione (come lo scheduler BiSuite). Dopo il messaggio di
  testo, `sendDailyReportForOrg` invia anche l'**allegato HTML**
  (Task #248): se l'allegato fallisce il report NON è considerato
  fallito — warn nel log, `docError` nel risultato (l'endpoint di prova
  lo espone come `warning`), scheduler mai bloccato. Per il trend
  (Task #250) `sendDailyReportForOrg` legge **14 giorni** di vendite in
  una sola query (`getBisuiteSalesByItalianDateRange(orgId, oggi-13,
  oggi)`), filtra le righe di oggi con `trendYmdOf` per gli aggregati e
  il messaggio di testo (che resta SOLO sul giorno corrente) e passa
  `buildDailyTrend` al builder HTML.

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
  (messaggio + allegato HTML) usando le credenziali nel body (o quelle
  salvate come fallback), senza sync. Se solo l'allegato fallisce risponde
  `{success: true, warning}`.

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

`tests/telegram-report.test.mjs` (37 test puri, inclusi 4 sui cambi
ora legale — DST marzo 23h / ottobre 25h — e 4 sul redactor dei log,
niente server né DB, via
loader tsx): aggregazione (ANNULLATA escluse, tipi/piste/PDV/addetti,
`categorieByPista` ordinato per pezzi, input malformati), formattazione
euro/date, messaggio (sezioni, escape HTML, giorno vuoto), report HTML
allegato (redesign Task #250: hero/card piste a tema/tipi/classifiche
con barre e medaglie, KPI e delta con trend, sparkline per pista,
giorno vuoto con e senza trend, escape valori dinamici, nessuna risorsa
esterna, `escapeHtml`, nome file slugificato), helper trend
(`buildDailyTrend` bucketing/zero-fill/intervallo invalido, `pctDelta`,
`addYmdDays`/`trendYmdOf`, `svgAreaChart`), orari
scheduler (`msUntilNextSend` a cavallo dei due orari
e di mezzanotte) e `resolveTelegramConfig`. Lancio:
`bash scripts/run-telegram-report-tests.sh`. La suite è inclusa nello
step 1a del quality gate di `scripts/deploy-prod.sh`. (Niente workflow
dedicato: limite workflow del workspace raggiunto.)

## Verifica end-to-end e attivazione in prod (Task #240)

Il 02/07/2026 è stato fatto un test reale con il bot **@CmsWindTrebot**
nel gruppo Telegram "Windtre test" (chat id nel config di prod): vendite
sintetiche seminate nel DB dev (2 attive + 1 ANNULLATA esclusa), invio
via `POST /api/admin/telegram-report-test` ⇒ 200 e messaggio arrivato
leggibile (conferma dell'utente). Un invio 200 implica anche HTML
valido: Telegram rifiuta i messaggi con parse_mode HTML malformato.

In produzione l'invio automatico è ATTIVO per l'org **WindTre Admin**
(`org-admin-windtre`): `config.telegramReport = {enabled, bot_token,
chat_id}` scritto nel DB di prod con token cifrato **sul VPS** usando la
`SMTP_SECRET_KEY` di prod (che è DIVERSA da quella dev: mai cifrare in
dev un segreto destinato al DB di prod), con verifica round-trip del
decrypt. Dopo il deploy il log PM2 conferma lo scheduler:
`[telegram-report] prossimo report 13:30 programmato per …`.

## Verifica del percorso schedulato (Task #242)

Il pulsante "Invia report di prova" NON copre il percorso schedulato
completo (salta la sync BiSuite). Per provarlo senza aspettare l'orario
c'è `scripts/verify-telegram-scheduled-path.mts`: replica
`runScheduledSend` — di default per **TUTTE** le org con bot attivo,
esattamente come lo scheduler (usa `ORG_ID=<id>` per limitarlo a una
sola org) — `resolveTelegramConfig` (decrypt del token dal DB) +
`sendDailyReportForOrg` con `syncFirst: true` (sync BiSuite del giorno →
aggregazione → invio REALE nel gruppo). Va lanciato con `DATABASE_URL`
puntato al DB di prod via tunnel SSH e `SMTP_SECRET_KEY` di prod
(recuperata dal VPS senza stamparla):

```bash
# tunnel: ssh -f -N -L 15433:localhost:5432 root@VPS
DATABASE_URL=<prod via tunnel> SMTP_SECRET_KEY=<prod> \
  ORG_ID=org-admin-windtre \
  npx tsx scripts/verify-telegram-scheduled-path.mts
```

Eseguito con successo il 02/07/2026 sera: sync 177 vendite del giorno,
reconcile journey, messaggio arrivato nel gruppo "Windtre test" con
label "verifica scheduler (prova pre-13:30)". Il timer di prod resta
armato (log PM2: `prossimo report 13:30 programmato per
2026-07-03T11:30:05Z`).
