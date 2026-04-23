export interface IncassoTotals {
  contanti: number;
  pos: number;
  finanziato: number;
  var: number;
  nonScontrinato: number;
  nonScontrinatoPos: number;
  bonifici: number;
  assegni: number;
  buoni: number;
  coupon: number;
  altriPagamenti: number;
}

export interface PagamentoRaw {
  contanti?: string | number | null;
  pagamentiElettronici?: string | number | null;
  nonScontrinato?: string | number | null;
  nonScontrinatoPos?: string | number | null;
  bonifici?: string | number | null;
  assegni?: string | number | null;
  buoni?: string | number | null;
  coupon?: string | number | null;
  altriPagamenti?: string | number | null;
}

export interface DettaglioArticoloRaw {
  importoFinanziato?: string | number | null;
  importoCredito?: string | number | null;
  importoScontrino?: string | number | null;
  importoImponibile?: string | number | null;
  aliquotaPrezzo?: string | number | null;
  natura?: string | null;
}

export interface ArticoloRaw {
  tipo?: string | null;
  categoria?: { nome?: string } | null;
  tipologia?: { nome?: string } | null;
  descrizione?: string;
  codice?: string | number;
  codiceArticolo?: string | number;
  dettaglio?: DettaglioArticoloRaw | null;
}

/**
 * Aliquote IVA italiane standard (in percentuale).
 */
export const ALIQUOTE_IVA_STANDARD = [4, 5, 10, 22] as const;

/**
 * Tolleranza in punti percentuali per l'arrotondamento alle aliquote standard.
 * Compensa errori di arrotondamento centesimi sui piccoli importi.
 */
export const ALIQUOTA_TOLERANCE_PP = 0.5;

export type IvaCategoria =
  | "standard"
  | "non_standard"
  | "natura"
  | "da_verificare"
  | "fuori_scontrino";

export interface IvaArticoloCalcolato {
  categoria: IvaCategoria;
  /** Aliquota calcolata grezza dagli importi (può essere qualsiasi valore). */
  aliquotaCalcolata: number;
  /** Aliquota normalizzata: snap a 4/5/10/22 se standard, valore esatto altrimenti. */
  aliquotaNormalizzata: number;
  /** Codice natura (N1-N7) se presente, altrimenti null. */
  naturaCode: string | null;
  imponibile: number;
  imposta: number;
  lordo: number;
}

/**
 * Classifica una riga articolo IVA derivando l'aliquota dagli importi monetari.
 *
 * **Importante**: il campo BiSuite `aliquotaPrezzo` NON contiene la percentuale
 * IVA — ha semantica variabile (a volte codice interno, a volte importo IVA in
 * euro). L'aliquota va sempre calcolata da:
 *   `(importoScontrino − importoImponibile) / importoImponibile × 100`
 * e poi snappata all'aliquota italiana standard (4/5/10/22) se vicina.
 *
 * Categorie:
 * - `fuori_scontrino`: scontrino e imponibile a 0 (canoni / servizi fatturati a parte)
 * - `natura`: campo `natura` valorizzato (N1-N7 = non imponibile/esente/fuori campo IVA)
 * - `da_verificare`: scontrino > 0 ma imponibile = 0 (caso degenere, NON concorre ai totali)
 * - `standard`: aliquota calcolata vicina (±0.5pp) a 4/5/10/22%
 * - `non_standard`: aliquota calcolata fuori fascia standard (anomalia segnalata)
 */
export function classifyIvaArticolo(det: DettaglioArticoloRaw | null | undefined): IvaArticoloCalcolato {
  const d = det || {};
  const importoScontrino = toNum(d.importoScontrino);
  const importoImponibile = toNum(d.importoImponibile);
  const natura = (d.natura ? String(d.natura) : "").trim();

  if (importoScontrino === 0 && importoImponibile === 0) {
    return {
      categoria: "fuori_scontrino",
      aliquotaCalcolata: 0,
      aliquotaNormalizzata: 0,
      naturaCode: natura || null,
      imponibile: 0,
      imposta: 0,
      lordo: 0,
    };
  }

  if (natura) {
    const lordo = importoScontrino || importoImponibile;
    const imp = importoImponibile || importoScontrino;
    return {
      categoria: "natura",
      aliquotaCalcolata: 0,
      aliquotaNormalizzata: 0,
      naturaCode: natura,
      imponibile: imp,
      imposta: 0,
      lordo,
    };
  }

  if (importoScontrino > 0 && importoImponibile === 0) {
    return {
      categoria: "da_verificare",
      aliquotaCalcolata: 0,
      aliquotaNormalizzata: 0,
      naturaCode: null,
      imponibile: 0,
      imposta: 0,
      lordo: importoScontrino,
    };
  }

  const aliquotaCalc = ((importoScontrino - importoImponibile) / importoImponibile) * 100;
  const imposta = importoScontrino - importoImponibile;

  let snapped = -1;
  for (const a of ALIQUOTE_IVA_STANDARD) {
    if (Math.abs(aliquotaCalc - a) <= ALIQUOTA_TOLERANCE_PP) {
      snapped = a;
      break;
    }
  }

  if (snapped >= 0) {
    return {
      categoria: "standard",
      aliquotaCalcolata: aliquotaCalc,
      aliquotaNormalizzata: snapped,
      naturaCode: null,
      imponibile: importoImponibile,
      imposta,
      lordo: importoScontrino,
    };
  }

  return {
    categoria: "non_standard",
    aliquotaCalcolata: aliquotaCalc,
    aliquotaNormalizzata: Math.round(aliquotaCalc * 100) / 100,
    naturaCode: null,
    imponibile: importoImponibile,
    imposta,
    lordo: importoScontrino,
  };
}

