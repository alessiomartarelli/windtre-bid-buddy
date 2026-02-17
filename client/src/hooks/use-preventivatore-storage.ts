import { useCallback } from 'react';
import { ConfigGaraBase, PuntoVendita, PistaMobileConfig, MobileCategoryConfig, AttivatoMobileDettaglio, PistaMobileRSConfig, PistaFissoRSConfig, PartnershipRewardRSConfig } from '@/types/preventivatore';
import { PistaFissoPosConfig, AttivatoFissoRiga } from '@/lib/calcoloPistaFisso';
import { PartnershipRewardPosConfig } from '@/types/partnership-reward';
import { AttivatoCBDettaglio } from '@/types/partnership-cb-events';
import { ProtectaAttivatoRiga } from '@/types/protecta';
import { EnergiaConfig, EnergiaPdvInGara } from '@/types/energia';
import { AssicurazioniConfig, AssicurazioniPdvInGara } from '@/types/assicurazioni';
import { CalendariMeseOverrides } from '@/components/wizard/StepCalendarioMese';

const STORAGE_KEY = 'preventivatore-state';
const TEMPLATE_KEY = 'preventivatore-template';
const CONFIG_KEY = 'preventivatore-config'; // Nuova chiave per configurazione persistente

export interface PreventivatoreState {
  step: number;
  configGara: ConfigGaraBase;
  numeroPdv: number;
  puntiVendita: PuntoVendita[];
  pistaMobileConfig: PistaMobileConfig;
  pistaFissoConfig: { sogliePerPos: PistaFissoPosConfig[] };
  partnershipRewardConfig: { configPerPos: PartnershipRewardPosConfig[] };
  mobileCategories: MobileCategoryConfig[];
  attivatoMobileByPos: Record<string, AttivatoMobileDettaglio[]>;
  attivatoFissoByPos: Record<string, AttivatoFissoRiga[]>;
  attivatoCBByPos: Record<string, AttivatoCBDettaglio[]>;
  attivatoProtectaByPos: Record<string, ProtectaAttivatoRiga>;
  savedAt: string;
}

export interface PreventivatoreTemplate {
  configGara: ConfigGaraBase;
  numeroPdv: number;
  puntiVendita: PuntoVendita[];
  pistaMobileConfig: PistaMobileConfig;
  pistaFissoConfig: { sogliePerPos: PistaFissoPosConfig[] };
  partnershipRewardConfig: { configPerPos: PartnershipRewardPosConfig[] };
  mobileCategories: MobileCategoryConfig[];
  savedAt: string;
}

// Configurazione persistente tra simulazioni (PDV, cluster, calendari, soglie)
export interface PreventivatoreConfig {
  configGara: ConfigGaraBase;
  numeroPdv: number;
  puntiVendita: PuntoVendita[];
  pistaMobileConfig: PistaMobileConfig;
  pistaFissoConfig: { sogliePerPos: PistaFissoPosConfig[] };
  partnershipRewardConfig: { configPerPos: PartnershipRewardPosConfig[] };
  calendarioOverrides: CalendariMeseOverrides;
  energiaConfig: EnergiaConfig;
  energiaPdvInGara: EnergiaPdvInGara[];
  assicurazioniConfig: AssicurazioniConfig;
  assicurazioniPdvInGara: AssicurazioniPdvInGara[];
  // Configurazioni RS
  pistaMobileRSConfig?: PistaMobileRSConfig;
  pistaFissoRSConfig?: PistaFissoRSConfig;
  partnershipRewardRSConfig?: PartnershipRewardRSConfig;
  // Modalità inserimento RS
  modalitaInserimentoRS?: "per_rs" | "per_pdv" | null;
  // Extra Gara IVA soglie override per RS
  extraGaraSoglieOverride?: Record<string, { s1: number; s2: number; s3: number; s4: number }>;
  savedAt: string;
  configVersion: string;
}

export const usePreventivatoreStorage = () => {
  const saveState = useCallback((state: Omit<PreventivatoreState, 'savedAt'>) => {
    try {
      const stateToSave: PreventivatoreState = {
        ...state,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('Errore nel salvataggio dello stato:', error);
    }
  }, []);

  const loadState = useCallback((): PreventivatoreState | null => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      return JSON.parse(saved);
    } catch (error) {
      console.error('Errore nel caricamento dello stato:', error);
      return null;
    }
  }, []);

  const clearState = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Errore nella cancellazione dello stato:', error);
    }
  }, []);

  const saveTemplate = useCallback((template: Omit<PreventivatoreTemplate, 'savedAt'>) => {
    try {
      const templateToSave: PreventivatoreTemplate = {
        ...template,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templateToSave));
    } catch (error) {
      console.error('Errore nel salvataggio del template:', error);
    }
  }, []);

  const loadTemplate = useCallback((): PreventivatoreTemplate | null => {
    try {
      const saved = localStorage.getItem(TEMPLATE_KEY);
      if (!saved) return null;
      return JSON.parse(saved);
    } catch (error) {
      console.error('Errore nel caricamento del template:', error);
      return null;
    }
  }, []);

  // Nuove funzioni per la configurazione persistente
  const saveConfig = useCallback((config: Omit<PreventivatoreConfig, 'savedAt'>) => {
    try {
      const configToSave: PreventivatoreConfig = {
        ...config,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(configToSave));
    } catch (error) {
      console.error('Errore nel salvataggio della configurazione:', error);
    }
  }, []);

  const loadConfig = useCallback((): PreventivatoreConfig | null => {
    try {
      const saved = localStorage.getItem(CONFIG_KEY);
      if (!saved) return null;
      return JSON.parse(saved);
    } catch (error) {
      console.error('Errore nel caricamento della configurazione:', error);
      return null;
    }
  }, []);

  const clearConfig = useCallback(() => {
    try {
      localStorage.removeItem(CONFIG_KEY);
    } catch (error) {
      console.error('Errore nella cancellazione della configurazione:', error);
    }
  }, []);

  return { 
    saveState, loadState, clearState, 
    saveTemplate, loadTemplate,
    saveConfig, loadConfig, clearConfig 
  };
};
