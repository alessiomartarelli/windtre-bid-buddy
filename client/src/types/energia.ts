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

export const ENERGIA_BONUS_PER_CONTRATTO = 15; // €15 extra per contratto se supera soglia
export const ENERGIA_SOGLIA_BONUS_BASE = 55; // 55 contratti * numero PDV ragione sociale

export type PistaEnergiaSoglia = "S1" | "S2" | "S3" | "S4" | "S5";

export interface PistaEnergiaSoglieSet {
  S1: number;
  S2: number;
  S3: number;
  S4: number;
  S5: number;
}

export const PISTA_ENERGIA_SOGLIE_FINO_A_3_DEFAULT: PistaEnergiaSoglieSet = {
  S1: 10,
  S2: 25,
  S3: 40,
  S4: 55,
  S5: 100,
};

export const PISTA_ENERGIA_SOGLIE_DA_4_IN_POI_DEFAULT: PistaEnergiaSoglieSet = {
  S1: 9,
  S2: 23,
  S3: 35,
  S4: 50,
  S5: 90,
};

export const PISTA_ENERGIA_BONUS_PER_CONTRATTO_DEFAULT: Record<PistaEnergiaSoglia, number> = {
  S1: 0,
  S2: 5,
  S3: 15,
  S4: 30,
  S5: 45,
};

export function getPistaEnergiaSoglie(numPdv: number, config: EnergiaConfig): PistaEnergiaSoglieSet {
  return numPdv <= 3
    ? { S1: config.pistaFinoA3_S1, S2: config.pistaFinoA3_S2, S3: config.pistaFinoA3_S3, S4: config.pistaFinoA3_S4, S5: config.pistaFinoA3_S5 }
    : { S1: config.pistaDa4_S1, S2: config.pistaDa4_S2, S3: config.pistaDa4_S3, S4: config.pistaDa4_S4, S5: config.pistaDa4_S5 };
}

export function getPistaEnergiaBonusPerContratto(config: EnergiaConfig): Record<PistaEnergiaSoglia, number> {
  return {
    S1: config.pistaBonus_S1,
    S2: config.pistaBonus_S2,
    S3: config.pistaBonus_S3,
    S4: config.pistaBonus_S4,
    S5: config.pistaBonus_S5,
  };
}

export function getPistaEnergiaSoglieEffettive(numPdv: number, config: EnergiaConfig): PistaEnergiaSoglieSet {
  const base = getPistaEnergiaSoglie(numPdv, config);
  return {
    S1: base.S1 * numPdv,
    S2: base.S2 * numPdv,
    S3: base.S3 * numPdv,
    S4: base.S4 * numPdv,
    S5: base.S5 * numPdv,
  };
}

export function determinaPistaEnergiaSoglia(totalePezzi: number, numPdv: number, config: EnergiaConfig): PistaEnergiaSoglia | null {
  const soglie = getPistaEnergiaSoglieEffettive(numPdv, config);
  if (totalePezzi >= soglie.S5) return "S5";
  if (totalePezzi >= soglie.S4) return "S4";
  if (totalePezzi >= soglie.S3) return "S3";
  if (totalePezzi >= soglie.S2) return "S2";
  if (totalePezzi >= soglie.S1) return "S1";
  return null;
}

export function calcolaBonusPistaEnergia(totalePezzi: number, numPdv: number, config: EnergiaConfig): { sogliaRaggiunta: PistaEnergiaSoglia | null; bonusPerContratto: number; bonusTotale: number } {
  const soglia = determinaPistaEnergiaSoglia(totalePezzi, numPdv, config);
  if (!soglia) return { sogliaRaggiunta: null, bonusPerContratto: 0, bonusTotale: 0 };
  const bonusMap = getPistaEnergiaBonusPerContratto(config);
  const bonusPerContratto = bonusMap[soglia];
  return { sogliaRaggiunta: soglia, bonusPerContratto, bonusTotale: bonusPerContratto * totalePezzi };
}

export interface EnergiaConfig {
  pdvInGara: number;
  targetNoMalus: number;
  targetS1: number;
  targetS2: number;
  targetS3: number;
  pistaFinoA3_S1: number;
  pistaFinoA3_S2: number;
  pistaFinoA3_S3: number;
  pistaFinoA3_S4: number;
  pistaFinoA3_S5: number;
  pistaDa4_S1: number;
  pistaDa4_S2: number;
  pistaDa4_S3: number;
  pistaDa4_S4: number;
  pistaDa4_S5: number;
  pistaBonus_S1: number;
  pistaBonus_S2: number;
  pistaBonus_S3: number;
  pistaBonus_S4: number;
  pistaBonus_S5: number;
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
