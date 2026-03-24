/* =============================================================================
   TIPI ENERGIA
============================================================================== */

export type EnergiaCategory = 
  | "CONSUMER_CON_SDD"
  | "CONSUMER_NO_SDD"
  | "BUSINESS_CON_SDD"
  | "BUSINESS_NO_SDD"
  | "CONSUMER_CON_SDD_W3"
  | "CONSUMER_NO_SDD_W3"
  | "BUSINESS_CON_SDD_W3"
  | "BUSINESS_NO_SDD_W3";

export const ENERGIA_CATEGORY_LABELS: { value: EnergiaCategory; label: string; isW3?: boolean }[] = [
  { value: "CONSUMER_CON_SDD", label: "Consumer con SDD" },
  { value: "CONSUMER_NO_SDD", label: "Consumer no SDD" },
  { value: "BUSINESS_CON_SDD", label: "Business con SDD" },
  { value: "BUSINESS_NO_SDD", label: "Business no SDD" },
];

export const ENERGIA_W3_CATEGORY_LABELS: { value: EnergiaCategory; label: string }[] = [
  { value: "CONSUMER_CON_SDD_W3", label: "Consumer con SDD (ex W3)" },
  { value: "CONSUMER_NO_SDD_W3", label: "Consumer no SDD (ex W3)" },
  { value: "BUSINESS_CON_SDD_W3", label: "Business con SDD (ex W3)" },
  { value: "BUSINESS_NO_SDD_W3", label: "Business no SDD (ex W3)" },
];

export const ENERGIA_BASE_PAY: Record<EnergiaCategory, number> = {
  CONSUMER_CON_SDD: 70,
  CONSUMER_NO_SDD: 55,
  BUSINESS_CON_SDD: 110,
  BUSINESS_NO_SDD: 95,
  CONSUMER_CON_SDD_W3: 35,
  CONSUMER_NO_SDD_W3: 27.5,
  BUSINESS_CON_SDD_W3: 55,
  BUSINESS_NO_SDD_W3: 47.5,
};

export const ENERGIA_BONUS_PER_CONTRATTO = 15;
export const ENERGIA_SOGLIA_BONUS_BASE = 55;

export type PistaEnergiaSoglia = "S1" | "S2" | "S3" | "S4" | "S5";

export interface PistaEnergiaSoglieSet {
  S1: number;
  S2: number;
  S3: number;
  S4: number;
  S5: number;
}

export const PISTA_ENERGIA_SOGLIE_BASE: PistaEnergiaSoglieSet = {
  S1: 10,
  S2: 25,
  S3: 40,
  S4: 55,
  S5: 100,
};

export const PISTA_ENERGIA_SOGLIE_DA4: PistaEnergiaSoglieSet = {
  S1: 9,
  S2: 23,
  S3: 35,
  S4: 50,
  S5: 90,
};

export const PISTA_ENERGIA_BONUS_PER_CONTRATTO: Record<PistaEnergiaSoglia, number> = {
  S1: 0,
  S2: 5,
  S3: 15,
  S4: 30,
  S5: 45,
};

export function calcolaSoglieDefaultPerRS(numPdv: number, pistaBaseOverride?: Record<string, number>, pistaDa4Override?: Record<string, number>): PistaEnergiaSoglieSet {
  const base = Math.min(numPdv, 3);
  const extra = Math.max(numPdv - 3, 0);
  const pb = pistaBaseOverride ? { ...PISTA_ENERGIA_SOGLIE_BASE, ...pistaBaseOverride } as typeof PISTA_ENERGIA_SOGLIE_BASE : PISTA_ENERGIA_SOGLIE_BASE;
  const pd = pistaDa4Override ? { ...PISTA_ENERGIA_SOGLIE_DA4, ...pistaDa4Override } as typeof PISTA_ENERGIA_SOGLIE_DA4 : PISTA_ENERGIA_SOGLIE_DA4;
  return {
    S1: pb.S1 * base + pd.S1 * extra,
    S2: pb.S2 * base + pd.S2 * extra,
    S3: pb.S3 * base + pd.S3 * extra,
    S4: pb.S4 * base + pd.S4 * extra,
    S5: pb.S5 * base + pd.S5 * extra,
  };
}

