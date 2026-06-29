import type { CjDriver, CjItemState } from "./schema";

// === Customer Journey driver classification (Task #158) ===
// Mappa categoria BiSuite → driver CJ. Rispecchia la classificazione canvass
// di `client/src/lib/bisuiteClassification.ts` (CATEGORY_MAP), limitata ai
// driver della customer journey. Tenuta in shared perché serve sia al motore
// di reconcile lato server sia alla UI. 'telefono' NON è una pista canvass:
// è la categoria dispositivi TELEFONIA.
//
// IMPORTANTE: CB / MIA / rivincoli sono esclusi per design (non sono nuove
// attivazioni e non fanno parte dei driver della journey).

export const CJ_DRIVER_LABELS: Record<CjDriver, string> = {
  mobile: "Mobile",
  fisso: "Fisso",
  energia: "Energia",
  assicurazioni: "Assicurazioni",
  telefono: "Smartphone",
  protetti: "Windtre Protetti",
};

export const CJ_DRIVER_ORDER: CjDriver[] = [
  "mobile", "fisso", "energia", "assicurazioni", "telefono", "protetti",
];

export const CJ_ITEM_STATE_LABELS: Record<CjItemState, string> = {
  inserito: "Inserito",
  in_lavorazione: "In lavorazione",
  attivato: "Attivato",
  ko: "KO",
  pagato: "Pagato",
  annullato: "Annullato",
  stornato: "Stornato",
  riaccreditato: "Riaccreditato",
};

// Un driver è "attivato" se ha almeno un item in uno di questi stati (cioè
// non KO e non stornato). Centralizzato qui per essere riusato sia dal
// dettaglio journey sia dal riepilogo per-scheda nella lista.
export const CJ_ACTIVE_STATES = new Set<CjItemState>([
  "inserito", "in_lavorazione", "attivato", "pagato", "riaccreditato",
]);

export interface CjDriverSummary {
  driver: CjDriver;
  activated: boolean;
  count: number;
}

// Riga item-level per la reportistica Customer Journey (Task #187): un record
// per contratto, già arricchito con l'anagrafica della journey. Usato dalla
// pagina "Reportistica" per aggregare per negozio / addetto / ragione sociale.
// L'isolamento per operatore (solo i propri item) è applicato lato server.
export interface CjReportRow {
  journeyId: string;
  customerKey: string;
  customerType: string;
  cliente: string;
  pdv: string;
  addetto: string;
  state: CjItemState;
  driver: CjDriver;
  valore: number;
  // Data di attivazione della SIM mobile che ha aperto la journey
  // (`customerJourneys.openedAt`, ISO string) o null. È il "T0" del cliente:
  // serve come coorte per il filtro a intervallo di date dell'analisi gettoni.
  openedAt: string | null;
  // Data evento dell'item (data attivazione, fallback data inserimento), ISO
  // string o null. Serve a stabilire se il contratto rientra nella finestra del
  // gettone (dal mese di T0 in poi).
  eventDate: string | null;
}

// Facet per-journey per i filtri della lista schede cliente (Task #187):
// i valori distinti di negozio (PDV), addetto e stato fra gli item della
// journey. Servono a popolare i menù dei filtri e a filtrare le schede.
export interface CjJourneyFacets {
  pdvs: string[];
  addetti: string[];
  states: string[];
}

// === Filtri condivisi fra "Schede clienti" e "Reportistica" (Task #189) ===
// I due tab della pagina Customer Journey condividono gli stessi filtri
// (tipo cliente, negozio/PDV, addetto, stato, ricerca testuale). La logica di
// matching è centralizzata qui per garantire che agisca in modo identico sulle
// due viste e per essere coperta da test unitari.
export interface CjListFilters {
  // "tutti" | "privato" | "azienda"
  typeFilter: string;
  // "tutti" | <pdv>
  pdvFilter: string;
  // "tutti" | <addetto>
  addettoFilter: string;
  // "tutti" | <stato item>
  stateFilter: string;
  search: string;
}

