import { PuntoVendita, StoreCalendar, PistaMobilePosConfig, ClusterCode, SoglieMobileRS, SoglieFissoRS, PartnershipRewardRS } from "@/types/preventivatore";
import { PartnershipRewardPosConfig, getDefaultTarget100, calculateTarget80, calculatePremio80 } from "@/types/partnership-reward";

export const mapClusterMobileToClusterPista = (clusterMobile: ClusterCode): 1 | 2 | 3 => {
  if (clusterMobile === "strada_1" || clusterMobile === "CC1" || clusterMobile === "local_x") {
    return 1;
  } else if (clusterMobile === "strada_2" || clusterMobile === "CC2") {
    return 2;
  } else if (clusterMobile === "strada_3" || clusterMobile === "CC3") {
    return 3;
  }
  return 1; // default
};

export const createEmptyCalendar = (): StoreCalendar => ({
  weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] },
  specialDays: [],
});

export const createEmptyPdv = (index: number): PuntoVendita => ({
  id: `pdv-${index}-${Math.random().toString(36).slice(2, 8)}`,
  codicePos: "",
  nome: "",
  ragioneSociale: "",
  tipoPosizione: "strada",
  canale: "franchising",
  clusterMobile: "",
  clusterFisso: "",
  clusterCB: "",
  clusterPIva: "",
  abilitaEnergia: true,
  abilitaAssicurazioni: true,
  ruoloBusiness: "none",
  calendar: createEmptyCalendar(),
});

export const getThresholdsByCluster = (
  tipoPosizione: string,
  clusterPista: 1 | 2 | 3,
  clusterMobile: string
): { soglia1: number; soglia2: number; soglia3: number; soglia4: number } => {
  // local_x usa gli stessi valori di Cluster 1 Strada
  if (clusterMobile === "local_x") {
    return { soglia1: 70, soglia2: 105, soglia3: 135, soglia4: 165 };
  }

  if (tipoPosizione === "strada") {
    switch (clusterPista) {
      case 1:
        return { soglia1: 70, soglia2: 105, soglia3: 135, soglia4: 165 };
      case 2:
        return { soglia1: 70, soglia2: 115, soglia3: 160, soglia4: 200 };
      case 3:
        return { soglia1: 70, soglia2: 130, soglia3: 185, soglia4: 225 };
      default:
        return { soglia1: 70, soglia2: 105, soglia3: 135, soglia4: 165 };
    }
  } else if (tipoPosizione === "centro_commerciale") {
    switch (clusterPista) {
      case 1:
        return { soglia1: 80, soglia2: 115, soglia3: 160, soglia4: 205 };
      case 2:
        return { soglia1: 80, soglia2: 120, soglia3: 185, soglia4: 225 };
      case 3:
        return { soglia1: 80, soglia2: 135, soglia3: 205, soglia4: 245 };
      default:
        return { soglia1: 80, soglia2: 115, soglia3: 160, soglia4: 205 };
    }
  }
  // Default per "altro"
  return { soglia1: 70, soglia2: 105, soglia3: 135, soglia4: 165 };
};

export const createDefaultPistaMobileConfig = (): PistaMobilePosConfig => ({
  posCode: "",
  soglia1: 70,
  soglia2: 105,
  soglia3: 135,
  soglia4: 165,
  multiplierSoglia1: 1,
  multiplierSoglia2: 1.2,
  multiplierSoglia3: 1.5,
  multiplierSoglia4: 2,
  canoneMedio: 10,
  forecastTargetPunti: 100,
  clusterPista: 1,
});

/**
 * Mappa cluster FISSO (stringa) a numero 1|2|3
 */
export const mapClusterFissoToNumber = (clusterFisso: ClusterCode | ""): 1 | 2 | 3 => {
  if (clusterFisso === "strada_1" || clusterFisso === "CC1" || clusterFisso === "local_x") {
    return 1;
  } else if (clusterFisso === "strada_2" || clusterFisso === "CC2") {
    return 2;
  } else if (clusterFisso === "strada_3" || clusterFisso === "CC3") {
    return 3;
  }
  return 1; // default
};

/**
 * Restituisce le soglie di default per FISSO in base a tipoPosizione e cluster
 */
export const getDefaultFissoThresholds = (
  tipoPosizione: string,
  clusterFisso: 1 | 2 | 3
): { soglia1: number; soglia2: number; soglia3: number; soglia4: number; soglia5: number } => {
  if (tipoPosizione === "strada") {
    switch (clusterFisso) {
      case 1:
        return { soglia1: 28, soglia2: 46, soglia3: 57, soglia4: 67, soglia5: 80 };
      case 2:
        return { soglia1: 34, soglia2: 60, soglia3: 72, soglia4: 83, soglia5: 97 };
      case 3:
        return { soglia1: 39, soglia2: 67, soglia3: 82, soglia4: 96, soglia5: 108 };
    }
  } else if (tipoPosizione === "centro_commerciale") {
    switch (clusterFisso) {
      case 1:
        return { soglia1: 30, soglia2: 48, soglia3: 59, soglia4: 70, soglia5: 84 };
      case 2:
        return { soglia1: 36, soglia2: 62, soglia3: 74, soglia4: 86, soglia5: 100 };
      case 3:
        return { soglia1: 41, soglia2: 69, soglia3: 84, soglia4: 99, soglia5: 110 };
    }
  }
  
  // Default fallback
  return { soglia1: 0, soglia2: 0, soglia3: 0, soglia4: 0, soglia5: 0 };
};

/* =============================================================================
   HELPER PER RAGIONE SOCIALE (GARA OPERATORE RS)
============================================================================== */

/**
 * Raggruppa PDV per ragioneSociale
 */
