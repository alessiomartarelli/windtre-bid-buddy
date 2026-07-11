# Report vendite giornaliero su Telegram (Task #239)

Invio automatico del riepilogo vendite BiSuite del giorno corrente in un
gruppo Telegram, due volte al giorno alle **13:30** e alle **22:30** ora
italiana (Europe/Rome, corretto anche col cambio ora legale).

## Architettura

- **`shared/bisuiteClassification.ts`** — la classificazione articoli
  (tipo Canvass/Prodotti/Servizi + pista) è stata spostata da
  `client/src/lib/` a `shared/` perché serve anche al server; il vecchio
  path client resta come re-export, gli import esistenti non cambiano.
- **`shared/venditeCommento.ts`** (Task #266) — logica PURA del
  **commento discorsivo in stile "direttore vendite"** che ha sostituito
  l'elenco nel messaggio di testo. Nessuna AI: pool di frasi predefinite a
  fasce, selezione **deterministica** legata alla data (hash FNV-1a di
  `dateYMD` ⇒ seme; stessa data ⇒ stesso testo, ma varietà giorno-per-
  giorno). `buildDirettoreCommento(params)` compone: apertura per fascia
  (☀️ parziale 13:30 / 🌙 chiusura 22:30) e **banda di performance**
  (moltoSopra ≥ +15%, sopra ≥ +5%, inLinea −5..+5%, sotto ≤ −5%,
  moltoSotto ≤ −15% sul delta medio mensile); riassunto della giornata
  (vendite + importo, dimensioni con pezzi/€, delta % vs obiettivo
  giornaliero); framing del **mese** per dimensione (mobile, di cui P.IVA,
  fisso, di cui P.IVA, energia, assicurazioni, protetti, cb — tutti pz;
  telefonia pz, accessori €, servizi €) con delta % vs passo atteso a oggi +
  **proiezione** a fine mese su obiettivo; standout negozio + addetto (con
  eventuale tono "occhio a … sotto la sua media" quando ≥ 3 negozi);
  spunto strategico (spingere sulla dimensione più indietro, consolidare
  la più avanti) e chiusura motivazionale (diversa parziale/chiusura e per
  banda). **Task #282**: lo standout negozio/addetto ora cita il miglior
  **punteggio performance** (non più il fatturato); segue una riga
  **WindTre Protetti** *sempre presente* (`protettiFraming`) — con
  congratulazioni al miglior venditore (`bestProtettiSeller`) se ci sono
  Protetti, altrimenti richiamo a spingere la leva a più alto valore; e una
  menzione **accessori/servizi a parte** (`accessoriServiziFraming`, in €)
  esplicitamente **fuori dal punteggio**. **Giornata al palo** (0 vendite)
  ⇒ frasi dedicate parziale/chiusura. Il passo atteso a oggi usa
  `elapsed`/`total` giorni lavorativi.
  Config di supporto: `parseForecastConfig(raw)` (normalizza il blocco
  forecast: stringhe/virgole ⇒ numeri, vuoti/≤0/NaN ⇒ null),
  `EMPTY_FORECAST`, `hasForecast(fc)`, `fasciaFromTimeLabel(label)`
  (22:xx ⇒ chiusura, resto ⇒ parziale). `ForecastConfig` =
  `{mobileVolumi, mobileIvaVolumi, fissoVolumi, fissoIvaVolumi,
  energiaVolumi, assicurazioniVolumi, protettiVolumi, cbVolumi,
  telefoniPezzi, accessoriFatturato, serviziFatturato, numeroNegoziCc,
  numeroNegoziStrada}` (ogni campo opzionale: una dimensione a null non
  viene valutata; `numeroNegoziCc`/`numeroNegoziStrada` sono solo divisori
  per lo standout/giorni lavorativi, non dimensioni valutate).
- **`shared/venditeReport.ts`** — logica PURA: `aggregateDailyReport`
  (aggregati del giorno: vendite/importo totale, per tipo, per pista, per
  PDV, breakdown `categorieByPista` per le card pista; ANNULLATA escluse,
  coerente con la pagina Vendite BiSuite) e
  `buildTelegramReportMessage`. **Task #266**: il messaggio di testo è ora
  **intestazione** (📊 data + fascia oraria, 🏢 org, con escape HTML) +
  **commento discorsivo** (`buildDirettoreCommento`). L'elenco dettagliato
  (per tipo/pista/PDV, fatturato prodotti/servizi, assicurazioni, energia,
  proiezione) **non è più nel testo**: resta tutto nell'**allegato HTML**,
  invariato. **Impaginazione** (aggiornamento): il commento è diviso in
  **blocchi/paragrafi** separati da riga vuota e le sezioni per-pista sono
  **elenchi puntati** (`•`, una riga per pista, valore in `<b>`): "Dettaglio
  di giornata" (pezzi/€ di oggi per pista) e "Sul mese …" (passo % +
  proiezione su obiettivo per pista). Restano frasi discorsive apertura,
  standout negozio/addetto, spunto strategico e chiusura motivazionale.
  Parametri: `aggregates` (giorno), `monthAggregates?`
  (mese-a-oggi per passo/proiezioni, fallback al giorno), `forecast?`
  (`ForecastConfig`; assente ⇒ commento senza valutazione mensile),
  `fascia?` (derivata da `timeLabel` se assente). I giorni lavorativi del
  mese sono **automatici** e pesati per tipologia di negozio via
  `monthWorkingDaysByType(ymd)`: CC = tutti i giorni tranne i festivi
  (domeniche incluse), strada = tutti tranne domeniche e festivi. `total`
  ed `elapsed` sono la media pesata su `numeroNegoziCc`/`numeroNegoziStrada`
  del forecast; senza conteggi negozi si ricade sul calendario standard
  (`monthWorkingDays`). `elapsed` è sempre cappato a `total`.
  Arricchimenti (Task #263, ora solo nell'HTML allegato): lo split
  **Energia per cliente** 👤 Privati (CF) vs 🏢 Business (P.IVA)
  usa `saleCustomerKind(rawData)`: business se
  `clienteTipo` è GIURIDICA/PROFESSIONISTA **oppure** è presente la P.IVA,
  altrimenti privato (CF o cliente non identificabile ⇒ default privato);
  `aggregateDailyReport`
  espone i nuovi aggregati `energiaByCliente` (split per pista energia) e
  `assicurazioniDettaglio` (ordinato per pezzi↓). La proiezione
  (`buildMonthEndProjection(ymd, monthAgg)`) stima i pezzi a fine mese in
  proporzione ai **giorni lavorativi** (`monthWorkingDays` riusa
  `buildCalendar`/`italianHolidays` dell'Incentivazione;
  `projectMonthEnd(value, elapsed, total)` = proporzione lineare, giorni
  non positivi ⇒ null).
  **Punteggio performance (Task #282)**: `performanceScore(drilldown)` =
  somma pesata delle attivazioni per pista (`PERFORMANCE_WEIGHTS`: mobile 1,
  fisso 3, energia 2, assicurazioni 2, protecta 10, cb 0.5) con la quota
  **P.IVA/business raddoppiata** (`IVA_PIVA_MULTIPLIER=2`, dal
  `businessCountByPista` popolato via `saleCustomerKind` a livello vendita
  per TUTTE le piste), più i telefoni a pezzo (`TELEFONI_WEIGHT=1`, flat, è
  un prodotto non un'attivazione). **NON** include il fatturato
  accessori/servizi. `perPdv`/`perAddetto` di `aggregateDailyReport`
  espongono un campo `punteggio` e sono **ordinati per punteggio↓** (poi
  importo, vendite, nome come spareggio). `topPerformer(a)` = miglior
  addetto/negozio per punteggio (esclude N/D, punteggio>0);
  `bestProtettiSeller(a)` = miglior venditore Protetti (pista protecta) per
  pezzi; `fmtPunti(v)` formatta il punteggio ("1 punto"/"X punti", virgola
  decimale it-IT).
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
  (🚀 pista del giorno); card **"I migliori del giorno"** (Task #272,
  sostituisce le vecchie card 🏆 Top negozio / ⭐ Top addetto uniche):
  per ciascun KPI — 📡 TELCO (fisso+mobile pz), 🛡️ New Core
  (assicurazioni+energia pz), 📱 Telefoni pz, 🎧 Accessori €,
  🛠️ Servizi € — il miglior ⭐ addetto (escluso N/D) e il miglior
  🏆 negozio col valore maturato; calcolo in `buildTopPerKpi`
  (`shared/venditeReport.ts`) dai drill-down `perAddetto`/`perPdv`,
  pareggi deterministici (a parità vince chi è davanti nell'ordinamento
  per importo↓), KPI a zero per tutti ⇒ riga assente. La stessa card
  compare come **"I migliori del mese"** nella pagina "Totale mese"
  (maturato mese-a-oggi, SENZA proiezione). Anche lo standout del
  commento discorsivo (`standoutFraming` in `shared/venditeCommento.ts`)
  usa `buildTopPerKpi`: cita negozio e addetto del KPI più rilevante
  (primo con un vincitore nell'ordine TELCO → New Core → Telefoni →
  Accessori → Servizi) col valore; grafico di
  andamento 14 giorni ad area (SVG inline via `svgAreaChart`, assi con
  giorno settimana + picco); **"La gara delle piste"** — una riga per
  pista con barra orizzontale scalata sul massimo, colore tema dark
  (`PISTA_THEME`), pezzi+importo, chip per categoria (top 4 da
  `categorieByPista`) e delta vs media 7 gg; **"Mix del giorno"** —
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
  proporzionali al **punteggio performance** (Task #282: valore in punti
  via `fmtPunti`, ordinamento per punteggio↓; il fatturato resta come
  informazione secondaria nella riga di dettaglio). Card **🛡️ WindTre
  Protetti** *sempre presente* (Task #282, nelle pagine giorno/mese e
  single-page): se ci sono Protetti celebra il miglior venditore addetto
  e/o negozio (`bestProtettiSeller`, pz), altrimenti ricorda che è la leva a
  più alto valore. Documento standalone: CSS + SVG inline,
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
`{ enabled, bot_token, chat_id }`. Il token è cifrato at-rest con
la stessa AES di SMTP/BiSuite (`server/cryptoSecret.ts`, chiave
`SMTP_SECRET_KEY`); mai in chiaro nel DB.

Il **forecast/obiettivi** NON vive più qui: è per-mese in
`gara_config.config.venditeForecast` (vedi
[`docs/incentivazione-interna.md`](incentivazione-interna.md) per la
Configurazione gara), gestito dalla card "Forecast e obiettivi (mese)" in
Performance → Configurazione gara. Lo scheduler lo legge via
`storage.getGaraConfig(orgId, month, year)` per il mese/anno correnti.
Un eventuale `forecast` legacy ancora presente in `telegramReport` viene
preservato ma non più usato.

## API admin (`server/routes.ts`)

Tutte con `isAuthenticated + requireModule("vendite_bisuite")` + ruolo
admin/super_admin; l'admin è vincolato alla propria org, il super_admin
sceglie l'org.

- `GET /api/admin/telegram-report?org_id=` — config per il form: `{enabled,
  has_token, chat_id}`. Il token **non viene mai restituito in chiaro**
  (il logger API serializza i body delle risposte): la UI riceve solo il
  flag `has_token`.
- `POST /api/admin/telegram-report` — salva `{organization_id, enabled,
  bot_token, chat_id, clear_token?}` (solo trasporto: il forecast si salva
  via `/api/gara-config`); token cifrato al salvataggio;
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
pulsanti "Invia report di prova" e "Salva configurazione". Solo trasporto:
nessun campo forecast qui.

La card **"Forecast e obiettivi (mese)"** vive in
`client/src/pages/ConfigurazioneGara.tsx` (Performance → Configurazione
gara), per-mese/anno: input per pista (mobile e di cui P.IVA, fisso e di
cui P.IVA, energia, assicurazioni, protetti, cb), telefoni pz, accessori €,
servizi €, e due caselle manuali n. negozi CC / n. negozi strada. Salva in
`gara_config.config.venditeForecast`; i valori vuoti restano non valutati.
I giorni lavorativi del report sono automatici (CC incl. domeniche, strada
no) e non si configurano.

## Test

`tests/telegram-report.test.mjs` (105 test puri, inclusi 4 su
`buildTopPerKpi` — vincitori per KPI, N/D escluso, pareggi
deterministici, input vuoto —, i test **punteggio performance**
(Task #282: `performanceScore` pesi/telefoni/P.IVA×2, classifiche ordinate
per punteggio non fatturato, `topPerformer`, `bestProtettiSeller`,
`fmtPunti`, card HTML Protetti sempre presente, commento con Protetti
sempre citato + congratulazioni e accessori/servizi a parte), 4 sui cambi
ora legale — DST marzo 23h / ottobre 25h — e 4 sul redactor dei log,
niente server né DB, via
loader tsx): aggregazione (ANNULLATA escluse, tipi/piste/PDV/addetti,
`categorieByPista` ordinato per pezzi, input malformati), formattazione
euro/date, messaggio (Task #266: intestazione + commento discorsivo,
escape HTML, giorno vuoto, framing mensile solo con forecast, niente più
sezioni elenco), **commento direttore** (`buildDirettoreCommento`:
determinismo per data, apertura/lead per fascia parziale/chiusura,
standout negozio+addetto, bande sopra/sotto il passo, giornata al palo;
`parseForecastConfig` stringhe/virgole/≤0⇒null, `hasForecast`,
`fasciaFromTimeLabel`), report HTML
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

Il verify script accetta ora `TIME_LABEL=<testo>` (override dell'etichetta
oraria in intestazione — determina anche la fascia: `22:xx` ⇒ chiusura) e
`SYNC_FIRST=0` (salta la sync BiSuite, utile per un 2° invio ravvicinato
senza risincronizzare). Così un solo giro può inviare sia il parziale
(13:30) sia la chiusura (22:30).

## Verifica del commento "direttore vendite" con dati reali (Task #267)

`scripts/preview-telegram-commento.mts` — helper **read-only** (non invia,
non scrive sul DB): replica la catena dello scheduler (stessa finestra
dati, `aggregateDailyReport` oggi+mese, `parseForecastConfig`) e stampa il
testo del messaggio per fascia **parziale e chiusura** più una tabella di
**cross-check** dei numeri (delta % giorno/passo, atteso-a-oggi,
proiezioni) da confrontare con l'allegato HTML. Il forecast si può
sovrascrivere via env (`FC_CANVASS`/`FC_TELEFONI`/`FC_ACCESSORI`/
`FC_SERVIZI`/`FC_NEGOZI`/`FC_GIORNI`) per esercitare tutte le bande di
performance senza toccare la config di prod:

```bash
DATABASE_URL=<prod via tunnel> ORG_ID=org-admin-windtre \
  FC_CANVASS=4600 FC_TELEFONI=905 FC_ACCESSORI=20629 FC_SERVIZI=11109 \
  FC_NEGOZI=8 FC_GIORNI=23 \
  npx tsx scripts/preview-telegram-commento.mts
```

Verificato il 04/07/2026 sui dati reali di prod (128 vendite/9.440,86 € al
momento): delta % e proiezioni del commento coincidono con
`buildMonthEndProjection` su tutte le bande (in linea / sopra / sotto),
standout PDV+addetto leggibili. **Org prod senza forecast** ⇒ il commento
live salta il framing mensile (scelta: nessun obiettivo mensile inventato
scritto in prod). Su richiesta utente inviati poi 2 messaggi reali
(parziale 13:30 + chiusura 22:30, label "(verifica commento)") nel gruppo
"Windtre test" — variante **senza forecast**. Fix di forma emerso nella
verifica: le aperture di banda che finiscono con `!` (es. "Chiusura col
botto, squadra!") non prendono più il punto in coda ("!." ⇒ "!", helper
`withPeriod` in `shared/venditeCommento.ts`).