/** Ricerca testuale case-insensitive, vuota => sempre match. */
export function cjSearchMatches(hay: string, search: string): boolean {
  const q = (search || "").trim().toLowerCase();
  if (!q) return true;
  return (hay || "").toLowerCase().includes(q);
}

// Forma minima filtrabile: una journey espone array di PDV/addetti/stati fra i
// suoi item, una riga report espone un singolo valore (wrappato in array dal
// chiamante). Così lo stesso predicato copre entrambe le viste.
export interface CjFilterable {
  customerType: string;
  pdvs: string[];
  addetti: string[];
  states: string[];
  searchHay: string;
}

/**
 * true se l'entità (journey o riga report) supera tutti i filtri attivi. Un
 * filtro impostato a "tutti" è ignorato. Negozio/addetto/stato usano
 * `includes` sull'array di facet (una journey può avere più PDV/addetti/stati;
 * una riga report ne ha uno solo).
 */
export function matchesCjFilters(v: CjFilterable, f: CjListFilters): boolean {
  if (f.typeFilter !== "tutti" && v.customerType !== f.typeFilter) return false;
  if (f.pdvFilter !== "tutti" && !v.pdvs.includes(f.pdvFilter)) return false;
  if (f.addettoFilter !== "tutti" && !v.addetti.includes(f.addettoFilter)) return false;
  if (f.stateFilter !== "tutti" && !v.states.includes(f.stateFilter)) return false;
  return cjSearchMatches(v.searchHay, f.search);
}

// === Aggregazione reportistica (Task #189) ===
// Gruppo di report lungo una dimensione (negozio / addetto / cliente).
export interface CjReportGroup {
  key: string;
  label: string;
  clienti: number;
  contratti: number;
  attivati: number;
  valore: number;
}

/**
 * Aggrega le righe item-level della reportistica lungo una dimensione scelta
 * dal chiamante (`keyFn`). `clienti` = journey distinte (Set su journeyId),
 * `contratti` = numero di item, `attivati` = item in uno stato attivo
 * (`CJ_ACTIVE_STATES`), `valore` = somma degli importi. Ordina per valore
 * decrescente, poi contratti, poi label (it).
 */
export function aggregateReport(
  rows: CjReportRow[],
  keyFn: (r: CjReportRow) => { key: string; label: string },
): CjReportGroup[] {
  const map = new Map<string, {
    label: string; journeys: Set<string>; contratti: number; attivati: number; valore: number;
  }>();
  for (const r of rows) {
    const { key, label } = keyFn(r);
    let e = map.get(key);
    if (!e) {
      e = { label, journeys: new Set(), contratti: 0, attivati: 0, valore: 0 };
      map.set(key, e);
    }
    e.journeys.add(r.journeyId);
    e.contratti += 1;
    e.valore += r.valore;
    if (CJ_ACTIVE_STATES.has(r.state)) e.attivati += 1;
  }
  return Array.from(map.entries())
    .map(([key, e]) => ({
      key,
      label: e.label,
      clienti: e.journeys.size,
      contratti: e.contratti,
      attivati: e.attivati,
      valore: e.valore,
    }))
    .sort((a, b) => b.valore - a.valore || b.contratti - a.contratti || a.label.localeCompare(b.label, "it"));
}

// === Analisi gettoni e fatturato cross-sell (Task #192) ===
// Il "gettone" di un cliente dipende da QUANTE piste NON-mobile sono attive
// nella sua journey (oltre alla SIM mobile che l'ha aperta). La tabella
// premiante è a scaglioni: più piste cross-sell = gettone più alto.
//
//   0 piste (solo mobile) =>   0 €
//   1 pista               =>  20 €
//   2 piste               =>  30 €
//   3 piste               =>  40 €
//   4 piste               => 100 €
//   5 piste               => 120 €
//
// L'indice dell'array è il numero di piste non-mobile attive.
export const CJ_GETTONE_TABLE: number[] = [0, 20, 30, 40, 100, 120];

