export type ProtectaProduct = 
  | 'casaStart'
  | 'casaStartFinanziato'
  | 'casaPlus'
  | 'casaPlusFinanziato'
  | 'negozioProtetti'
  | 'negozioProtettiFinanziato';

export interface ProtectaAttivatoRiga {
  casaStart: number;
  casaStartFinanziato: number;
  casaPlus: number;
  casaPlusFinanziato: number;
  negozioProtetti: number;
  negozioProtettiFinanziato: number;
}

export interface ProtectaResult {
  pdvId: string;
  nome: string;
  pezziTotali: number;
  premioTotale: number;
  dettaglioProdotti: {
    prodotto: string;
    pezzi: number;
    gettone: number;
    premio: number;
  }[];
  pezziNegozioProtetti: number; // Per Extra Gara P.IVA (somma normale + finanziato)
}

export const PROTECTA_GETTONI: Record<ProtectaProduct, number> = {
  casaStart: 200,
  casaStartFinanziato: 280,
  casaPlus: 270,
  casaPlusFinanziato: 380,
  negozioProtetti: 230,
  negozioProtettiFinanziato: 320,
};

export const PROTECTA_LABELS: Record<ProtectaProduct, string> = {
  casaStart: 'Casa Start',
  casaStartFinanziato: 'Casa Start Finanziato',
  casaPlus: 'Casa Plus',
  casaPlusFinanziato: 'Casa Plus Finanziato',
  negozioProtetti: 'Negozio Protetti',
  negozioProtettiFinanziato: 'Negozio Protetti Finanziato',
};

export const PROTECTA_PRODUCTS_CASA: ProtectaProduct[] = [
  'casaStart',
  'casaStartFinanziato',
  'casaPlus',
  'casaPlusFinanziato',
];

export const PROTECTA_PRODUCTS_NEGOZIO: ProtectaProduct[] = [
  'negozioProtetti',
  'negozioProtettiFinanziato',
];

export const createEmptyProtectaAttivato = (): ProtectaAttivatoRiga => ({
  casaStart: 0,
  casaStartFinanziato: 0,
  casaPlus: 0,
  casaPlusFinanziato: 0,
  negozioProtetti: 0,
  negozioProtettiFinanziato: 0,
});
