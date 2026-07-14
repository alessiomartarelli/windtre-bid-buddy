// Categorizzazione delle vendite BiSuite canvass Vodafone/Fastweb.
//
// Modulo PURO (nessun import di React/HTTP/xlsx): dato un articolo BiSuite,
// risolve pista/categoria/tipologia/canone incrociando il `codice` articolo
// con il listino canvass (chiave primaria di match), con fallback su
// offerId (i 5 char centrali del codice) e su categoria/tipologia.
//
// È tenuto SEPARATO dal motore WindTre (`shared/bisuiteMapping.ts` +
// `shared/bisuiteClassification.ts`): le piste canvass Vodafone non
// coincidono con l'enum `GaraPista` WindTre, quindi qui pista/categoria/
// tipologia restano stringhe libere prese dal listino. Nessuna modifica al
// comportamento WindTre.

export type CanvassBrand = "vodafone" | "fastweb";

export interface CanvassOffer {
  /** Codice completo a 12 char, es. "CANOHEWD2208". */
  codice: string;
  /** I 5 char centrali del codice (CAN·····dddd), es. "OHEWD"; null se il codice non ha il formato atteso. */
  offerId: string | null;
  nomeEtichetta: string;
  /** Etichetta pista grezza dal listino, es. "PISTA MOBILE", "ENERGIA VODAFONE". */
  pista: string;
  categoria: string;
  tipologia: string;
  canone: number;
  brand: CanvassBrand;
}

export interface CanvassStep {
  externalId: number | null;
  pistaAssociata: string;
  pistaForm: string;
  domanda: string;
  ordine: number | null;
  attivo: boolean;
  brand: string;
}

export interface CanvassReference {
  /** Periodo del listino, es. "LUGLIO 2026". */
  periodo: string;
  offers: CanvassOffer[];
  steps: CanvassStep[];
}

export type CanvassMatchType = "codice" | "offerId" | "catTip";

export interface CanvassMatch {
  matchType: CanvassMatchType;
  pista: string;
  categoria: string;
  tipologia: string;
  canone: number;
  nomeEtichetta: string;
  brand: CanvassBrand;
  /** L'offerta del listino che ha prodotto il match (assente per il fallback catTip). */
  offer?: CanvassOffer;
}

export interface CanvassIndex {
  byCodice: Map<string, CanvassOffer>;
  byOfferId: Map<string, CanvassOffer>;
  /** Solo chiavi categoria|tipologia NON ambigue (una sola pista). */
  byCatTip: Map<string, CanvassOffer>;
  offersCount: number;
}

/** Normalizza un codice: uppercase, senza spazi. */
export function normalizeCodice(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/\s+/g, "").trim();
}

/** Estrae i 5 char centrali del codice CAN·····dddd; null se il formato non combacia. */
export function extractOfferId(codice: unknown): string | null {
  const c = normalizeCodice(codice);
  return /^CAN.{5}\d{4}$/.test(c) ? c.slice(3, 8) : null;
}

/** Deriva il brand dal nome della pista del listino. */
export function deriveBrandFromPista(pista: string): CanvassBrand {
  return /FASTWEB/i.test(pista) ? "fastweb" : "vodafone";
}

function catTipKey(categoria: unknown, tipologia: unknown): string {
  return `${String(categoria ?? "").toUpperCase().trim()}|||${String(tipologia ?? "").toUpperCase().trim()}`;
}

/**
 * Costruisce gli indici di lookup dal listino. `byCatTip` include solo le
 * coppie categoria|tipologia che mappano a un'UNICA pista: le combinazioni
 * ambigue (es. "FASTWEB ENERGIA|LUCE FASTWEB" presente sia in ENERGIA
 * FASTWEB che ENERGIA VODAFONE) vengono escluse per non indovinare.
 */
export function buildCanvassIndex(offers: CanvassOffer[]): CanvassIndex {
  const byCodice = new Map<string, CanvassOffer>();
  const byOfferId = new Map<string, CanvassOffer>();
  const catTipPistas = new Map<string, Set<string>>();
  const catTipFirst = new Map<string, CanvassOffer>();

  for (const offer of offers) {
    const codice = normalizeCodice(offer.codice);
    if (codice && !byCodice.has(codice)) byCodice.set(codice, offer);
    if (offer.offerId && !byOfferId.has(offer.offerId)) byOfferId.set(offer.offerId, offer);
    const key = catTipKey(offer.categoria, offer.tipologia);
    if (!catTipPistas.has(key)) {
      catTipPistas.set(key, new Set());
      catTipFirst.set(key, offer);
    }
    catTipPistas.get(key)!.add(offer.pista);
  }

  const byCatTip = new Map<string, CanvassOffer>();
  for (const [key, pistas] of catTipPistas.entries()) {
    if (pistas.size === 1) byCatTip.set(key, catTipFirst.get(key)!);
  }

  return { byCodice, byOfferId, byCatTip, offersCount: offers.length };
}

