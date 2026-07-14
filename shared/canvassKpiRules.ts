// Regole KPI configurabili per le piste canvass Vodafone/Fastweb.
//
// Per le org con brand VF non esistono le piste WindTre "vere" (es. non c'è
// "Windtre Protetti": si prendono lead per Verisure). L'admin può quindi
// definire regole che associano gli articoli BiSuite alle piste del conteggio
// KPI di Vendite BiSuite (o li escludono dal conteggio) in base a
// categoria e/o tipologia e/o descrizione e/o domanda del questionario.
//
// Modulo PURO (nessun import di React/HTTP): usato sia dal client
// (classificazione in Vendite BiSuite) sia dal server (validazione/salvataggio
// in organization_config.config.canvassKpiRules).

import type { PistaCanvass } from './bisuiteClassification';

/** Target di una regola: una pista KPI oppure "escludi dal conteggio". */
export type CanvassKpiTarget = PistaCanvass | 'escludi';

export const CANVASS_KPI_TARGETS: CanvassKpiTarget[] = [
  'mobile',
  'fisso',
  'cb',
  'iva',
  'assicurazioni',
  'protecta',
  'energia',
  'escludi',
];

export interface CanvassKpiCondition {
  /** Match "contiene" (case-insensitive) sul codice articolo BiSuite. */
  codice?: string;
  /** Match "contiene" (case-insensitive) sul nome categoria BiSuite. */
  categoria?: string;
  /** Match "contiene" (case-insensitive) sul nome tipologia BiSuite. */
  tipologia?: string;
  /** Match "contiene" (case-insensitive) sulla descrizione articolo. */
  descrizione?: string;
  /** Match "contiene" (case-insensitive) sul testo di una domanda del questionario. */
  domanda?: string;
  /** Se presente insieme a `domanda`, la risposta deve contenere questo testo. */
  risposta?: string;
}

export interface CanvassKpiRule {
  id: string;
  target: CanvassKpiTarget;
  conditions: CanvassKpiCondition;
  enabled: boolean;
}

/** Forma minima di articolo BiSuite per il match delle regole KPI. */
export interface CanvassKpiArticleLike {
  codice?: unknown;
  categoria?: { nome?: unknown } | null;
  tipologia?: { nome?: unknown } | null;
  descrizione?: unknown;
  dettaglio?: {
    domandeRisposte?: Array<{ domandaTesto?: string; risposta?: string }>;
  } | null;
}

function norm(v: unknown): string {
  return String(v ?? '').toUpperCase().trim();
}

/** True se la regola ha almeno una condizione compilata (regole vuote = mai match). */
export function ruleHasConditions(rule: CanvassKpiRule): boolean {
  const c = rule.conditions || {};
  return Boolean(
    (c.codice || '').trim() ||
      (c.categoria || '').trim() ||
      (c.tipologia || '').trim() ||
      (c.descrizione || '').trim() ||
      (c.domanda || '').trim(),
  );
}

/**
 * Match di una regola su un articolo: TUTTE le condizioni compilate devono
 * combaciare ("contiene", case-insensitive). `risposta` è considerata solo
 * insieme a `domanda`. Una regola senza condizioni non matcha mai.
 */
export function matchesCanvassKpiRule(
  article: CanvassKpiArticleLike,
  rule: CanvassKpiRule,
): boolean {
  if (!ruleHasConditions(rule)) return false;
  const c = rule.conditions;

  if ((c.codice || '').trim()) {
    if (!norm(article.codice).includes(norm(c.codice))) return false;
  }
  if ((c.categoria || '').trim()) {
    if (!norm(article.categoria?.nome).includes(norm(c.categoria))) return false;
  }
  if ((c.tipologia || '').trim()) {
    if (!norm(article.tipologia?.nome).includes(norm(c.tipologia))) return false;
  }
  if ((c.descrizione || '').trim()) {
    if (!norm(article.descrizione).includes(norm(c.descrizione))) return false;
  }
  if ((c.domanda || '').trim()) {
    const domande = article.dettaglio?.domandeRisposte || [];
    const domandaTarget = norm(c.domanda);
    const rispostaTarget = norm(c.risposta);
    const found = domande.some((dr) => {
      if (!norm(dr.domandaTesto).includes(domandaTarget)) return false;
      if (rispostaTarget) return norm(dr.risposta).includes(rispostaTarget);
      return true;
    });
    if (!found) return false;
  }
  return true;
}

/**
 * Risolve il target KPI di un articolo: la PRIMA regola abilitata che matcha
 * (nell'ordine della lista) vince. Undefined = nessuna regola, si usa la
 * classificazione automatica dal listino.
 */
export function resolveCanvassKpiTarget(
  article: CanvassKpiArticleLike,
  rules: CanvassKpiRule[] | null | undefined,
): CanvassKpiTarget | undefined {
  if (!rules || rules.length === 0) return undefined;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (matchesCanvassKpiRule(article, rule)) return rule.target;
  }
  return undefined;
}

/** Sanifica una lista di regole caricata da config (forma difensiva). */
export function sanitizeCanvassKpiRules(raw: unknown): CanvassKpiRule[] {
  if (!Array.isArray(raw)) return [];
  const out: CanvassKpiRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rule = r as Record<string, unknown>;
    const target = String(rule.target ?? '');
    if (!CANVASS_KPI_TARGETS.includes(target as CanvassKpiTarget)) continue;
    const cond = (rule.conditions && typeof rule.conditions === 'object'
      ? rule.conditions
      : {}) as Record<string, unknown>;
    out.push({
      id: String(rule.id ?? `rule-${out.length}`),
      target: target as CanvassKpiTarget,
      conditions: {
        codice: typeof cond.codice === 'string' ? cond.codice : undefined,
        categoria: typeof cond.categoria === 'string' ? cond.categoria : undefined,
        tipologia: typeof cond.tipologia === 'string' ? cond.tipologia : undefined,
        descrizione: typeof cond.descrizione === 'string' ? cond.descrizione : undefined,
        domanda: typeof cond.domanda === 'string' ? cond.domanda : undefined,
        risposta: typeof cond.risposta === 'string' ? cond.risposta : undefined,
      },
      enabled: rule.enabled !== false,
    });
  }
  return out;
}
