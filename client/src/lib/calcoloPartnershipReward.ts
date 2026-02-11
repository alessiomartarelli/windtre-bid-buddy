import { AttivatoCBDettaglio, CalcoloPartnershipRewardResult } from "@/types/partnership-cb-events";
import { PartnershipRewardPosConfig } from "@/types/partnership-reward";

export interface CalcoloPartnershipRewardParams {
  posCode: string;
  config: PartnershipRewardPosConfig;
  attivato: AttivatoCBDettaglio[];
  giorniLavorativi: number;
}

export const calcolaPartnershipRewardPerPos = (
  params: CalcoloPartnershipRewardParams
): CalcoloPartnershipRewardResult => {
  const { config, attivato, giorniLavorativi } = params;
  
  // I volumi inseriti sono il target fine mese
  // Proteggi da NaN usando || 0 per gettoni e puntiPartnership
  const totaleGettoni = attivato.reduce((sum, evento) => {
    const gettoni = evento.gettoni || 0;
    const pezzi = evento.pezzi || 0;
    return sum + (pezzi * gettoni);
  }, 0);
  const totalePezzi = attivato.reduce((sum, evento) => sum + (evento.pezzi || 0), 0);
  
  // Calcola punti partnership (usati per target e premio)
  const punti = attivato.reduce((sum, evento) => {
    const puntiPartnership = evento.puntiPartnership || 0;
    const pezzi = evento.pezzi || 0;
    return sum + (pezzi * puntiPartnership);
  }, 0);
  
  const target100 = config.config.target100 || 0;
  const target80 = config.config.target80 || 0;
  
  // Calcola percentuale e target raggiunto
  const percentualeTarget = target100 > 0 ? (punti / target100) * 100 : 0;
  let targetRaggiunto: '100%' | '80%' | 'nessuno' = 'nessuno';
  let premioTarget = 0;
  
  if (target100 > 0 && punti >= target100) {
    targetRaggiunto = '100%';
    premioTarget = config.config.premio100 || 0;
  } else if (target80 > 0 && punti >= target80) {
    targetRaggiunto = '80%';
    premioTarget = config.config.premio80 || 0;
  }
  
  // Premio totale = premio target + gettoni
  const premioMaturato = premioTarget + totaleGettoni;
  
  // Run rate giornaliero
  const runRateGiornalieroPezzi = giorniLavorativi > 0 ? totalePezzi / giorniLavorativi : 0;
  
  // Prepara dettaglio eventi
  const dettaglioEventi = attivato.map(evento => {
    const gettoni = evento.gettoni || 0;
    const puntiPartnership = evento.puntiPartnership || 0;
    const pezzi = evento.pezzi || 0;
    return {
      eventType: evento.eventType,
      pezzi,
      gettoniUnitari: gettoni,
      puntiPartnershipUnitari: puntiPartnership,
      gettoniTotali: pezzi * gettoni,
      puntiPartnership: pezzi * puntiPartnership,
    };
  });
  
  return {
    punti,
    totaleGettoni,
    totalePezzi,
    percentualeTarget,
    targetRaggiunto,
    premioMaturato,
    runRateGiornalieroPezzi,
    giorniLavorativi,
    dettaglioEventi,
  };
};
