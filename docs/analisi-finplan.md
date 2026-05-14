# Tab Analisi — FinPlan Studio

Tab dentro Amministrazione che embedda lo strumento standalone "Easy
Digital Group — FinPlan Studio" (vanilla HTML + Chart.js + xlsx + pdf.js)
in un `<iframe>` a tutta pagina, sostituendo la persistenza
`localStorage` con un blob JSONB per organizzazione su Postgres.

## File coinvolti

- `client/public/finplan/index.html` — copia dell'HTML originale con uno
  script di shim iniettato in `<head>` subito dopo il `<title>` per
  la sync server-side. Il resto del file è invariato.
- `client/src/pages/Amministrazione.tsx` — nuovo `TabKey` `analisi` con
  `<TabsTrigger>` in tutti e tre i blocchi `Tabs` esistenti e
  `<TabsContent value="analisi">` che monta l'iframe a
  `${BASE_PATH}/finplan/index.html`.
- `shared/schema.ts` — tabella `finplan_data` (`organization_id` UNIQUE,
  `data` JSONB, `updated_by`, `updated_at`).
- `server/storage.ts` — `getFinplanData(orgId)` /
  `upsertFinplanData(orgId, data, updatedBy)`.
- `server/routes.ts` — `GET /api/finplan` e `PUT /api/finplan`
  (entrambi `isAuthenticated`, scope automatico
  `profile.organizationId`).

## Persistenza

Lo script iniettato in `client/public/finplan/index.html`:

1. Risolve l'URL API in modo relativo all'iframe stesso
   (`new URL('../api/finplan', location.href)`), così funziona sia in dev
   (`/api/finplan`) sia in prod (`/incentivew3/api/finplan`).
