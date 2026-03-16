export type ArticleType = 'canvass' | 'prodotti' | 'servizi';

export type PistaCanvass = 'mobile' | 'fisso' | 'cb' | 'assicurazioni' | 'protecta' | 'energia';

export interface CategoryClassification {
  type: ArticleType;
  pista?: PistaCanvass;
}

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

  'RIVINCOLO': { type: 'canvass', pista: 'cb' },
  'WINDTRE SECURITY PRO CB': { type: 'canvass', pista: 'cb' },
  'ALTRI EVENTI CB': { type: 'canvass', pista: 'cb' },
  'ADD-ON CB': { type: 'canvass', pista: 'cb' },
  'MIA UNTIED': { type: 'canvass', pista: 'cb' },
  'MIA TIED': { type: 'canvass', pista: 'cb' },
  'MIGRAZIONE EXTRA TRAMITE ASK': { type: 'canvass', pista: 'cb' },

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
  'ARROTONDAMENTO': { type: 'prodotti' },
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

export const PISTA_CANVASS_LABELS: Record<PistaCanvass, string> = {
  mobile: 'Mobile',
  fisso: 'Fisso',
  cb: 'CB',
  assicurazioni: 'Assicurazioni',
  protecta: 'Protecta',
  energia: 'Energia',
};

export const PISTA_CANVASS_COLORS: Record<PistaCanvass, string> = {
  mobile: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  fisso: 'bg-purple-500/10 text-purple-700 border-purple-500/20',
  cb: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
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
}

export interface SaleClassification {
  articles: ClassifiedArticle[];
  countByType: Record<ArticleType, number>;
  amountByType: Record<ArticleType, number>;
  countByPista: Partial<Record<PistaCanvass, number>>;
  amountByPista: Partial<Record<PistaCanvass, number>>;
  hasCanvass: boolean;
  primaryPista: PistaCanvass | null;
}

const _warnedCategories = new Set<string>();

export function classifySaleArticles(rawData: any): SaleClassification {
  const articoli = rawData?.articoli || [];
  const articles: ClassifiedArticle[] = [];
  const countByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const amountByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const countByPista: Partial<Record<PistaCanvass, number>> = {};
  const amountByPista: Partial<Record<PistaCanvass, number>> = {};

  for (const art of articoli) {
    const catNome = (art.categoria?.nome || '').trim();
    const tipNome = (art.tipologia?.nome || '').trim();
    const desc = (art.descrizione || '').trim();
    const prezzo = parseFloat(art.dettaglio?.prezzo || '0') || 0;
    const classification = classifyCategory(catNome);

    if (classification) {
      const classified: ClassifiedArticle = {
        categoriaNome: catNome,
        tipologiaNome: tipNome,
        descrizione: desc,
        type: classification.type,
        pista: classification.pista,
        prezzo,
      };
      articles.push(classified);
      countByType[classification.type]++;
      amountByType[classification.type] += prezzo;
      if (classification.pista) {
        countByPista[classification.pista] = (countByPista[classification.pista] || 0) + 1;
        amountByPista[classification.pista] = (amountByPista[classification.pista] || 0) + prezzo;
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
  };
}
