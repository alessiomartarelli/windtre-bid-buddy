// Modulo Gestione DTS (Task #321): logica PURA per il parsing dell'Excel
// dei lead drive-to-store e per le aggregazioni di report (conversioni,
// incidenza sulle vendite BiSuite per negozio/pista/categoria/prodotto,
// report per consulente). Nessun import runtime oltre alla classificazione
// condivisa: caricabile via loader tsx nei test senza dev server né DB.
import {
  classifySaleArticles,
  type ArticleType,
  type PistaCanvass,
} from "./bisuiteClassification";

// ---------------------------------------------------------------------------
// Parsing Excel (colonne fisse, identiche per VF e W3)
// ---------------------------------------------------------------------------

/** Intestazioni richieste nel file Excel dei lead DTS (ordine libero). */
export const DTS_REQUIRED_HEADERS = [
  "Source.Name",
  "CAMPAGNA",
  "NOMINATIVO",
  "EMAIL",
  "CODICE FISCALE",
  "TELEFONO",
  "IN CARICO",
  "STATO",
  "DATA",
  "ID VENDITA",
  "ADDETTO VENDITA",
  "ORIGINE LEAD",
] as const;

/** Lead DTS normalizzato (una riga dell'Excel). */
export interface DtsLead {
  /** Chiave stabile del lead (dedup su re-upload). */
  leadKey: string;
  /** Consulente che ha fissato il DTS (da Source.Name, senza estensione). */
  consulente: string;
  campagna: string;
  nominativo: string;
  email: string;
  codiceFiscale: string;
  telefono: string;
  inCarico: string;
  stato: string;
  /** Data del DTS in formato YYYY-MM-DD (da gg/mm/aaaa); null se assente. */
  data: string | null;
  /** ID vendita BiSuite quando il DTS è stato scaricato in cassa. */
  idVendita: number | null;
  addettoVendita: string;
  origineLead: string;
}

/**
 * Normalizza il consulente da `Source.Name`: rimuove l'estensione file
 * (".csv", ".xlsx", ...) e gli spazi in eccesso. "DALIA BOLES.csv" ⇒
 * "DALIA BOLES".
 */
