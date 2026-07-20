import { categorizeCanvassArticle, type CanvassIndex } from './canvassMapping';
import { resolveCanvassKpiTarget, type CanvassKpiRule } from './canvassKpiRules';

export type ArticleType = 'canvass' | 'prodotti' | 'servizi';

export type PistaCanvass = 'mobile' | 'fisso' | 'cb' | 'iva' | 'assicurazioni' | 'protecta' | 'energia';

export interface CategoryClassification {
  type: ArticleType;
  pista?: PistaCanvass;
}

const EXCLUDED_CATEGORIES = new Set(['ARROTONDAMENTO']);

const CATEGORY_MAP: Record<string, CategoryClassification> = {
  'UNTIED': { type: 'canvass', pista: 'mobile' },
  'TIED CF': { type: 'canvass', pista: 'mobile' },
  'TIED IVA': { type: 'canvass', pista: 'mobile' },
  'ALTRE GA': { type: 'canvass', pista: 'mobile' },
  'ADD-ON GA': { type: 'canvass', pista: 'mobile' },
  'VERY MOBILE': { type: 'canvass', pista: 'mobile' },

  'ADSL/FIBRA/FWA CF': { type: 'canvass', pista: 'fisso' },
  'ADSL/FIBRA/FWA IVA': { type: 'canvass', pista: 'fisso' },
  'FISSO VOCE': { type: 'canvass', pista: 'fisso' },
  'ADD-ON FISSI': { type: 'canvass', pista: 'fisso' },

  // Pezzi CB = SOLO MIA TIED + MIA UNTIED + RIVINCOLO (richiesta utente).
  // Le altre categorie CB restano canvass ma SENZA pista: non contano nei
  // pezzi CB (dashboard Vendite BiSuite e report Telegram).
  'RIVINCOLO': { type: 'canvass', pista: 'cb' },
  'MIA UNTIED': { type: 'canvass', pista: 'cb' },
  'MIA TIED': { type: 'canvass', pista: 'cb' },
  'WINDTRE SECURITY PRO CB': { type: 'canvass' },
  'ALTRI EVENTI CB': { type: 'canvass' },
  'ADD-ON CB': { type: 'canvass' },
  'MIGRAZIONE EXTRA TRAMITE ASK': { type: 'canvass' },

  'ASSICURAZIONI': { type: 'canvass', pista: 'assicurazioni' },
  'ASSICURAZIONI BUSINESS PRO': { type: 'canvass', pista: 'assicurazioni' },
  'WINDTRE SECURITY PRO GA': { type: 'canvass', pista: 'assicurazioni' },

  'ALLARMI': { type: 'canvass', pista: 'protecta' },

  'ENERGIA W3': { type: 'canvass', pista: 'energia' },
  'ACEA ENERGIA': { type: 'canvass', pista: 'energia' },

  'TELEFONIA': { type: 'prodotti' },
  'MODEM/ROUTER': { type: 'prodotti' },
  'SMART DEVICE': { type: 'prodotti' },
  'INTERNET DEVICE': { type: 'prodotti' },
  'SIM': { type: 'prodotti' },
  'RICARICHE': { type: 'prodotti' },
  'ACCESSORI': { type: 'prodotti' },
  'GARANZIE': { type: 'prodotti' },
  'RICAMBI': { type: 'prodotti' },
  'RICAMBI PC': { type: 'prodotti' },
  'DEPOSITO CAUZIONALE': { type: 'prodotti' },
  'COSTO ATTIVAZIONE': { type: 'prodotti' },
  'EPAY': { type: 'prodotti' },
  'OPZIONI': { type: 'prodotti' },
  'GARANTEASY': { type: 'prodotti' },
  'DEMO TELEFONIA WIND3': { type: 'prodotti' },
  'TELEFONIA TRADE-IN': { type: 'prodotti' },
  'ALTRO': { type: 'prodotti' },

  'SPEDIZIONE': { type: 'servizi' },
  'ASSISTENZA': { type: 'servizi' },
};

export function classifyCategory(categoryName: string): CategoryClassification | null {
  const key = categoryName.toUpperCase().trim();
  return CATEGORY_MAP[key] || null;
}

/**
 * Task #317 — mappa la pista "libera" del listino canvass Vodafone/Fastweb
 * (es. "PISTA MOBILE", "PISTA IVA", "ENERGIA FASTWEB") sulla PistaCanvass
 * usata dalla UI di Vendite BiSuite. Ritorna undefined se non riconosciuta
 * (l'articolo resta comunque "canvass", solo senza chip pista).
 */
export function pistaFromCanvassListino(pista: string): PistaCanvass | undefined {
  const p = (pista || '').toUpperCase();
  if (/\bIVA\b/.test(p)) return 'iva';
  if (p.includes('MOBILE')) return 'mobile';
  if (p.includes('FISSO')) return 'fisso';
  if (p.includes('CB')) return 'cb';
  if (p.includes('ENERGIA')) return 'energia';
  if (p.includes('VERISURE') || p.includes('ALLARM')) return 'protecta';
  if (p.includes('ASSICURA')) return 'assicurazioni';
  return undefined;
}

