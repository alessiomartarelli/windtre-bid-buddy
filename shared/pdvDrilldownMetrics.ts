import {
  classifyCategory,
  isCouponCaring,
  isPezzoIva,
  type PistaCanvass,
} from './bisuiteClassification';

type RawQuestionAnswer = { domanda?: unknown; domandaTesto?: unknown; risposta?: unknown };
type RawArticle = {
  categoria?: { nome?: unknown };
  tipologia?: { nome?: unknown };
  descrizione?: unknown;
  dettaglio?: {
    domandeRisposte?: RawQuestionAnswer[];
    finanziatore?: unknown;
    tipologiaVendita?: unknown;
  };
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

export type PhoneSaleModality = 'finanziato' | 'rate' | 'altro';

const emptyTelefoni = (): Record<TelefonoDrilldownKey, number> => ({
  'telefono:finanziato-ga': 0,
  'telefono:finanziato-cb': 0,
  'telefono:var-ga': 0,
  'telefono:var-cb': 0,
});

const normalizedText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/&GT;?/g, '>');

const answerIsYes = (value: unknown) => /\b(SI|YES|TRUE|1)\b/.test(normalizedText(value));
const answerIsPositiveNumber = (value: unknown) => {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0;
};

const articlePhoneBuckets = (article: RawArticle): Set<TelefonoDrilldownKey> => {
  const buckets = new Set<TelefonoDrilldownKey>();
  const category = normalizedText(article.categoria?.nome);
  const isCbArticle = category === 'MIA TIED' || category === 'MIA UNTIED';
  for (const row of article.dettaglio?.domandeRisposte || []) {
    // Il payload BiSuite reale usa `domandaTesto`; `domanda` resta supportato
    // per fixture e vecchi payload già importati.
    const question = normalizedText(row.domandaTesto ?? row.domanda);
    const answer = row.risposta;
    const positiveAnswer = answerIsYes(answer);
    if (
      (
        question.includes('TELEFONO INCLUSO COMPASS') ||
        question.includes('TELEFONO INCLUSO FINDOMESTIC')
      ) && positiveAnswer
    ) {
      buckets.add('telefono:finanziato-ga');
    }
    if (question.includes('TELEFONO INCLUSO MULTI FINANZIAMENTO') && positiveAnswer) {
      buckets.add(isCbArticle ? 'telefono:finanziato-cb' : 'telefono:finanziato-ga');
    }
    if (
      question.includes('MIA TELEFONO FINANZIAMENTO') &&
      !question.includes('= 0') &&
      (positiveAnswer || answerIsPositiveNumber(answer))
    ) {
      buckets.add('telefono:finanziato-cb');
    }
    if (question.includes('TELEFONO INCLUSO VAR') && positiveAnswer) {
      buckets.add('telefono:var-ga');
    }
    if (
      question.includes('MIA TELEFONO VAR') &&
      !question.includes('= 0') &&
      (positiveAnswer || answerIsPositiveNumber(answer))
    ) {
      buckets.add('telefono:var-cb');
    }
    if (question.includes('TNP CB IN FINANZIAMENTO') && positiveAnswer) {
      buckets.add('telefono:finanziato-cb');
    } else if (
      (question.includes('TNP COMPASS/SMARTPHONE EASY') ||
        question.includes('TNP BUSINESS FINANZIAMENTO COMPASS')) &&
      positiveAnswer
    ) {
      buckets.add('telefono:finanziato-ga');
    }
  }
  return buckets;
};

const fallbackPhoneBucket = (
  article: RawArticle,
  channel: 'ga' | 'cb',
): TelefonoDrilldownKey | null => {
  const saleType = normalizedText(article.dettaglio?.tipologiaVendita);
  const financer = normalizedText(article.dettaglio?.finanziatore);
  if (saleType.includes('FINANZIAMENTO') || saleType.includes('COMPASS') || financer) {
    return `telefono:finanziato-${channel}`;
  }
  if (saleType.includes('VENDITA A RATE') || /\bVAR\b/.test(saleType)) {
    return `telefono:var-${channel}`;
  }
  return null;
};

/** Modalità device condivisa con l'aggregazione BiSuite server. */
export function derivePhoneSaleModality(rawData: unknown): PhoneSaleModality {
  const articles: RawArticle[] = Array.isArray((rawData as any)?.articoli)
    ? (rawData as any).articoli
    : [];
  const detected = articles.flatMap((article) => Array.from(articlePhoneBuckets(article)));
  if (detected.some((bucket) => bucket.includes(':finanziato-'))) return 'finanziato';
  if (detected.some((bucket) => bucket.includes(':var-'))) return 'rate';
  for (const article of articles) {
    if (normalizedText(article.categoria?.nome) !== 'TELEFONIA') continue;
    const fallback = fallbackPhoneBucket(article, 'ga');
    if (fallback?.includes(':finanziato-')) return 'finanziato';
    if (fallback?.includes(':var-')) return 'rate';
  }
  return 'altro';
}

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

  const phoneArticles = articles.filter(
    (article) => normalizedText(article.categoria?.nome) === 'TELEFONIA',
  );
  const detectedBuckets: TelefonoDrilldownKey[] = [];
  let hasCbSignal = false;
  let hasGaSignal = false;
  for (const article of articles) {
    const sourcePista = classifyCategory(String(article.categoria?.nome || ''))?.pista;
    if (sourcePista === 'cb') hasCbSignal = true;
    if (sourcePista === 'mobile' || sourcePista === 'fisso') hasGaSignal = true;
    for (const bucket of articlePhoneBuckets(article)) {
      detectedBuckets.push(bucket);
      if (bucket.endsWith('-cb')) hasCbSignal = true;
      else hasGaSignal = true;
    }
  }
  let assignedPhones = 0;
  for (const bucket of detectedBuckets) {
    if (assignedPhones >= phoneArticles.length) break;
    telefoni[bucket] += 1;
    assignedPhones += 1;
  }
  const fallbackChannel = hasCbSignal && !hasGaSignal ? 'cb' : 'ga';
  for (const article of phoneArticles) {
    if (assignedPhones >= phoneArticles.length) break;
    const bucket = fallbackPhoneBucket(article, fallbackChannel);
    if (!bucket) continue;
    telefoni[bucket] += 1;
    assignedPhones += 1;
  }
  // Una sola domanda positiva può descrivere più telefoni nella stessa
  // vendita: in assenza di un dettaglio articolo più preciso, assegna i
  // rimanenti alla modalità esplicitamente dichiarata dalla domanda.
  if (assignedPhones < phoneArticles.length && detectedBuckets.length === 1) {
    const [bucket] = detectedBuckets;
    telefoni[bucket] += phoneArticles.length - assignedPhones;
  }

  return {
    breakdowns: Array.from(breakdownMap.values()),
    businessByPista,
    telefoni,
  };
}