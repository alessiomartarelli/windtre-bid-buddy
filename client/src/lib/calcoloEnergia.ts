import {
  EnergiaCategory,
  EnergiaConfig,
  EnergiaAttivatoRiga,
  EnergiaResult,
  EnergiaPdvInGara,
  ENERGIA_BASE_PAY,
  ENERGIA_BONUS_PER_CONTRATTO,
  ENERGIA_SOGLIA_BONUS_BASE,
  calcolaBonusPistaEnergia as calcolaBonusPistaEnergiaFn,
} from "@/types/energia";

interface CalcoloEnergiaParams {
  posCode: string;
  attivato: EnergiaAttivatoRiga[];
  config: EnergiaConfig;
  pdvInGaraList: EnergiaPdvInGara[];
  isNegozioInGara: boolean;
  numPdv: number;
}

export function calcoloEnergiaPerPos({
  posCode,
  attivato,
  config,
  pdvInGaraList,
  isNegozioInGara,
  numPdv,
}: CalcoloEnergiaParams): EnergiaResult {
  const pezziPerCategoria: Record<EnergiaCategory, number> = {
    CONSUMER_CON_SDD: 0,
    CONSUMER_NO_SDD: 0,
    BUSINESS_CON_SDD: 0,
    BUSINESS_NO_SDD: 0,
    CONSUMER_CON_SDD_W3: 0,
    CONSUMER_NO_SDD_W3: 0,
    BUSINESS_CON_SDD_W3: 0,
    BUSINESS_NO_SDD_W3: 0,
  };

  attivato.forEach((riga) => {
    pezziPerCategoria[riga.category] += riga.pezzi;
  });

  const totalePezzi = Object.values(pezziPerCategoria).reduce((a, b) => a + b, 0);

  let premioBase = 0;
  (Object.keys(pezziPerCategoria) as EnergiaCategory[]).forEach((cat) => {
    premioBase += pezziPerCategoria[cat] * ENERGIA_BASE_PAY[cat];
  });

  const sogliaBonus = ENERGIA_SOGLIA_BONUS_BASE * config.pdvInGara;
  const totalePezziRagioneSociale = totalePezzi;
  
  let bonusRaggiungimentoSoglia = 0;
  if (totalePezziRagioneSociale >= sogliaBonus) {
    bonusRaggiungimentoSoglia = totalePezzi * ENERGIA_BONUS_PER_CONTRATTO;
  }

  let premioSoglia = 0;
  let sogliaRaggiunta: 0 | 1 | 2 | 3 = 0;
  
  if (isNegozioInGara) {
    if (totalePezzi >= config.targetS3) {
      premioSoglia = 1000;
      sogliaRaggiunta = 3;
    } else if (totalePezzi >= config.targetS2) {
      premioSoglia = 500;
      sogliaRaggiunta = 2;
    } else if (totalePezzi >= config.targetS1) {
      premioSoglia = 250;
      sogliaRaggiunta = 1;
    }
  }

  const pistaEnergia = calcolaBonusPistaEnergiaFn(totalePezzi, numPdv);

  const premioTotale = premioBase + bonusRaggiungimentoSoglia + premioSoglia + pistaEnergia.bonusTotale;

  return {
    posCode,
    pezziPerCategoria,
    totalePezzi,
    premioBase,
    bonusRaggiungimentoSoglia,
    premioSoglia,
    premioTotale,
    sogliaRaggiunta,
    pistaEnergia,
  };
}

export function calcoloEnergiaTotale(results: EnergiaResult[]): {
  totalePezzi: number;
  totalePremioBase: number;
  totaleBonus: number;
  totalePremioSoglia: number;
  totaleBonusPista: number;
  totalePremio: number;
} {
  return results.reduce(
    (acc, r) => ({
      totalePezzi: acc.totalePezzi + r.totalePezzi,
      totalePremioBase: acc.totalePremioBase + r.premioBase,
      totaleBonus: acc.totaleBonus + r.bonusRaggiungimentoSoglia,
      totalePremioSoglia: acc.totalePremioSoglia + r.premioSoglia,
      totaleBonusPista: acc.totaleBonusPista + r.pistaEnergia.bonusTotale,
      totalePremio: acc.totalePremio + r.premioTotale,
    }),
    {
      totalePezzi: 0,
      totalePremioBase: 0,
      totaleBonus: 0,
      totalePremioSoglia: 0,
      totaleBonusPista: 0,
      totalePremio: 0,
    }
  );
}