2. All'avvio adotta una strategia **completamente non bloccante**
   (Task #121, niente XHR sincrono):
   - Se `localStorage[STORAGE_KEY]` ha già dati (caso comune dalla 2ª
     apertura) → boot istantaneo dalla cache e `fetch` async in
     background per riconciliare con il server (confronto via
     `updatedAt`, non JSON.stringify, per robustezza al riordino
     chiavi jsonb). Reload solo se il server ha un updatedAt più
     recente **e** l'utente non ha scritto nella sessione corrente
     (flag `_userWroteThisSession`). Se invece il server ha una
     versione più nuova **ma** l'utente ha modifiche locali pendenti,
     compare un banner non bloccante in basso al centro ("Esiste una
     versione più recente salvata da un altro utente — ricarica per
     vederla (perderai le modifiche non salvate)") con un pulsante
     "Ricarica ora" che forza il reload e una × per chiuderlo. Niente
     reload automatico in questo scenario, così le modifiche locali
     non vengono perse senza consenso.
   - Se la cache è vuota (prima apertura su quel browser+org) →
     mostra un overlay leggero "Caricamento dati FinPlan…",
     fa un `fetch` async, scrive i dati in localStorage e fa **un
     unico** `location.reload()` per idratare il tool. Niente XHR
     sincrono: il parser e la UI restano sbloccati.
3. Patcha `Storage.prototype.setItem`: ogni volta che il main script
   salva sulla chiave master `finplan_edg_20260505_134919`, fa un
   debounce-`PUT` (3 s, era 1.5 s) verso `/api/finplan` con
   `{data: <snapshot>}`. Il debounce più lungo riduce frequenza di
   serializzazione/PUT su blob grandi senza ritardo percepibile.
4. Espone `window.finplanApi = { endpoint, fetchRemote, pushRemote }`
   come hook per future API (es. import/export programmato, sync
   periodica con altri sistemi).

`localStorage` resta come cache offline e per i comandi di
import/export JSON manuali già presenti nel tool.

## Sicurezza e limiti

- Le route usano `isAuthenticated + requireModule(["amministrazione",
  "controllo_gestione"])`: stesso gate della pagina Amministrazione, così
  un utente di un'altra org senza quei moduli non può leggere/scrivere
  il blob. `super_admin` bypassa il check come nel resto del sistema.
- Cross-tenant cache: lo shim al boot azzera `localStorage[KEY]` solo
  quando il server risponde **200 con `data` vuoto/`{}`** (risposta
  autoritativa "nessun dato per questa org"), così cambio utente/org
  sullo stesso browser non leak-a dati della sessione precedente. In
  caso di errori di rete/401/5xx la cache locale resta intatta come
  fallback offline.
- Race salvataggio: lo shim usa una coda "latest-wins" — se un PUT è in
  volo e arriva un nuovo snapshot, lo memorizza come `_pending` e lo
  flusha al termine, così l'ultimo stato viene sempre persistito.
- Scoping per organizzazione: la riga è univoca per `organization_id`,
  nessuna possibilità di vedere/scrivere dati di altre org.
- Limite payload server-side: 12 MB per `JSON.stringify(data)`. Oltre
  → HTTP 413. La `express.json` globale è già a 50 MB.
- Il blob è opaco lato server: nessuna validazione di forma, nessuna
  trasformazione. Sicuro perché reso solo a chi appartiene all'org e
  consumato esclusivamente dall'iframe stesso.

## Performance (Task #121)

Il file standalone è ~5,4 MB di HTML+JS inline. Per evitare 3-6s di
attesa a ogni apertura del tab Analisi:

- **Server: gzip + ETag + cache lunga** (`server/finplanStatic.ts`). Un
  middleware monta `/finplan/*`, pre-comprime in memoria (gzip livello
  9, cache invalidata su `mtime`) e risponde con `ETag` +
  `Cache-Control` differenziato:
  - URL semplice (es. `/finplan/index.html`): `public, max-age=3600,
    must-revalidate` → 1h di cache pura, poi revalida via ETag (se
    nulla è cambiato il server risponde 304 da pochi byte).
  - URL versionato (es. `/finplan/index.html?v=<hash>`): `public,
    max-age=31536000, immutable` → cache un anno, mai revalidata
    (cambiare la query param invalida). Pronto per quando esporremo
    un build hash al client.
  Risultato: prima apertura ~600 KB trasferiti invece di 5,4 MB;
  aperture successive entro 1h → 0 byte (cache hit). Montato sia in
  dev (prima di Vite) sia in prod (prima di `express.static`).
- **xlsx + pdf.js caricate ON-DEMAND**: i tag `<script>` per xlsx e
  pdf.js sono stati rimossi dall'`<head>`. Le librerie vengono iniettate
  dinamicamente la prima volta che un entry point di import/export le
  richiede tramite `await window.loadXLSX()` / `await window.loadPdfJs()`.
  Una `Promise` cached garantisce che ogni libreria sia scaricata e
  inizializzata una sola volta, anche se più handler la richiedono in
  parallelo. Le chiamate successive risolvono immediatamente. Tutti gli
  entry point asincroni (`parseExcel`, `parsePdf`, `hrParseExcel`,
  `ptImportFile`, `ptImportPdf`, `debtImport*`, `debtReload*`,
  `adeImport*`, `cdgImport*`, `scadImportFile`, `ptPdfAnalisi`,
  `archUploadFiles`, `importObjConsuntivo`, `downloadHRTemplate`)
  fanno `await` del loader prima di toccare `XLSX` o `pdfjsLib`.
  Risultato: ~700 KB rimossi dal cold load per gli utenti che non
  importano/esportano nulla. Chart.js resta invece blocking perché
  serve a `buildPanels()` immediatamente al boot.
- **Google Fonts consolidati**: una sola richiesta che include tutti
  i family (Syne + Plus Jakarta Sans + Inter + JetBrains Mono),
  invece delle due richieste duplicate originali.
- **Tenant scoping del localStorage**: l'iframe è caricato con
  `?org=<orgId>` dal wrapper React (Amministrazione.tsx). Lo script
  inline parsa il query param e namespacing la chiave master in
  `finplan_edg_20260505_134919__org_<orgId>`. Conseguenza: cambio
  organizzazione → cache di un'altra org non viene MAI letta. Se
  manca l'orgId (iframe aperto fuori dal wrapper), il fast-boot da
  cache è disabilitato e si forza l'overlay async + GET autoritativa,
  così non c'è nessun rischio di mostrare dati di un'altra org. È
  prevista una migrazione one-shot dalla chiave legacy globale alla
  prima apertura per quel orgId, per non perdere dati pre-fix.
- **Iframe keep-alive** (`client/src/pages/Amministrazione.tsx`): la
  prima volta che l'utente apre il tab Analisi, l'iframe FinPlan viene
  montato in un wrapper persistente fuori dal blocco `<TabsContent>`,
  con `display:none` quando l'utente passa ad altri tab. Il blocco
  `TabsContent value="analisi"` non contiene più il vero iframe.
  Risultato: tornare al tab è istantaneo, niente re-bootstrap.

## Performance interazioni interne (Task #128)

Dopo aver ottimizzato boot/rete (Task #121), restavano 5-10s di
freeze al cambio azienda o sezione interna. Tre interventi
chirurgici dentro `client/public/finplan/index.html`, niente nuove
dipendenze, comportamento invariato:

- **Chart.js — update invece di destroy+recreate**: i tre helper
  `makeArea` / `makeBar` / `makePie` ora controllano se sul canvas
  esiste già un grafico dello stesso tipo e numero di dataset; in tal
  caso mutano `chart.data` in place e chiamano `chart.update('none')`
  (senza animazione). Salta la teardown di Chart.js, la
  riallocazione del canvas e l'animazione di entrata, che sui pannelli
  con 4-5 grafici dominavano il tempo di render. Fallback al
  vecchio `destroy + new Chart` per type mismatch o dataset shape
  diversa (sicuro, mai regressivo).
- **Memo per-frame degli aggregati**: un IIFE in fondo al file wrappa
  `coTotals`, `coIvaTotals`, `coIgTotals`, `coGcTotals`,
  `coEsteroTotals`, `coFinanziamentiTotals`, `coRateazioniTotals` con
  una cache `Map` keyed `<funcName>:<ci>:<frame>`. Il frame counter
  viene bumpato (e la cache svuotata) all'inizio di ogni
  `renderCo` / `renderConsolidated`, di ogni tick idle e a ogni click
  di tab interno.
  Conseguenza: dentro una singola chiamata di `renderConsolidated` le
  ~30 invocazioni di `coTotals(co)` (ciclo `consMonthly` di 12 mesi
  + tabella confronto + chart category aggregate) collassano a 5
  (una per società); idem per le altre.
  **Correttezza**: la cache è attiva SOLO quando siamo dentro a un
  blocco di render tracciato (contatore `_inRender > 0`,
  incrementato/decrementato in renderCo/renderConsolidated/idle
  tick/inner-tab handler). Le chiamate dirette dei mutation handler
  — es. `setTxIva` → `renderCoKPIs(ci)`, gli onchange dei valori
  mensili → `renderCoKPIs + renderMonthCharts`, gli onchange degli
  obiettivi → `renderObjCo + renderCoKPIs`, gli input di
  `inv` → `renderDebtInv + renderCoKPIs` — passano per la wrapper
  ma con `_inRender === 0` bypassano la cache e ricalcolano sempre,
  così l'utente vede subito il valore aggiornato senza dover
  cambiare azienda/sezione. La modifica preserva il guadagno
  prestazionale (le ~30 chiamate dentro renderConsolidated restano
  collassate a 5) senza introdurre stale reads. Su errore la
  wrapper fa fallback alla funzione originale.
- **renderCo incrementale**: `renderCo` viene riassegnato (function
  declarations sono hoisted, quindi il wrap funziona anche se l'IIFE
  sta a fine file) in modo da:
  1. Renderizzare SUBITO `renderCoKPIs(ci)` + la sola sezione
     attualmente visibile (rilevata via `document.querySelector('[id^="sec-<ci>-"].on')`),
     che è ciò che l'utente vede mentre cambia azienda;
  2. Schedulare ognuna delle altre 12 sezioni in
     `requestIdleCallback` (con fallback `setTimeout(_, 16)`), una
     per tick, così il main thread resta responsivo;
  3. Pre-popolare la tbody Personale e fare `debounceSave()` solo
     dopo che tutte le sezioni idle sono state aggiornate.
  Il render set è identico a quello della versione 8244 di
  `renderCo` (stessa lista di sub-renderer, stessi side effect),
  semplicemente spalmato nel tempo. Le sezioni nascoste vengono
  comunque aggiornate, così quando l'utente clicca un tab interno
  trova la sezione già pronta. Se due `renderCo` consecutive si
  sovrappongono, il bump del frame invalida la cache ma le idle
  callback in volo riapplicano semplicemente i nuovi dati al DOM
  (auto-healing, niente race visibili).
- **Click su tab interno (`attachListeners`)**: il vecchio handler
  chiamava `renderCo(ci)` per intero a ogni click, rifacendo TUTTE
  le 14 sezioni anche se l'utente passava da "Mensile" a "Categorie".
  Ora chiama solo `SECTION_RENDERERS[t.dataset.t](ci)` + KPI:
  l'unica sezione visibile viene aggiornata, le altre restano
  cached dal render precedente.
- **Profiler opzionale**: aggiungendo `?perf=1` alla query string
  dell'iframe, ogni `renderCo`/`renderConsolidated`/sub-section
  logga su console il tempo in ms (`[finplan perf] ...`). In prod
  resta off (zero overhead), ma utile per regression testing.

I test `tests/finplan-sync.test.mjs` (5 scenari) restano verdi —
lo shim sync, ETag/304, debounce 3s, conflict guard e PUT/GET
autenticato non sono toccati da queste modifiche.

## Note operative

- L'HTML usa CDN (Chart.js, xlsx, pdf.js) e font Google: nessuna
  installazione npm.
- Vite copia automaticamente `client/public/` in `dist/public/` in
  build di produzione, quindi nessuna modifica a `vite.config.ts` o a
  `script/build.ts`.
- Eventuali aggiornamenti al tool standalone: ricopiare il file in
  `client/public/finplan/index.html` e re-iniettare il blocco
  `<script>` di shim subito dopo il `<title>` + il blocco theme
  override + i `<script defer>` per le CDN.
