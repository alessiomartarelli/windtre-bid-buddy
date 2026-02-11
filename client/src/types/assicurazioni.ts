export type AssicurazioneProduct = 
  | 'protezionePro'
  | 'casaFamigliaFull'
  | 'casaFamigliaPlus'
  | 'casaFamigliaStart'
  | 'sportFamiglia'
  | 'sportIndividuale'
  | 'viaggiVacanze'
  | 'elettrodomestici'
  | 'micioFido'
  | 'viaggioMondo'
  | 'reloadForever';

export interface AssicurazioniConfig {
  pdvInGara: number;
  targetNoMalus: number;
  targetS1: number;
  targetS2: number;
}

export interface AssicurazioniPdvInGara {
  pdvId: string;
  nome: string;
  codicePos: string;
  inGara: boolean;
}

export interface AssicurazioniAttivatoRiga {
  protezionePro: number;
  casaFamigliaFull: number;
  casaFamigliaPlus: number;
  casaFamigliaStart: number;
  sportFamiglia: number;
  sportIndividuale: number;
  viaggiVacanze: number;
  elettrodomestici: number;
  micioFido: number;
  viaggioMondo: number; // numero pezzi
  viaggioMondoPremio: number; // premio assicurativo in €
  reloadForever: number; // numero eventi
}

export interface AssicurazioniResult {
  pdvId: string;
  nome: string;
  puntiTotali: number;
  puntiTotaliConReload: number; // include reload forever dopo prima soglia
  premioBase: number;
  bonusSoglia1: number;
  bonusSoglia2: number;
  premioTotale: number;
  dettaglioProdotti: {
    prodotto: string;
    pezzi: number;
    punti: number;
    premio: number;
  }[];
}

export const ASSICURAZIONI_POINTS: Record<Exclude<AssicurazioneProduct, 'viaggioMondo' | 'reloadForever'>, number> = {
  protezionePro: 4,
  casaFamigliaFull: 3,
  casaFamigliaPlus: 3,
  casaFamigliaStart: 2,
  sportFamiglia: 2,
  sportIndividuale: 0.5,
  viaggiVacanze: 1.5,
  elettrodomestici: 0.5,
  micioFido: 2,
};

export const ASSICURAZIONI_PREMIUMS: Record<Exclude<AssicurazioneProduct, 'viaggioMondo' | 'reloadForever'>, number> = {
  protezionePro: 0, // Non specificato, assumo 0
  casaFamigliaFull: 100,
  casaFamigliaPlus: 70,
  casaFamigliaStart: 40,
  sportFamiglia: 49,
  sportIndividuale: 25,
  viaggiVacanze: 30,
  elettrodomestici: 18,
  micioFido: 45,
};

export const ASSICURAZIONI_LABELS: Record<AssicurazioneProduct, string> = {
  protezionePro: 'Protezione Pro',
  casaFamigliaFull: 'Casa e Famiglia Full',
  casaFamigliaPlus: 'Casa e Famiglia Plus',
  casaFamigliaStart: 'Casa e Famiglia Start',
  sportFamiglia: 'Sport Famiglia',
  sportIndividuale: 'Sport Individuale',
  viaggiVacanze: 'Viaggi e Vacanze',
  elettrodomestici: 'Elettrodomestici',
  micioFido: 'Micio e Fido',
  viaggioMondo: 'Viaggio Mondo',
  reloadForever: 'Reload Forever',
};

export const createEmptyAssicurazioniAttivato = (): AssicurazioniAttivatoRiga => ({
  protezionePro: 0,
  casaFamigliaFull: 0,
  casaFamigliaPlus: 0,
  casaFamigliaStart: 0,
  sportFamiglia: 0,
  sportIndividuale: 0,
  viaggiVacanze: 0,
  elettrodomestici: 0,
  micioFido: 0,
  viaggioMondo: 0,
  viaggioMondoPremio: 0,
  reloadForever: 0,
});