// I 5 driver NON-mobile che concorrono al gettone (la mobile è il trigger,
// non conta come pista cross-sell).
export const CJ_NON_MOBILE_DRIVERS: CjDriver[] = [
  "fisso", "energia", "assicurazioni", "telefono", "protetti",
];

// Numero massimo di piste cross-sell saturabili (= journey "piena").
export const CJ_MAX_PISTE = CJ_GETTONE_TABLE.length - 1;

/** Gettone (€) per `n` piste non-mobile attive, con clamp a [0, CJ_MAX_PISTE]. */
export function gettoneForPiste(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const i = Math.max(0, Math.min(CJ_MAX_PISTE, Math.round(n)));
  return CJ_GETTONE_TABLE[i];
}

function clampSaturation(pct: number): number {
  if (!Number.isFinite(pct)) return 100;
  return Math.max(0, Math.min(100, pct));
}

// Numero di prodotti (piste cross-sell) aggiuntivi simulati per cliente, con
// clamp a [0, CJ_MAX_PISTE]. Valore non finito => CJ_MAX_PISTE (saturazione
// completa = comportamento storico dello scenario "+5").
function clampAddProducts(n: number): number {
  if (!Number.isFinite(n)) return CJ_MAX_PISTE;
  return Math.max(0, Math.min(CJ_MAX_PISTE, Math.round(n)));
}

/**
 * Incremento di gettone (€) per una journey con `pisteAttive` piste cross-sell
 * attive e `fatturato` maturato, nello scenario in cui guadagnasse
 * `addProducts` piste in più (cap a CJ_MAX_PISTE). Sempre >= 0. Con
 * `addProducts = CJ_MAX_PISTE` (o più) equivale al potenziale pieno residuo
 * fino alla saturazione completa: è il caso che riproduce il comportamento
 * storico ("+5").
 */
export function gettoneIncremento(
  pisteAttive: number,
  fatturato: number,
  addProducts: number,
): number {
  const add = clampAddProducts(addProducts);
  const piste = Number.isFinite(pisteAttive) ? Math.max(0, pisteAttive) : 0;
  const target = Math.min(CJ_MAX_PISTE, piste + add);
  return Math.max(0, gettoneForPiste(target) - fatturato);
}

// Fra due stringhe tiene il minimo lessicografico ignorando i valori vuoti
// (commutativa => attribuzione indipendente dall'ordine delle righe).
function minNonEmpty(cur: string, val: string): string {
  if (!val) return cur;
  if (!cur) return val;
  return val < cur ? val : cur;
}

// Estrae la data (YYYY-MM-DD, in UTC) da un timestamp ISO. `openedAt` deriva
// dalla data vendita (mezzanotte UTC), quindi i primi 10 caratteri sono la
// data corretta senza ambiguità di fuso orario. Ritorna null se malformato.
function isoDateOnly(iso: string): string | null {
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// Indice mese assoluto (anno*12 + mese, mese 0-based) da un timestamp ISO, in
// UTC. Ritorna null se mancante o malformato. Serve a confrontare il mese di un
// contratto con il mese di T0 (apertura journey).
export function monthOfIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = isoDateOnly(iso);
  if (d == null) return null;
  const year = Number(d.slice(0, 4));
  const month = Number(d.slice(5, 7)) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return year * 12 + month;
}

// Una pista cross-sell rientra nella finestra del gettone se il suo contratto è
// del mese di T0 (apertura journey) o successivo. I contratti dei mesi
// precedenti NON contano. In assenza di T0 o di data evento (dato non
// collocabile) non si penalizza: la pista conta comunque.
export function pisteInWindow(eventDate: string | null, t0Month: number | null): boolean {
  if (t0Month == null) return true;
  const m = monthOfIso(eventDate);
  if (m == null) return true;
  return m >= t0Month;
}

