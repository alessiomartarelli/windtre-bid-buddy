import {
  classifyCategory,
  isCouponCaring,
  isPezzoIva,
  type PistaCanvass,
} from './bisuiteClassification';

type RawQuestionAnswer = { domanda?: unknown; risposta?: unknown };
type RawArticle = {
  categoria?: { nome?: unknown };
  tipologia?: { nome?: unknown };
  descrizione?: unknown;
  dettaglio?: { domandeRisposte?: RawQuestionAnswer[] };
};

export type TelefonoDrilldownKey =
  | 'telefono:finanziato-ga'
  | 'telefono:finanziato-cb'
  | 'telefono:var-ga'
  | 'telefono:var-cb';

export interface PdvDrilldownDerivedMetrics {
  breakdowns: Array<{ pista: PistaCanvass; label: string; value: number }>;
  businessByPista: Partial<Record<PistaCanvass, number>>;
  telefoni: Record<TelefonoDrilldownKey, number>;
}

const emptyTelefoni = (): Record<TelefonoDrilldownKey, number> => ({
  'telefono:finanziato-ga': 0,
  'telefono:finanziato-cb': 0,
  'telefono:var-ga': 0,
  'telefono:var-cb': 0,
});

const answerIsYes = (value: unknown) => /\bSI\b/.test(String(value ?? '').trim().toUpperCase());
const answerIsNumeric = (value: unknown) => /^-?\d+(?:[.,]\d+)?$/.test(String(value ?? '').trim());

const articlePhoneBuckets = (article: RawArticle): Set<TelefonoDrilldownKey> => {
  const buckets = new Set<TelefonoDrilldownKey>();
  const category = String(article.categoria?.nome || '').trim().toUpperCase();
  const isCbArticle = category === 'MIA TIED' || category === 'MIA UNTIED';
  for (const row of article.dettaglio?.domandeRisposte || []) {
    const question = String(row.domanda || '').trim().toUpperCase();
    const answer = row.risposta;
    if (
      (
        question.includes('TELEFONO INCLUSO COMPASS') ||
        question.includes('TELEFONO INCLUSO FINDOMESTIC')
      ) && answerIsYes(answer)
    ) {
      buckets.add('telefono:finanziato-ga');
    }
    if (question.includes('TELEFONO INCLUSO MULTI FINANZIAMENTO') && answerIsYes(answer)) {
      buckets.add(isCbArticle ? 'telefono:finanziato-cb' : 'telefono:finanziato-ga');
    }
    if (question.includes('MIA TELEFONO FINANZIAMENTO') && answerIsNumeric(answer)) {
      buckets.add('telefono:finanziato-cb');
    }
    if (question.includes('TELEFONO INCLUSO VAR') && answerIsYes(answer)) {
      buckets.add('telefono:var-ga');
    }
    if (question.includes('MIA TELEFONO VAR') && answerIsNumeric(answer)) {
      buckets.add('telefono:var-cb');
    }
  }
  return buckets;
};

export function derivePdvDrilldownMetrics(rawData: unknown): PdvDrilldownDerivedMetrics {
  const articles: RawArticle[] = Array.isArray((rawData as any)?.articoli)
    ? (rawData as any).articoli
    : [];
  const breakdownMap = new Map<string, { pista: PistaCanvass; label: string; value: number }>();
  const businessByPista: Partial<Record<PistaCanvass, number>> = {};
  const telefoni = emptyTelefoni();

  for (const article of articles) {
    const categoria = String(article.categoria?.nome || '').trim();
    const tipologia = String(article.tipologia?.nome || '').trim();
    if (isCouponCaring(categoria, tipologia)) continue;
    const sourcePista = classifyCategory(categoria)?.pista;
    const breakdownLabel = sourcePista === 'assicurazioni'
      ? (tipologia || categoria)
      : sourcePista === 'mobile' || sourcePista === 'fisso' || sourcePista === 'cb'
        ? categoria
        : '';
    if (sourcePista && breakdownLabel) {
      const key = `${sourcePista}:${breakdownLabel.toUpperCase()}`;
      const current = breakdownMap.get(key);
      if (current) current.value += 1;
      else breakdownMap.set(key, { pista: sourcePista, label: breakdownLabel, value: 1 });
    }
    if (
      (sourcePista === 'energia' || sourcePista === 'protecta') &&
      isPezzoIva({
        pista: sourcePista,
        categoriaNome: categoria,
        descrizione: String(article.descrizione || ''),
      })
    ) {
      businessByPista[sourcePista] = (businessByPista[sourcePista] || 0) + 1;
    }
  }

  for (const article of articles) {
    for (const bucket of articlePhoneBuckets(article)) {
      telefoni[bucket] += 1;
    }
  }

  return {
    breakdowns: Array.from(breakdownMap.values()),
    businessByPista,
    telefoni,
  };
}