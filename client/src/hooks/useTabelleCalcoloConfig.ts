import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { MOBILE_CATEGORIES_CONFIG_DEFAULT, MobileCategoryConfig } from "@/types/preventivatore";
import { ENERGIA_BASE_PAY, PISTA_ENERGIA_BONUS_PER_CONTRATTO, PISTA_ENERGIA_SOGLIE_BASE, PISTA_ENERGIA_SOGLIE_DA4, PistaEnergiaSoglia } from "@/types/energia";
import { ASSICURAZIONI_POINTS, ASSICURAZIONI_PREMIUMS } from "@/types/assicurazioni";
import { PROTECTA_GETTONI, ProtectaProduct } from "@/types/protecta";
import { PUNTI_EXTRA_GARA, SOGLIE_BASE_EXTRA_GARA, PREMI_EXTRA_GARA } from "@/lib/calcoloExtraGaraIva";
import { FISSO_CATEGORIE_DEFAULT, FissoCategoriaConfig } from "@/lib/calcoloPistaFisso";
import { ClusterPIvaCode } from "@/types/preventivatore";

export interface TabelleCalcoloValues {
  mobile: {
    categories: MobileCategoryConfig[];
    soglieCluster: Record<string, number[]>;
    moltiplicatoriCanone: Record<string, number[]>;
  };
  fisso: {
    euroPerPezzo: Record<string, number>;
    gettoniContrattuali: Record<string, number>;
    soglieCluster: Record<string, number[]>;
  };
  energia: {
    compensiBase: Record<string, number>;
    bonusPerContratto: Record<string, number>;
    pistaBase: Record<string, number>;
    pistaDa4: Record<string, number>;
  };
  assicurazioni: {
    puntiProdotto: Record<string, number>;
    premiProdotto: Record<string, number>;
  };
  protecta: {
    gettoniProdotto: Record<string, number>;
  };
  extraGara: {
    puntiAttivazione: Record<string, number>;
    soglieMultipos: Record<string, Record<string, number>>;
    soglieMonopos: Record<string, Record<string, number>>;
    premiPerSoglia: Record<string, number[]>;
  };
}