// Sintesi per-journey usata dall'analisi gettoni. Una riga per cliente.
export interface CjGettoneJourney {
  journeyId: string;
  cliente: string;
  customerType: string;
  // Attribuzione negozio/addetto: quelli della SIM mobile (trigger) se
  // disponibili, altrimenti il primo item incontrato.
  pdv: string;
  addetto: string;
  // Data attivazione SIM (T0), ISO string o null.
  openedAt: string | null;
  // N. SIM mobile ATTIVE del cliente (volume item-level, >= 1: la cohort
  // include solo clienti con almeno una SIM mobile attiva).
  simAttive: number;
  // Piste NON-mobile distinte attive (0..CJ_MAX_PISTE).
  pisteAttive: number;
  // Gettone maturato (fatturato as-is) = gettoneForPiste(pisteAttive).
  fatturato: number;
  // Potenziale "pieno": gettone aggiuntivo se la journey arrivasse a
  // saturazione completa (tutte le piste attive). Sempre >= 0.
  potenzialePieno: number;
}

/**
 * Costruisce una `CjGettoneJourney` per ogni journey distinta a partire dalle
 * righe item-level della reportistica. La COHORT include solo i clienti con
 * almeno una SIM mobile in stato attivo (`CJ_ACTIVE_STATES`): le journey con
 * mobile non attivo (ko/stornato/annullato) o senza mobile sono escluse.
 * Le piste attive contano i driver NON-mobile distinti con almeno un item in
 * uno stato attivo. L'energia (gas/luce) conta come una sola pista perché la
 * riga report porta già il driver aggregato.
 */
export function buildGettoneJourneys(rows: CjReportRow[]): CjGettoneJourney[] {
  const map = new Map<string, {
    cliente: string; customerType: string;
    mobilePdv: string; mobileAddetto: string;
    anyPdv: string; anyAddetto: string;
    openedAt: string | null;
    simAttive: number;
    // Candidati pista: driver non-mobile attivi con la loro data evento.
    // Il conteggio distinto in-finestra avviene dopo aver fissato T0.
    candidates: { driver: CjDriver; eventDate: string | null }[];
    // Mesi degli item (mobile attivi e tutti) per il fallback di T0 quando
    // `openedAt` è assente.
    mobileMonths: number[];
    allMonths: number[];
  }>();
  for (const r of rows) {
    let e = map.get(r.journeyId);
    if (!e) {
      e = {
        cliente: r.cliente, customerType: r.customerType,
        mobilePdv: "", mobileAddetto: "", anyPdv: "", anyAddetto: "",
        openedAt: r.openedAt ?? null, simAttive: 0,
        candidates: [], mobileMonths: [], allMonths: [],
      };
      map.set(r.journeyId, e);
    }
    // Attribuzione deterministica (indipendente dall'ordine delle righe, che
    // la query report non garantisce): fra i valori non vuoti teniamo il
    // minimo lessicografico. Nel caso normale la journey ha un'unica
    // attivazione mobile, quindi il valore è univoco.
    e.anyPdv = minNonEmpty(e.anyPdv, r.pdv);
    e.anyAddetto = minNonEmpty(e.anyAddetto, r.addetto);
    const eventMonth = monthOfIso(r.eventDate ?? null);
    if (eventMonth != null) e.allMonths.push(eventMonth);
    if (r.driver === "mobile") {
      e.mobilePdv = minNonEmpty(e.mobilePdv, r.pdv);
      e.mobileAddetto = minNonEmpty(e.mobileAddetto, r.addetto);
      if (CJ_ACTIVE_STATES.has(r.state)) {
        e.simAttive += 1;
        if (eventMonth != null) e.mobileMonths.push(eventMonth);
      }
    }
    if (!e.openedAt && r.openedAt) e.openedAt = r.openedAt;
    if (r.driver !== "mobile" && CJ_ACTIVE_STATES.has(r.state)) {
      e.candidates.push({ driver: r.driver, eventDate: r.eventDate ?? null });
    }
  }
  return Array.from(map.entries())
    // Cohort: solo clienti con SIM mobile attiva.
    .filter(([, e]) => e.simAttive >= 1)
    .map(([journeyId, e]) => {
      // T0 = mese di apertura journey; fallback alla prima SIM mobile attiva,
      // poi al primo evento in assoluto. Solo i contratti dal mese di T0 in poi
      // contano come pista cross-sell.
      const t0Month =
        monthOfIso(e.openedAt) ??
        (e.mobileMonths.length ? Math.min(...e.mobileMonths) : null) ??
        (e.allMonths.length ? Math.min(...e.allMonths) : null);
      const activeDrivers = new Set<CjDriver>();
      for (const c of e.candidates) {
        if (pisteInWindow(c.eventDate, t0Month)) activeDrivers.add(c.driver);
      }
      const pisteAttive = activeDrivers.size;
      const fatturato = gettoneForPiste(pisteAttive);
      return {
        journeyId,
        cliente: e.cliente,
        customerType: e.customerType,
        pdv: e.mobilePdv || e.anyPdv,
        addetto: e.mobileAddetto || e.anyAddetto,
        openedAt: e.openedAt,
        simAttive: e.simAttive,
        pisteAttive,
        fatturato,
        potenzialePieno: Math.max(0, gettoneForPiste(CJ_MAX_PISTE) - fatturato),
      };
    });
}

