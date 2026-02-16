import { PuntoVendita, MobileActivationType, AttivatoMobileDettaglio, ClusterPIvaCode } from "@/types/preventivatore";
import { AttivatoFissoRiga, FissoCategoriaType } from "@/lib/calcoloPistaFisso";
import { EnergiaAttivatoRiga } from "@/types/energia";
import { AssicurazioniAttivatoRiga } from "@/types/assicurazioni";
import { ProtectaAttivatoRiga } from "@/types/protecta";
import { ExtraGaraIvaPdvResult, ExtraGaraIvaRsResult } from "@/types/extra-gara-iva";

// Punti per tipo attivazione
export const PUNTI_EXTRA_GARA = {
  worldStaff: 1.5,           // PROFESSIONAL_STAFF + PROFESSIONAL_WORLD
  fullPlusData60_100: 1,     // ALTRE_SIM_IVA (Full Plus, Data 60-100)
  flexSpecialData10: 0.5,    // PROFESSIONAL_FLEX + PROFESSIONAL_SPECIAL + PROFESSIONAL_DATA_10
  fissoPIva: 1,              // Fisso P.IVA 1ª + 2ª Linea
  fritzBox: 0.5,             // FRITZ!Box
  luceGas: 1,                // Tutte le categorie Energia
  protezionePro: 5,          // Protezione Pro da Assicurazioni
  negozioProtetti: 5,        // Negozio Protetti da Protecta
};

// Soglie base per PDV (punti) - dipendono da monopos/multipos e se ha BP
export const SOGLIE_BASE_EXTRA_GARA = {
  multipos: {
    conBP: { s1: 15, s2: 22, s3: 32, s4: 40 },
    senzaBP: { s1: 10, s2: 20, s3: 25, s4: 25 }, // S4 = S3 per senza BP
  },
  monopos: {
    conBP: { s1: 30, s2: 45, s3: 55, s4: 65 },
    senzaBP: { s1: 20, s2: 30, s3: 40, s4: 40 }, // S4 = S3 per senza BP
  },
};

// Premi per soglia raggiunta (€ per pezzo)
export const PREMI_EXTRA_GARA: Record<ClusterPIvaCode, number[]> = {
  business_promoter_plus: [0, 25, 35, 45, 55], // [nessuna, S1, S2, S3, S4]
  business_promoter: [0, 25, 35, 45, 45],      // S4 = S3
  senza_business_promoter: [0, 10, 15, 25, 25], // S4 = S3
};

interface CalcolaExtraGaraIvaParams {
  puntiVendita: PuntoVendita[];
  attivatoMobileByPos: Record<string, AttivatoMobileDettaglio[]>;
  attivatoFissoByPos: Record<string, AttivatoFissoRiga[]>;
  attivatoEnergiaByPos: Record<string, EnergiaAttivatoRiga[]>;
  attivatoAssicurazioniByPos: Record<string, AssicurazioniAttivatoRiga>;
  attivatoProtectaByPos: Record<string, ProtectaAttivatoRiga>;
}

// Estrae i pezzi da Mobile per le categorie Extra Gara
const estraiPezziMobile = (righe: AttivatoMobileDettaglio[]) => {
  let worldStaff = 0;
  let fullPlus = 0;
  let flexSpecial = 0;

  for (const riga of righe) {
    if (!riga.type) continue;
    const pezzi = riga.pezzi || 0;
    
    if (riga.type === MobileActivationType.PROFESSIONAL_STAFF || 
        riga.type === MobileActivationType.PROFESSIONAL_WORLD) {
      worldStaff += pezzi;
    } else if (riga.type === MobileActivationType.ALTRE_SIM_IVA) {
      fullPlus += pezzi;
    } else if (riga.type === MobileActivationType.PROFESSIONAL_FLEX || 
               riga.type === MobileActivationType.PROFESSIONAL_SPECIAL || 
               riga.type === MobileActivationType.PROFESSIONAL_DATA_10) {
      flexSpecial += pezzi;
    }
  }

  return { worldStaff, fullPlus, flexSpecial };
};

// Categorie Fisso che contano per Extra IVA (solo linee P.IVA)
const FISSO_CATEGORIE_EXTRA_IVA: FissoCategoriaType[] = [
  "FISSO_PIVA_1A_LINEA",
  "FISSO_PIVA_2A_LINEA",
];

