import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { MOBILE_CATEGORIES_CONFIG_DEFAULT, MobileCategoryConfig } from "@/types/preventivatore";
import { ENERGIA_BASE_PAY, PISTA_ENERGIA_BONUS_PER_CONTRATTO, PistaEnergiaSoglia } from "@/types/energia";
import { ASSICURAZIONI_POINTS, ASSICURAZIONI_PREMIUMS } from "@/types/assicurazioni";
import { PROTECTA_GETTONI, ProtectaProduct } from "@/types/protecta";
import { PUNTI_EXTRA_GARA, SOGLIE_BASE_EXTRA_GARA, PREMI_EXTRA_GARA } from "@/lib/calcoloExtraGaraIva";
import { FISSO_CATEGORIE_DEFAULT, FissoCategoriaConfig } from "@/lib/calcoloPistaFisso";
import { ClusterPIvaCode } from "@/types/preventivatore";

export interface TabelleCalcoloValues {
  mobile: {
    categories: MobileCategoryConfig[];
  };
  fisso: {
    euroPerPezzo: Record<string, number>;
    gettoniContrattuali: Record<string, number>;
  };
  energia: {
    compensiBase: Record<string, number>;
    bonusPerContratto: Record<string, number>;
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

  return {
    mobile: { categories: [...MOBILE_CATEGORIES_CONFIG_DEFAULT] },
    fisso: { euroPerPezzo: fissoEuro, gettoniContrattuali: fissoGettoni },
    energia: { compensiBase: energiaCompensi, bonusPerContratto: energiaBonus },
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

  if (merged.fisso?.euroPerPezzo) {
    Object.assign(result.fisso.euroPerPezzo, merged.fisso.euroPerPezzo);
  }
  if (merged.fisso?.gettoniContrattuali) {
    Object.assign(result.fisso.gettoniContrattuali, merged.fisso.gettoniContrattuali);
  }

  if (merged.energia?.compensiBase) {
    Object.assign(result.energia.compensiBase, merged.energia.compensiBase);
  }
  if (merged.energia?.bonusPerContratto) {
    Object.assign(result.energia.bonusPerContratto, merged.energia.bonusPerContratto);
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

  const defaults = buildDefaults();

  if (sysLoading || orgLoading) {
    return { config: defaults, isLoading: true };
  }

  const systemConfig = systemConfigData?.config || {};
  const orgOverrides = orgConfigData?.config?.tabelleCalcolo || null;

  const merged = mergeConfigs(systemConfig, orgOverrides);
  const config = applyConfigToDefaults(merged, defaults);

  return { config, isLoading: false };
}
