import type { CjDriver, CjEconomicState } from "./schema";
import { monthOfIso } from "./customerJourney";

// === Motore di esito economico Customer Journey ← DRMS ===
//
// Logica PURA (nessun import runtime oltre a `monthOfIso`) così da essere
// testabile con tsx/node e riusabile lato server. Dato l'insieme delle righe
// DRMS caricate per un'organizzazione (tutti gli upload, così com'è salvato in
// `drms_uploads.rows`) e gli item CJ, calcola per ogni item l'esito economico
// (pagato / annullato / stornato / riaccreditato) con il riferimento alla riga
// che l'ha determinato.
//
// Regole (confermate dall'utente, vedi docs/customer-journey.md):
//  - unità di analisi = CODICE_CONTRATTO; per l'esito contano SOLO le righe con
//    NATURA = CONTRATTUALE (+ gli "Adjustment Manuali" di storno compensi);
//  - pagato       = importo > 0 senza causale storno;
//  - annullato    = importo = 0 con causale di annullamento (DINIEGO, POPI,
//                   POPI ESTESA, DISCONOSCIMENTO, KO_REITERO, NP INTERNA);
//  - stornato     = importo < 0 (DISDETTA RECESSO, CLIENTE IRREGOLARE, PDA…) o
//                   adjustment "Storno Compensi";
//  - riaccreditato = importo > 0 su contratto già stornato in una competenza
//                   precedente;
//  - precedenza temporale: si ricostruisce la storia per COMPETENZA (poi
//    DATA_EVENTO) e vince l'evento più recente;
//  - match: codice contratto (mobile/fisso/assicurazioni/telefono/protetti)
//    con fallback CF/P.IVA + TIPO_FONIA; energia per POD/PDR con fallback
//    CF/P.IVA + ENERGIA. Con più contratti agganciati basta un pagato;
//  - finestra: competenze dal mese di inserimento dell'item fino a T+5.

// Riga DRMS "lasca": è il JSON salvato in `drms_uploads.rows` (normalizzato dal
// client, che dalla Task DRMS conserva i campi di esito). Gli upload
// precedenti a quella modifica non li hanno: le righe vengono semplicemente
// ignorate dal motore.
export interface DrmsOutcomeRow {
  SEQ_ID?: unknown;
  CODICE_CONTRATTO?: unknown;
  FISCAL_CODE?: unknown;
  P_IVA_CLIENTE?: unknown;
  POD_PDR?: unknown;
  NATURA?: unknown;
  CAUSALE_STORNO?: unknown;
  DATA_EVENTO?: unknown;
  TIPO_TRANSAZIONE?: unknown;
  TIPO_FONIA?: unknown;
  COMPETENZA?: unknown;
  DT_ATTIVAZIONE?: unknown;
  DESCRIZIONE_EVENTO?: unknown;
  IMPORTO_NUM?: unknown;
  IMPORTO?: unknown;
  __UPLOAD_ID?: unknown;
  [k: string]: unknown;
}

export interface DrmsOutcomeItem {
  id: string;
  driver: CjDriver | string;
  codiceContratto: string | null;
  cf: string | null;
  piva: string | null;
  pod: string | null;
  pdr: string | null;
  // ISO string o null: mese di inserimento (inizio finestra T0..T+5).
  dataInserimento: string | null;
}

export type DrmsMatchBy = "contratto" | "pod_pdr" | "cf";

export interface DrmsOutcome {
  state: CjEconomicState;
  // Competenza del contratto = prima riga CONTRATTUALE che lo cita.
  competenza: string;
  // Riferimento alla riga che ha determinato l'esito.
  outcomeCompetenza: string;
  causale: string;
  importo: number;
  seqId: string;
  uploadId: string | null;
  matchBy: DrmsMatchBy;
  // Codici contratto DRMS agganciati (1 nel caso normale; >1 con fallback CF
  // o più POD/PDR).
  contratti: string[];
  // true se i contratti agganciati hanno esiti finali diversi (è stata
  // applicata la precedenza pagato > riaccreditato > stornato > annullato).
  ambiguous: boolean;
  // Storia ricostruita per competenza (in ordine crescente).
  history: { competenza: string; state: CjEconomicState; importo: number; causale: string }[];
}

