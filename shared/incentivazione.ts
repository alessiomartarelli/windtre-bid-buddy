// === Incentivazione interna (gare addetto) — logica condivisa client/server ===
// Conversione fedele del prototipo HTML (Task #170). Tutte le funzioni sono pure
// così la stessa matematica (proiezione, semaforo, calendario giorni lavorativi)
// gira identica sul client (rendering) e sul server (aggregazione live).

export type Semaforo = "g" | "a" | "r" | "u";

export interface Track {
  id: string;
  name: string;
  target: number;
  unit: string;
  isLock: boolean;
  sub?: boolean;
  note?: string;
  /** true => valore preso dal connettore BiSuite (Accessori/Servizi). */
  live?: boolean;
  /** lettera colonna Excel (es. "B") per il mapping valenze, opzionale. */
  excelCol?: string;
}

export interface Section {
  id: string;
  label: string;
  op: string;
  cls: string;
  base: number | null;
  locks: number;
  ready: boolean;
  tracks: Track[];
}

export interface IncentivazioneConfig {
  /** categorie connettore Accessori (categoria.id BiSuite). */
  catAcc: number[];
  /** categorie connettore Servizi (categoria.id BiSuite). */
  catServ: number[];
  /** festività ISO (YYYY-MM-DD) escluse dai giorni lavorativi. */
  holidays: string[];
  sections: Section[];
}

export interface CalendarInfo {
  el: number;
  tot: number;
  rem: number;
  pct: number;
  mult: number;
  from: string;
  to: string;
}

export interface TrackDatum {
  actual: number | null;
  proj: number | null;
  sem: Semaforo;
  target: number;
}

export interface LockDatum {
  id: string;
  name: string;
  sem: Semaforo;
}

export interface Employee {
  name: string;
  tds: Record<string, TrackDatum>;
  locks: LockDatum[];
  status: Semaforo;
  /** true se per proiezione sblocca la gara (tutti i lucchetti g|a). */
  unlockProjected: boolean;
}

export interface ValenzaRow {
  name: string;
  [trackId: string]: number | null | string;
}

export interface LiveAddetto {
  name: string;
  acc: number;
  serv: number;
}

// ── Default config (fedele al prototipo) ───────────────────────────────────
export const DEFAULT_CAT_ACC = [13, 3];
export const DEFAULT_CAT_SERV = [4, 27];

// Template W3 (foglio "Riepilogo" del report valenze): col A=Addetto,
// B=PISTA MOBILE, C=PISTA FISSO, D=PISTA CB, E=PISTA ASSICURAZIONI,
// F=PISTA IVA W3, G=PISTA ENERGIA, H=PISTA PROTECTA, I=PISTA FISSO (2ª,
// non usata dal regolamento — skip), J=PISTA EXTRA MARGINALITA. Le colonne
// da L in poi sono le "Proiezione" calcolate nel file e vengono ignorate
// (il mapping è per posizione fissa, non per header).
const W3_COL: Record<string, string> = {
  mobile: "B",
  fisso: "C",
  cb_rete: "D",
  assicurazione: "E",
  iva: "F",
  energia: "G",
  protecta: "H",
  extra_marginalita: "J",
};

// Layout del file punti Vodafone "report_valenze" (foglio "Riepilogo"):
// A=Addetto, B=Mobile, C=Fisso, D=CB (escluso), E=Energia Fastweb,
// F=TNP (solo vis), G=IVA, H=Totale piste consumer (escluso); da I in poi
// separatore vuoto + colonne "Proiezione" calcolate, ignorate. Mappiamo per
// posizione fissa SOLO le 5 piste a punteggio del file. I pezzi Fisso/Mobile,
// i fissi IVA e Accessori/Servizi NON sono nel file: arrivano dal connettore
// BiSuite (vedi flag `live` e l'aggregazione lato server).
const VDF_COL: Record<string, string> = {
  mobile_pt: "B",
  fisso_pt: "C",
  energia: "E",
  tnp: "F",
  iva_voci: "G",
};

