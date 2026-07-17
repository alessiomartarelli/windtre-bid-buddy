# Test suite — dettaglio

Dettaglio di tutte le suite di test. La tabella riassuntiva è in
`replit.md` → "Testing". Tutte le suite sono anche step di validation
registrati (stesso nome dello script) e fanno parte del quality gate
pre-deploy (vedi `docs/deploy-prod.md`).

## FinPlan sync tests (`tests/finplan-sync.test.mjs`)

5 scenari post-cutover Task #148: (1) PUT/GET autenticato round-trip,
(2) latest-wins su PUT consecutivi (mirror del debounce React),
(3) preflight GET conflict-guard, (4) route legacy
`/api/finplan/preload(/status)` + super-admin `finplan-preload` +
`/finplan/index.html` ⇒ 404 (no SPA fallback), (5) setup wizard gating
(`!updatedAt && !dismissed`). Lanciali via lo step di validation
`finplan-tests` (`bash scripts/run-finplan-tests.sh`). Lo script aspetta
fino a 30s che l'app sia raggiungibile su `localhost:5000`, quindi
richiede che il workflow "Start application" sia già attivo. Run ~1s.

## Customer Journey authz tests (`tests/customer-journey-authz.test.mjs`)

2 scenari security-critical (Task #160) sull'isolamento per-operatore:
(1) `GET /api/customer-journeys` filtrata per ruolo — admin/super_admin
vedono tutte le journey dell'org, operatore senza addetti ⇒ 0 (no leakage
del tenant), operatore con addetto corrispondente ⇒ solo la sua (match
case-insensitive); (2) `GET /api/customer-journeys/:id` enforce
l'ownership — proprietario ⇒ 200, non proprietario / operatore senza
addetti ⇒ 403, admin ⇒ 200 su qualunque journey. La route rilegge il
profilo ad ogni richiesta, così i test mutano `role`/`bisuite_addetti`
dello stesso profilo signup per coprire i vari ruoli. Step di validation
`cj-authz-tests` (`bash scripts/run-customer-journey-authz-tests.sh`);
richiede il workflow "Start application" attivo. Run ~1s.

## Admin role/org boundary tests (`tests/admin-authz.test.mjs`)

