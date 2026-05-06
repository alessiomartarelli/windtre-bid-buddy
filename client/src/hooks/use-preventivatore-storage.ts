import { useCallback, useEffect } from 'react';
import { ConfigGaraBase, PuntoVendita, PistaMobileConfig, MobileCategoryConfig, AttivatoMobileDettaglio, PistaMobileRSConfig, PistaFissoRSConfig, PartnershipRewardRSConfig } from '@/types/preventivatore';
import { PistaFissoPosConfig, AttivatoFissoRiga } from '@/lib/calcoloPistaFisso';
import { PartnershipRewardPosConfig } from '@/types/partnership-reward';
import { AttivatoCBDettaglio } from '@/types/partnership-cb-events';
import { ProtectaAttivatoRiga } from '@/types/protecta';
import { EnergiaConfig, EnergiaPdvInGara } from '@/types/energia';
import { AssicurazioniConfig, AssicurazioniPdvInGara } from '@/types/assicurazioni';
import { CalendariMeseOverrides } from '@/components/wizard/StepCalendarioMese';

const BASE_STATE_KEY = 'preventivatore-state';
const BASE_TEMPLATE_KEY = 'preventivatore-template';
const BASE_CONFIG_KEY = 'preventivatore-config';

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
  extraGaraSoglieOverride?: Record<string, { s1?: number; s2?: number; s3?: number; s4?: number; pdvCount?: number }>;
  savedAt: string;
  configVersion: string;
}

// Cancella le vecchie chiavi globali NON scoped per organizzazione (legacy).
// Necessario perché in passato lo storage non separava le organizzazioni e i
// dati di un'organizzazione potevano essere caricati per un'altra (data leak).
function purgeLegacyUnscopedKeys() {
  try {
    localStorage.removeItem(BASE_STATE_KEY);
    localStorage.removeItem(BASE_TEMPLATE_KEY);
    localStorage.removeItem(BASE_CONFIG_KEY);
  } catch {
    // ignore
  }
}

/**
 * Hook di storage per il wizard del simulatore.
 * IMPORTANTE: tutte le chiavi vengono scoped per `organizationId` per evitare
 * che dati di un'organizzazione vengano letti da un'altra sullo stesso browser.
 * Se `organizationId` è null/undefined il hook diventa un no-op (nessuna lettura
 * né scrittura) finché l'auth non è caricata.
 */
export const usePreventivatoreStorage = (organizationId?: string | null) => {
  // Pulizia una tantum delle chiavi legacy globali
  useEffect(() => {
    purgeLegacyUnscopedKeys();
  }, []);

  const orgSuffix = organizationId ? `:${organizationId}` : null;
  const stateKey = orgSuffix ? `${BASE_STATE_KEY}${orgSuffix}` : null;
  const templateKey = orgSuffix ? `${BASE_TEMPLATE_KEY}${orgSuffix}` : null;
  const configKey = orgSuffix ? `${BASE_CONFIG_KEY}${orgSuffix}` : null;

  const saveState = useCallback((state: Omit<PreventivatoreState, 'savedAt'>) => {
    if (!stateKey) return;
    try {
      const stateToSave: PreventivatoreState = {
        ...state,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(stateKey, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('Errore nel salvataggio dello stato:', error);
    }
  }, [stateKey]);

  const loadState = useCallback((): PreventivatoreState | null => {
    if (!stateKey) return null;
    try {
      const saved = localStorage.getItem(stateKey);
      if (!saved) return null;
      return JSON.parse(saved);
    } catch (error) {
      console.error('Errore nel caricamento dello stato:', error);
      return null;
    }
  }, [stateKey]);

  const clearState = useCallback(() => {
    if (!stateKey) return;
    try {
      localStorage.removeItem(stateKey);
    } catch (error) {
      console.error('Errore nella cancellazione dello stato:', error);
    }
  }, [stateKey]);

  const saveTemplate = useCallback((template: Omit<PreventivatoreTemplate, 'savedAt'>) => {
    if (!templateKey) return;
    try {
      const templateToSave: PreventivatoreTemplate = {
        ...template,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(templateKey, JSON.stringify(templateToSave));
    } catch (error) {
      console.error('Errore nel salvataggio del template:', error);
    }
  }, [templateKey]);

  const loadTemplate = useCallback((): PreventivatoreTemplate | null => {
    if (!templateKey) return null;
    try {
      const saved = localStorage.getItem(templateKey);
      if (!saved) return null;
      return JSON.parse(saved);
    } catch (error) {
      console.error('Errore nel caricamento del template:', error);
      return null;
    }
  }, [templateKey]);

  const saveConfig = useCallback((config: Omit<PreventivatoreConfig, 'savedAt'>) => {
    if (!configKey) return;
    try {
      const configToSave: PreventivatoreConfig = {
        ...config,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(configKey, JSON.stringify(configToSave));
    } catch (error) {
      console.error('Errore nel salvataggio della configurazione:', error);
    }
  }, [configKey]);

  const loadConfig = useCallback((): PreventivatoreConfig | null => {
    if (!configKey) return null;
    try {
      const saved = localStorage.getItem(configKey);
      if (!saved) return null;
      return JSON.parse(saved);
    } catch (error) {
      console.error('Errore nel caricamento della configurazione:', error);
      return null;
    }
  }, [configKey]);

  const clearConfig = useCallback(() => {
    if (!configKey) return;
    try {
      localStorage.removeItem(configKey);
    } catch (error) {
      console.error('Errore nella cancellazione della configurazione:', error);
    }
  }, [configKey]);

  return {
    saveState, loadState, clearState,
    saveTemplate, loadTemplate,
    saveConfig, loadConfig, clearConfig,
    isReady: !!orgSuffix,
  };
};
