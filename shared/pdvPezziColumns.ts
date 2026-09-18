import type { PezziExtraColKey, PistaCanvass } from './bisuiteClassification';

export type PdvPezziColumn =
  | {
      kind: 'pista';
      key: PistaCanvass;
      label: string;
      exportLabel: string;
      euro: false;
    }
  | {
      kind: 'extra';
      key: PezziExtraColKey;
      label: string;
      exportLabel: string;
      euro: boolean;
    };

const EXTRA_COLUMNS: Readonly<Record<PezziExtraColKey, Omit<Extract<PdvPezziColumn, { kind: 'extra' }>, 'kind' | 'key'>>> = {
  iva: { label: 'IVA', exportLabel: 'IVA', euro: false },
  cb: { label: 'CB', exportLabel: 'CB', euro: false },
  telefoni: { label: 'Telefoni', exportLabel: 'Telefoni', euro: false },
  accEuro: { label: '€ Accessori', exportLabel: '€ Accessori (netto IVA)', euro: true },
  srvEuro: { label: '€ Servizi', exportLabel: '€ Servizi (netto IVA)', euro: true },
};

/**
 * Definizione ordinata unica delle colonne numeriche della tabella Vendite.
 * Vista, drill-down ed export devono consumare questo stesso array.
 */
export function buildPdvPezziColumns(
  piste: readonly PistaCanvass[],
  pistaLabels: Readonly<Record<PistaCanvass, string>>,
  extraColKeys: readonly PezziExtraColKey[],
  includeExtra: boolean,
): readonly PdvPezziColumn[] {
  const pistaColumns: PdvPezziColumn[] = piste.map((key) => ({
    kind: 'pista',
    key,
    label: pistaLabels[key],
    exportLabel: `${pistaLabels[key]} - Volumi`,
    euro: false,
  }));
  if (!includeExtra) return pistaColumns;
  return [
    ...pistaColumns,
    ...extraColKeys.map((key): PdvPezziColumn => ({
      kind: 'extra',
      key,
      ...EXTRA_COLUMNS[key],
    })),
  ];
}