4 scenari security-critical (Task #211 + Task #213) che bloccano la
regressione dei controlli aggiunti in Task #207 contro l'escalation di
ruolo/org da parte di un admin di tenant. (1) `POST /api/admin/create-user`
fatta da un admin: `role="super_admin"` forzato nel payload ⇒ 403 e nessun
super_admin creato; un `organization_id`/`organizationId` di un'altra org
nel payload viene ignorato e l'utente è creato nella org dell'admin.
(2) `POST /api/admin/bisuite-api` con un `organization_id` di un'altra org
⇒ 403 per l'admin (cross-org negato), mentre il super_admin supera il
controllo cross-org e raggiunge il lookup credenziali (400 perché la org
estranea non ha credenziali BiSuite ⇒ prova che non è bloccato dal vincolo
di org). (3) `POST /api/admin/update-user` (Task #213): un admin che fa
update con `role="super_admin"` ⇒ 403 e il ruolo del target NON cambia,
mentre il super_admin promuove con successo (200). (4) stesso update-user
ma cross-org: un admin che modifica un utente di un'altra org ⇒ 403
("Cannot update users outside your organization") e il target resta
invariato, mentre il super_admin aggiorna con successo (200, no vincolo
org). Gli scenari 3-4 usano l'helper `createTargetUser` (insert profilo
via SQL in una data org). Stessa strategia degli altri authz test: signup
admin + cookie, la route rilegge il profilo ad ogni richiesta quindi si
muta `role` via `setRole`; una seconda org "estranea" è creata via SQL per
i tentativi cross-org e ripulita nel `finally`. Step di validation
`admin-authz-tests` (`bash scripts/run-admin-authz-tests.sh`); richiede il
workflow "Start application" attivo. Run ~1s.

## Customer Journey reconcile tests (`tests/customer-journey-reconcile.test.mjs`)

4 scenari (Task #164 + Task #180) sul reconcile. Setup: signup admin +
org, inserisce una vendita BiSuite (`bisuite_sales`) con un'attivazione
mobile (categoria UNTIED, `data_vendita ≥ 01/07/2026`, innesca la journey)
e due dispositivi TELEFONIA finanziati (IMEI + RATA derivati). Guida
`reconcileCustomerJourneys` e PATCH dettagli via HTTP, legge lo stato
finale degli item dal DB. (1) i 4 campi manuali (DATA ATTIVAZIONE, PDV
DESTINAZIONE, IMEI, RATA) salvati via `updateCustomerJourneyItemDetails`
(`details_manual = true`) NON vengono sovrascritti da un reconcile
successivo anche se cambiano IMEI/importo finanziato della vendita;
(2) gli item NON modificati a mano vengono comunque aggiornati con
IMEI/RATA derivati da BiSuite (ramo `ELSE excluded`). (3) cliente AZIENDA
(GIURIDICA, keyed by piva): la journey salva
`nominativo`/`ragione_sociale` dal CLIENTE (non dall'addetto vendita) e
ogni item conserva `addetto` = addetto vendita; (4) cliente PRIVATO
(FISICA): regressione che la journey salvi Nome+Cognome del cliente e
l'item l'addetto distinto. Gli scenari 3-4 (Task #180) proteggono il fix
Task #178 che separa l'anagrafica journey dall'addetto per-item. Step di
validation `cj-reconcile-tests`
(`bash scripts/run-customer-journey-reconcile-tests.sh`); richiede il
workflow "Start application" attivo. Run ~4s.

## Customer Journey timeline tests (`tests/customer-journey-timeline.test.mjs`)

16 test sulla logica pura del tracciamento temporale della scheda cliente
(Task #185/#186). La logica è stata estratta dal componente React in
`client/src/lib/customerJourneyTimeline.ts` (solo `import type`, nessun
import a runtime) così è caricabile via loader `tsx` senza dev server né
DB. Coprono i rami delicati: (1) contratti senza alcuna data ⇒ timeline
vuota (`empty`); (2) driver sconosciuto ⇒ fallback colore grigio
`cjDriverColor` + nessun crash; (3) rilevamento T0 — trigger BiSuite
(`triggerSaleId`/`triggerBisuiteId`), fallback prima attivazione mobile,
fallback primo evento in assoluto, `openedAt` esplicito; (4) stati
ko/stornato/annullato attenuati (`isFadedState`); (5) asse mesi esteso
oltre T0–T6 (eventi dopo T6 e prima di T0) + label mese a cavallo d'anno;
(6) raggruppamento per PDV (destinazione→origine→N/D) ordinato per
conteggio; (7) `itemEventDate` (attivazione→inserimento→null, data
malformata ⇒ null). Step di validation `cj-timeline-tests`
(`bash scripts/run-customer-journey-timeline-tests.sh`). Run ~1s.

## Customer Journey badge↔gettone parity tests (`tests/customer-journey-validity-gettone-parity.test.mjs`)

8 test incrociati (Task #216) che blindano l'allineamento fra il badge
"Conta/Non conta" della scheda (`computeItemValidity` in
`client/src/lib/customerJourneyTimeline.ts`) e il conteggio piste del
gettone (`buildGettoneJourneys` in `shared/customerJourney.ts`). Le due
logiche condividono gli helper (mesi UTC, regola T0, finestra) ma restano
funzioni separate che partono da shape diverse (scheda da
`CustomerJourneyItem`, gettone da `CjReportRow`): un test incrociato
impedisce che divergano in silenzio (regressione del caso storico
"30€ vs 40€"). Ogni scenario costruisce UN dataset sintetico di contratti
e da quell'unica sorgente deriva entrambe le shape, poi verifica che il
numero di badge `counts: true` == `pisteAttive` della stessa journey.
Coprono: (1) base mobile+1 pista; (2) pista del mese prima di T0 (fuori
finestra in entrambe); (3) driver duplicato gas+luce = una pista;
(4) stati ko/annullato/stornato esclusi; (5) trigger su contratto
NON-mobile (la timeline lo marca T0 ma conta come pista, come il gettone
che esclude solo i driver mobile — è il ramo che storicamente faceva
divergere i numeri); (6) dataset combinato con tutti i rami limite
insieme; (7) confine cohort — journey senza SIM mobile attiva esclusa del
tutto dal gettone (regola voluta, non divergenza, perciò la parità si
asserisce solo dentro la cohort); (8) indipendenza dall'ordine delle
righe. Funzioni pure: NON serve né dev server né DB, moduli TS via loader
`tsx`. Step di validation `cj-validity-gettone-parity-tests`
(`bash scripts/run-customer-journey-validity-gettone-parity-tests.sh`).
Run ~1s.

## Customer Journey export (PDF/Excel) tests (`tests/customer-journey-export.test.mjs`)

26 test sulla logica pura di costruzione righe/colonne degli export
(Task #190). La logica è stata estratta da
`client/src/lib/customerJourneyExport.ts` in
`shared/customerJourneyExport.ts` (import RELATIVI, niente runtime
jsPDF/xlsx/react) così è caricabile via loader `tsx` senza dev server né
DB; il file di rendering ora consuma quei builder. Coprono: (1) helper di
formattazione (`fmtDate` it-IT/"—", `journeyTitle` azienda↔privato con
fallback, `safeFileName`/`detailFileBase`,
`driverLabel`/`itemStateLabel`/`itemDescription` con fallback,
`rataCanone` con canone escluso per `telefono`, `activeDriverCount`,
`detailMeta` CF↔P.IVA); (2) dettaglio — `driverTableHead/Body` (ordine
`CJ_DRIVER_ORDER`, col 0 vuota nel PDF vs emoji nell'Excel),
`contractsHead/Body` (12 colonne, PDV destinazione→origine, gettone
Sì/No), `detailExcelHeaderRows`; (3) elenco —
`listSubtitle`/`listExcelHeaderRows` con `filterLabel` opzionale,
`listPdfHead/Body` (5 colonne fisse + driver, "Si"/""), `listExcelHead/Body`
(colonna Telefono + emoji, "Sì"/""). I test bloccano le differenze volute
di shape fra PDF ed Excel così che un cambio accidentale alle colonne non
rompa silenziosamente gli export. Step di validation `cj-export-tests`
(`bash scripts/run-customer-journey-export-tests.sh`). Run ~1s.

## Incentivazione interna tests (`tests/incentivazione.test.mjs`)

18 test sulla logica pura di `shared/incentivazione.ts` (gare addetto nel
tempo). Funzioni pure: NON serve né dev server né DB, modulo TS via loader
`tsx`. Coprono: (1) `buildCalendar` per mese futuro (regressione del bug
dei giorni trascorsi != 0 ⇒ el/mult/pct = 0), corrente (el parziale,
mult = tot/el) e passato (el == tot, pct 100), più l'esclusione delle
festività infrasettimanali; (2) `projV` (proiezione lineare con guard su
valore nullo ed `el === 0`); (3) `semOf` (semaforo g/a/r/u inclusi i casi
limite); (4) `buildEmps` con `unlockProjected` (sblocco gara solo se TUTTI
i lucchetti sono g|a), il caso senza dati, il merge dei dati live BiSuite
e l'ordinamento per stato; (5) `colIdx` (lettera colonna ⇒ indice 0-based)
e `parseValenzeAoa` (lettura file Excel valenze) sia con AOA sintetici sia
sul file REALE. Casi sintetici: mapping per `excelCol` esplicita (template
W3), fallback per keyword sull'header (template Vodafone, prefisso
"Pista " ignorato), scarto righe Totale/Media/senza nome, parsing con
virgola decimale ("1,5" ⇒ 1.5), celle vuote/assenti ⇒ null e celle non
numeriche ⇒ 0. Caso REALE (fixture stabile `tests/fixtures/valenze-w3.xlsx`,
foglio "Riepilogo"): verifica il layout header, il mapping per-posizione
delle 8 piste W3 con `excelCol` (col B–H + J), che la col J sia "Extra
Marginalità" (non più "Smartphone") e che separatore vuoto, 2ª
"PISTA FISSO" (col I) e le 9 colonne "Proiezione" siano ignorati. Step di
validation `incentivazione-tests`
(`bash scripts/run-incentivazione-tests.sh`). Run ~1s.

## Gara SOS Caring tests (`tests/sos-caring.test.mjs`)

15 test puri (Task #327) su `shared/sosCaring.ts` (gara SOS Caring
WindTre, upload Excel caring PDV in Configurazione Gara → Performance).
Coprono: (1) `validateSosCaringHeaders` (14 colonne richieste, extra
ignorate, elenco delle mancanti); (2) `parseSosCaringRows`
(normalizzazione righe, percentuali frazione→punti percentuali via
`parseSosPercent`, periodo AnnoMese più frequente, scarto righe senza
PDV/RS); (3) `parseSosNumber`/`parseSosPercent` (tolleranza formati
"1.204", virgola decimale, stringhe con "%"); (4) `aggregateSosCaring`
(subtotali per RS + totale rete con % Balance = Σ MNP Out / (Σ GA Gara +
Σ CP TIED) sui valori aggregati, RS deduplicata case-insensitive,
denominatore 0 ⇒ 0%); (5) `computeSosCaringPremio`: fasce default
10/20/30% con bonus 30/20/10% del premio Partnership e malus 500€ ×
negozi in gara, INCLUSI i confini (10 ⇒ fascia 10–20, 20 ⇒ 20–30, 30 ⇒
ancora bonus, 30,01 ⇒ malus), override di config e malus mai positivo;
(6) `formatAnnoMese`. Nessun prerequisito (logica pura via loader tsx).
Step di validation `sos-caring-tests`
(`bash scripts/run-sos-caring-tests.sh`). Run ~1s.

## Brand gating tests (`tests/brand-gating.test.mjs`)

7 test puri (Task #279) su `shared/modules.ts`: `isWindtreBrandName`
(varianti "WindTre"/"Wind Tre"/"WIND3"/"W3" accettate, altri brand
rifiutati) e `isModuleAllowedForBrands` (moduli non gated sempre
consentiti; fallback sicuro org senza brand ⇒ nessun filtro; org con
brand ma senza WindTre ⇒ moduli WindTre bloccati; WindTre presente ⇒
consentiti; lista `WINDTRE_GATED_MODULES` attesa). Nessun prerequisito.
Step di validation `brand-gating-tests`
(`bash scripts/run-brand-gating-tests.sh`). Run ~1s.

## Non-WindTre org authz tests (`tests/non-windtre-authz.test.mjs`)

2 test end-to-end (Task #315) sulle route HTTP con `requireModule`
(`server/routes.ts`): congelano il perimetro del brand gating post
Task #314 (caso Phone&Phone). Scenario 1: org admin con SOLO brand
Fastweb ⇒ `/api/customer-journeys`, `/api/bisuite-sales`,
`/api/incentivazione/config` rispondono 200; `/api/preventivi`,
`/api/gara-config`, `/api/drms` rispondono 403 "Modulo non abilitato".
Scenario 2 (controllo del setup): stessa org SENZA brand associati ⇒
tutte e sei le route 200 (fallback: nessun filtro). Se qualcuno
reintroduce Vendite BiSuite/CJ/Incentivazione in
`WINDTRE_GATED_MODULES` (`shared/modules.ts`) o cambia i gate in
`requireModule`, la suite fallisce. Prerequisiti: app su
`localhost:5000` + `DATABASE_URL`. Step di validation
`non-windtre-authz-tests`
(`bash scripts/run-non-windtre-authz-tests.sh`). Run ~2s.

## Canvass VF mapping tests (`tests/canvass-mapping.test.mjs`)

17 test puri sull'engine di categorizzazione canvass Vodafone/Fastweb
(`shared/canvassMapping.ts` + catalogo baked `shared/canvassCatalog.ts`).
Coprono: forma del catalogo baked (306 offerte, 76 step, periodo);
`normalizeCodice`/`extractOfferId` (5 char centrali di `CAN·····dddd`,
null su forma/suffisso non valido); `deriveBrandFromPista`
(FASTWEB⇒fastweb, resto incl. VERISURE/ENERGIA VODAFONE⇒vodafone);
`buildCanvassIndex` (indici byCodice/byOfferId + esclusione coppie
categoria|tipologia ambigue, es. "FASTWEB ENERGIA|LUCE FASTWEB");
`categorizeCanvassArticle` (match a cascata codice→offerId→catTip→null,
incluso fallback su edizione diversa); `aggregateCanvassSales`
(pezzi/canone per pista, non mappati raggruppati per codice, matchCounts);
`groupStepsByPista` (raggruppamento + ordinamento);
`buildCanvassReferenceFromRows` (reference da righe Excel grezze, Task #303);
`validateCanvassColumns` (colonne richieste nei due fogli Excel, colonne
sbagliate/mancanti rilevate prima del salvataggio, fogli vuoti, Task #305).
Logica pura: nessun
prerequisito (né dev server né DB), moduli TS via loader `tsx`. Step di
validation `canvass-mapping-tests`
(`bash scripts/run-canvass-mapping-tests.sh`). Run ~1s.

## Canvass VF authz tests (`tests/canvass-authz.test.mjs`)

3 scenari (Task #302) sui confini di ruolo/organizzazione delle route
canvass Vodafone/Fastweb: (1) `operatore` => 403 su tutte e 4 le route
(`/api/admin/canvass-catalog`, `.../canvass-mapped-sales`,
`.../canvass-catalog/import`, `.../canvass-catalog/reset`); (2) `admin` =>
200 su catalogo e vendite della PROPRIA org, 403 su
`organization_id` estraneo e su import/reset (riservati al super_admin);
(3) `super_admin` che importa un reference senza offerte (colonne Excel
sbagliate, Task #305) => 400. Stessa strategia di admin-authz: signup +
mutazione ruolo via SQL, cleanup org di test. Prerequisiti: app attiva su
`localhost:5000` + `DATABASE_URL`. Step di validation `canvass-authz-tests`
(`bash scripts/run-canvass-authz-tests.sh`). Run ~6s.

## Gestione DTS authz tests (`tests/dts-authz.test.mjs`)

2 scenari (Task #322) sui confini di ruolo/organizzazione delle route di
scrittura del modulo Gestione DTS: (1) `operatore` => 403 su
`POST /api/dts/upload` (nessun lead scritto) e su `DELETE /api/dts/leads`
(i lead esistenti restano), mentre la lettura `GET /api/dts/leads` resta
consentita; (2) `admin` => 200 su upload/delete SOLO nella propria org
(il lead caricato appartiene alla sua org, il GET non mostra i lead di
un'altra org, il DELETE non tocca l'org estranea, seminata via SQL).
Stessa strategia di admin-authz: signup + mutazione ruolo via SQL,
cleanup org di test. Prerequisiti: app attiva su `localhost:5000` +
`DATABASE_URL`. Step di validation `dts-authz-tests`
(`bash scripts/run-dts-authz-tests.sh`). Run ~2s.

## Caring esclusi dai totali CB (`tests/caring-cb-exclusion.test.mjs`)

7 test puri (Task #290, regressione di Task #289) che partono da un dataset
BiSuite grezzo (MIA TIED / MIA UNTIED / RIVINCOLO + entrambe le tipologie
COUPON CARING) mappato con `mergeWithDefaultRules` + `mapBiSuiteSale`
(`shared/bisuiteMapping.ts`) e `calcoloCBPerPdv`
(`client/src/lib/calcoloCB.ts`, alias `@/` risolto da tsx). Coprono: le
tipologie caring mappano SOLO su `cb:coupon_caring` (nessuna altra pista);
i veri eventi CB (rivincoli/untied) ottengono invece il gemello partnership;
`calcoloCBPerPdv` ignora il caring in conteggio pezzi, premio e punti (con vs
senza caring danno lo stesso risultato; PDV con solo caring ⇒ 0/0); la card
"Caring utilizzate" conta i pezzi corretti per PDV e per Ragione Sociale
(PDV senza caring esclusi); un'org con regole DB VECCHIE (caring sotto
`cambio_offerta_*`) migra via `retargetCaringSavedRules`/`mergeWithDefaultRules`
verso `coupon_caring` senza duplicati né gemelli partnership (idempotente).
Nessun prerequisito. Step di validation `caring-cb-exclusion-tests`
(`bash scripts/run-caring-cb-exclusion-tests.sh`). Run ~1s.

## Caring esclusi dai totali CB — DB-backed (`tests/caring-cb-exclusion-db.test.mjs`)

3 test DB-backed (Task #291, regressione di Task #289/#290) che esercitano il
VERO percorso di aggregazione server-side, non solo le funzioni pure di mapping.
Seminano righe `bisuite_sales` persistite per un'org effimera (COUPON CARING
TIED/UNTIED + veri eventi CB rivincoli/untied su più PDV), le rileggono con
`storage.getBisuiteSalesByItalianMonth` (lo stesso load della route
`GET /api/admin/bisuite-mapped-sales`) e le passano ad `aggregateMappedSales`
(`server/bisuiteMappedSales.ts`, la funzione estratta dalla route e da essa
richiamata), con regole EFFETTIVE via `mergeWithDefaultRules`. Coprono: il
caring atterra SOLO su `cb:coupon_caring` con i pezzi corretti per PDV e nei
totali per pista, senza gonfiare i veri eventi CB (`cambio_offerta_rivincoli` /
`cambio_offerta_untied`); il caring NON genera gemello `partnership` mentre i
veri eventi CB sì; le vendite ANNULLATA (caring o CB) sono escluse dal load e
quindi dall'aggregazione. Prerequisito: `DATABASE_URL` (NON serve il dev
server). Step di validation `caring-cb-exclusion-db-tests`
(`bash scripts/run-caring-cb-exclusion-db-tests.sh`). Run ~1-7s.

## Device + Accessori/Servizi — DB-backed (`tests/devices-accessori-servizi-db.test.mjs`)

4 test DB-backed (Task #293, regressione di Task #291) che coprono la parte di
`aggregateMappedSales` (`server/bisuiteMappedSales.ts`) NON esercitata dalla
suite caring/CB: le card device/accessori/servizi della dashboard, che non
passano dal mapping delle piste. Seminano righe `bisuite_sales` per un'org
effimera, le rileggono con `storage.getBisuiteSalesByItalianMonth` (lo stesso
load della route `GET /api/admin/bisuite-mapped-sales`) e le passano ad
`aggregateMappedSales` con regole EFFETTIVE via `mergeWithDefaultRules`.
Coprono: (1) conteggio device (smartphone da TELEFONIA, smartDevice da SMART
DEVICE, internetDevice da INTERNET DEVICE + MODEM/ROUTER) con lo split
finanziato/rate/altro dedotto dalle `domandeRisposte` (COMPASS/FINDOMESTIC/MULTI
FINANZIAMENTO/MIA FINANZIAMENTO ⇒ finanziato; VAR/MIA VAR ⇒ rate; nessuna ⇒
altro) e le descrizioni accumulate per modalità; (2) secchi Accessori e Servizi
dashboard (SPEDIZIONE/ASSISTENZA/GARANTEASY) — pezzi + importo, con
`importoImponibile` e fallback su `prezzo`; (3) separazione dei totali per PDV
(nessun travaso tra PDV); (4) la modalità è dedotta a livello di VENDITA (una
domanda su un articolo qualsiasi marca tutti i device della stessa vendita).
Prerequisito: `DATABASE_URL` (NON serve il dev server). Step di validation
`devices-accservizi-tests`
(`bash scripts/run-devices-accessori-servizi-tests.sh`). Run ~1-5s.

## Tally piste/addon — DB-backed (`tests/pista-addon-tally-db.test.mjs`)

4 test DB-backed (Task #297, regressione di Task #291) che coprono il CUORE del
mapping per pista di `aggregateMappedSales` (`server/bisuiteMappedSales.ts`) NON
esercitato dalle suite caring/CB e device/accessori/servizi. Seminano righe
`bisuite_sales` per un'org effimera, le rileggono con
`storage.getBisuiteSalesByItalianMonth` (lo stesso load della route
`GET /api/admin/bisuite-mapped-sales`) e le passano ad `aggregateMappedSales`
con regole EFFETTIVE via `mergeWithDefaultRules`. Coprono: (1) gli item BASE
(pezzi + canone accumulati per pista/targetCategory) con rollup `totaliPerPista`
e conteggi globali; (2) il percorso ADDITIONAL/addon (occorrenze + canone, con
il canone accumulato SOLO per il set `CANONE_BASED_ADDONS` — es. CONVERGENZA —
e canone 0 per gli altri, es. NETFLIX_CON_ADV), con base + addon dallo stesso
articolo e rollup `totaliAddonsPerPista`; (3) le descrizioni accumulate per gli
item SIM_IVA; (4) i conteggi globali `totalMapped` / `totalUnmapped` /
`totalArticoli` con un mix mappato/non mappato e l'isolamento dei totali per
PDV. Prerequisito: `DATABASE_URL` (NON serve il dev server). Step di validation
`pista-addon-tally-tests`
(`bash scripts/run-pista-addon-tally-tests.sh`). Run ~1-6s.

## Dashboard: solo vendite in-gara del mese — DB-backed (`tests/dashboard-ingara-filter-db.test.mjs`)

5 test DB-backed (Task #298) che coprono il LAYER SOPRA `aggregateMappedSales`:
il filtro della route `GET /api/admin/bisuite-mapped-sales` che decide QUALI
righe `bisuite_sales` arrivano all'aggregatore. Seminano `bisuite_sales` (e la
`gara_config` con i calendari per PDV) per un'org effimera e verificano:
(1) la finestra mensile italiana di `storage.getBisuiteSalesByItalianMonth`
(solo il mese/anno selezionato, ANNULLATA escluse); (2) il gating
`inGaraOnly` + calendario di `selectInGaraSales` (`server/bisuiteGaraFilter.ts`),
che con inGaraOnly attivo e calendari presenti tiene solo le vendite nei giorni
di apertura del PDV (fuso Europe/Rome); (3) l'override `specialDays` (giorno
feriale chiuso / weekend aperto); (4) il fallback quando non ci sono calendari
(passa tutto anche con inGaraOnly); (5) il filtro per-PDV senza doppio
conteggio. Prerequisito: `DATABASE_URL` (NON serve il dev server). Step di
validation `dashboard-ingara-filter-tests`
(`bash scripts/run-dashboard-ingara-filter-tests.sh`). Run ~1-5s.

## Incentivazione Accessori/Servizi live tests (`tests/incentivazione-accessori-servizi.test.mjs`)

4 scenari DB-backed (Task #174) su `aggregateAccessoriServizi`
(`server/storage.ts`), il conteggio live Accessori/Servizi BiSuite per
addetto nelle gare addetto. È DB-backed ma NON passa dall'HTTP: chiama
direttamente la funzione di storage via loader `tsx`, usando lo stesso
pool `pg` del server per inserire le vendite di test (crea org al volo,
niente signup). Richiede solo `DATABASE_URL`, non il dev server. Coprono:
(1) somma per addetto separata catAcc vs catServ su più vendite (una sola
riga per addetto); (2) esclusione delle vendite ANNULLATA dalle somme;
(3) addetto con sole categorie non mappate ⇒ acc/serv = 0 e vendite fuori
intervallo di date escluse del tutto; (4) più addetti distinti con
grouping case-insensitive sul nominativo (le grafie diverse dello stesso
addetto si fondono). Step di validation `incentivazione-accservizi-tests`
(`bash scripts/run-incentivazione-accessori-servizi-tests.sh`). Run ~5s.

## Customer Journey reportistica + filtri condivisi tests (`tests/customer-journey-report.test.mjs`)

28 test sulla logica pura di `shared/customerJourney.ts` (Task #189 +
Task #192). Funzioni pure: NON serve né dev server né DB, modulo TS via
loader `tsx`. La pagina Customer Journey ha due viste ("Schede clienti" e
"Reportistica") che condividono gli stessi filtri (tipo cliente,
negozio/PDV, addetto, stato, ricerca); la logica era inline in
`CustomerJourney.tsx` ed è stata estratta in shared per essere testabile e
usata da entrambe le viste. Coprono: (1) `CJ_ACTIVE_STATES` (gli stati che
contano come "attivati"); (2) `aggregateReport` per dimensione
negozio/addetto/cliente — `clienti` = journey distinte (Set su journeyId,
non item), `contratti` = numero item, `attivati` = item in stato attivo
(ko/annullato/stornato esclusi), `valore` = somma importi; ordinamento per
valore↓ poi contratti↓ poi label (it), tie-break e input vuoto ⇒ [];
(3) `cjSearchMatches` (ricerca case-insensitive, vuota ⇒ match);
(4) `matchesCjFilters` — predicato condiviso che agisce sia su una journey
(array di facet PDV/addetti/stati, match per `includes`) sia su una riga
report (singolo valore wrappato in array), filtri "tutti" = nessun
vincolo, combinazione AND, facet vuoti esclusi da filtro specifico;
(5) coerenza schede/report: stesso predicato, granularità journey vs item.
Task #192 aggiunge 10 test sull'analisi gettoni cross-sell:
(6) `gettoneForPiste` (tabella a scaglioni `[0,20,30,40,100,120]`, clamp
0..5, round dei decimali, NaN ⇒ 0); (7) `buildGettoneJourneys` (piste =
driver NON-mobile distinti in stato attivo, energia gas/luce conta una
volta, stati ko/annullato/stornato non contano, attribuzione pdv/addetto
dalla SIM mobile con fallback al primo item); (8) `filterGettoneByDate`
(coorte per data attivazione SIM, estremi inclusi,
solo-from/solo-to/nessun range, journey senza `openedAt` passa solo senza
limiti); (9) `aggregateGettone` (somma fatturato + potenziale alla
saturazione, ordinamento per fatturato↓, la saturazione scala solo il
potenziale e viene clampata a 0..100); (10) `gettoneTotals` + input vuoto.
(11) `simSaturationPct` (% saturazione cross-sell per singola SIM =
`pisteAttive/CJ_MAX_PISTE`, con clamp 0..100); (12) `gettoneDetailByKey`
(dettaglio per riga PDV/addetto col click: clienti/SIM per gruppo + %
saturazione, ordinati per saturazione↓). L'analisi gettoni aggrega solo
per **negozio** o **addetto** (la dimensione "ragione sociale/cliente" è
stata rimossa). Step di validation `cj-report-tests`
(`bash scripts/run-customer-journey-report-tests.sh`). Run ~1s.

## Telegram report tests (`tests/telegram-report.test.mjs`)

52 test puri (Task #239 + #248 + #250) su aggregati (incl. per-addetto,
`categorieByPista`, `prodottiByCategoria`/`serviziByCategoria` con split
pagamenti), trend per-giorno (`buildDailyTrend`/`pctDelta`) e messaggio
del report vendite Telegram (`shared/venditeReport.ts`), report HTML
allegato (`shared/venditeReportHtml.ts`: dashboard con hero/KPI/grafici
SVG inline, card categorie con chip pagamenti, escape, nome file) + orari
scheduler DST-safe (incl. cambio ora legale marzo 23h / ottobre 25h),
redazione segreti nei log e risoluzione config
(`server/telegramReportScheduler.ts`). Niente server né DB, loader tsx.
Lancio: `bash scripts/run-telegram-report-tests.sh` (nessun workflow
dedicato: limite workflow raggiunto). Inclusa nello step 1a del quality
gate di deploy. Dettagli in `docs/telegram-report.md`. Run ~1s.

## Customer Journey Analisi gettoni UI tests (`tests/customer-journey-gettone-ui.test.mjs`)

3 scenari Playwright (Task #194 + Task #195) sulle tabelle report
interattive. A differenza dei test puri, questo guida un vero browser
headless (chromium di sistema via Nix + `playwright-core`) per proteggere
il rendering React che la logica pura non copre: il toggle `useState` che
apre/chiude la sotto-tabella in `AnalisiView` e la proiezione delle
colonne (Cliente / SIM attive / Piste attive / % saturazione / Fatturato).
Setup: signup admin+org, poi semina DIRETTAMENTE via SQL due journey con
item (mobile attiva + cross-sell) — deterministico e con pieno controllo
su driver/stato/PDV/addetto, così i valori attesi (Mario: 2 piste ⇒ 40%
saturazione / 30€; Luigi: 1 pista ⇒ 20€) sono prevedibili; la vista
gettone consuma comunque l'output di `/api/customer-journeys/report`,
identico al percorso reconcile (già coperto altrove). I PDV sono nomi
univoci per evitare collisioni di test-id nella dimensione negozio. Il
cookie di sessione viene iniettato nel context Playwright. Coprono:
(1) admin — Analisi gettoni: espande la riga **addetto** E la riga
**negozio/PDV** (`button-gettone-dim-negozio`, Task #195), verifica per
entrambe i valori aggregati e la sotto-tabella (nome cliente, %
saturazione, piste 2/5, intestazioni), poi le richiude
(`row-gettone-detail-*` rimossa); (2) operatore con `bisuite_addetti`
associato a un solo addetto — vede SOLO la propria riga, niente leakage
dell'altro addetto; (3) admin — tab **"Dettaglio"** (ReportView,
Task #195): verifica che le righe aggregate `row-report-*` rendano i
valori attesi (label/clienti/contratti/attivi) e che il selettore di
dimensione (`button-report-dim-*`) cambi il grouping a runtime
(negozio⇒addetto, le righe PDV spariscono). Task #199 aggiunge 2 scenari
che verificano il wiring dei filtri condivisi con le tabelle renderizzate
(la logica pura del predicato è già coperta da `cj-report-tests`):
(4) il filtro Negozio/PDV (`select-filter-negozio`) applicato via il
controllo `<Select>` restringe SIA la tab Dettaglio (la riga PDV non
selezionata sparisce) SIA l'Analisi gettoni — il filtro è condiviso fra le
viste — e `button-reset-filters` ripristina tutte le righe; (5) il filtro
per data attivazione SIM dell'Analisi gettoni
(`input-gettone-date-from`/`input-gettone-date-to`) restringe la coorte:
due journey seminate con `opened_at` (T0) a marzo vs gennaio, un "dal
2026-02-01" tiene solo marzo, un "al 2026-02-01" solo gennaio,
`button-gettone-reset-date` ripristina entrambe. Lo scenario 5 sfrutta il
parametro `openedAt` aggiunto a `seedJourney` in
`tests/helpers/uiTest.mjs`. Cleanup completo del dev DB alla fine. Step di
validation `cj-gettone-ui-tests`
(`bash scripts/run-customer-journey-gettone-ui-tests.sh`); richiede il
workflow "Start application" attivo, `DATABASE_URL` e chromium di sistema.
Run ~25s.

## Incentivazione interna sort/filter UI tests (`tests/incentivazione-sort-ui.test.mjs`)

2 scenari Playwright (Task #226) sul wiring dei controlli di ordinamento
della pagina Incentivazione interna. La logica pura `sortEmps`
(`shared/incentivazione.ts`) è già coperta dai test puri
(`incentivazione-tests`); qui si protegge il rendering React che quella
non raggiunge: la scelta del criterio (`select-sort-key`/`option-sort-*`)
+ il toggle direzione (`button-sort-dir`) che si combinano coi filtri, il
reset (`button-reset-filters`) che riporta a Stato/desc, e il fallback a
"Stato" quando si cambia sezione e la pista scelta non esiste lì
(`effectiveSortKey`). Setup: signup admin+org (modulo
`incentivazione_interna` abilitato di default), poi semina SOLO le righe
valenze via SQL (`incentivazione_valenze`, helper `seedValenze` in
`tests/helpers/uiTest.mjs`) con valori `mobile`/`fisso_pt` deterministici
per il mese/anno correnti (la pagina apre di default sul periodo
corrente). La config NON è seminata: la pagina usa `defaultConfig`
(sezioni W3/Vodafone già "ready"). Coprono: (1) ordina per la pista
"mobile" desc (30,20,10) → inverte in asc (10,20,30) → applica la ricerca
"rossi" (sottoinsieme, ordine asc preservato: filtro+sort convivono) →
"Azzera filtri" ripristina 3 schede, ricerca vuota, criterio "Stato" e il
bottone reset sparisce; (2) impostato il sort per "mobile" in W3, il
cambio tab su Vodafone (dove "mobile" non è una pista) ricade su "Stato" e
l'ordine schede lo DIMOSTRA: lo scenario opera su un mese passato
(`el==tot` ⇒ stati semaforo deterministici) e semina la sezione Vodafone
così che l'ordine per Stato/desc `[UNO(r), DUE(g)]` differisca dall'ordine
per nome `[DUE, UNO]` (che si otterrebbe se il fallback non scattasse,
pista assente ⇒ tie-break per nome); inverte poi la direzione e verifica
`[DUE(g), UNO(r)]` (l'ordinamento risponde alla direzione ⇒ è davvero un
sort per Stato, non un ordine per nome invariante), il tutto senza crash.
L'ordine schede è letto via i data-testid `card-addetto-*` nel DOM. Step
di validation `inc-sort-ui-tests`
(`bash scripts/run-incentivazione-sort-ui-tests.sh`); richiede il workflow
"Start application" attivo, `DATABASE_URL` e chromium di sistema. Run ~25s.

## Pesi punteggio performance UI (Configurazione Gara)

Suite Playwright a 2 scenari sulla card `card-performance-weights` della
pagina `/configurazione-gara`. Perché serve un test UI: gli helper puri
dei pesi (`weightsToForm`/`weightsFormToPayload`/`weightsFormHasValue`,
allineati a `DEFAULT_PERFORMANCE_WEIGHTS`) sono già coperti; quello che
NON lo era è il wiring React fra gli input `input-weight-*`, il
salvataggio in `gara_config.config.performanceWeights` e il ricaricamento.
Scenario 1: digita alcuni pesi (lasciandone altri vuoti), salva con un
nome, verifica sia via DB (valori numerici persistiti, campi vuoti = null
⇒ fallback ai default) sia ricaricando la pagina (gli input ripopolati, i
vuoti restano vuoti). Scenario 2: dopo aver salvato il mese corrente,
cambia mese verso uno senza config (i pesi si azzerano) e torna al mese
salvato (i pesi si ricaricano). Step di validation `gara-weights-ui-tests`
(`bash scripts/run-gara-config-weights-ui-tests.sh`); richiede il workflow
"Start application" attivo, `DATABASE_URL` e chromium di sistema. Run ~25s.

## Home landing UI tests (`tests/home-landing-ui.test.mjs`)

3 scenari Playwright sull'atterraggio post-login sulla Home hub. Il bug
originale era il rimbalzo continuo su `/` per le org senza moduli WindTre
(redirect verso un modulo disabilitato). Ora `/`
(`client/src/pages/Index.tsx`) rende la Home hub per admin/operatore e
reindirizza SOLO super_admin a `/super-admin`; la Home
(`client/src/pages/Home.tsx`) non è mai un modulo gated e mostra le
scorciatoie ai soli moduli attivi (o il messaggio "Nessun modulo attivo"
quando non ce ne sono). La suite blinda questo comportamento contro
regressioni future. Setup: signup admin+org (tutti i moduli abilitati di
default, nessun brand ⇒ nessun filtro brand gating); gli helper
`setRole`/`newAuthedContext` di `tests/helpers/uiTest.mjs` mutano ruolo e
iniettano il cookie di sessione. Coprono: (1) un admin atterra sulla Home
(URL resta `/`, `text-home-title` visibile, NON redirect su un modulo) e
vede le scorciatoie `link-home-shortcut-*` dei moduli attivi
(amministrazione, simulatore, customer_journey, ...), senza empty-state;
(2) un operatore con un brand NON WindTre associato (tutti i moduli
WindTre-gated filtrati via, le scorciatoie admin non gli spettano) vede la
Home e il messaggio `text-home-no-modules` "Nessun modulo attivo" senza
restare bloccato; (3) un super_admin viene reindirizzato da `/` a
`/super-admin`. Step di validation `home-landing-ui-tests`
(`bash scripts/run-home-landing-ui-tests.sh`); richiede il workflow "Start
application" attivo, `DATABASE_URL` e chromium di sistema. Run ~25s.

## Type-check (Task #219)

Step di validation `typecheck` (`bash scripts/run-typecheck.sh`) che
esegue `npx tsc --noEmit` su tutto il repo usando `tsconfig.json` (target
ES2020, strict). Check statico puro: NON serve né dev server né DB.
Fallisce (exit != 0) se compare anche un solo errore di tipo, così blocca
la ricomparsa degli errori di tipo che Task #218 aveva ripulito. Run
~10-20s.

## Integration suites orchestrator (Task #221)

Step di validation `integration-tests`
(`bash scripts/run-deploy-integration-tests.sh`) + step **1b** del
cancello di qualità pre-deploy. Esegue in un colpo solo tutte le suite che
richiedono il dev server e/o `DATABASE_URL` — `cj-authz`, `admin-authz`,
`canvass-authz`, `cj-reconcile`, `cj-trigger-date`, `inc-dashboard-authz`,
`incentivazione-accservizi`, `finplan`, `inc-sort-ui`, `cj-gettone-ui`,
`gara-weights-ui`, `home-landing-ui` — che prima andavano lanciate a
mano. Richiede `DATABASE_URL` (riusa il DB di dev: ogni suite
semina/pulisce i propri dati con prefissi univoci). Se
l'app non è già su `localhost:5000`, avvia `npm run dev` in modo effimero,
attende la readiness (fino a `APP_READY_TIMEOUT`, default 90s) e la ferma
con teardown pulito dell'intero albero di processi al termine; se è già su
(workflow "Start application" attivo) la riusa e NON la ferma. Fail-fast
(`set -e`) alla prima suite che fallisce. La suite Playwright
`cj-gettone-ui` (chromium di sistema) gira per ultima perché è la più
lenta. Run completo ~70-90s con app già avviata (più ~10-20s di startup se
effimera).
