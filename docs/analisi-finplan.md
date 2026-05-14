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
2. All'avvio adotta una strategia **non bloccante** (Task #121):
   - Se `localStorage[STORAGE_KEY]` ha già dati (caso comune dalla 2ª
     apertura) → boot istantaneo dalla cache e `fetch` async in
     background per riconciliare con il server. Se il remoto differisce
     (snapshot più recente da altro browser/dispositivo), aggiorna la
     cache e fa `location.reload()` una sola volta.
   - Se la cache è vuota (prima apertura su quel browser) → fallback
     alla `XMLHttpRequest` sincrona, una tantum, per evitare che il
     tool parta con stato vuoto e poi "salti" sul reload.
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

- **Server: gzip + ETag** (`server/finplanStatic.ts`). Un middleware
  monta `/finplan/*`, pre-comprime in memoria (gzip livello 9, cache
  invalidata su `mtime`) e risponde con `ETag` + `Cache-Control:
  public, max-age=0, must-revalidate`. Risultato: prima apertura ~600
  KB trasferiti invece di 5,4 MB; aperture successive → `304 Not
  Modified` (poche centinaia di byte). Montato sia in dev (prima di
  Vite) sia in prod (prima di `express.static`).
- **CDN blocking ma cache-friendly** (Chart.js, xlsx, pdf.js): rimasti
  blocking perché lo script inline alla fine del body usa
  `pdfjsLib.GlobalWorkerOptions` (e altre globali) immediatamente al
  parse. `defer` non è praticabile senza una riscrittura invasiva del
  bootstrap. Le librerie sono comunque servite da cdnjs e cacheate dal
  browser tra i reload.
- **Google Fonts consolidati**: una sola richiesta che include tutti
  i family (Syne + Plus Jakarta Sans + Inter + JetBrains Mono),
  invece delle due richieste duplicate originali.
- **Iframe keep-alive** (`client/src/pages/Amministrazione.tsx`): la
  prima volta che l'utente apre il tab Analisi, l'iframe FinPlan viene
  montato in un wrapper persistente fuori dal blocco `<TabsContent>`,
  con `display:none` quando l'utente passa ad altri tab. Il blocco
  `TabsContent value="analisi"` non contiene più il vero iframe.
  Risultato: tornare al tab è istantaneo, niente re-bootstrap.

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