/**
 * Filtra le journey per data di attivazione SIM (coorte). `from`/`to` sono
 * stringhe `YYYY-MM-DD` (estremi inclusi) o vuote/null per nessun limite.
 * Una journey senza `openedAt` passa solo se NON c'è alcun limite di data
 * (non collocabile in una coorte temporale).
 */
export function filterGettoneByDate(
  journeys: CjGettoneJourney[],
  from?: string | null,
  to?: string | null,
): CjGettoneJourney[] {
  const f = from || null;
  const t = to || null;
  const hasRange = f != null || t != null;
  return journeys.filter((j) => {
    if (!j.openedAt) return !hasRange;
    // Confronto per sola data (UTC) per evitare ambiguità di fuso orario sui
    // bordi: gli estremi `from`/`to` sono YYYY-MM-DD e li confrontiamo come
    // stringhe con la data UTC dell'attivazione.
    const d = isoDateOnly(j.openedAt);
    if (d == null) return false;
    if (f != null && d < f) return false;
    if (t != null && d > t) return false;
    return true;
  });
}

// Gruppo dell'analisi gettoni lungo una dimensione (negozio / addetto /
// ragione sociale).
export interface CjGettoneGroup {
  key: string;
  label: string;
  // N. SIM mobile attivate nel periodo (volume item-level).
  simAttivate: number;
  // N. clienti distinti con SIM attiva (journey distinte del gruppo).
  clienti: number;
  // Clienti con almeno una pista cross-sell attiva ("+prodotti").
  conProdotti: number;
  // Fatturato maturato (€) = somma dei gettoni as-is.
  fatturato: number;
  // Potenziale non espresso (€) alla saturazione scelta.
  potenziale: number;
}

export interface CjGettoneTotals {
  // N. SIM mobile attivate nel periodo (volume item-level).
  simAttivate: number;
  // N. clienti distinti con SIM attiva.
  clienti: number;
  conProdotti: number;
  fatturato: number;
  potenziale: number;
  // Totale piste cross-sell attive (per eventuale media).
  pisteAttive: number;
}

/**
 * Aggrega le journey dell'analisi lungo una dimensione (`keyFn`). Il
 * `potenziale` non espresso è il gettone incrementale dello scenario simulato,
 * scalato per la percentuale di clienti attesa (`saturationPct`, 0..100). Lo
 * scenario assume che ogni cliente guadagni `addProducts` piste cross-sell in
 * più (cap a CJ_MAX_PISTE); con il default `addProducts = CJ_MAX_PISTE` lo
 * scenario è la saturazione completa e il calcolo coincide col potenziale
 * pieno residuo storico. Ordina per fatturato↓, poi clienti↓, poi label (it).
 */