/** Forma minima di un articolo BiSuite necessaria alla categorizzazione. */
export interface BiSuiteArticleLike {
  codice?: unknown;
  categoria?: { nome?: unknown } | null;
  tipologia?: { nome?: unknown } | null;
  descrizione?: unknown;
}

function matchFromOffer(offer: CanvassOffer, matchType: CanvassMatchType): CanvassMatch {
  return {
    matchType,
    pista: offer.pista,
    categoria: offer.categoria,
    tipologia: offer.tipologia,
    canone: offer.canone,
    nomeEtichetta: offer.nomeEtichetta,
    brand: offer.brand,
    offer,
  };
}

/**
 * Categorizza un articolo BiSuite contro il listino canvass.
 * Ordine di risoluzione: 1) codice esatto, 2) offerId (5 char centrali),
 * 3) categoria+tipologia (solo se non ambigua). Restituisce null se nessun
 * criterio combacia (→ codice non mappato).
 */
export function categorizeCanvassArticle(
  article: BiSuiteArticleLike,
  index: CanvassIndex,
): CanvassMatch | null {
  const codice = normalizeCodice(article.codice);
  if (codice) {
    const exact = index.byCodice.get(codice);
    if (exact) return matchFromOffer(exact, "codice");
    const offerId = extractOfferId(codice);
    if (offerId) {
      const byOid = index.byOfferId.get(offerId);
      if (byOid) return matchFromOffer(byOid, "offerId");
    }
  }
  const key = catTipKey(article.categoria?.nome, article.tipologia?.nome);
  const byCatTip = index.byCatTip.get(key);
  if (byCatTip) return matchFromOffer(byCatTip, "catTip");
  return null;
}

export interface CanvassAggregatedItem {
  pista: string;
  categoria: string;
  tipologia: string;
  pezzi: number;
  canone: number;
}

export interface CanvassUnmappedItem {
  codice: string;
  categoria: string;
  tipologia: string;
  descrizione: string;
  pezzi: number;
}

export interface CanvassAggregation {
  /** Aggregati per pista → categoria → tipologia. */
  byPista: Record<string, Record<string, Record<string, CanvassAggregatedItem>>>;
  items: CanvassAggregatedItem[];
  unmapped: CanvassUnmappedItem[];
  totalArticoli: number;
  totalMapped: number;
  totalUnmapped: number;
  matchCounts: Record<CanvassMatchType, number>;
}

/** Forma minima di una vendita: raccoglie gli articoli dal rawData. */
export interface CanvassSaleLike {
  rawData?: unknown;
}

function extractArticoli(sale: CanvassSaleLike): BiSuiteArticleLike[] {
  const raw = sale.rawData as { articoli?: unknown } | null | undefined;
  const articoli = raw?.articoli;
  return Array.isArray(articoli) ? (articoli as BiSuiteArticleLike[]) : [];
}

/**
 * Aggrega le vendite canvass categorizzandole via listino. Conta i pezzi e
 * somma il canone per pista/categoria/tipologia, e raccoglie i codici non
 * mappati (aggregati per codice) così da poter completare il listino nel tempo.
 */
export function aggregateCanvassSales(
  sales: CanvassSaleLike[],
  index: CanvassIndex,
): CanvassAggregation {
  const byPista: CanvassAggregation["byPista"] = {};
  const unmappedMap = new Map<string, CanvassUnmappedItem>();
  const matchCounts: Record<CanvassMatchType, number> = { codice: 0, offerId: 0, catTip: 0 };
  let totalArticoli = 0;
  let totalMapped = 0;
  let totalUnmapped = 0;

  for (const sale of sales) {
    for (const art of extractArticoli(sale)) {
      totalArticoli++;
      const match = categorizeCanvassArticle(art, index);
      if (match) {
        totalMapped++;
        matchCounts[match.matchType]++;
        const p = (byPista[match.pista] ??= {});
        const c = (p[match.categoria] ??= {});
        const item = (c[match.tipologia] ??= {
          pista: match.pista,
          categoria: match.categoria,
          tipologia: match.tipologia,
          pezzi: 0,
          canone: 0,
        });
        item.pezzi++;
        item.canone += match.canone;
      } else {
        totalUnmapped++;
        const codice = normalizeCodice(art.codice) || "(senza codice)";
        const existing = unmappedMap.get(codice);
        if (existing) {
          existing.pezzi++;
        } else {
          unmappedMap.set(codice, {
            codice,
            categoria: String(art.categoria?.nome ?? "").trim(),
            tipologia: String(art.tipologia?.nome ?? "").trim(),
            descrizione: String(art.descrizione ?? "").trim(),
            pezzi: 1,
          });
        }
      }
    }
  }

  const items: CanvassAggregatedItem[] = [];
  for (const cats of Object.values(byPista)) {
    for (const tips of Object.values(cats)) {
      for (const item of Object.values(tips)) items.push(item);
    }
  }

  const unmapped = Array.from(unmappedMap.values()).sort((a, b) => b.pezzi - a.pezzi);

  return {
    byPista,
    items,
    unmapped,
    totalArticoli,
    totalMapped,
    totalUnmapped,
    matchCounts,
  };
}