function deepGet(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function mergeConfigs(systemConfig: any, orgOverrides: any): any {
  if (!systemConfig && !orgOverrides) return {};
  const result = JSON.parse(JSON.stringify(systemConfig || {}));
  if (!orgOverrides) return result;

  for (const section of Object.keys(orgOverrides)) {
    if (!result[section]) result[section] = {};
    for (const subKey of Object.keys(orgOverrides[section])) {
      const override = orgOverrides[section][subKey];
      if (override && typeof override === "object" && !Array.isArray(override)) {
        if (!result[section][subKey]) result[section][subKey] = {};
        Object.assign(result[section][subKey], override);
      } else if (Array.isArray(override)) {
        if (!result[section][subKey]) result[section][subKey] = [];
        result[section][subKey] = [...override];
      } else {
        result[section][subKey] = override;
      }
    }
  }
  return result;
}

function buildDefaults(): TabelleCalcoloValues {
  const mobilePunti: Record<string, number> = {};
  MOBILE_CATEGORIES_CONFIG_DEFAULT.forEach((c) => {
    mobilePunti[c.type] = c.punti;
  });

  const fissoEuro: Record<string, number> = {};
  const fissoGettoni: Record<string, number> = {};
  FISSO_CATEGORIE_DEFAULT.forEach((c) => {
    fissoEuro[c.type] = c.euroPerPezzo;
  });
  fissoGettoni["FISSO_FTTC"] = 23;
  fissoGettoni["FISSO_FTTH"] = 23;
  fissoGettoni["FISSO_FWA_OUT"] = 23;
  fissoGettoni["FISSO_FWA_IND_2P"] = 23;
  fissoGettoni["CONVERGENZA"] = 23;
  fissoGettoni["LINEA_ATTIVA"] = 23;
  fissoGettoni["FISSO_PIVA_1A_LINEA"] = 23;
  fissoGettoni["FISSO_PIVA_2A_LINEA"] = 10;
  fissoGettoni["MIGRAZIONI_FTTH_FWA"] = 40;

  const energiaCompensi: Record<string, number> = { ...ENERGIA_BASE_PAY };
  const energiaBonus: Record<string, number> = {};
  (Object.keys(PISTA_ENERGIA_BONUS_PER_CONTRATTO) as PistaEnergiaSoglia[]).forEach((k) => {
    energiaBonus[k] = PISTA_ENERGIA_BONUS_PER_CONTRATTO[k];
  });

  const assicPunti: Record<string, number> = { ...ASSICURAZIONI_POINTS };
  const assicPremi: Record<string, number> = { ...ASSICURAZIONI_PREMIUMS };

  const protectaGettoni: Record<string, number> = { ...PROTECTA_GETTONI };

  const extraPunti: Record<string, number> = { ...PUNTI_EXTRA_GARA };
  const extraSoglieMulti: Record<string, Record<string, number>> = {
    conBP: { ...SOGLIE_BASE_EXTRA_GARA.multipos.conBP },
    senzaBP: { ...SOGLIE_BASE_EXTRA_GARA.multipos.senzaBP },
  };
  const extraSoglieMono: Record<string, Record<string, number>> = {
    conBP: { ...SOGLIE_BASE_EXTRA_GARA.monopos.conBP },
    senzaBP: { ...SOGLIE_BASE_EXTRA_GARA.monopos.senzaBP },
  };
  const extraPremi: Record<string, number[]> = {};
  for (const cluster of Object.keys(PREMI_EXTRA_GARA)) {
    extraPremi[cluster] = [...PREMI_EXTRA_GARA[cluster as ClusterPIvaCode]];
  }

  const mobileSoglieCluster: Record<string, number[]> = {
    strada_1: [70, 105, 135, 165],
    strada_2: [70, 115, 160, 200],
    strada_3: [70, 130, 185, 225],
    cc_1: [80, 115, 160, 205],
    cc_2: [80, 120, 185, 225],
    cc_3: [80, 135, 205, 245],
  };

  const moltiplicatoriCanone: Record<string, number[]> = {
    ga_base: [1.0, 1.5, 2.0, 2.25],
    ga_underground: [0.5, 1.0, 1.5, 1.75],
    mnp: [1.0, 1.0, 1.0, 1.0],
    tied: [2.0, 2.0, 2.25, 2.25],
    piva: [1.0, 1.0, 1.0, 1.0],
  };

  const fissoSoglieCluster: Record<string, number[]> = {
    strada_1: [28, 46, 57, 67, 80],
    strada_2: [34, 60, 72, 83, 97],
    strada_3: [39, 67, 82, 96, 108],
    cc_1: [30, 48, 59, 70, 84],
    cc_2: [36, 62, 74, 86, 100],
    cc_3: [41, 69, 84, 99, 110],
  };

  const pistaBase: Record<string, number> = { ...PISTA_ENERGIA_SOGLIE_BASE };
  const pistaDa4: Record<string, number> = { ...PISTA_ENERGIA_SOGLIE_DA4 };

  return {
    mobile: { categories: [...MOBILE_CATEGORIES_CONFIG_DEFAULT], soglieCluster: mobileSoglieCluster, moltiplicatoriCanone },
    fisso: { euroPerPezzo: fissoEuro, gettoniContrattuali: fissoGettoni, soglieCluster: fissoSoglieCluster },
    energia: { compensiBase: energiaCompensi, bonusPerContratto: energiaBonus, pistaBase, pistaDa4 },
    assicurazioni: { puntiProdotto: assicPunti, premiProdotto: assicPremi },
    protecta: { gettoniProdotto: protectaGettoni },
    extraGara: {
      puntiAttivazione: extraPunti,
      soglieMultipos: extraSoglieMulti,
      soglieMonopos: extraSoglieMono,
      premiPerSoglia: extraPremi,
    },
  };
}

function applyConfigToDefaults(merged: any, defaults: TabelleCalcoloValues): TabelleCalcoloValues {
  const result = JSON.parse(JSON.stringify(defaults)) as TabelleCalcoloValues;

  if (merged.mobile?.puntiAttivazione) {
    result.mobile.categories = result.mobile.categories.map((cat) => {
      const override = merged.mobile.puntiAttivazione[cat.type];
      if (override !== undefined) {
        return { ...cat, punti: override };
      }
      return cat;
    });
  }

  if (merged.mobile?.soglieCluster) {
    for (const key of Object.keys(merged.mobile.soglieCluster)) {
      const arr = merged.mobile.soglieCluster[key];
      if (Array.isArray(arr)) result.mobile.soglieCluster[key] = [...arr];
    }
  }
  if (merged.mobile?.moltiplicatoriCanone) {
    for (const key of Object.keys(merged.mobile.moltiplicatoriCanone)) {
      const arr = merged.mobile.moltiplicatoriCanone[key];
      if (Array.isArray(arr)) result.mobile.moltiplicatoriCanone[key] = [...arr];
    }
  }

  if (merged.fisso?.euroPerPezzo) {
    Object.assign(result.fisso.euroPerPezzo, merged.fisso.euroPerPezzo);
  }
  if (merged.fisso?.gettoniContrattuali) {
    Object.assign(result.fisso.gettoniContrattuali, merged.fisso.gettoniContrattuali);
  }
  if (merged.fisso?.soglieCluster) {
    for (const key of Object.keys(merged.fisso.soglieCluster)) {
      const arr = merged.fisso.soglieCluster[key];
      if (Array.isArray(arr)) result.fisso.soglieCluster[key] = [...arr];
    }
  }

  if (merged.energia?.compensiBase) {
    Object.assign(result.energia.compensiBase, merged.energia.compensiBase);
  }
  if (merged.energia?.bonusPerContratto) {
    Object.assign(result.energia.bonusPerContratto, merged.energia.bonusPerContratto);
  }
  if (merged.energia?.pistaBase) {
    Object.assign(result.energia.pistaBase, merged.energia.pistaBase);
  }
  if (merged.energia?.pistaDa4) {
    Object.assign(result.energia.pistaDa4, merged.energia.pistaDa4);
  }

  if (merged.assicurazioni?.puntiProdotto) {
    Object.assign(result.assicurazioni.puntiProdotto, merged.assicurazioni.puntiProdotto);
  }
  if (merged.assicurazioni?.premiProdotto) {
    Object.assign(result.assicurazioni.premiProdotto, merged.assicurazioni.premiProdotto);
  }

  if (merged.protecta?.gettoniProdotto) {
    Object.assign(result.protecta.gettoniProdotto, merged.protecta.gettoniProdotto);
  }

  if (merged.extraGara?.puntiAttivazione) {
    Object.assign(result.extraGara.puntiAttivazione, merged.extraGara.puntiAttivazione);
  }
  if (merged.extraGara?.soglieMultipos) {
    for (const key of Object.keys(merged.extraGara.soglieMultipos)) {
      if (!result.extraGara.soglieMultipos[key]) result.extraGara.soglieMultipos[key] = {};
      Object.assign(result.extraGara.soglieMultipos[key], merged.extraGara.soglieMultipos[key]);
    }
  }
  if (merged.extraGara?.soglieMonopos) {
    for (const key of Object.keys(merged.extraGara.soglieMonopos)) {
      if (!result.extraGara.soglieMonopos[key]) result.extraGara.soglieMonopos[key] = {};
      Object.assign(result.extraGara.soglieMonopos[key], merged.extraGara.soglieMonopos[key]);
    }
  }
  if (merged.extraGara?.premiPerSoglia) {
    for (const key of Object.keys(merged.extraGara.premiPerSoglia)) {
      const arr = merged.extraGara.premiPerSoglia[key];
      if (Array.isArray(arr)) {
        result.extraGara.premiPerSoglia[key] = [...arr];
      }
    }
  }

  return result;
}

export function useTabelleCalcoloConfig(): {
  config: TabelleCalcoloValues;
  isLoading: boolean;
} {
  const { user } = useAuth();

  const { data: systemConfigData, isLoading: sysLoading } = useQuery<{ config: any }>({
    queryKey: ["/api/system-config/tabelle_calcolo"],
    enabled: !!user,
  });

  const { data: orgConfigData, isLoading: orgLoading } = useQuery<{ config: any }>({
    queryKey: ["/api/organization-config"],
    enabled: !!user,
  });

  const defaults = useMemo(() => buildDefaults(), []);

  const config = useMemo(() => {
    if (sysLoading || orgLoading) {
      return defaults;
    }
    const systemConfig = systemConfigData?.config || {};
    const orgOverrides = orgConfigData?.config?.tabelleCalcolo || null;
    const merged = mergeConfigs(systemConfig, orgOverrides);
    return applyConfigToDefaults(merged, defaults);
  }, [sysLoading, orgLoading, systemConfigData, orgConfigData, defaults]);

  return { config, isLoading: sysLoading || orgLoading };
}
