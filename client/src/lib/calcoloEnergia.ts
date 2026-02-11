import {
  EnergiaCategory,
  EnergiaConfig,
  EnergiaAttivatoRiga,
  EnergiaResult,
  EnergiaPdvInGara,
  ENERGIA_BASE_PAY,
  ENERGIA_BONUS_PER_CONTRATTO,
  ENERGIA_SOGLIA_BONUS_BASE,
} from "@/types/energia";

interface CalcoloEnergiaParams {
  posCode: string;
  attivato: EnergiaAttivatoRiga[];
  config: EnergiaConfig;
  pdvInGaraList: EnergiaPdvInGara[];
  isNegozioInGara: boolean;
}

export function calcoloEnergiaPerPos({
  posCode,
  attivato,
  config,
  pdvInGaraList,
  isNegozioInGara,
}: CalcoloEnergiaParams): EnergiaResult {
  // Calcola pezzi per categoria
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

  // Calcola premio base
  let premioBase = 0;
  (Object.keys(pezziPerCategoria) as EnergiaCategory[]).forEach((cat) => {
    premioBase += pezziPerCategoria[cat] * ENERGIA_BASE_PAY[cat];
  });

  // Calcola bonus raggiungimento soglia (totale ragione sociale)
  // La soglia è 55 * numero PDV ragione sociale
  const sogliaBonus = ENERGIA_SOGLIA_BONUS_BASE * config.pdvInGara;
  
  // Calcola totale pezzi di tutti i PDV in gara (somma totale ragione sociale)
  // Per ora usiamo solo il totale del singolo PDV, ma in produzione si dovrebbe sommare tutti
  const totalePezziRagioneSociale = totalePezzi; // TODO: sommare tutti i PDV della stessa ragione sociale
  
  let bonusRaggiungimentoSoglia = 0;
  if (totalePezziRagioneSociale >= sogliaBonus) {
    bonusRaggiungimentoSoglia = totalePezzi * ENERGIA_BONUS_PER_CONTRATTO;
  }

  // Calcola premio a soglia (solo per negozi in gara)
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

  const premioTotale = premioBase + bonusRaggiungimentoSoglia + premioSoglia;

  return {
    posCode,
    pezziPerCategoria,
    totalePezzi,
    premioBase,
    bonusRaggiungimentoSoglia,
    premioSoglia,
    premioTotale,
    sogliaRaggiunta,
  };
}

// Calcola il totale per tutti i PDV
export function calcoloEnergiaTotale(results: EnergiaResult[]): {
  totalePezzi: number;
  totalePremioBase: number;
  totaleBonus: number;
  totalePremioSoglia: number;
  totalePremio: number;
} {
  return results.reduce(
    (acc, r) => ({
      totalePezzi: acc.totalePezzi + r.totalePezzi,
      totalePremioBase: acc.totalePremioBase + r.premioBase,
      totaleBonus: acc.totaleBonus + r.bonusRaggiungimentoSoglia,
      totalePremioSoglia: acc.totalePremioSoglia + r.premioSoglia,
      totalePremio: acc.totalePremio + r.premioTotale,
    }),
    {
      totalePezzi: 0,
      totalePremioBase: 0,
      totaleBonus: 0,
      totalePremioSoglia: 0,
      totalePremio: 0,
    }
  );
}
