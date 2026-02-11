import {
  AssicurazioniConfig,
  AssicurazioniPdvInGara,
  AssicurazioniAttivatoRiga,
  AssicurazioniResult,
  ASSICURAZIONI_POINTS,
  ASSICURAZIONI_PREMIUMS,
  ASSICURAZIONI_LABELS,
  AssicurazioneProduct,
} from '@/types/assicurazioni';
import { PuntoVendita } from '@/types/preventivatore';

export function calcoloAssicurazioniPerPos(
  puntiVendita: PuntoVendita[],
  config: AssicurazioniConfig,
  pdvInGara: AssicurazioniPdvInGara[],
  attivatoByPos: Record<string, AssicurazioniAttivatoRiga>
): AssicurazioniResult[] {
  const results: AssicurazioniResult[] = [];
  const pdvCodificatiInGara = pdvInGara.filter(p => p.inGara).length;

  for (const pdv of puntiVendita) {
    const attivato = attivatoByPos[pdv.codicePos];
    if (!attivato) continue;

    const pdvInfo = pdvInGara.find(p => p.pdvId === pdv.codicePos);
    const isInGara = pdvInfo?.inGara ?? false;

    const dettaglioProdotti: AssicurazioniResult['dettaglioProdotti'] = [];
    let puntiTotali = 0;
    let premioBase = 0;

    // Calcolo prodotti standard
    const prodottiStandard: (keyof typeof ASSICURAZIONI_POINTS)[] = [
      'protezionePro',
      'casaFamigliaFull',
      'casaFamigliaPlus',
      'casaFamigliaStart',
      'sportFamiglia',
      'sportIndividuale',
      'viaggiVacanze',
      'elettrodomestici',
      'micioFido',
    ];

    for (const prodotto of prodottiStandard) {
      const pezzi = attivato[prodotto];
      if (pezzi > 0) {
        const punti = pezzi * ASSICURAZIONI_POINTS[prodotto];
        const premio = pezzi * ASSICURAZIONI_PREMIUMS[prodotto];
        puntiTotali += punti;
        premioBase += premio;
        dettaglioProdotti.push({
          prodotto: ASSICURAZIONI_LABELS[prodotto],
          pezzi,
          punti,
          premio,
        });
      }
    }

    // Viaggio Mondo: 1.5 punti ogni 100€ di premio, premio = 12.5% del premio assicurativo (max 201€)
    if (attivato.viaggioMondo > 0 && attivato.viaggioMondoPremio > 0) {
      const puntiViaggio = (attivato.viaggioMondoPremio / 100) * 1.5;
      const premioViaggio = Math.min(attivato.viaggioMondoPremio * 0.125, 201) * attivato.viaggioMondo;
      puntiTotali += puntiViaggio;
      premioBase += premioViaggio;
      dettaglioProdotti.push({
        prodotto: ASSICURAZIONI_LABELS.viaggioMondo,
        pezzi: attivato.viaggioMondo,
        punti: puntiViaggio,
        premio: premioViaggio,
      });
    }

    // Calcolo soglie e bonus (solo per PDV in gara)
    let bonusSoglia1 = 0;
    let bonusSoglia2 = 0;
    let puntiTotaliConReload = puntiTotali;

    if (isInGara) {
      // Se supera soglia 1 (targetNoMalus), aggiungi punti Reload Forever
      if (puntiTotali >= config.targetNoMalus && attivato.reloadForever > 0) {
        const puntiReload = Math.floor(attivato.reloadForever / 5);
        puntiTotaliConReload = puntiTotali + puntiReload;
        
        if (puntiReload > 0) {
          dettaglioProdotti.push({
            prodotto: ASSICURAZIONI_LABELS.reloadForever,
            pezzi: attivato.reloadForever,
            punti: puntiReload,
            premio: 0,
          });
        }
      }

      // Target S1: €500 per PDV codificato
      if (puntiTotaliConReload >= config.targetS1) {
        bonusSoglia1 = 500;
      }

      // Target S2: €750 per PDV
      if (puntiTotaliConReload >= config.targetS2) {
        bonusSoglia2 = 750;
      }
    }

    results.push({
      pdvId: pdv.codicePos,
      nome: pdv.nome || pdv.codicePos,
      puntiTotali,
      puntiTotaliConReload,
      premioBase,
      bonusSoglia1,
      bonusSoglia2,
      premioTotale: premioBase + bonusSoglia1 + bonusSoglia2,
      dettaglioProdotti,
    });
  }

  return results;
}