export function defaultSections(): Section[] {
  return [
    {
      id: "ss_w3",
      label: "Store Specialist",
      op: "W3",
      cls: "w3",
      base: 400,
      locks: 4,
      ready: true,
      tracks: [
        { id: "mobile", name: "Mobile (S3)", target: 50, unit: "pt", isLock: false, excelCol: W3_COL.mobile },
        { id: "fisso", name: "Fisso (S3)", target: 22, unit: "pt", isLock: false, excelCol: W3_COL.fisso },
        { id: "cb_rete", name: "CB Rete", target: 25, unit: "pz", isLock: false, excelCol: W3_COL.cb_rete },
        { id: "assicurazione", name: "Assicurazione", target: 7, unit: "pt", isLock: true, excelCol: W3_COL.assicurazione },
        { id: "iva", name: "IVA F+M (S2)", target: 10, unit: "pt", isLock: true, excelCol: W3_COL.iva },
        { id: "energia", name: "Energia", target: 16, unit: "pt", isLock: false, excelCol: W3_COL.energia },
        { id: "protecta", name: "Protecta", target: 1, unit: "pz", isLock: true, excelCol: W3_COL.protecta },
        { id: "extra_marginalita", name: "Smartphone", target: 22, unit: "pz", isLock: true, excelCol: W3_COL.extra_marginalita },
        { id: "accessori", name: "Accessori", target: 427, unit: "€", isLock: false, live: true },
        { id: "servizi", name: "Servizi", target: 300, unit: "€", isLock: false, live: true },
      ],
    },
    {
      id: "sm_w3",
      label: "Store Manager",
      op: "W3",
      cls: "w3",
      base: null,
      locks: 0,
      ready: false,
      tracks: [],
    },
    {
      id: "ss_vdf",
      label: "Store Specialist",
      op: "Vodafone",
      cls: "vdf",
      base: 300,
      locks: 4,
      ready: true,
      tracks: [
        { id: "fisso_pt", name: "Fisso (S6) pt", target: 20, unit: "pt", isLock: true, excelCol: VDF_COL.fisso_pt },
        { id: "fisso_pz", name: "Fisso (S6) pz", target: 15, unit: "pz", isLock: true, sub: true },
        { id: "mobile_pt", name: "Mobile (S7) pt", target: 45, unit: "pt", isLock: false, excelCol: VDF_COL.mobile_pt },
        { id: "mobile_pz", name: "Mobile (S7) pz", target: 30, unit: "pz", isLock: false, sub: true },
        { id: "iva_voci", name: "IVA voci (S3)", target: 8, unit: "voci", isLock: true, excelCol: VDF_COL.iva_voci },
        { id: "iva_fissi", name: "IVA fissi (S3)", target: 3, unit: "fissi", isLock: true, sub: true },
        { id: "tnp", name: "TNP/Smartphone", target: 16, unit: "pz", isLock: true, note: "≥65% fin.", excelCol: VDF_COL.tnp },
        { id: "energia", name: "Energia", target: 12, unit: "pz", isLock: true, excelCol: VDF_COL.energia },
        { id: "accessori", name: "Accessori", target: 427, unit: "€", isLock: false, live: true },
        { id: "servizi", name: "Servizi", target: 305, unit: "€", isLock: false, live: true },
      ],
    },
    {
      id: "sm_vdf",
      label: "Store Manager",
      op: "Vodafone",
      cls: "vdf",
      base: null,
      locks: 0,
      ready: false,
      tracks: [],
    },
  ];
}

export function defaultConfig(year: number): IncentivazioneConfig {
  return {
    catAcc: [...DEFAULT_CAT_ACC],
    catServ: [...DEFAULT_CAT_SERV],
    holidays: italianHolidays(year),
    sections: defaultSections(),
  };
}

/** Merge config salvata con i default (back-compat se mancano campi). */
export function normalizeConfig(raw: unknown, year: number): IncentivazioneConfig {
  const def = defaultConfig(year);
  if (!raw || typeof raw !== "object") return def;
  const c = raw as Partial<IncentivazioneConfig>;
  return {
    catAcc: Array.isArray(c.catAcc) && c.catAcc.length ? c.catAcc.map(Number) : def.catAcc,
    catServ: Array.isArray(c.catServ) && c.catServ.length ? c.catServ.map(Number) : def.catServ,
    holidays: Array.isArray(c.holidays) && c.holidays.length ? c.holidays.slice() : def.holidays,
    sections: Array.isArray(c.sections) && c.sections.length ? (c.sections as Section[]) : def.sections,
  };
}

