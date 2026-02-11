import { ClusterPIvaCode } from "./preventivatore";

export interface ExtraGaraIvaPdvResult {
  pdvId: string;
  pdvCode: string;
  nome: string;
  ragioneSociale: string;
  clusterPIva: ClusterPIvaCode | "";
  // Pezzi e punti per categoria
  pezziWorldStaff: number;
  puntiWorldStaff: number;
  pezziFullPlus: number;
  puntiFullPlus: number;
  pezziFlexSpecial: number;
  puntiFlexSpecial: number;
  pezziFissoPIva: number;
  puntiFissoPIva: number;
  pezziFritzBox: number;
  puntiFritzBox: number;
  pezziLuceGas: number;
  puntiLuceGas: number;
  pezziProtezionePro: number;
  puntiProtezionePro: number;
  pezziNegozioProtetti: number;
  puntiNegozioProtetti: number;
  // Totali
  pezziTotali: number;
  puntiTotali: number;
  premioUnitario: number;
  premioTotale: number;
}

export interface ExtraGaraIvaRsResult {
  ragioneSociale: string;
  isMultipos: boolean;
  numPdv: number;
  pdvList: string[];
  soglie: { s1: number; s2: number; s3: number; s4: number };
  hasBPInRS: boolean; // true se almeno un PDV ha BP o BP Plus+
  puntiTotaliRS: number;
  pezziTotaliRS: number;
  sogliaRaggiunta: 0 | 1 | 2 | 3 | 4;
  pdvResults: ExtraGaraIvaPdvResult[];
  premioTotaleRS: number;
}