// Estrae i pezzi da Fisso per le categorie Extra IVA
const estraiPezziFisso = (righe: AttivatoFissoRiga[]) => {
  let fissoPIva = 0;
  let fritzBox = 0;

  for (const riga of righe) {
    const pezzi = riga.pezzi || 0;
    
    if (riga.categoria === "FRITZ_BOX") {
      fritzBox += pezzi;
    } else if (FISSO_CATEGORIE_EXTRA_IVA.includes(riga.categoria)) {
      fissoPIva += pezzi;
    }
  }

  return { fissoPIva, fritzBox };
};

// Estrae i pezzi Energia solo Business (P.IVA)
const estraiPezziEnergia = (righe: EnergiaAttivatoRiga[]) => {
  return righe
    .filter(riga => riga.category === "BUSINESS_CON_SDD" || riga.category === "BUSINESS_NO_SDD")
    .reduce((sum, riga) => sum + (riga.pezzi || 0), 0);
};

// Estrae pezzi Protezione Pro da Assicurazioni
const estraiPezziProtezionePro = (attivato: AssicurazioniAttivatoRiga | undefined) => {
  return attivato?.protezionePro || 0;
};

// Estrae pezzi Negozio Protetti da Protecta
const estraiPezziNegozioProtetti = (attivato: ProtectaAttivatoRiga | undefined) => {
  if (!attivato) return 0;
  return (attivato.negozioProtetti || 0) + (attivato.negozioProtettiFinanziato || 0);
};

// Determina se il cluster P.IVA ha Business Promoter
const haBusinessPromoter = (clusterPIva: ClusterPIvaCode | ""): boolean => {
  return clusterPIva === "business_promoter_plus" || clusterPIva === "business_promoter";
};

// Calcola le soglie per una Ragione Sociale
const calcolaSoglieRS = (
  pdvList: PuntoVendita[],
  isMultipos: boolean
): { s1: number; s2: number; s3: number; s4: number } => {
  const baseType = isMultipos ? "multipos" : "monopos";
  
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  
  for (const pdv of pdvList) {
    const hasBP = haBusinessPromoter(pdv.clusterPIva || "");
    const baseKey = hasBP ? "conBP" : "senzaBP";
    const base = SOGLIE_BASE_EXTRA_GARA[baseType][baseKey];
    
    s1 += base.s1;
    s2 += base.s2;
    s3 += base.s3;
    // Per S4: PDV senza BP contribuisce con la sua S3 massima
    s4 += hasBP ? base.s4 : base.s3;
  }
  
  return { s1, s2, s3, s4 };
};

// Determina la soglia raggiunta
const determinaSogliaRaggiunta = (
  puntiTotali: number,
  soglie: { s1: number; s2: number; s3: number; s4: number },
  hasBPInRS: boolean
): 0 | 1 | 2 | 3 | 4 => {
  // S4 è raggiungibile solo se c'è almeno un PDV con BP
  if (hasBPInRS && puntiTotali >= soglie.s4) return 4;
  if (puntiTotali >= soglie.s3) return 3;
  if (puntiTotali >= soglie.s2) return 2;
  if (puntiTotali >= soglie.s1) return 1;
  return 0;
};