/** Forma minima di articolo BiSuite per la classificazione brand-aware. */
export interface ClassifiableArticle {
  codice?: unknown;
  categoria?: { nome?: unknown } | null;
  tipologia?: { nome?: unknown } | null;
  descrizione?: unknown;
  dettaglio?: {
    domandeRisposte?: Array<{ domandaTesto?: string; risposta?: string }>;
  } | null;
}

/**
 * Classificatore brand-aware (Task #317): se è disponibile l'indice del
 * listino canvass Vodafone/Fastweb (org con brand VF), prova prima il match
 * canvass (codice → offerId → categoria/tipologia); se combacia, l'articolo
 * è "canvass" con la pista derivata dal listino. Altrimenti ricade sulla
 * mappa categorie WindTre (comportamento invariato per org WindTre/senza
 * brand VF, dove canvassIndex è null/undefined).
 */
export function classifyArticle(
  article: ClassifiableArticle,
  canvassIndex?: CanvassIndex | null,
  kpiRules?: CanvassKpiRule[] | null,
): CategoryClassification | null {
  if (canvassIndex) {
    // Regole KPI per-org (solo org VF, dove esiste il canvassIndex): la prima
    // regola abilitata che matcha vince SULLA classificazione automatica.
    // Target 'escludi' = l'articolo non conta in nessuna pista KPI.
    const target = resolveCanvassKpiTarget(article, kpiRules);
    if (target === 'escludi') {
      const match = categorizeCanvassArticle(article, canvassIndex);
      if (match) return { type: 'canvass' };
      const fallback = classifyCategory(String(article.categoria?.nome ?? '').trim());
      return fallback ? { type: fallback.type } : null;
    }
    if (target) {
      return { type: 'canvass', pista: target };
    }
    const match = categorizeCanvassArticle(article, canvassIndex);
    if (match) {
      return { type: 'canvass', pista: pistaFromCanvassListino(match.pista) };
    }
  }
  return classifyCategory(String(article.categoria?.nome ?? '').trim());
}

export const PISTA_CANVASS_LABELS: Record<PistaCanvass, string> = {
  mobile: 'Mobile',
  fisso: 'Fisso',
  cb: 'CB',
  iva: 'P.IVA',
  assicurazioni: 'Assicurazioni',
  protecta: 'Windtre Protetti',
  energia: 'Energia',
};

/**
 * Label piste per le org con brand Vodafone/Fastweb: lì "Windtre Protetti"
 * non esiste — si prendono lead per Verisure. Le altre piste restano uguali.
 */
export const PISTA_CANVASS_LABELS_VF: Record<PistaCanvass, string> = {
  ...PISTA_CANVASS_LABELS,
  protecta: 'Verisure',
};

/** Restituisce le label piste corrette per il contesto (VF = Verisure). */
export function getPistaCanvassLabels(isVfOrg: boolean): Record<PistaCanvass, string> {
  return isVfOrg ? PISTA_CANVASS_LABELS_VF : PISTA_CANVASS_LABELS;
}

export const PISTA_CANVASS_COLORS: Record<PistaCanvass, string> = {
  mobile: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  fisso: 'bg-purple-500/10 text-purple-700 border-purple-500/20',
  cb: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  iva: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20',
  assicurazioni: 'bg-teal-500/10 text-teal-700 border-teal-500/20',
  protecta: 'bg-red-500/10 text-red-700 border-red-500/20',
  energia: 'bg-green-500/10 text-green-700 border-green-500/20',
};

export const TYPE_LABELS: Record<ArticleType, string> = {
  canvass: 'Canvass',
  prodotti: 'Prodotti',
  servizi: 'Servizi',
};

export const TYPE_COLORS: Record<ArticleType, string> = {
  canvass: 'bg-orange-500/10 text-orange-700 border-orange-500/20',
  prodotti: 'bg-slate-500/10 text-slate-700 border-slate-500/20',
  servizi: 'bg-cyan-500/10 text-cyan-700 border-cyan-500/20',
};

export interface ClassifiedArticle {
  categoriaNome: string;
  tipologiaNome: string;
  descrizione: string;
  type: ArticleType;
  pista?: PistaCanvass;
  prezzo: number;
  importoScontrino: number;
  importoFinanziato: number;
  importoCredito: number;
  /**
   * Flag ufficiale BiSuite (`dettaglio.scontrino`): 1 = articolo da
   * scontrinare (finisce nello scontrino fiscale), 0 = NON da
   * scontrinare. Da preferire al check `importoScontrino > 0` perché
   * BiSuite a volte popola `importoScontrino` anche per articoli con
   * `scontrino=0`, e viceversa lascia `importoScontrino=0` per articoli
   * con `scontrino=1` finanziati o a credito.
   */
  scontrinato: boolean;
  /** Coupon Caring (MIA TIED/UNTIED + tipologia COUPON CARING …): escluso
   * dai pezzi CB, conteggiato nel report dedicato. */
  couponCaring?: boolean;
}