/** Riga grezza del foglio "listino" (chiavi = intestazioni di colonna). */
export type CanvassRawRow = Record<string, unknown>;

/** Colonne richieste nel foglio listino offerte canvass. */
export const REQUIRED_LISTINO_COLUMNS = [
  "CODICE",
  "NOME ETICHETTA",
  "PISTA",
  "CATEGORIA",
  "TIPOLOGIA",
  "CANONE",
] as const;

/** Colonne richieste nel foglio step di vendita. */
export const REQUIRED_STEP_COLUMNS = ["Pista FORM", "Domanda"] as const;

export interface CanvassColumnsValidation {
  ok: boolean;
  missingListino: string[];
  missingStep: string[];
}

/**
 * Verifica che i fogli Excel caricati abbiano le colonne attese PRIMA di
 * costruire il reference (Task #305). Le righe arrivano da
 * `XLSX.utils.sheet_to_json(ws, { defval: "" })`, quindi ogni riga contiene
 * tutte le intestazioni come chiavi: si controlla l'unione delle chiavi delle
 * prime righe. Un foglio vuoto conta come "tutte le colonne mancanti".
 */
export function validateCanvassColumns(
  listinoRows: CanvassRawRow[],
  stepRows: CanvassRawRow[],
): CanvassColumnsValidation {
  const collectKeys = (rows: CanvassRawRow[]): Set<string> => {
    const keys = new Set<string>();
    for (const row of rows.slice(0, 25)) {
      for (const k of Object.keys(row)) keys.add(k.trim());
    }
    return keys;
  };
  const listinoKeys = collectKeys(listinoRows);
  const stepKeys = collectKeys(stepRows);
  const missingListino = REQUIRED_LISTINO_COLUMNS.filter((c) => !listinoKeys.has(c));
  const missingStep = REQUIRED_STEP_COLUMNS.filter((c) => !stepKeys.has(c));
  return {
    ok: missingListino.length === 0 && missingStep.length === 0,
    missingListino: [...missingListino],
    missingStep: [...missingStep],
  };
}

/** Converte un canone grezzo (numero o stringa con virgola) in number. */
function parseCanone(raw: unknown): number {
  if (typeof raw === "number") return raw;
  return parseFloat(String(raw ?? "").replace(",", ".")) || 0;
}

/**
 * Costruisce un `CanvassReference` a partire dalle righe grezze dei due fogli
 * Excel (listino offerte + step di vendita), già lette con
 * `XLSX.utils.sheet_to_json(ws, { defval: "" })`.
 *
 * Logica pura, allineata a `scripts/generate-canvass-catalog.mjs`: è tenuta
 * qui in shared/ così sia lo script (baked catalog) sia l'upload da UI
 * producono lo stesso formato. Il brand delle offerte è derivato dalla pista.
 */
export function buildCanvassReferenceFromRows(
  listinoRows: CanvassRawRow[],
  stepRows: CanvassRawRow[],
  periodo: string,
): CanvassReference {
  const offers: CanvassOffer[] = listinoRows
    .filter((r) => String(r["CODICE"] ?? "").trim() !== "")
    .map((r) => {
      const codice = normalizeCodice(r["CODICE"]);
      const pista = String(r["PISTA"] ?? "").trim();
      return {
        codice,
        offerId: extractOfferId(codice),
        nomeEtichetta: String(r["NOME ETICHETTA"] ?? "").trim(),
        pista,
        categoria: String(r["CATEGORIA"] ?? "").trim(),
        tipologia: String(r["TIPOLOGIA"] ?? "").trim(),
        canone: parseCanone(r["CANONE"]),
        brand: deriveBrandFromPista(pista),
      };
    });

  const steps: CanvassStep[] = stepRows
    .filter((r) => String(r["Domanda"] ?? "").trim() !== "")
    .map((r) => ({
      externalId: r["ID"] === "" || r["ID"] == null ? null : Number(r["ID"]),
      pistaAssociata: String(r["Pista Associata"] ?? "").trim(),
      pistaForm: String(r["Pista FORM"] ?? "").trim(),
      domanda: String(r["Domanda"] ?? "").trim(),
      ordine: r["Ordine"] === "" || r["Ordine"] == null ? null : Number(r["Ordine"]),
      attivo: String(r["ATTIVO"] ?? "").trim().toUpperCase() === "S",
      brand: String(r["Brand"] ?? "").trim(),
    }));

  return { periodo: periodo.trim(), offers, steps };
}

export interface CanvassStepGroup {
  pista: string;
  steps: CanvassStep[];
}

/** Raggruppa gli step di vendita per pista FORM, ordinati per `ordine`. */
export function groupStepsByPista(steps: CanvassStep[]): CanvassStepGroup[] {
  const groups = new Map<string, CanvassStep[]>();
  for (const step of steps) {
    const key = step.pistaForm || step.pistaAssociata || "(senza pista)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(step);
  }
  return Array.from(groups.entries())
    .map(([pista, list]) => ({
      pista,
      steps: list.slice().sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)),
    }))
    .sort((a, b) => a.pista.localeCompare(b.pista));
}
