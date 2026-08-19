import {
  type AssicurazioniAttivatoRiga,
  type AssicurazioniConfig,
  ASSICURAZIONI_POINTS,
  ASSICURAZIONI_PREMIUMS,
} from '@/types/assicurazioni';
import { ASSICURAZIONI_PRODOTTI_STANDARD } from '@/lib/calcoloAssicurazioni';

export interface AssicurazioniRSResult {
  puntiBase: number;
  puntiConReload: number;
  gettoniBase: number;
  bonusSoglia1: number;
  bonusSoglia2: number;
  premioTotale: number;
}

/**
 * Calcolo assicurazioni del Simulatore in modalità Ragione Sociale.
 * Le soglie sono moltiplicate per il numero di PDV della RS, così come i bonus.
 */
export function calcolaPremioAssicurazioniPerRS(
  attivato: AssicurazioniAttivatoRiga,
  config: AssicurazioniConfig,
  numeroPdv: number,
  puntiOverride?: Record<string, number>,
  premiOverride?: Record<string, number>,
): AssicurazioniRSResult {
  const effectivePoints = puntiOverride
    ? { ...ASSICURAZIONI_POINTS, ...puntiOverride }
    : ASSICURAZIONI_POINTS;
  const effectivePremiums = premiOverride
    ? { ...ASSICURAZIONI_PREMIUMS, ...premiOverride }
    : ASSICURAZIONI_PREMIUMS;

  let puntiBase = 0;
  let gettoniBase = 0;
  for (const prodotto of ASSICURAZIONI_PRODOTTI_STANDARD) {
    const pezzi = attivato[prodotto] || 0;
    puntiBase += pezzi * (effectivePoints[prodotto] ?? 0);
    gettoniBase += pezzi * (effectivePremiums[prodotto] ?? 0);
  }

  if (attivato.viaggioMondoPremio > 0) {
    puntiBase += (attivato.viaggioMondoPremio / 100) * 1.5;
    gettoniBase += Math.min(attivato.viaggioMondoPremio * 0.125, 201) * (attivato.viaggioMondo || 1);
  }

  const targetS1 = (config.targetS1 || 0) * numeroPdv;
  const targetS2 = (config.targetS2 || 0) * numeroPdv;
  let puntiConReload = puntiBase;
  if (puntiBase >= targetS1 && attivato.reloadForever > 0) {
    const puntiReloadRaw = Math.floor(attivato.reloadForever / 5);
    const maxReload = Math.floor(puntiBase * 0.15 / 0.85);
    puntiConReload = puntiBase + Math.min(puntiReloadRaw, maxReload);
  }

  const bonusSoglia1 = puntiBase >= targetS1 ? 500 * numeroPdv : 0;
  const bonusSoglia2 = puntiConReload >= targetS2 ? 750 * numeroPdv : 0;

  return {
    puntiBase,
    puntiConReload,
    gettoniBase,
    bonusSoglia1,
    bonusSoglia2,
    premioTotale: gettoniBase + bonusSoglia1 + bonusSoglia2,
  };
}