export function aggregateGettone(
  journeys: CjGettoneJourney[],
  keyFn: (j: CjGettoneJourney) => { key: string; label: string },
  saturationPct: number,
  addProducts: number = CJ_MAX_PISTE,
): CjGettoneGroup[] {
  const s = clampSaturation(saturationPct) / 100;
  const map = new Map<string, {
    label: string; simAttivate: number; clienti: number; conProdotti: number;
    fatturato: number; incremento: number;
  }>();
  for (const j of journeys) {
    const { key, label } = keyFn(j);
    let e = map.get(key);
    if (!e) {
      e = { label, simAttivate: 0, clienti: 0, conProdotti: 0, fatturato: 0, incremento: 0 };
      map.set(key, e);
    }
    e.simAttivate += j.simAttive;
    e.clienti += 1;
    if (j.pisteAttive >= 1) e.conProdotti += 1;
    e.fatturato += j.fatturato;
    e.incremento += gettoneIncremento(j.pisteAttive, j.fatturato, addProducts);
  }
  return Array.from(map.entries())
    .map(([key, e]) => ({
      key,
      label: e.label,
      simAttivate: e.simAttivate,
      clienti: e.clienti,
      conProdotti: e.conProdotti,
      fatturato: e.fatturato,
      potenziale: e.incremento * s,
    }))
    .sort((a, b) => b.fatturato - a.fatturato || b.clienti - a.clienti || a.label.localeCompare(b.label, "it"));
}

/**
 * Totali aggregati dell'analisi gettoni per lo scenario simulato: il
 * `potenziale` è l'incremento di gettone se ogni cliente guadagnasse
 * `addProducts` piste in più (cap a CJ_MAX_PISTE), scalato per la percentuale
 * di clienti `saturationPct`. Default `addProducts = CJ_MAX_PISTE` =
 * saturazione completa (comportamento storico).
 */
export function gettoneTotals(
  journeys: CjGettoneJourney[],
  saturationPct: number,
  addProducts: number = CJ_MAX_PISTE,
): CjGettoneTotals {
  const s = clampSaturation(saturationPct) / 100;
  let simAttivate = 0, clienti = 0, conProdotti = 0, fatturato = 0, incremento = 0, pisteAttive = 0;
  for (const j of journeys) {
    simAttivate += j.simAttive;
    clienti += 1;
    if (j.pisteAttive >= 1) conProdotti += 1;
    fatturato += j.fatturato;
    incremento += gettoneIncremento(j.pisteAttive, j.fatturato, addProducts);
    pisteAttive += j.pisteAttive;
  }
  return { simAttivate, clienti, conProdotti, fatturato, potenziale: incremento * s, pisteAttive };
}

/**
 * Percentuali clienti CON vs SENZA prodotti aggiuntivi (almeno 1 pista
 * cross-sell attiva oltre la SIM). `clienti` = totale cohort. Con cohort vuota
 * ritorna 0/0. Le due percentuali sommano sempre a 100 (salvo cohort vuota).
 */
export function crossSellPercentuali(
  clienti: number,
  conProdotti: number,
): { conPct: number; senzaPct: number } {
  if (!clienti || clienti <= 0) return { conPct: 0, senzaPct: 0 };
  const con = Math.max(0, Math.min(clienti, conProdotti));
  const conPct = (con / clienti) * 100;
  return { conPct, senzaPct: 100 - conPct };
}

/**
 * Percentuale di saturazione cross-sell di una singola journey (SIM che ha
 * attivato la CJ): quante delle `CJ_MAX_PISTE` piste cross-sell sono attive,
 * 0..100, con clamp.
 */
export function simSaturationPct(pisteAttive: number): number {
  const p = Math.max(0, Math.min(CJ_MAX_PISTE, pisteAttive));
  return (p / CJ_MAX_PISTE) * 100;
}