// Upload "legacy": salvato PRIMA che il parser client conservasse i campi di
// esito (FISCAL_CODE / POD_PDR / CAUSALE_STORNO / …). Le sue righe non possono
// agganciare nulla per POD/CF né distinguere gli annullamenti: vanno
// ricaricate dai file originali.
export interface DrmsLegacyUpload {
  uploadId: string;
  rows: number;
}

export interface DrmsOutcomeSummary {
  items: number;
  matched: number;
  notFound: number;
  ambiguous: number;
  byState: Record<CjEconomicState, number>;
  // Item non esitati: quanti per driver.
  notFoundByDriver: Record<string, number>;
  // Upload privi dei campi di esito (righe ignorate dal motore per il
  // fallback POD/CF): elencati esplicitamente, MAI conteggiati in silenzio.
  legacyUploads: DrmsLegacyUpload[];
  // Righe complessive appartenenti a upload legacy.
  legacyRows: number;
}

export interface DrmsOutcomeResult {
  outcomes: Map<string, DrmsOutcome | null>;
  summary: DrmsOutcomeSummary;
}

// Chiavi che il parser DRMS "nuovo" conserva su OGNI riga (anche vuote): la
// loro assenza dall'oggetto JSON (non il valore vuoto) identifica un upload
// legacy.
export const DRMS_OUTCOME_FIELD_KEYS = ["FISCAL_CODE", "POD_PDR", "CAUSALE_STORNO"] as const;

export function drmsRowHasOutcomeFields(row: DrmsOutcomeRow): boolean {
  return DRMS_OUTCOME_FIELD_KEYS.some((k) => Object.prototype.hasOwnProperty.call(row, k));
}

/**
 * Individua gli upload (per `__UPLOAD_ID`) in cui NESSUNA riga porta i campi
 * di esito. Righe senza `__UPLOAD_ID` sono raggruppate sotto la chiave "".
 */
export function detectLegacyDrmsUploads(rows: DrmsOutcomeRow[]): DrmsLegacyUpload[] {
  const perUpload = new Map<string, { rows: number; withFields: boolean }>();
  for (const row of rows) {
    const id = str(row.__UPLOAD_ID);
    let e = perUpload.get(id);
    if (!e) { e = { rows: 0, withFields: false }; perUpload.set(id, e); }
    e.rows += 1;
    if (!e.withFields && drmsRowHasOutcomeFields(row)) e.withFields = true;
  }
  const out: DrmsLegacyUpload[] = [];
  perUpload.forEach((e, uploadId) => {
    if (!e.withFields && e.rows > 0) out.push({ uploadId, rows: e.rows });
  });
  return out.sort((a, b) => a.uploadId.localeCompare(b.uploadId));
}

// Causali che, con importo 0, indicano un contratto MAI pagato (annullato).
export const DRMS_ANNULLATO_CAUSALI = new Set([
  "DINIEGO", "POPI", "POPI ESTESA", "DISCONOSCIMENTO", "KO_REITERO", "KO REITERO", "NP INTERNA",
]);

// Ampiezza della finestra di monitoraggio (mesi dopo quello di inserimento).
export const DRMS_WINDOW_MONTHS = 5;

// TIPO_FONIA atteso per il fallback CF+driver. `telefono` (smartphone) non ha
// righe CONTRATTUALE proprie e condividerebbe MOBILE con la SIM: niente
// fallback (solo codice contratto).
export const DRIVER_TIPO_FONIA: Record<string, string | null> = {
  mobile: "MOBILE",
  fisso: "FISSO",
  energia: "ENERGIA",
  assicurazioni: "ASSICURAZIONI",
  protetti: "ASSICURAZIONI",
  telefono: null,
};

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const up = (v: unknown): string => str(v).toUpperCase();