// ── Calendario giorni lavorativi ────────────────────────────────────────────
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Pasqua (algoritmo di Gauss/Meeus) -> Date del giorno di Pasqua. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Festività italiane (nazionali fisse + Lunedì dell'Angelo) per l'anno. */
export function italianHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);
  const fixed = [
    `${year}-01-01`,
    `${year}-01-06`,
    `${year}-04-25`,
    `${year}-05-01`,
    `${year}-06-02`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-12-08`,
    `${year}-12-25`,
    `${year}-12-26`,
    toISO(easter),
    toISO(easterMonday),
  ];
  return Array.from(new Set(fixed)).sort();
}

function isWorkingDay(d: Date, holidays: Set<string>): boolean {
  const dw = d.getDay();
  if (dw === 0 || dw === 6) return false;
  return !holidays.has(toISO(d));
}

function countWorkingDays(year: number, monthIdx: number, upToDay: number, holidays: Set<string>): number {
  let c = 0;
  const d = new Date(year, monthIdx, 1);
  const end = new Date(year, monthIdx, upToDay);
  while (d <= end) {
    if (isWorkingDay(d, holidays)) c++;
    d.setDate(d.getDate() + 1);
  }
  return c;
}

/**
 * Calcola il calendario della gara per (year, month1..12).
 * `today` di default = oggi (cappato all'ultimo giorno del mese di gara).
 */
export function buildCalendar(year: number, month1: number, holidaysList: string[], now: Date = new Date()): CalendarInfo {
  const monthIdx = month1 - 1;
  const holidays = new Set(holidaysList);
  const monthStart = new Date(year, monthIdx, 1);
  const garaEnd = new Date(year, monthIdx + 1, 0);
  const lastDay = garaEnd.getDate();
  // Giorno "corrente" clampato dentro il mese selezionato: prima dell'inizio
  // del mese => 0 giorni trascorsi (mese futuro), dopo la fine => tutto il
  // mese (mese passato), altrimenti il giorno effettivo.
  let elapsedDay: number;
  if (now < monthStart) elapsedDay = 0;
  else if (now > garaEnd) elapsedDay = lastDay;
  else elapsedDay = now.getDate();
  const tot = countWorkingDays(year, monthIdx, lastDay, holidays);
  const el = elapsedDay === 0 ? 0 : countWorkingDays(year, monthIdx, elapsedDay, holidays);
  const rem = tot - el;
  const pct = tot === 0 ? 0 : Math.round((el / tot) * 100);
  const mult = el === 0 ? 0 : tot / el;
  const toDate = elapsedDay === 0 ? monthStart : new Date(year, monthIdx, elapsedDay);
  return {
    el,
    tot,
    rem,
    pct,
    mult,
    from: `${year}-${pad(month1)}-01`,
    to: toISO(toDate),
  };
}

// ── Proiezione & semaforo ───────────────────────────────────────────────────
export function normN(n: unknown): string {
  return String(n || "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function projV(v: number | null, cal: CalendarInfo): number | null {
  return v === null || cal.el === 0 ? null : (v / cal.el) * cal.tot;
}

export function semOf(v: number | null, target: number, cal: CalendarInfo): Semaforo {
  if (v === null) return "u";
  if (v >= target) return "g";
  const p = projV(v, cal);
  return p !== null && p >= target ? "a" : "r";
}

const STATUS_ORDER: Record<Semaforo, number> = { r: 0, a: 1, g: 2, u: 1 };

/**
 * Costruisce gli addetti unendo le righe valenze con i dati live BiSuite
 * (Accessori/Servizi) e calcolando proiezione/semaforo/stato per ciascuno.
 */
export function buildEmps(
  tracks: Track[],
  rows: ValenzaRow[],
  live: LiveAddetto[],
  cal: CalendarInfo,
): Employee[] {
  const lm: Record<string, { acc: number; serv: number }> = {};
  for (const e of live) lm[normN(e.name)] = { acc: e.acc, serv: e.serv };

  const emps = rows.map((r) => {
    const liveEntry = lm[normN(r.name)];
    const merged: Record<string, number | null | string> = {
      ...r,
      accessori: liveEntry ? liveEntry.acc : (r.accessori ?? null),
      servizi: liveEntry ? liveEntry.serv : (r.servizi ?? null),
    };
    const tds: Record<string, TrackDatum> = {};
    for (const t of tracks) {
      const raw = merged[t.id];
      const v = raw !== undefined && raw !== null && raw !== "" ? parseFloat(String(raw)) : null;
      const vv = v !== null && !Number.isNaN(v) ? v : null;
      tds[t.id] = { actual: vv, proj: projV(vv, cal), sem: semOf(vv, t.target, cal), target: t.target };
    }
    const locks: LockDatum[] = tracks
      .filter((t) => t.isLock && !t.sub)
      .map((t) => ({ id: t.id, name: t.name, sem: tds[t.id]?.sem || "u" }));
    const ks = tracks
      .filter((t) => !t.sub)
      .map((t) => tds[t.id]?.sem)
      .filter((s): s is Semaforo => !!s && s !== "u");
    const status: Semaforo =
      ks.length === 0 ? "u" : ks.every((s) => s === "g") ? "g" : ks.every((s) => s !== "r") ? "a" : "r";
    const unlockProjected = locks.length > 0 && locks.every((l) => l.sem === "g" || l.sem === "a");
    return { name: String(r.name), tds, locks, status, unlockProjected };
  });

  return emps.sort((a, b) => (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0));
}

// ── Ordinamento addetti ─────────────────────────────────────────────────────
/** Criterio di ordinamento: "status" (semaforo) oppure l'id di una pista. */
export type IncSortKey = "status" | string;
/** Direzione: "asc" crescente ↑, "desc" decrescente ↓. */
export type IncSortDir = "asc" | "desc";

/**
 * Riordina (immutabile) gli addetti secondo il criterio scelto.
 * - "status": ordine semaforo; "desc" (default) = peggiori prima, identico a
 *   `buildEmps` (sort STABILE: a parità di stato si conserva l'ordine di
 *   ingresso, niente riordino per nome), "asc" = migliori prima.
 * - pista: chiave = valore attuale dell'addetto per quella pista (proiezione
 *   come tie-break); "desc" = valori più alti prima, "asc" = più bassi prima.
 * Gli addetti senza valore per la pista finiscono SEMPRE in coda,
 * indipendentemente dalla direzione. Tie-break finale per nome (it-IT) solo
 * per le piste (nessun ordinamento pregresso da preservare).
 */
export function sortEmps(
  emps: Employee[],
  key: IncSortKey,
  dir: IncSortDir,
): Employee[] {
  const arr = [...emps];
  const byName = (a: Employee, b: Employee) => a.name.localeCompare(b.name, "it");
  if (key === "status") {
    // Sort stabile: a parità di stato l'ordine di ingresso è preservato, così
    // "Stato/desc" coincide esattamente con l'ordinamento di `buildEmps`.
    arr.sort((a, b) => {
      const d = (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0);
      return dir === "desc" ? d : -d;
    });
    return arr;
  }
  const factor = dir === "desc" ? -1 : 1;
  arr.sort((a, b) => {
    const av = a.tds[key]?.actual ?? null;
    const bv = b.tds[key]?.actual ?? null;
    if (av === null && bv === null) return byName(a, b);
    if (av === null) return 1; // valori mancanti sempre in coda
    if (bv === null) return -1;
    if (av !== bv) return (av - bv) * factor;
    const ap = a.tds[key]?.proj ?? null;
    const bp = b.tds[key]?.proj ?? null;
    if (ap !== null && bp !== null && ap !== bp) return (ap - bp) * factor;
    return byName(a, b);
  });
  return arr;
}

// ── Formattazione ───────────────────────────────────────────────────────────
export function fmtV(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "€") return Math.round(v).toLocaleString("it-IT") + "€";
  return Math.round(v * 10) / 10 + " " + unit;
}

// ── Parsing Excel valenze (colonna -> trackId) ──────────────────────────────
/** Converte lettera colonna ("A","B"..."AA") in indice 0-based. */
export function colIdx(letter: string): number {
  let i = 0;
  for (const c of letter.toUpperCase()) i = i * 26 + (c.charCodeAt(0) - 64);
  return i - 1;
}

/**
 * Costruisce le righe valenze da un AOA (array di array) letto da SheetJS.
 * Per ogni track con `excelCol` usa la colonna esplicita; altrimenti prova un
 * match per keyword sull'header (utile per i template VDF senza posizioni fisse).
 */
export function parseValenzeAoa(aoa: unknown[][], tracks: Track[]): ValenzaRow[] {
  if (!aoa || aoa.length < 2) return [];
  const header = (aoa[0] || []).map((h) => String(h ?? "").trim().toLowerCase());
  const cmap: Record<string, number> = {};
  const used = new Set<number>([0]);

  for (const t of tracks) {
    if (t.live) continue; // accessori/servizi arrivano dal connettore
    if (t.excelCol) {
      cmap[t.id] = colIdx(t.excelCol);
      used.add(cmap[t.id]);
      continue;
    }
    // keyword fallback: cerca header che contiene id o nome
    const hints = [t.id.replace(/_/g, " "), t.name.toLowerCase()];
    for (let ci = 0; ci < header.length; ci++) {
      if (used.has(ci)) continue;
      const h = header[ci].replace(/^pista\s+/, "");
      if (!h) continue; // colonna separatore senza header: mai un match (hint.includes("") sarebbe sempre true)
      if (hints.some((hint) => h === hint || h.includes(hint) || hint.includes(h))) {
        cmap[t.id] = ci;
        used.add(ci);
        break;
      }
    }
  }

  return aoa
    .slice(1)
    .filter((r) => String(r?.[0] ?? "").trim() && !/^totale$|^media$/i.test(String(r[0]).trim()))
    .map((r) => {
      const row: ValenzaRow = { name: String(r[0] ?? "N/D").trim() };
      for (const [tid, ci] of Object.entries(cmap)) {
        const cell = r[ci];
        row[tid] = cell !== undefined && cell !== "" && cell !== null
          ? parseFloat(String(cell).replace(",", ".")) || 0
          : null;
      }
      return row;
    });
}

export const SECTION_IDS = ["ss_w3", "sm_w3", "ss_vdf", "sm_vdf"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