// Riga di dettaglio dell'analisi gettoni: una per cliente/SIM che ha attivato
// la CJ, con la sua percentuale di saturazione cross-sell.
export interface CjGettoneDetailRow {
  journeyId: string;
  cliente: string;
  // N. SIM mobile attive del cliente.
  simAttive: number;
  // N. piste cross-sell attive (0..CJ_MAX_PISTE).
  pisteAttive: number;
  // % saturazione cross-sell della singola SIM/cliente (0..100).
  saturazionePct: number;
  // Gettone maturato (€).
  fatturato: number;
}

/**
 * Raggruppa le journey per chiave (`keyFn`, es. PDV o addetto) e ritorna, per
 * ogni chiave, l'elenco di dettaglio dei clienti/SIM con la loro % saturazione
 * cross-sell. Ogni elenco è ordinato per saturazione↓ poi nominativo (it).
 */
export function gettoneDetailByKey(
  journeys: CjGettoneJourney[],
  keyFn: (j: CjGettoneJourney) => string,
): Map<string, CjGettoneDetailRow[]> {
  const map = new Map<string, CjGettoneDetailRow[]>();
  for (const j of journeys) {
    const key = keyFn(j);
    let list = map.get(key);
    if (!list) { list = []; map.set(key, list); }
    list.push({
      journeyId: j.journeyId,
      cliente: j.cliente,
      simAttive: j.simAttive,
      pisteAttive: j.pisteAttive,
      saturazionePct: simSaturationPct(j.pisteAttive),
      fatturato: j.fatturato,
    });
  }
  for (const list of Array.from(map.values())) {
    list.sort((a: CjGettoneDetailRow, b: CjGettoneDetailRow) => b.saturazionePct - a.saturazionePct || a.cliente.localeCompare(b.cliente, "it"));
  }
  return map;
}

/**
 * Riepilogo per-driver (attivato sì/no + conteggio item) per un insieme di
 * item di una journey. L'energia distingue gas/luce a livello di item ma per
 * il riepilogo conta come singolo driver. L'ordine segue `CJ_DRIVER_ORDER`.
 */
export function summarizeDrivers(
  items: { driver: CjDriver; state: CjItemState }[],
): CjDriverSummary[] {
  return CJ_DRIVER_ORDER.map((driver) => {
    const driverItems = items.filter((it) => it.driver === driver);
    const activated = driverItems.some((it) => CJ_ACTIVE_STATES.has(it.state));
    return { driver, activated, count: driverItems.length };
  });
}

const MOBILE_CATEGORIES = new Set([
  "UNTIED", "TIED CF", "TIED IVA", "ALTRE GA", "ADD-ON GA", "VERY MOBILE",
]);
const FISSO_CATEGORIES = new Set([
  "ADSL/FIBRA/FWA CF", "ADSL/FIBRA/FWA IVA", "FISSO VOCE", "ADD-ON FISSI",
]);
const ENERGIA_CATEGORIES = new Set(["ENERGIA W3", "ACEA ENERGIA"]);
const ASSICURAZIONI_CATEGORIES = new Set([
  "ASSICURAZIONI", "ASSICURAZIONI BUSINESS PRO", "WINDTRE SECURITY PRO GA",
]);
const PROTETTI_CATEGORIES = new Set(["ALLARMI"]);
const TELEFONO_CATEGORIES = new Set(["TELEFONIA"]);

function normCat(categoria: string | null | undefined): string {
  return (categoria || "").toUpperCase().trim();
}

/** Restituisce il driver CJ per una categoria, o null se non è un driver. */
export function driverFromCategory(categoria: string | null | undefined): CjDriver | null {
  const k = normCat(categoria);
  if (MOBILE_CATEGORIES.has(k)) return "mobile";
  if (FISSO_CATEGORIES.has(k)) return "fisso";
  if (ENERGIA_CATEGORIES.has(k)) return "energia";
  if (ASSICURAZIONI_CATEGORIES.has(k)) return "assicurazioni";
  if (PROTETTI_CATEGORIES.has(k)) return "protetti";
  if (TELEFONO_CATEGORIES.has(k)) return "telefono";
  return null;
}