export const calcolaExtraGaraIva = (params: CalcolaExtraGaraIvaParams): ExtraGaraIvaRsResult[] => {
  const { 
    puntiVendita, 
    attivatoMobileByPos, 
    attivatoFissoByPos, 
    attivatoEnergiaByPos,
    attivatoAssicurazioniByPos,
    attivatoProtectaByPos,
  } = params;

  // Raggruppa PDV per ragioneSociale
  const pdvPerRS: Record<string, PuntoVendita[]> = {};
  for (const pdv of puntiVendita) {
    const rs = pdv.ragioneSociale || "Senza RS";
    if (!pdvPerRS[rs]) pdvPerRS[rs] = [];
    pdvPerRS[rs].push(pdv);
  }

  const results: ExtraGaraIvaRsResult[] = [];

  for (const [ragioneSociale, pdvList] of Object.entries(pdvPerRS)) {
    const isMultipos = pdvList.length > 1;
    const soglie = calcolaSoglieRS(pdvList, isMultipos);
    
    // Verifica se almeno un PDV ha Business Promoter
    const hasBPInRS = pdvList.some(pdv => haBusinessPromoter(pdv.clusterPIva || ""));

    // Calcola risultati per ogni PDV
    const pdvResults: ExtraGaraIvaPdvResult[] = [];
    let puntiTotaliRS = 0;
    let pezziTotaliRS = 0;

    for (const pdv of pdvList) {
      // Estrai pezzi dalle varie piste
      const mobileRighe = attivatoMobileByPos[pdv.id] || [];
      const fissoRighe = attivatoFissoByPos[pdv.id] || [];
      const energiaRighe = attivatoEnergiaByPos[pdv.id] || [];
      const assicurazioniAttivato = attivatoAssicurazioniByPos[pdv.id];
      const protectaAttivato = attivatoProtectaByPos[pdv.id];

      const { worldStaff, fullPlus, flexSpecial } = estraiPezziMobile(mobileRighe);
      const { fissoPIva, fritzBox } = estraiPezziFisso(fissoRighe);
      const luceGas = estraiPezziEnergia(energiaRighe);
      const protezionePro = estraiPezziProtezionePro(assicurazioniAttivato);
      const negozioProtetti = estraiPezziNegozioProtetti(protectaAttivato);

      // Calcola punti
      const puntiWorldStaff = worldStaff * PUNTI_EXTRA_GARA.worldStaff;
      const puntiFullPlus = fullPlus * PUNTI_EXTRA_GARA.fullPlusData60_100;
      const puntiFlexSpecial = flexSpecial * PUNTI_EXTRA_GARA.flexSpecialData10;
      const puntiFissoPIva = fissoPIva * PUNTI_EXTRA_GARA.fissoPIva;
      const puntiFritzBox = fritzBox * PUNTI_EXTRA_GARA.fritzBox;
      const puntiLuceGas = luceGas * PUNTI_EXTRA_GARA.luceGas;
      const puntiProtezionePro = protezionePro * PUNTI_EXTRA_GARA.protezionePro;
      const puntiNegozioProtetti = negozioProtetti * PUNTI_EXTRA_GARA.negozioProtetti;

      const puntiTotali = 
        puntiWorldStaff + puntiFullPlus + puntiFlexSpecial + 
        puntiFissoPIva + puntiFritzBox + 
        puntiLuceGas + puntiProtezionePro + puntiNegozioProtetti;

      const pezziTotali = 
        worldStaff + fullPlus + flexSpecial + 
        fissoPIva + fritzBox + 
        luceGas + protezionePro + negozioProtetti;

      puntiTotaliRS += puntiTotali;
      pezziTotaliRS += pezziTotali;

      pdvResults.push({
        pdvId: pdv.id,
        pdvCode: pdv.codicePos,
        nome: pdv.nome,
        ragioneSociale: pdv.ragioneSociale,
        clusterPIva: pdv.clusterPIva || "",
        pezziWorldStaff: worldStaff,
        puntiWorldStaff,
        pezziFullPlus: fullPlus,
        puntiFullPlus,
        pezziFlexSpecial: flexSpecial,
        puntiFlexSpecial,
        pezziFissoPIva: fissoPIva,
        puntiFissoPIva,
        pezziFritzBox: fritzBox,
        puntiFritzBox,
        pezziLuceGas: luceGas,
        puntiLuceGas,
        pezziProtezionePro: protezionePro,
        puntiProtezionePro,
        pezziNegozioProtetti: negozioProtetti,
        puntiNegozioProtetti,
        pezziTotali,
        puntiTotali,
        premioUnitario: 0, // Sarà calcolato dopo
        premioTotale: 0,   // Sarà calcolato dopo
      });
    }

    // Determina soglia raggiunta per la RS
    const sogliaRaggiunta = determinaSogliaRaggiunta(puntiTotaliRS, soglie, hasBPInRS);

    // Calcola premio per ogni PDV in base alla soglia raggiunta
    let premioTotaleRS = 0;
    for (const pdvResult of pdvResults) {
      const clusterPIva = pdvResult.clusterPIva as ClusterPIvaCode;
      if (!clusterPIva || !PREMI_EXTRA_GARA[clusterPIva]) {
        pdvResult.premioUnitario = 0;
        pdvResult.premioTotale = 0;
        continue;
      }
      
      const premioUnitario = PREMI_EXTRA_GARA[clusterPIva][sogliaRaggiunta];
      const premioTotale = pdvResult.pezziTotali * premioUnitario;
      
      pdvResult.premioUnitario = premioUnitario;
      pdvResult.premioTotale = premioTotale;
      premioTotaleRS += premioTotale;
    }

    results.push({
      ragioneSociale,
      isMultipos,
      numPdv: pdvList.length,
      pdvList: pdvList.map(p => p.codicePos),
      soglie,
      hasBPInRS,
      puntiTotaliRS,
      pezziTotaliRS,
      sogliaRaggiunta,
      pdvResults,
      premioTotaleRS,
    });
  }

  return results;
};

export const calcolaTotaleExtraGaraIva = (results: ExtraGaraIvaRsResult[]): number => {
  return results.reduce((sum, rs) => sum + rs.premioTotaleRS, 0);
};
