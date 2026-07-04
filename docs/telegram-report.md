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
  Arricchimenti (Task #263, affinati in Task #264): il messaggio aggiunge
  — quando > 0 — una sezione **Fatturato prodotti/servizi** che elenca
  **tutte** le categorie prodotto vendute (non solo Telefoni/Accessori:
  anche Elettrodomestici, Viaggi, Ricariche, SIM, ecc., con emoji 📱 per
  TELEFONIA, 🎧 per ACCESSORI, 📦 fallback per le altre) più il totale
  🔧 Servizi; il **dettaglio Assicurazioni** per prodotto (tipologia —
  descrizione) e lo split **Energia per cliente** 👤 Privati (CF) vs
  🏢 Business (P.IVA) compaiono **solo quando aggiungono granularità**
  oltre la riga "Per pista" (assicurazioni: ≥ 2 prodotti; energia:
  presenti sia CF che IVA), così non duplicano il totale pista quando c'è
  un solo sottogruppo; e, se passata, la **Proiezione fine mese** (pezzi
  Canvass totali e Telefoni). **Lo split energia CF/IVA viene ricavato
  dalla DESCRIZIONE dell'offerta, non dal tipo cliente registrato**
  (Task #264): `energiaClienteFromDescrizione(descrizione)` = business se
  la descrizione (maiuscola) contiene `BUSINESS` (copre `MICROBUSINESS` e
  `CLIENTE BUSINESS`), altrimenti privato. Sui dati reali WindTre il campo
  cliente spesso non concorda con la descrizione, per questo si usa la
  descrizione. (`saleCustomerKind(rawData)` — business se `clienteTipo` è
  GIURIDICA/PROFESSIONISTA **oppure** è presente la P.IVA — resta esportato
  ma NON governa più lo split energia.) `aggregateDailyReport`
  espone i nuovi aggregati `energiaByCliente` (split per pista energia) e
  `assicurazioniDettaglio` (ordinato per pezzi↓). La proiezione
  (`buildMonthEndProjection(ymd, monthAgg)`) stima i pezzi a fine mese in
  proporzione ai **giorni lavorativi** (`monthWorkingDays` riusa
  `buildCalendar`/`italianHolidays` dell'Incentivazione;
  `projectMonthEnd(value, elapsed, total)` = proporzione lineare, giorni
  non positivi ⇒ null).
  Per il trend (Task #250): `buildDailyTrend(rows, fromYMD, toYMD)`
  (serie per-giorno zero-filled, `TrendDay {ymd, vendite, importo,
  countByPista}`, ANNULLATA e righe senza data/fuori intervallo escluse),
  `trendYmdOf` (giorno YYYY-MM-DD da Date con getter locali o prefisso
  stringa), `addYmdDays` (aritmetica giorni UTC) e `pctDelta` (variazione
  % arrotondata, base non positiva ⇒ null).
- **`shared/venditeReportHtml.ts`** (Task #248, redesign "night glass"
  su feedback utente) — logica PURA: `buildVenditeReportHtml` genera il
  **file HTML allegato** come dashboard mobile a tema scuro con card in
  stile glassmorphism (come l'app) e filo conduttore arancione WindTre.
  Sezioni: hero con glow arancione (numero grande vendite + importo) e
  chip delta oggi/ieri/media 7 gg ▲/▼% integrati; riga **highlights**
  (🏆 top negozio, ⭐ top addetto, 🚀 pista del giorno); grafico di
  andamento 14 giorni ad area (SVG inline via `svgAreaChart`, assi con
  giorno settimana + picco); **"La gara delle piste"** — una riga per
  pista con barra orizzontale scalata sul massimo, colore tema dark
  (`PISTA_THEME`), pezzi+importo, chip di dettaglio inline (top 4 da
  `categorieByPista`) e delta vs media 7 gg. **I chip di dettaglio
  (Task #264)**: per **Assicurazioni** mostrano la **descrizione prodotto**
  (`tipologia — descrizione`, come i chip Mobile TIED/UNTIED); per
  **Energia** mostrano `CF`/`IVA` ricavati dalla descrizione offerta; per
  le altre piste la categoria BiSuite. **"Mix del giorno"** —
  donut chart SVG (`svgDonut`, pezzi totali al centro) + legenda per
  tipo; **"Prodotti per categoria"** e **"Servizi"** — una card
  ciascuna (da `prodottiByCategoria`/`serviziByCategoria` di
  `aggregateDailyReport`, assenti se vuote) con una riga per categoria
  (pezzi + fatturato, barra proporzionale) e chip col fatturato diviso
  per modalità di pagamento (💵 Contanti / 💳 POS / 🏦 Finanziato /
  📄 VAR / 🧾 Altro, solo quelle > 0; sottotitolo `h2-sub` coi totali
  di sezione). Lo split è calcolato in `aggregateDailyReport`:
  finanziato (`importoFinanziato`) e VAR (`importoCredito`) sono esatti
  per-articolo, il resto del prezzo è ripartito proporzionalmente sul
  mix di incasso dello scontrino (`rawData.pagamento`: contanti /
  pagamentiElettronici⇒POS / bonifici+assegni+buoni+coupon+non
  scontrinato+altri⇒Altro); vendita senza mix ⇒ tutto in Altro;
  classifiche PDV e addetti (medaglie top 3) con barre
  proporzionali all'importo. Documento standalone: CSS + SVG inline,
  nessuna risorsa esterna, escape HTML di tutti i valori dinamici. Il
  parametro `trend?: TrendDay[]` è opzionale: con meno di 2 giorni le
  sezioni comparative e i grafici semplicemente non compaiono. Giorno
  senza vendite ⇒ hero a 0 + card "Nessuna vendita" (+ grafico andamento
  se c'è il trend). **Navigazione multi-pagina**: con `history?:
  DayHistoryEntry[]` (da `buildDailyHistory`, crescente, ultimo = oggi)
  il documento diventa navigabile — una pagina pre-renderizzata per
  giorno (`data-page="d0..dN"`, solo l'ultima visibile), barra sticky
  ‹ data › con JS vanilla inline (nessuna risorsa esterna, funziona
  offline da Telegram); i delta e il grafico di ogni pagina storica sono
  calcolati sullo slice del trend fino a quel giorno ("vs giorno prima").
  Con `month?: {label, aggregates}` compare la pagina **"Totale mese"**
  (`data-page="month"`): bottone "Mese" nella nav o tocco sull'hero per
  entrarci/uscirne; contiene hero totale, highlights, andamento dei
  giorni del mese, "La gara delle piste · mese", mix e classifiche.
  Senza `history` il documento resta a pagina singola senza script
  (retrocompatibile). `reportHtmlFileName` produce il nome file
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
  (Task #250) e per la navigazione dell'allegato, `sendDailyReportForOrg`
  legge le vendite in **una sola query** dal più lontano fra inizio mese
  (`monthStartYmd`) e inizio finestra trend (oggi-13), poi deriva:
  righe di oggi con `trendYmdOf` per gli aggregati e il messaggio di
  testo (che resta SOLO sul giorno corrente), `buildDailyTrend` sui 14
  giorni, `buildDailyHistory` (aggregati completi per giorno, pagine
  navigabili) e il totale mese (`aggregateDailyReport` sulle righe da
  inizio mese + `monthLabelOf`), tutti passati al builder HTML.

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
  salvate come fallback). Come lo scheduler, esegue prima la **sync
  BiSuite del giorno** così il report riflette le ultime vendite (un
  errore di sync non blocca l'invio). Se solo l'allegato fallisce
  risponde `{success: true, warning}`.

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

`tests/telegram-report.test.mjs` (70 test puri, inclusi 4 sui cambi
ora legale — DST marzo 23h / ottobre 25h — e 4 sul redactor dei log,
niente server né DB, via
loader tsx): aggregazione (ANNULLATA escluse, tipi/piste/PDV/addetti,
`categorieByPista` ordinato per pezzi, input malformati), formattazione
euro/date, messaggio (sezioni, escape HTML, giorno vuoto), report HTML
allegato (redesign Task #250: hero/card piste a tema/tipi/classifiche
con barre e medaglie, KPI e delta con trend, sparkline per pista,
giorno vuoto con e senza trend, escape valori dinamici, nessuna risorsa
esterna, `escapeHtml`, nome file slugificato), navigazione multi-pagina
(`monthStartYmd`/`monthLabelOf`, `buildDailyHistory` aggregati completi
per giorno con zero-fill/intervallo invalido, pagine `d0..dN` con solo
l'ultima visibile + barra nav ‹ › + JS inline, pagina "Totale mese" con
gara piste del mese e bottone Mese, retrocompatibilità senza `history` ⇒
niente nav né script), helper trend
(`buildDailyTrend` bucketing/zero-fill/intervallo invalido, `pctDelta`,
`addYmdDays`/`trendYmdOf`, `svgAreaChart`), drill-down negozio/addetto
(Task #251: `dettaglio` per PDV/addetto con canvass per pista e categorie
prodotti/servizi ordinate per fatturato↓, righe `<details>` toccabili con
pannello inline su tutte le pagine — giorno/storico/mese — riga senza
articoli resta un `<div>` semplice, nessuno script richiesto), orari
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

## Verifica arricchimenti Task #263 (Task #264)

Il 04/07/2026 sono stati verificati end-to-end gli arricchimenti del
Task #263 (Proiezione fine mese, Fatturato prodotti/servizi, dettaglio
Assicurazioni, split Energia Privati/Business). Procedura: prima un
dry-run che costruisce messaggio + HTML dagli stessi dati/funzioni di
`sendDailyReportForOrg` **senza inviare** (dati di PROD via tunnel SSH),
per ispezionare le nuove sezioni, la validità dell'HTML (container
bilanciati, nessun `undefined`/`NaN`/`[object Object]`) e il render
dell'allegato; poi l'invio REALE nel gruppo "Windtre test" via
`scripts/verify-telegram-scheduled-path.mts`
(`ORG_ID=org-admin-windtre`, sync BiSuite del giorno, reconcile journey
⇒ `INVIATO`). Un invio 200 implica HTML del messaggio valido (Telegram
rifiuta il parse_mode HTML malformato). Il timer schedulato di prod
resta armato.

**Correzioni emerse dalla verifica.** Nel messaggio di testo la sezione
Fatturato mostrava solo Telefoni/Accessori (mancavano le altre categorie
prodotto vendute: Ricariche, SIM, Modem/Router, Elettrodomestici, Viaggi,
ecc.) e le sezioni Assicurazioni / Energia per cliente ripetevano il
totale già presente in "Per pista" quando c'era un solo sottogruppo. Fix:
il Fatturato elenca ora **tutte** le categorie prodotto (con la loro
descrizione BiSuite) più il totale Servizi; Assicurazioni ed Energia per
cliente compaiono **solo** quando aggiungono granularità (≥ 2 prodotti
assicurazione / entrambi i tipi cliente energia).

**Revisione finale (Task #264, feedback utente Round 4).** Su richiesta
esplicita dell'utente, nell'allegato HTML le **card dedicate** sotto "La
gara delle piste" ("Assicurazioni" ed "Energia · Privati vs Business")
sono state **rimosse del tutto** ("togli quelle sotto"). Al loro posto, il
dettaglio compare **inline come chip** dentro la riga pista di "La gara
delle piste" (esattamente come i chip Mobile "TIED CF ×N / UNTIED ×N"):
per Assicurazioni i chip mostrano la **descrizione prodotto**, per Energia
i chip `CF`/`IVA`. Inoltre lo **split Energia CF/IVA** è ora ricavato dalla
**descrizione dell'offerta** (`energiaClienteFromDescrizione`), non dal
tipo cliente registrato: sui dati reali WindTre il campo cliente spesso
diverge dalla descrizione, mentre le offerte business/IVA contengono
sempre `BUSINESS` in descrizione (es. `LUCE MICROBUSINESS …`,
`CLIENTE BUSINESS …`). `assicurazioniDettaglio`
(`aggregateDailyReport`) raggruppa per **descrizione prodotto**
(`tipologiaNome — descrizione`, es. "ASSICURAZIONI CASA — CASA
ELETTRODOMESTICI"). Le sezioni **testuali** del messaggio (Assicurazioni /
Energia per cliente) restano invariate con la regola anti-duplicazione.
Test puri aggiornati (categorie prodotto,
no-duplicazione messaggio + HTML, raggruppamento per descrizione) e
re-invio nel gruppo dopo il fix.