/**
 * true se la categoria è una **nuova attivazione di pista mobile** che fa
 * scattare la customer journey. Esclude per costruzione CB/MIA/rivincoli.
 */
export function isMobileActivationCategory(categoria: string | null | undefined): boolean {
  return MOBILE_CATEGORIES.has(normCat(categoria));
}

/** Sotto-tipo energia dalla tipologia: 'gas' | 'luce' | null. */
export function energiaSubtype(tipologia: string | null | undefined): "gas" | "luce" | null {
  const t = (tipologia || "").toUpperCase();
  if (t.includes("GAS")) return "gas";
  if (t.includes("LUCE")) return "luce";
  return null;
}

/**
 * Estrae i campi codificati nelle stringhe free-text `venditaInfoN` del
 * `dettaglio` BiSuite (es. "CODICE CONTRATTO: 168...", "POD/PDR: 005...",
 * "IMEI/SERIALE DISPOSITIVO ASSOCIATO: 0"). I valori vuoti o "0" sono
 * scartati. Il discriminante POD vs PDR (luce vs gas) lo applica il chiamante
 * in base a `energiaSubtype(tipologia)`.
 */
export function parseVenditaInfo(dettaglio: any): {
  codiceContratto?: string;
  podPdr?: string;
  imei?: string;
} {
  const out: { codiceContratto?: string; podPdr?: string; imei?: string } = {};
  if (!dettaglio || typeof dettaglio !== "object") return out;
  const fields = [
    dettaglio.venditaInfo1, dettaglio.venditaInfo2, dettaglio.venditaInfo3,
    dettaglio.venditaInfo4, dettaglio.venditaInfo5,
  ];
  for (const f of fields) {
    if (typeof f !== "string") continue;
    const idx = f.indexOf(":");
    if (idx < 0) continue;
    const label = f.slice(0, idx).toUpperCase().trim();
    const value = f.slice(idx + 1).trim();
    if (!value || value === "0") continue;
    if (label.includes("CODICE CONTRATTO")) out.codiceContratto = value;
    else if (label.includes("POD") || label.includes("PDR")) out.podPdr = value;
    else if (label.includes("IMEI")) out.imei = value;
  }
  return out;
}

// Prefissi email "generici" (caselle di reparto/servizio) che NON sono il nome
// dell'azienda: in questi casi non proponiamo alcun suggerimento di ragione
// sociale.
const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "info", "amministrazione", "amm", "ammin", "contabilita", "segreteria",
  "direzione", "commerciale", "ufficio", "ordini", "acquisti", "vendite",
  "mail", "posta", "pec", "noreply", "no-reply", "supporto", "assistenza",
  "marketing", "hr", "staff", "admin", "contact", "contatti", "azienda",
]);

/**
 * Suggerimento (best-effort) della ragione sociale del cliente business a
 * partire dalla sua email. BiSuite NON fornisce la ragione sociale del cliente
 * in un campo strutturato: l'unico indizio è la parte locale dell'email (es.
 * `BLUESHARKSRL@modaroma.it` ⇒ "BLUESHARKSRL"). Il valore è solo un punto di
 * partenza modificabile dall'operatore: non sappiamo dove vadano gli spazi.
 * Restituisce null se l'email manca, è una casella generica di reparto, o non
 * contiene lettere.
 */
export function suggestRagioneSocialeFromEmail(
  email: string | null | undefined,
): string | null {
  if (!email) return null;
  const at = String(email).indexOf("@");
  if (at <= 0) return null;
  const local = String(email).slice(0, at).trim();
  if (!local) return null;
  // scarta separatori comuni e numeri di coda (es. "info2", "amministrazione.2")
  const base = local.replace(/[._-]?\d+$/, "").replace(/[._-]+/g, " ").trim();
  const key = base.replace(/\s+/g, "").toLowerCase();
  if (!key || GENERIC_EMAIL_LOCAL_PARTS.has(key)) return null;
  if (!/[a-zA-Z]/.test(base)) return null;
  return base.toUpperCase();
}
