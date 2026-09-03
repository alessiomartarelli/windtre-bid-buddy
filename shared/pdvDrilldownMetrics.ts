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

export type TelefonoCanale = 'ga' | 'cb';
export type TelefonoModalita = 'finanziato' | 'var';
export type TelefonoDrilldownKey =
  | 'telefono:finanziato-ga'
  | 'telefono:finanziato-cb'
  | 'telefono:var-ga'
  | 'telefono:var-cb';

export interface PdvDrilldownDerivedMetrics {
  ivaByPista: Partial<Record<PistaCanvass, number>>;
  telefoni: Record<TelefonoDrilldownKey, number>;
}

const emptyTelefoni = (): Record<TelefonoDrilldownKey, number> => ({
  'telefono:finanziato-ga': 0,
  'telefono:finanziato-cb': 0,
  'telefono:var-ga': 0,
  'telefono:var-cb': 0,
});

const articleChannel = (article: RawArticle): TelefonoCanale | null => {
  const categoria = String(article.categoria?.nome || '').trim();
  const tipologia = String(article.tipologia?.nome || '').trim();
  if (isCouponCaring(categoria, tipologia)) return null;
  const pista = classifyCategory(categoria)?.pista;
  return pista === 'mobile' ? 'ga' : pista === 'cb' ? 'cb' : null;
};

const answerIsYes = (value: unknown) => /\bSI\b/.test(String(value ?? '').trim().toUpperCase());
const answerIsNumeric = (value: unknown) => /^-?\d+(?:[.,]\d+)?$/.test(String(value ?? '').trim());

const articlePhoneModes = (article: RawArticle): Set<TelefonoModalita> => {
  const modes = new Set<TelefonoModalita>();
  for (const row of article.dettaglio?.domandeRisposte || []) {
    const question = String(row.domanda || '').trim().toUpperCase();
    const answer = row.risposta;
    if (
      (
        question.includes('TELEFONO INCLUSO COMPASS') ||
        question.includes('TELEFONO INCLUSO FINDOMESTIC') ||
        question.includes('TELEFONO INCLUSO MULTI FINANZIAMENTO')
      ) && answerIsYes(answer)
    ) {
      modes.add('finanziato');
    }
    if (question.includes('MIA TELEFONO FINANZIAMENTO') && answerIsNumeric(answer)) {
      modes.add('finanziato');
    }
    if (question.includes('TELEFONO INCLUSO VAR') && answerIsYes(answer)) {
      modes.add('var');
    }
    if (question.includes('MIA TELEFONO VAR') && answerIsNumeric(answer)) {
      modes.add('var');
    }
  }
  return modes;
};

export function derivePdvDrilldownMetrics(rawData: unknown): PdvDrilldownDerivedMetrics {
  const articles: RawArticle[] = Array.isArray((rawData as any)?.articoli)
    ? (rawData as any).articoli
    : [];
  const ivaByPista: Partial<Record<PistaCanvass, number>> = {};
  const telefoni = emptyTelefoni();
  const saleChannels = new Set<TelefonoCanale>();

  for (const article of articles) {
    const channel = articleChannel(article);
    if (channel) saleChannels.add(channel);

    const categoria = String(article.categoria?.nome || '').trim();
    const tipologia = String(article.tipologia?.nome || '').trim();
    if (isCouponCaring(categoria, tipologia)) continue;
    const sourcePista = classifyCategory(categoria)?.pista;
    if (
      sourcePista &&
      isPezzoIva({
        pista: sourcePista,
        categoriaNome: categoria,
        descrizione: String(article.descrizione || ''),
      })
    ) {
      ivaByPista[sourcePista] = (ivaByPista[sourcePista] || 0) + 1;
    }
  }

  for (const article of articles) {
    const modes = articlePhoneModes(article);
    if (modes.size === 0) continue;
    const ownChannel = articleChannel(article);
    const channel = ownChannel || (saleChannels.size === 1 ? Array.from(saleChannels)[0] : null);
    if (!channel) continue;
    for (const mode of modes) {
      telefoni[`telefono:${mode}-${channel}`] += 1;
    }
  }

  return { ivaByPista, telefoni };
}