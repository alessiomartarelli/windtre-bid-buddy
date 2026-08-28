import { normalizeRsName } from './ragioneSociale';

/**
 * Task #528 — calcolo obiettivi/soglie/premi delle piste Vodafone/Fastweb
 * (luce, gas, iva_mobile, iva_wireline, vas) dalla configurazione gara
 * (blocchi `vfPisteConfig` globale + `vfPisteRSConfig` per Ragione Sociale).
 *
 * Logica PURA (nessun import React/DB): usata da DashboardGaraReale e
 * testabile via tsx (tests/vf-piste-premi.test.mjs).
 */

export interface VfPistaConf {
  targetS1: number;
  targetS2: number;
  targetS3: number;
  premioS1?: number;
  premioS2?: number;
  premioS3?: number;
}

export interface VfPisteRSEntry {
  ragioneSociale: string;
  rimosso?: boolean;
  perPista: Partial<Record<string, VfPistaConf>>;
}

export type VfSoglia = 'S1' | 'S2' | 'S3';

export interface VfPistaCalcResult {
  /** Soglia più alta raggiunta (target > 0 e pezzi >= target), o null. */
  soglia: VfSoglia | null;
  /** Premio € flat della soglia raggiunta (non cumulativo). */
  premio: number;
  /** Primo target > 0 non ancora raggiunto (in ordine S1→S3), o null. */
  nextTarget: number | null;
}

/**
 * Risolve la chiave RS effettiva del perimetro dashboard:
 * - PDV selezionato → RS di quel PDV (dal catalogo);
 * - altrimenti filtro RS selezionato → quella RS;
 * - altrimenti, se il catalogo contiene UNA sola RS → quella (org mono-RS,
 *   dove il selettore RS non viene nemmeno renderizzato);
 * - altrimenti null (aggregato multi-RS: vale la sola config globale).
 */
export function resolveVfEffectiveRsKey(params: {
  pdvFilter: string;
  rsFilter: string;
  catalog: Array<{ codicePos: string; ragioneSociale?: string | null }>;
}): string | null {
  const { pdvFilter, rsFilter, catalog } = params;
  if (pdvFilter !== 'all') {
    const pdv = catalog.find((p) => p.codicePos === pdvFilter);
    return normalizeRsName(pdv?.ragioneSociale || 'N/D');
  }
  if (rsFilter !== 'all') return rsFilter;
  const keys = new Set(catalog.map((p) => normalizeRsName(p.ragioneSociale || 'N/D')));
  if (keys.size === 1) {
    const only = keys.values().next().value;
    return only ?? null;
  }
  return null;
}

/**
 * Risolve la config effettiva di una pista VF: override RS (se la RS
 * effettiva ha un blocco), altrimenti config globale. Un blocco RS
 * `rimosso` disattiva soglie/premi per quella RS anche se esiste una
 * config globale (fail-closed sulla rimozione intenzionale). Config con
 * target tutti a 0 equivale ad assente (pista a solo conteggio pezzi).
 */
export function resolveVfPistaConf(params: {
  pista: string;
  global: Partial<Record<string, VfPistaConf>>;
  perRS: VfPisteRSEntry[];
  effectiveRsKey: string | null;
}): VfPistaConf | null {
  const { pista, global, perRS, effectiveRsKey } = params;
  let conf: VfPistaConf | null = null;
  const rsEntry = effectiveRsKey
    ? perRS.find((c) => normalizeRsName(c.ragioneSociale) === effectiveRsKey)
    : undefined;
  if (rsEntry) {
    conf = rsEntry.rimosso ? null : (rsEntry.perPista?.[pista] ?? global[pista] ?? null);
  } else {
    conf = global[pista] ?? null;
  }
  if (conf && !(conf.targetS1 > 0 || conf.targetS2 > 0 || conf.targetS3 > 0)) conf = null;
  return conf;
}

/** Calcola soglia raggiunta, premio e prossimo target dai pezzi. */
export function calcVfPistaResult(pezzi: number, conf: VfPistaConf): VfPistaCalcResult {
  const livelli: Array<[VfSoglia, number, number]> = [
    ['S3', conf.targetS3, conf.premioS3 ?? 0],
    ['S2', conf.targetS2, conf.premioS2 ?? 0],
    ['S1', conf.targetS1, conf.premioS1 ?? 0],
  ];
  let soglia: VfSoglia | null = null;
  let premio = 0;
  for (const [liv, target, prem] of livelli) {
    if (target > 0 && pezzi >= target) { soglia = liv; premio = prem; break; }
  }
  let nextTarget: number | null = null;
  for (const [, target] of [...livelli].reverse()) {
    if (target > 0 && pezzi < target) { nextTarget = target; break; }
  }
  return { soglia, premio, nextTarget };
}