export const raggruppaPdvPerRS = (puntiVendita: PuntoVendita[]): Map<string, PuntoVendita[]> => {
  const map = new Map<string, PuntoVendita[]>();
  for (const pdv of puntiVendita) {
    const rs = pdv.ragioneSociale || "Senza RS";
    if (!map.has(rs)) map.set(rs, []);
    map.get(rs)!.push(pdv);
  }
  return map;
};

/**
 * Calcola le soglie Mobile aggregate di default per una Ragione Sociale
 * sommando le soglie di tutti i PDV della RS
 */
export const getDefaultSoglieMobileRS = (
  pdvList: PuntoVendita[]
): Omit<SoglieMobileRS, 'ragioneSociale'> => {
  let totale = { soglia1: 0, soglia2: 0, soglia3: 0, soglia4: 0 };
  
  for (const pdv of pdvList) {
    if (!pdv.clusterMobile) continue;
    const clusterPista = mapClusterMobileToClusterPista(pdv.clusterMobile as ClusterCode);
    const thresholds = getThresholdsByCluster(pdv.tipoPosizione, clusterPista, pdv.clusterMobile);
    totale.soglia1 += thresholds.soglia1;
    totale.soglia2 += thresholds.soglia2;
    totale.soglia3 += thresholds.soglia3;
    totale.soglia4 += thresholds.soglia4;
  }
  
  return { 
    ...totale, 
    canoneMedio: 10, 
    forecastTargetPunti: totale.soglia4 
  };
};

/**
 * Calcola le soglie Fisso aggregate di default per una Ragione Sociale
 * sommando le soglie di tutti i PDV della RS
 */
export const getDefaultSoglieFissoRS = (
  pdvList: PuntoVendita[]
): Omit<SoglieFissoRS, 'ragioneSociale'> => {
  let totale = { soglia1: 0, soglia2: 0, soglia3: 0, soglia4: 0, soglia5: 0 };
  
  for (const pdv of pdvList) {
    if (!pdv.clusterFisso) continue;
    const clusterNum = mapClusterFissoToNumber(pdv.clusterFisso as ClusterCode);
    const thresholds = getDefaultFissoThresholds(pdv.tipoPosizione, clusterNum);
    totale.soglia1 += thresholds.soglia1;
    totale.soglia2 += thresholds.soglia2;
    totale.soglia3 += thresholds.soglia3;
    totale.soglia4 += thresholds.soglia4;
    totale.soglia5 += thresholds.soglia5;
  }
  
  return { 
    ...totale, 
    forecastTargetPunti: totale.soglia5 
  };
};

/**
 * Genera le configurazioni di default per tutte le Ragioni Sociali (Mobile)
 */
export const generaSoglieMobileRSDefault = (puntiVendita: PuntoVendita[]): SoglieMobileRS[] => {
  const rsMap = raggruppaPdvPerRS(puntiVendita);
  const result: SoglieMobileRS[] = [];
  
  rsMap.forEach((pdvList, ragioneSociale) => {
    const defaults = getDefaultSoglieMobileRS(pdvList);
    result.push({
      ragioneSociale,
      ...defaults,
    });
  });
  
  return result;
};

/**
 * Genera le configurazioni di default per tutte le Ragioni Sociali (Fisso)
 */
export const generaSoglieFissoRSDefault = (puntiVendita: PuntoVendita[]): SoglieFissoRS[] => {
  const rsMap = raggruppaPdvPerRS(puntiVendita);
  const result: SoglieFissoRS[] = [];
  
  rsMap.forEach((pdvList, ragioneSociale) => {
    const defaults = getDefaultSoglieFissoRS(pdvList);
    result.push({
      ragioneSociale,
      ...defaults,
    });
  });
  
  return result;
};

/**
 * Calcola i valori aggregati Partnership Reward per una Ragione Sociale
 * sommando i valori dei PDV associati
 */
export const getDefaultPartnershipRS = (
  pdvList: PuntoVendita[],
  partnershipConfig: { configPerPos: PartnershipRewardPosConfig[] },
  allPdv: PuntoVendita[]
): Omit<PartnershipRewardRS, 'ragioneSociale'> => {
  let totalTarget100 = 0;
  let totalPremio100 = 0;
  
  pdvList.forEach((pdv) => {
    const index = allPdv.findIndex((p) => p.id === pdv.id);
    const conf = partnershipConfig.configPerPos[index];
    if (conf) {
      totalTarget100 += conf.config.target100 || 0;
      totalPremio100 += conf.config.premio100 || 0;
    } else {
      // Usa valori default se non configurato
      const tipoPosizione = pdv.tipoPosizione === "centro_commerciale" ? "centro_commerciale" : 
                           pdv.tipoPosizione === "strada" ? "strada" : "altro";
      const defaultTarget = getDefaultTarget100(tipoPosizione, pdv.clusterCB || "strada_1");
      totalTarget100 += defaultTarget;
      totalPremio100 += 100; // Premio default
    }
  });
  
  return {
    target100: totalTarget100,
    target80: calculateTarget80(totalTarget100),
    premio100: totalPremio100,
    premio80: calculatePremio80(totalPremio100),
  };
};

/**
 * Genera le configurazioni Partnership Reward di default per tutte le Ragioni Sociali
 */
export const generaPartnershipRSDefault = (
  puntiVendita: PuntoVendita[],
  partnershipConfig: { configPerPos: PartnershipRewardPosConfig[] }
): PartnershipRewardRS[] => {
  const rsMap = raggruppaPdvPerRS(puntiVendita);
  const result: PartnershipRewardRS[] = [];
  
  rsMap.forEach((pdvList, ragioneSociale) => {
    const defaults = getDefaultPartnershipRS(pdvList, partnershipConfig, puntiVendita);
    result.push({
      ragioneSociale,
      ...defaults,
    });
  });
  
  return result;
};