export interface SaleClassification {
  articles: ClassifiedArticle[];
  countByType: Record<ArticleType, number>;
  amountByType: Record<ArticleType, number>;
  countByPista: Partial<Record<PistaCanvass, number>>;
  amountByPista: Partial<Record<PistaCanvass, number>>;
  hasCanvass: boolean;
  primaryPista: PistaCanvass | null;
  /** Coupon Caring: pezzi e importo (esclusi dai pezzi/importi pista CB). */
  couponCaring: { pezzi: number; importo: number };
}

/**
 * Coupon Caring: offerte MIA TIED / MIA UNTIED con tipologia
 * "COUPON CARING TIED" / "COUPON CARING UNTIED". NON contano nei pezzi CB:
 * vengono conteggiate in un report dedicato (dashboard + allegato Telegram).
 */
export function isCouponCaring(categoriaNome: string, tipologiaNome: string): boolean {
  const cat = categoriaNome.toUpperCase().trim();
  if (cat !== 'MIA TIED' && cat !== 'MIA UNTIED') return false;
  return tipologiaNome.toUpperCase().trim().startsWith('COUPON CARING');
}

const _warnedCategories = new Set<string>();

export function classifySaleArticles(
  rawData: any,
  canvassIndex?: CanvassIndex | null,
  kpiRules?: CanvassKpiRule[] | null,
): SaleClassification {
  const articoli = rawData?.articoli || [];
  const articles: ClassifiedArticle[] = [];
  const countByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const amountByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const countByPista: Partial<Record<PistaCanvass, number>> = {};
  const amountByPista: Partial<Record<PistaCanvass, number>> = {};
  const couponCaring = { pezzi: 0, importo: 0 };

  for (const art of articoli) {
    const catNome = (art.categoria?.nome || '').trim();
    if (EXCLUDED_CATEGORIES.has(catNome.toUpperCase())) continue;
    const tipNome = (art.tipologia?.nome || '').trim();
    const desc = (art.descrizione || '').trim();
    const prezzo = parseFloat(art.dettaglio?.prezzo || '0') || 0;
    const importoScontrino = parseFloat(art.dettaglio?.importoScontrino || '0') || 0;
    const importoFinanziato = parseFloat(art.dettaglio?.importoFinanziato || '0') || 0;
    const importoCredito = parseFloat(art.dettaglio?.importoCredito || '0') || 0;
    // Flag ufficiale BiSuite: 1 = da scontrinare, 0 = no.
    const flagScontrinoRaw = art.dettaglio?.scontrino;
    const scontrinato =
      flagScontrinoRaw === 1 ||
      flagScontrinoRaw === '1' ||
      flagScontrinoRaw === true;
    const classification = classifyArticle(art, canvassIndex, kpiRules);

    if (classification) {
      // Coupon Caring: resta canvass ma NON conta nella pista CB; viene
      // conteggiato a parte per il report dedicato (solo path WindTre:
      // la classificazione da listino VF non produce queste categorie).
      const coupon = classification.type === 'canvass' && isCouponCaring(catNome, tipNome);
      const pista = coupon ? undefined : classification.pista;
      const classified: ClassifiedArticle = {
        categoriaNome: catNome,
        tipologiaNome: tipNome,
        descrizione: desc,
        type: classification.type,
        pista,
        couponCaring: coupon || undefined,
        prezzo,
        importoScontrino,
        importoFinanziato,
        importoCredito,
        scontrinato,
      };
      articles.push(classified);
      countByType[classification.type]++;
      amountByType[classification.type] += prezzo;
      if (coupon) {
        couponCaring.pezzi++;
        couponCaring.importo += prezzo;
      }
      if (pista) {
        countByPista[pista] = (countByPista[pista] || 0) + 1;
        amountByPista[pista] = (amountByPista[pista] || 0) + prezzo;
      }
    } else if (catNome) {
      if (typeof window !== 'undefined' && !_warnedCategories.has(catNome)) {
        _warnedCategories.add(catNome);
        console.warn(`[BiSuite Classification] Unknown category "${catNome}" — defaulting to "prodotti"`);
      }
      articles.push({
        categoriaNome: catNome,
        tipologiaNome: tipNome,
        descrizione: desc,
        type: 'prodotti',
        prezzo,
        importoScontrino,
        importoFinanziato,
        importoCredito,
        scontrinato,
      });
      countByType.prodotti++;
      amountByType.prodotti += prezzo;
    }
  }

  const pistaEntries = Object.entries(countByPista) as [PistaCanvass, number][];
  const primaryPista = pistaEntries.length > 0
    ? pistaEntries.sort(([, a], [, b]) => b - a)[0][0]
    : null;

  return {
    articles,
    countByType,
    amountByType,
    countByPista,
    amountByPista,
    hasCanvass: countByType.canvass > 0,
    primaryPista,
    couponCaring,
  };
}
