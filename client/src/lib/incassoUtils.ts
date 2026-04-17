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
}

export interface ArticoloRaw {
  categoria?: { nome?: string } | null;
  tipologia?: { nome?: string } | null;
  descrizione?: string;
  codice?: string | number;
  codiceArticolo?: string | number;
  dettaglio?: DettaglioArticoloRaw | null;
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