/**
 * Indica se l'articolo BiSuite contribuisce alla Prima Nota IVA.
 * Solo `P` (Prodotti) e `S` (Servizi) producono importi nello scontrino fiscale.
 * `C` (Contratti / Canvass) sono procacciamenti fatturati a parte.
 */
export function isArticoloFiscale(art: ArticoloRaw | null | undefined): boolean {
  const tipo = (art?.tipo || "").toUpperCase();
  return tipo === "P" || tipo === "S";
}

export interface NegozioRaw {
  matricolaFiscale?: string | number;
  matricola?: string | number;
}

export interface RawSaleData {
  pagamento?: PagamentoRaw | null;
  articoli?: ArticoloRaw[];
  matricolaFiscale?: string | number;
  matricola_fiscale?: string | number;
  matricola?: string | number;
  negozio?: NegozioRaw | null;
}

export interface SaleWithRaw {
  rawData?: RawSaleData | null;
}

export function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

export function emptyIncassoTotals(): IncassoTotals {
  return {
    contanti: 0, pos: 0, finanziato: 0, var: 0,
    nonScontrinato: 0, nonScontrinatoPos: 0,
    bonifici: 0, assegni: 0, buoni: 0, coupon: 0, altriPagamenti: 0,
  };
}

export function computeIncassoTotals(salesList: SaleWithRaw[]): IncassoTotals {
  const t = emptyIncassoTotals();
  for (const sale of salesList) {
    const pag = sale.rawData?.pagamento;
    if (pag) {
      t.contanti += toNum(pag.contanti);
      t.pos += toNum(pag.pagamentiElettronici);
      t.nonScontrinato += toNum(pag.nonScontrinato);
      t.nonScontrinatoPos += toNum(pag.nonScontrinatoPos);
      t.bonifici += toNum(pag.bonifici);
      t.assegni += toNum(pag.assegni);
      t.buoni += toNum(pag.buoni);
      t.coupon += toNum(pag.coupon);
      t.altriPagamenti += toNum(pag.altriPagamenti);
    }
    const articoli = sale.rawData?.articoli;
    if (Array.isArray(articoli)) {
      for (const art of articoli) {
        const det = art?.dettaglio;
        if (!det) continue;
        const impFinanziato = toNum(det.importoFinanziato);
        const impCredito = toNum(det.importoCredito);
        if (impFinanziato > 0) t.finanziato += impFinanziato;
        if (impCredito > 0) t.var += impCredito;
      }
    }
  }
  return t;
}

/**
 * Conteggia quanti scontrini contribuiscono a ciascun metodo di pagamento
 * (cioè per cui il relativo importo è > 0). Per finanziato/var basta che
 * almeno un articolo dello scontrino abbia importoFinanziato/importoCredito > 0.
 */
export function computeIncassoCounts(salesList: SaleWithRaw[]): IncassoTotals {
  const c = emptyIncassoTotals();
  for (const sale of salesList) {
    const pag = sale.rawData?.pagamento;
    if (pag) {
      if (toNum(pag.contanti) > 0) c.contanti += 1;
      if (toNum(pag.pagamentiElettronici) > 0) c.pos += 1;
      if (toNum(pag.nonScontrinato) > 0) c.nonScontrinato += 1;
      if (toNum(pag.nonScontrinatoPos) > 0) c.nonScontrinatoPos += 1;
      if (toNum(pag.bonifici) > 0) c.bonifici += 1;
      if (toNum(pag.assegni) > 0) c.assegni += 1;
      if (toNum(pag.buoni) > 0) c.buoni += 1;
      if (toNum(pag.coupon) > 0) c.coupon += 1;
      if (toNum(pag.altriPagamenti) > 0) c.altriPagamenti += 1;
    }
    const articoli = sale.rawData?.articoli;
    if (Array.isArray(articoli)) {
      let hasFin = false;
      let hasVar = false;
      for (const art of articoli) {
        const det = art?.dettaglio;
        if (!det) continue;
        if (toNum(det.importoFinanziato) > 0) hasFin = true;
        if (toNum(det.importoCredito) > 0) hasVar = true;
      }
      if (hasFin) c.finanziato += 1;
      if (hasVar) c.var += 1;
    }
  }
  return c;
}

export interface IncassoItemConfig {
  key: keyof IncassoTotals;
  label: string;
  icon: string;
  color: string;
}

export const INCASSO_ITEMS_CONFIG: IncassoItemConfig[] = [
  { key: "contanti", label: "Contanti", icon: "banknote", color: "text-green-600" },
  { key: "pos", label: "POS", icon: "creditcard", color: "text-blue-600" },
  { key: "finanziato", label: "Finanziato", icon: "landmark", color: "text-purple-600" },
  { key: "var", label: "VAR", icon: "filetext", color: "text-amber-600" },
  { key: "nonScontrinato", label: "Non scont. Cont.", icon: "banknote", color: "text-red-600" },
  { key: "nonScontrinatoPos", label: "Non scont. POS", icon: "creditcard", color: "text-rose-600" },
  { key: "bonifici", label: "Bonifici", icon: "landmark", color: "text-teal-600" },
  { key: "assegni", label: "Assegni", icon: "filetext", color: "text-slate-600" },
  { key: "buoni", label: "Buoni", icon: "wallet", color: "text-orange-600" },
  { key: "coupon", label: "Coupon", icon: "tag", color: "text-pink-600" },
  { key: "altriPagamenti", label: "Altri Pag.", icon: "wallet", color: "text-gray-600" },
];
