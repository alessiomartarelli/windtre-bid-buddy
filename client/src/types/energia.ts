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

export interface EnergiaConfig {
  pdvInGara: number; // Numero PDV in gara per ragione sociale
  targetNoMalus: number;
  targetS1: number;
  targetS2: number;
  targetS3: number;
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
  bonusRaggiungimentoSoglia: number; // +15€ per contratto se supera soglia
  premioSoglia: number; // 250/500/1000€ per negozio
  premioTotale: number;
  sogliaRaggiunta: 0 | 1 | 2 | 3; // 0=nessuna, 1=S1, 2=S2, 3=S3
}