export function drmsImporto(row: DrmsOutcomeRow): number {
  if (typeof row.IMPORTO_NUM === "number" && Number.isFinite(row.IMPORTO_NUM)) return row.IMPORTO_NUM;
  const raw = row.IMPORTO_NUM ?? row.IMPORTO;
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  let s = String(raw).trim();
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const MONTH_ABBR: Record<string, number> = {
  GEN: 1, FEB: 2, MAR: 3, APR: 4, MAG: 5, GIU: 6, LUG: 7, AGO: 8, SET: 9, OTT: 10, NOV: 11, DIC: 12,
  JAN: 1, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, DEC: 12,
};

/**
 * Normalizza una competenza DRMS in 'YYYY-MM'. Accetta '2026-02', '202602',
 * '2026-02-01', 'FEB-26', 'FEB-2026'. Ritorna null se non interpretabile.
 */
export function normalizeCompetenza(v: unknown): string | null {
  const s = up(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^([A-Z]{3})-(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTH_ABBR[m[1]];
    if (!mon) return null;
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${year}-${String(mon).padStart(2, "0")}`;
  }
  return null;
}

/** Indice mese assoluto (anno*12+mese-1) da 'YYYY-MM'. */
export function competenzaMonthIndex(c: string | null): number | null {
  if (!c) return null;
  const m = c.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

type EventKind = "credit" | "storno" | "annullato";

interface DrmsEvent {
  kind: EventKind;
  contratto: string;
  competenza: string;
  monthIdx: number;
  dataEvento: string;
  importo: number;
  causale: string;
  seqId: string;
  uploadId: string | null;
  fonia: string;
}

function isContrattuale(row: DrmsOutcomeRow): boolean {
  return up(row.NATURA) === "CONTRATTUALE";
}

function isStornoCompensi(row: DrmsOutcomeRow): boolean {
  return up(row.TIPO_TRANSAZIONE).includes("ADJUSTMENT") && up(row.DESCRIZIONE_EVENTO).includes("STORNO COMPENSI");
}

/**
 * Classifica una singola riga DRMS in evento di esito, o null se la riga non
 * concorre all'esito (natura non contrattuale, importo 0 senza causale di
 * annullamento, riga senza chiavi di aggancio).
 */
export function classifyDrmsRow(row: DrmsOutcomeRow): { kind: EventKind } | null {
  const storno = isStornoCompensi(row);
  if (!isContrattuale(row) && !storno) return null;
  const importo = drmsImporto(row);
  if (storno) return { kind: "storno" };
  if (importo > 0) return { kind: "credit" };
  if (importo < 0) return { kind: "storno" };
  if (DRMS_ANNULLATO_CAUSALI.has(up(row.CAUSALE_STORNO))) return { kind: "annullato" };
  return null;
}

interface DrmsIndex {
  byContratto: Map<string, DrmsEvent[]>;
  byPodPdr: Map<string, Set<string>>;
  // chiave `${CF}|${FONIA}` → contratti
  byCfFonia: Map<string, Set<string>>;
}

function addTo(map: Map<string, Set<string>>, key: string, code: string) {
  if (!key) return;
  let s = map.get(key);
  if (!s) { s = new Set(); map.set(key, s); }
  s.add(code);
}

export function buildDrmsIndex(rows: DrmsOutcomeRow[]): DrmsIndex {
  const idx: DrmsIndex = { byContratto: new Map(), byPodPdr: new Map(), byCfFonia: new Map() };
  for (const row of rows) {
    const cls = classifyDrmsRow(row);
    if (!cls) continue;
    const competenza = normalizeCompetenza(row.COMPETENZA);
    if (!competenza) continue;
    const monthIdx = competenzaMonthIndex(competenza)!;
    const cf = up(row.FISCAL_CODE);
    const piva = up(row.P_IVA_CLIENTE);
    const fonia = up(row.TIPO_FONIA);
    let contratto = up(row.CODICE_CONTRATTO);
    // Storni manuali senza codice contratto: agganciati per cliente+fonia
    // (chiave sintetica), così pesano sull'esito del CF corrispondente.
    if (!contratto) {
      const owner = cf || piva;
      if (!owner) continue;
      contratto = `__CF:${owner}|${fonia}`;
    }
    const ev: DrmsEvent = {
      kind: cls.kind,
      contratto,
      competenza,
      monthIdx,
      dataEvento: str(row.DATA_EVENTO),
      importo: drmsImporto(row),
      causale: str(row.CAUSALE_STORNO) || (isStornoCompensi(row) ? str(row.DESCRIZIONE_EVENTO) : ""),
      seqId: str(row.SEQ_ID),
      uploadId: str(row.__UPLOAD_ID) || null,
      fonia,
    };
    const list = idx.byContratto.get(contratto) ?? [];
    list.push(ev);
    idx.byContratto.set(contratto, list);
    const pod = up(row.POD_PDR);
    if (pod && fonia === "ENERGIA") addTo(idx.byPodPdr, pod, contratto);
    if (cf) addTo(idx.byCfFonia, `${cf}|${fonia}`, contratto);
    if (piva) addTo(idx.byCfFonia, `${piva}|${fonia}`, contratto);
  }
  return idx;
}

interface ContractOutcome {
  state: CjEconomicState;
  competenza: string;
  ref: DrmsEvent;
  history: DrmsOutcome["history"];
}

/**
 * Ricostruisce la storia economica di un contratto a partire dai suoi eventi
 * (già filtrati per finestra). Gli eventi sono raggruppati per competenza; per
 * ogni competenza si valuta il saldo netto (così un'opzione stornata da -5€
 * accanto a un'attivazione pagata +30€ nello stesso mese non "storna" il
 * contratto). Le competenze sono applicate in ordine crescente: credito dopo
 * uno storno = riaccredito.
 */
export function outcomeForEvents(events: DrmsEvent[]): ContractOutcome | null {
  if (events.length === 0) return null;
  const byComp = new Map<string, DrmsEvent[]>();
  for (const ev of events) {
    const l = byComp.get(ev.competenza) ?? [];
    l.push(ev);
    byComp.set(ev.competenza, l);
  }
  const comps = Array.from(byComp.keys()).sort();
  let state: CjEconomicState | null = null;
  let ref: DrmsEvent | null = null;
  const history: DrmsOutcome["history"] = [];
  for (const comp of comps) {
    const evs = byComp.get(comp)!;
    evs.sort((a, b) => a.dataEvento.localeCompare(b.dataEvento) || a.seqId.localeCompare(b.seqId));
    const net = evs.reduce((s, e) => s + e.importo, 0);
    let next: CjEconomicState | null = null;
    let refEv: DrmsEvent | null = null;
    if (net > 0) {
      next = state === "stornato" ? "riaccreditato" : "pagato";
      // riga di riferimento: l'ultimo credito della competenza
      refEv = [...evs].reverse().find((e) => e.kind === "credit") ?? evs[evs.length - 1];
    } else if (net < 0) {
      next = "stornato";
      refEv = [...evs].reverse().find((e) => e.kind === "storno") ?? evs[evs.length - 1];
    } else {
      const ann = [...evs].reverse().find((e) => e.kind === "annullato");
      if (ann && state == null) {
        next = "annullato";
        refEv = ann;
      } else if (ann && state === "pagato") {
        // annullamento successivo a un pagamento senza addebito negativo:
        // non altera lo stato pagato (nessun importo restituito).
        continue;
      } else {
        continue;
      }
    }
    state = next;
    ref = refEv;
    history.push({ competenza: comp, state: next, importo: net, causale: refEv?.causale ?? "" });
  }
  if (!state || !ref) return null;
  return { state, competenza: comps[0], ref, history };
}

const STATE_PREFERENCE: CjEconomicState[] = ["pagato", "riaccreditato", "stornato", "annullato"];

function inWindow(ev: DrmsEvent, startIdx: number | null): boolean {
  if (startIdx == null) return true;
  return ev.monthIdx >= startIdx && ev.monthIdx <= startIdx + DRMS_WINDOW_MONTHS;
}

/**
 * Esito per un singolo item CJ dato l'indice DRMS. Ritorna null se nessuna
 * riga CONTRATTUALE (in finestra) è agganciabile all'item.
 */
export function resolveItemOutcome(idx: DrmsIndex, item: DrmsOutcomeItem): DrmsOutcome | null {
  const startIdx = monthOfIso(item.dataInserimento);
  const code = up(item.codiceContratto);
  const cf = up(item.cf);
  const piva = up(item.piva);
  const fonia = DRIVER_TIPO_FONIA[item.driver] ?? null;

  let candidates = new Set<string>();
  let matchBy: DrmsMatchBy = "contratto";
  if (item.driver === "energia") {
    matchBy = "pod_pdr";
    for (const k of [up(item.pod), up(item.pdr)]) {
      const s = k ? idx.byPodPdr.get(k) : undefined;
      if (s) for (const c of Array.from(s)) candidates.add(c);
    }
    // Il codice contratto energia BiSuite differisce da quello DRMS, ma se
    // per caso coincide lo accettiamo.
    if (candidates.size === 0 && code && idx.byContratto.has(code)) {
      candidates.add(code);
      matchBy = "contratto";
    }
  } else if (code && idx.byContratto.has(code)) {
    candidates.add(code);
  }
  if (candidates.size === 0 && fonia) {
    matchBy = "cf";
    for (const owner of [cf, piva]) {
      const s = owner ? idx.byCfFonia.get(`${owner}|${fonia}`) : undefined;
      if (s) for (const c of Array.from(s)) candidates.add(c);
    }
  }
  if (candidates.size === 0) return null;

  const outcomes: { code: string; out: ContractOutcome }[] = [];
  for (const c of Array.from(candidates)) {
    const evs = (idx.byContratto.get(c) ?? []).filter((e) => inWindow(e, startIdx));
    const out = outcomeForEvents(evs);
    if (out) outcomes.push({ code: c, out });
  }
  if (outcomes.length === 0) return null;
  const states = new Set(outcomes.map((o) => o.out.state));
  let chosen = outcomes[0];
  for (const pref of STATE_PREFERENCE) {
    const found = outcomes.find((o) => o.out.state === pref);
    if (found) { chosen = found; break; }
  }
  const competenza = outcomes.map((o) => o.out.competenza).sort()[0];
  return {
    state: chosen.out.state,
    competenza,
    outcomeCompetenza: chosen.out.ref.competenza,
    causale: chosen.out.ref.causale,
    importo: chosen.out.ref.importo,
    seqId: chosen.out.ref.seqId,
    uploadId: chosen.out.ref.uploadId,
    matchBy,
    contratti: outcomes.map((o) => o.code).filter((c) => !c.startsWith("__CF:")),
    ambiguous: states.size > 1,
    history: chosen.out.history,
  };
}

/**
 * Calcola l'esito DRMS per tutti gli item. `outcomes` contiene una voce per
 * OGNI item (null = non trovato), così il chiamante può azzerare gli esiti
 * di item non più presenti nei DRMS.
 */
export function computeDrmsOutcomes(rows: DrmsOutcomeRow[], items: DrmsOutcomeItem[]): DrmsOutcomeResult {
  const idx = buildDrmsIndex(rows);
  const outcomes = new Map<string, DrmsOutcome | null>();
  const legacyUploads = detectLegacyDrmsUploads(rows);
  const summary: DrmsOutcomeSummary = {
    items: items.length, matched: 0, notFound: 0, ambiguous: 0,
    byState: { pagato: 0, annullato: 0, stornato: 0, riaccreditato: 0 },
    notFoundByDriver: {},
    legacyUploads,
    legacyRows: legacyUploads.reduce((s, u) => s + u.rows, 0),
  };
  for (const it of items) {
    const out = resolveItemOutcome(idx, it);
    outcomes.set(it.id, out);
    if (!out) {
      summary.notFound += 1;
      summary.notFoundByDriver[it.driver] = (summary.notFoundByDriver[it.driver] ?? 0) + 1;
      continue;
    }
    summary.matched += 1;
    summary.byState[out.state] += 1;
    if (out.ambiguous) summary.ambiguous += 1;
  }
  return { outcomes, summary };
}

/**
 * Decide il nuovo stato economico di un item dato l'esito DRMS calcolato:
 * lo stato manuale vince sempre (con flag di incongruenza se diverso);
 * altrimenti lo stato segue il DRMS (null se nessun esito).
 */
export function applyOutcomeToState(
  current: { economicState: string | null; economicStateManual: boolean; drmsOutcomeState?: string | null },
  outcome: DrmsOutcome | null,
): { economicState: string | null; mismatch: boolean } {
  const drmsState = outcome?.state ?? null;
  if (current.economicStateManual) {
    return {
      economicState: current.economicState,
      mismatch: drmsState != null && drmsState !== current.economicState,
    };
  }
  if (drmsState != null) return { economicState: drmsState, mismatch: false };
  // Nessun esito DRMS: se lo stato corrente era stato scritto dal DRMS (esito
  // precedente ora scomparso, es. upload eliminato) lo azzeriamo; altrimenti
  // preserviamo quello di altra origine (es. "annullato" da BiSuite).
  if (current.drmsOutcomeState != null && current.economicState === current.drmsOutcomeState) {
    return { economicState: null, mismatch: false };
  }
  return { economicState: current.economicState, mismatch: false };
}

// ---------------------------------------------------------------------------
// Esecuzione asincrona di "Esita da DRMS"
// ---------------------------------------------------------------------------
// Su decine di migliaia di righe il ricalcolo può durare a lungo: le route
// attendono l'esito al massimo `CJ_DRMS_APPLY_INLINE_WAIT_MS`; se non è
// pronto rispondono 202 `{ pending: true }` e il risultato viene consegnato
// come notifica (campanella) con questo status in bisuite_sync_notifications.
export const CJ_DRMS_OUTCOME_NOTIFICATION_STATUS = "cj_drms_outcome" as const;
export const CJ_DRMS_APPLY_INLINE_WAIT_MS = 10_000;

export type DrmsApplySummaryLike = {
  items: number;
  matched: number;
  notFound: number;
  ambiguous: number;
  byState: Record<CjEconomicState, number>;
  notFoundByDriver: Record<string, number>;
  legacyUploads: { period?: string; fileName?: string }[];
  updated: number;
  mismatches: number;
  uploads: number;
  drmsRows: number;
};

/** Testo discorsivo del riepilogo esiti (notifica campanella / log). */
export function formatDrmsApplySummary(s: DrmsApplySummaryLike, opts?: { durationMs?: number }): string {
  const states = (["pagato", "annullato", "stornato", "riaccreditato"] as CjEconomicState[])
    .map((st) => `${s.byState?.[st] ?? 0} ${st}`)
    .join(", ");
  const nf = Object.entries(s.notFoundByDriver ?? {})
    .filter(([, n]) => n > 0)
    .map(([d, n]) => `${n} ${d}`)
    .join(", ");
  const parts = [
    s.uploads === 0
      ? "Nessun DRMS caricato: esiti azzerati."
      : `${s.matched}/${s.items} contratti esitati (${states}) su ${s.drmsRows} righe DRMS di ${s.uploads} upload.`,
    `${s.notFound} non trovati${nf ? ` (${nf})` : ""}, ${s.ambiguous} ambigui, ${s.mismatches} incongruenze con stato manuale, ${s.updated} contratti aggiornati.`,
  ];
  if (s.legacyUploads.length > 0) {
    parts.push(`${s.legacyUploads.length} upload senza campi di esito da ricaricare: ${s.legacyUploads.map((l) => `${l.period ?? ""} ${l.fileName ?? ""}`.trim()).join("; ")}.`);
  }
  if (opts?.durationMs != null) parts.push(`Durata ${(opts.durationMs / 1000).toFixed(1)}s.`);
  return parts.join(" ");
}
