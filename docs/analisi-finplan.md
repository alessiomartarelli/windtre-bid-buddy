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
2. All'avvio fa una `XMLHttpRequest` **sincrona** verso `GET
   /api/finplan` e — se il server risponde con `data` non null — popola
   `localStorage[STORAGE_KEY]` con quel blob, prima che il main script
   chiami `tryLoadFromStorage`. In questo modo il codice originale
   continua a leggere da localStorage senza modifiche.
3. Patcha `Storage.prototype.setItem`: ogni volta che il main script
   salva sulla chiave master `finplan_edg_20260505_134919`, fa un
   debounce-`PUT` (1.5 s) verso `/api/finplan` con `{data: <snapshot>}`.
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
- Cross-tenant cache: lo shim al boot azzera `localStorage[KEY]` se il
  GET non restituisce dati (404/null/401 o errore di rete), così cambio
  utente/org sullo stesso browser non leak-a dati della sessione
  precedente.
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

## Note operative

- L'HTML usa CDN (Chart.js, xlsx, pdf.js) e font Google: nessuna
  installazione npm.
- Vite copia automaticamente `client/public/` in `dist/public/` in
  build di produzione, quindi nessuna modifica a `vite.config.ts` o a
  `script/build.ts`.
- Eventuali aggiornamenti al tool standalone: ricopiare il file in
  `client/public/finplan/index.html` e re-iniettare il blocco
  `<script>` di shim subito dopo il `<title>`.