export function normalizeConsulente(sourceName: unknown): string {
  return String(sourceName ?? "")
    .trim()
    .replace(/\.(csv|xlsx?|txt)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Data italiana gg/mm/aaaa ⇒ YYYY-MM-DD. Accetta anche il seriale Excel
 * (numero di giorni dal 1900) e stringhe già in formato ISO. Non
 * riconoscibile ⇒ null.
 */
export function parseDtsDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Seriale Excel (epoca 1899-12-30, bug 1900 incluso nel -25569).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) {
    const dd = +m[1];
    const mm = +m[2];
    const yyyy = +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** ID VENDITA ⇒ intero positivo o null (vuoto/non numerico). */
export function parseIdVendita(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Chiave stabile del lead per il merge idempotente su re-upload: data +
 * miglior identificativo della persona (telefono, poi codice fiscale, poi
 * nominativo) + campagna, tutto normalizzato. Due export dello stesso lead
 * producono la stessa chiave anche se cambia lo STATO o arriva l'ID VENDITA.
 */
export function dtsLeadKey(l: {
  data: string | null;
  telefono: string;
  codiceFiscale: string;
  nominativo: string;
  campagna: string;
}): string {
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
  const who = norm(l.telefono) || norm(l.codiceFiscale) || norm(l.nominativo);
  return `${l.data ?? ""}|${who}|${norm(l.campagna)}`;
}

export interface DtsHeaderValidation {
  ok: boolean;
  /** Intestazioni richieste non trovate (per il messaggio d'errore). */
  missing: string[];
}

/** Verifica che l'header del file contenga tutte le colonne richieste. */
export function validateDtsHeaders(headers: unknown[]): DtsHeaderValidation {
  const set = new Set(headers.map((h) => String(h ?? "").trim().toUpperCase()));
  const missing = DTS_REQUIRED_HEADERS.filter((h) => !set.has(h.toUpperCase()));
  return { ok: missing.length === 0, missing: [...missing] };
}

export interface DtsParseResult {
  leads: DtsLead[];
  /** Righe scartate perché vuote o senza dati identificativi. */
  skipped: number;
}

/**
 * Converte la matrice del foglio (prima riga = header) in lead normalizzati.
 * Righe completamente vuote o senza alcun identificativo (nominativo,
 * telefono, codice fiscale) sono scartate. Lead duplicati (stessa chiave)
 * si fondono: vince l'ultima riga, ma un ID VENDITA presente non viene mai
 * sovrascritto da uno vuoto.
 */
export function parseDtsRows(matrix: unknown[][]): DtsParseResult {
  if (matrix.length === 0) return { leads: [], skipped: 0 };
  const headers = matrix[0].map((h) => String(h ?? "").trim().toUpperCase());
  const idx = (name: string) => headers.indexOf(name.toUpperCase());
  const col = {
    source: idx("Source.Name"),
    campagna: idx("CAMPAGNA"),
    nominativo: idx("NOMINATIVO"),
    email: idx("EMAIL"),
    cf: idx("CODICE FISCALE"),
    telefono: idx("TELEFONO"),
    inCarico: idx("IN CARICO"),
    stato: idx("STATO"),
    data: idx("DATA"),
    idVendita: idx("ID VENDITA"),
    addetto: idx("ADDETTO VENDITA"),
    origine: idx("ORIGINE LEAD"),
  };
  const cell = (row: unknown[], i: number): unknown => (i >= 0 ? row[i] : undefined);
  const str = (row: unknown[], i: number): string => String(cell(row, i) ?? "").trim();

  const byKey = new Map<string, DtsLead>();
  let skipped = 0;
  for (const row of matrix.slice(1)) {
    if (!Array.isArray(row) || row.length === 0) {
      skipped++;
      continue;
    }
    const nominativo = str(row, col.nominativo);
    const telefono = str(row, col.telefono);
    const codiceFiscale = str(row, col.cf);
    if (!nominativo && !telefono && !codiceFiscale) {
      skipped++;
      continue;
    }
    const base = {
      consulente: normalizeConsulente(cell(row, col.source)),
      campagna: str(row, col.campagna),
      nominativo,
      email: str(row, col.email),
      codiceFiscale,
      telefono,
      inCarico: str(row, col.inCarico),
      stato: str(row, col.stato),
      data: parseDtsDate(cell(row, col.data)),
      idVendita: parseIdVendita(cell(row, col.idVendita)),
      addettoVendita: str(row, col.addetto),
      origineLead: str(row, col.origine),
    };
    const leadKey = dtsLeadKey(base);
    const prev = byKey.get(leadKey);
    byKey.set(leadKey, {
      ...base,
      leadKey,
      idVendita: base.idVendita ?? prev?.idVendita ?? null,
    });
  }
  return { leads: Array.from(byKey.values()), skipped };
}

/**
 * Merge idempotente per il re-upload: i lead nuovi sovrascrivono quelli
 * esistenti con la stessa chiave (lo STATO/ID VENDITA si aggiornano), ma un
 * ID VENDITA già noto non viene mai perso se il nuovo export lo ha vuoto.
 */
export function mergeDtsLeads(existing: DtsLead[], incoming: DtsLead[]): DtsLead[] {
  const byKey = new Map<string, DtsLead>(existing.map((l) => [l.leadKey, l]));
  for (const l of incoming) {
    const prev = byKey.get(l.leadKey);
    byKey.set(l.leadKey, {
      ...l,
      idVendita: l.idVendita ?? prev?.idVendita ?? null,
    });
  }
  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Aggregazioni report
// ---------------------------------------------------------------------------

/** Vendita BiSuite nella forma minima necessaria al report DTS. */
export interface DtsSaleRow {
  bisuiteId: number;
  stato: string | null;
  codicePos: string | null;
  nomeNegozio: string | null;
  nomeAddetto?: string | null;
  rawData: unknown;
}

/** Conteggio DTS vs totale, con incidenza percentuale (0-100, 1 decimale). */
export interface DtsIncidenza {
  dts: number;
  totale: number;
  /** dts/totale in %, null se totale = 0. */
  incidenzaPct: number | null;
}

function incid(dts: number, totale: number): DtsIncidenza {
  return {
    dts,
    totale,
    incidenzaPct: totale > 0 ? Math.round((dts / totale) * 1000) / 10 : null,
  };
}

export interface DtsNegozioAggregate {
  codicePos: string;
  nomeNegozio: string;
  /** Vendite (scontrini) del negozio: DTS vs totali. */
  vendite: DtsIncidenza;
  /** Pezzi canvass per pista: DTS vs totali del negozio. */
  perPista: Partial<Record<PistaCanvass, DtsIncidenza>>;
}

export interface DtsConsulenteAggregate {
  consulente: string;
  /** DTS fissati (lead totali). */
  fissati: number;
  /** DTS con vendita agganciata (ID VENDITA presente fra le vendite). */
  convertiti: number;
  /** convertiti/fissati in %, null se fissati = 0. */
  tassoPct: number | null;
}

export interface DtsNamedIncidenza extends DtsIncidenza {
  nome: string;
}

export interface DtsReportAggregates {
  /** Lead DTS considerati (dopo i filtri). */
  totaleLead: number;
  /** Lead con ID VENDITA valorizzato nell'Excel. */
  leadConIdVendita: number;
  /** Lead la cui vendita è stata trovata fra le vendite BiSuite. */
  leadConvertiti: number;
  /** leadConvertiti/totaleLead in %, null se nessun lead. */
  conversionePct: number | null;
  /** Vendite del periodo: da DTS vs totali (ANNULLATA escluse). */
  vendite: DtsIncidenza;
  /** Pezzi canvass per pista: da vendite DTS vs totali. */
  perPista: Partial<Record<PistaCanvass, DtsIncidenza>>;
  /** Pezzi per categoria canvass (es. UNTIED, RIVINCOLO): DTS vs totali. */
  perCategoriaCanvass: DtsNamedIncidenza[];
  /** Pezzi per categoria prodotto (es. TELEFONIA, ACCESSORI): DTS vs totali. */
  perProdotto: DtsNamedIncidenza[];
  /** Incidenza per negozio, ordinata per vendite DTS ↓ poi totali ↓. */
  perNegozio: DtsNegozioAggregate[];
  /** Report per consulente, ordinato per fissati ↓. */
  perConsulente: DtsConsulenteAggregate[];
}

/** Filtri del report DTS (applicati ai lead). */
export interface DtsLeadFilters {
  /** Mese YYYY-MM sulla colonna DATA del lead. */
  month?: string | null;
  consulente?: string | null;
}

/** Applica i filtri mese (YYYY-MM su DATA) e consulente ai lead. */
export function filterDtsLeads(leads: DtsLead[], filters?: DtsLeadFilters | null): DtsLead[] {
  const month = (filters?.month ?? "").trim();
  const consulente = (filters?.consulente ?? "").trim().toUpperCase();
  return leads.filter((l) => {
    if (month && (l.data ?? "").slice(0, 7) !== month) return false;
    if (consulente && l.consulente.trim().toUpperCase() !== consulente) return false;
    return true;
  });
}

function isAnnullata(stato: string | null | undefined): boolean {
  return (stato ?? "").trim().toUpperCase() === "ANNULLATA";
}

/**
 * Aggregato del report DTS: incrocia i lead (già filtrati per mese e/o
 * consulente) con le vendite BiSuite del periodo via ID VENDITA ↔
 * `bisuiteId`. Le vendite ANNULLATA sono escluse da tutti i conteggi. Il
 * filtro negozio (`codicePos`) agisce sulle vendite (i lead non hanno il
 * negozio) e quindi su incidenza e conversioni.
 */
export function aggregateDtsReport(
  leads: DtsLead[],
  sales: DtsSaleRow[],
  opts?: { codicePos?: string | null },
): DtsReportAggregates {
  const codicePosFilter = (opts?.codicePos ?? "").trim();
  const activeSales = sales.filter(
    (s) =>
      !isAnnullata(s.stato) &&
      (!codicePosFilter || (s.codicePos ?? "").trim() === codicePosFilter),
  );
  const dtsIds = new Set<number>();
  for (const l of leads) {
    if (l.idVendita !== null) dtsIds.add(l.idVendita);
  }
  const matchedIds = new Set<number>();
  for (const s of activeSales) {
    if (dtsIds.has(s.bisuiteId)) matchedIds.add(s.bisuiteId);
  }

  // Lead KPI + per consulente.
  let leadConIdVendita = 0;
  let leadConvertiti = 0;
  const consMap = new Map<string, { consulente: string; fissati: number; convertiti: number }>();
  for (const l of leads) {
    const key = l.consulente.trim().toUpperCase() || "N/D";
    let c = consMap.get(key);
    if (!c) {
      c = { consulente: l.consulente.trim() || "N/D", fissati: 0, convertiti: 0 };
      consMap.set(key, c);
    }
    c.fissati++;
    if (l.idVendita !== null) {
      leadConIdVendita++;
      if (matchedIds.has(l.idVendita)) {
        leadConvertiti++;
        c.convertiti++;
      }
    }
  }

  // Vendite: totali vs DTS, per negozio/pista/categoria/prodotto.
  let venditeTot = 0;
  let venditeDts = 0;
  const pistaTot: Partial<Record<PistaCanvass, number>> = {};
  const pistaDts: Partial<Record<PistaCanvass, number>> = {};
  const catCanvass = new Map<string, { dts: number; totale: number }>();
  const catProdotti = new Map<string, { dts: number; totale: number }>();
  interface NegAcc {
    codicePos: string;
    nomeNegozio: string;
    venditeTot: number;
    venditeDts: number;
    pistaTot: Partial<Record<PistaCanvass, number>>;
    pistaDts: Partial<Record<PistaCanvass, number>>;
  }
  const negMap = new Map<string, NegAcc>();

  for (const s of activeSales) {
    const isDts = dtsIds.has(s.bisuiteId);
    venditeTot++;
    if (isDts) venditeDts++;
    const posKey = (s.codicePos ?? "").trim() || "N/D";
    let neg = negMap.get(posKey);
    if (!neg) {
      neg = {
        codicePos: posKey,
        nomeNegozio: (s.nomeNegozio ?? "").trim(),
        venditeTot: 0,
        venditeDts: 0,
        pistaTot: {},
        pistaDts: {},
      };
      negMap.set(posKey, neg);
    }
    if (!neg.nomeNegozio && s.nomeNegozio) neg.nomeNegozio = s.nomeNegozio.trim();
    neg.venditeTot++;
    if (isDts) neg.venditeDts++;

    const sc = classifySaleArticles(s.rawData);
    for (const art of sc.articles) {
      if (art.pista) {
        pistaTot[art.pista] = (pistaTot[art.pista] ?? 0) + 1;
        neg.pistaTot[art.pista] = (neg.pistaTot[art.pista] ?? 0) + 1;
        if (isDts) {
          pistaDts[art.pista] = (pistaDts[art.pista] ?? 0) + 1;
          neg.pistaDts[art.pista] = (neg.pistaDts[art.pista] ?? 0) + 1;
        }
      }
      if (art.type === "canvass") {
        const label = art.categoriaNome.trim() || "Altro";
        const e = catCanvass.get(label) ?? { dts: 0, totale: 0 };
        e.totale++;
        if (isDts) e.dts++;
        catCanvass.set(label, e);
      } else if (art.type === "prodotti") {
        const label = art.categoriaNome.trim() || "Altro";
        const e = catProdotti.get(label) ?? { dts: 0, totale: 0 };
        e.totale++;
        if (isDts) e.dts++;
        catProdotti.set(label, e);
      }
    }
  }

  const perPista: Partial<Record<PistaCanvass, DtsIncidenza>> = {};
  for (const p of Object.keys(pistaTot) as PistaCanvass[]) {
    perPista[p] = incid(pistaDts[p] ?? 0, pistaTot[p] ?? 0);
  }
  const namedList = (m: Map<string, { dts: number; totale: number }>): DtsNamedIncidenza[] =>
    Array.from(m.entries())
      .map(([nome, v]) => ({ nome, ...incid(v.dts, v.totale) }))
      .sort((a, b) => b.dts - a.dts || b.totale - a.totale || a.nome.localeCompare(b.nome, "it"));

  const perNegozio: DtsNegozioAggregate[] = Array.from(negMap.values())
    .map((n) => {
      const pp: Partial<Record<PistaCanvass, DtsIncidenza>> = {};
      for (const p of Object.keys(n.pistaTot) as PistaCanvass[]) {
        pp[p] = incid(n.pistaDts[p] ?? 0, n.pistaTot[p] ?? 0);
      }
      return {
        codicePos: n.codicePos,
        nomeNegozio: n.nomeNegozio,
        vendite: incid(n.venditeDts, n.venditeTot),
        perPista: pp,
      };
    })
    .sort(
      (a, b) =>
        b.vendite.dts - a.vendite.dts ||
        b.vendite.totale - a.vendite.totale ||
        a.codicePos.localeCompare(b.codicePos, "it"),
    );

  const perConsulente: DtsConsulenteAggregate[] = Array.from(consMap.values())
    .map((c) => ({
      consulente: c.consulente,
      fissati: c.fissati,
      convertiti: c.convertiti,
      tassoPct: c.fissati > 0 ? Math.round((c.convertiti / c.fissati) * 1000) / 10 : null,
    }))
    .sort(
      (a, b) =>
        b.fissati - a.fissati ||
        b.convertiti - a.convertiti ||
        a.consulente.localeCompare(b.consulente, "it"),
    );

  return {
    totaleLead: leads.length,
    leadConIdVendita,
    leadConvertiti,
    conversionePct:
      leads.length > 0 ? Math.round((leadConvertiti / leads.length) * 1000) / 10 : null,
    vendite: incid(venditeDts, venditeTot),
    perPista,
    perCategoriaCanvass: namedList(catCanvass),
    perProdotto: namedList(catProdotti),
    perNegozio,
    perConsulente,
  };
}

/** Mesi (YYYY-MM) presenti nei lead, ordinati dal più recente. */
export function dtsAvailableMonths(leads: DtsLead[]): string[] {
  const set = new Set<string>();
  for (const l of leads) {
    if (l.data) set.add(l.data.slice(0, 7));
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

/** Etichetta italiana di un mese YYYY-MM (es. "luglio 2026"). */
export function dtsMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) return month;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  return d.toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
}
