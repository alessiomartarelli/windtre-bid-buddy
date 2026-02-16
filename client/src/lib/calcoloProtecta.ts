import { PuntoVendita } from '@/types/preventivatore';
import {
  ProtectaAttivatoRiga,
  ProtectaResult,
  ProtectaProduct,
  PROTECTA_GETTONI,
  PROTECTA_LABELS,
  createEmptyProtectaAttivato,
} from '@/types/protecta';

export function calcolaProtecta(
  attivatoByPos: Record<string, ProtectaAttivatoRiga>,
  puntiVendita: PuntoVendita[],
  gettoniOverride?: Record<string, number>,
): ProtectaResult[] {
  const effectiveGettoni = gettoniOverride
    ? { ...PROTECTA_GETTONI, ...gettoniOverride } as Record<ProtectaProduct, number>
    : PROTECTA_GETTONI;

  return puntiVendita.map(pdv => {
    const attivato = attivatoByPos[pdv.codicePos] || createEmptyProtectaAttivato();
    
    const dettaglioProdotti = (Object.keys(effectiveGettoni) as ProtectaProduct[])
      .map(key => {
        const pezzi = attivato[key];
        const gettone = effectiveGettoni[key];
        return {
          prodotto: PROTECTA_LABELS[key],
          pezzi,
          gettone,
          premio: pezzi * gettone,
        };
      })
      .filter(d => d.pezzi > 0);

    const pezziTotali = (Object.keys(effectiveGettoni) as ProtectaProduct[])
      .reduce((sum, key) => sum + attivato[key], 0);

    const premioTotale = dettaglioProdotti.reduce((sum, d) => sum + d.premio, 0);

    return {
      pdvId: pdv.codicePos,
      nome: pdv.nome || pdv.codicePos,
      pezziTotali,
      premioTotale,
      dettaglioProdotti,
      pezziNegozioProtetti: attivato.negozioProtetti + attivato.negozioProtettiFinanziato,
    };
  });
}

export function calcolaTotaleProtecta(results: ProtectaResult[]): number {
  return results.reduce((sum, r) => sum + r.premioTotale, 0);
}