export function getSoglieFromConfig(config: EnergiaConfig, numPdv: number, pistaBaseOverride?: Record<string, number>, pistaDa4Override?: Record<string, number>): PistaEnergiaSoglieSet {
  const defaults = calcolaSoglieDefaultPerRS(numPdv, pistaBaseOverride, pistaDa4Override);
  return {
    S1: config.pistaSoglia_S1 || defaults.S1,
    S2: config.pistaSoglia_S2 || defaults.S2,
    S3: config.pistaSoglia_S3 || defaults.S3,
    S4: config.pistaSoglia_S4 || defaults.S4,
    S5: config.pistaSoglia_S5 || defaults.S5,
  };
}

export function determinaPistaEnergiaSoglia(totalePezzi: number, config: EnergiaConfig, numPdv: number, pistaBaseOverride?: Record<string, number>, pistaDa4Override?: Record<string, number>): PistaEnergiaSoglia | null {
  const soglie = getSoglieFromConfig(config, numPdv, pistaBaseOverride, pistaDa4Override);
  if (totalePezzi >= soglie.S5) return "S5";
  if (totalePezzi >= soglie.S4) return "S4";
  if (totalePezzi >= soglie.S3) return "S3";
  if (totalePezzi >= soglie.S2) return "S2";
  if (totalePezzi >= soglie.S1) return "S1";
  return null;
}

export function calcolaBonusPistaEnergia(totalePezzi: number, config: EnergiaConfig, numPdv: number, bonusPerContrattoOverride?: Record<string, number>, pistaBaseOverride?: Record<string, number>, pistaDa4Override?: Record<string, number>): { sogliaRaggiunta: PistaEnergiaSoglia | null; bonusPerContratto: number; bonusTotale: number } {
  const soglia = determinaPistaEnergiaSoglia(totalePezzi, config, numPdv, pistaBaseOverride, pistaDa4Override);
  if (!soglia) return { sogliaRaggiunta: null, bonusPerContratto: 0, bonusTotale: 0 };
  const bonusPerContratto = bonusPerContrattoOverride?.[soglia] ?? PISTA_ENERGIA_BONUS_PER_CONTRATTO[soglia];
  return { sogliaRaggiunta: soglia, bonusPerContratto, bonusTotale: bonusPerContratto * totalePezzi };
}

export interface EnergiaConfig {
  pdvInGara: number;
  targetNoMalus: number;
  targetS1: number;
  targetS2: number;
  targetS3: number;
  premio?: number;
  premioS1?: number;
  premioS2?: number;
  premioS3?: number;
  pistaSoglia_S1?: number;
  pistaSoglia_S2?: number;
  pistaSoglia_S3?: number;
  pistaSoglia_S4?: number;
  pistaSoglia_S5?: number;
}

export interface EnergiaPdvInGara {
  pdvId: string;
  codicePos: string;
  nome: string;
  isInGara: boolean;
}

export interface EnergiaAttivatoRiga {
  id: string;
  category: EnergiaCategory;
  pezzi: number;
}

export interface EnergiaResult {
  posCode: string;
  pezziPerCategoria: Record<EnergiaCategory, number>;
  totalePezzi: number;
  premioBase: number;
  bonusRaggiungimentoSoglia: number;
  premioSoglia: number;
  premioTotale: number;
  sogliaRaggiunta: 0 | 1 | 2 | 3;
  pistaEnergia: {
    sogliaRaggiunta: PistaEnergiaSoglia | null;
    bonusPerContratto: number;
    bonusTotale: number;
  };
}
