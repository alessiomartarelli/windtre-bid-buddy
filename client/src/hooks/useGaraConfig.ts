import { useState, useCallback, useRef, useEffect } from 'react';
import { apiUrl } from '@/lib/basePath';

export interface GaraConfigPdv {
  id: string;
  codicePos: string;
  nome: string;
  ragioneSociale: string;
  tipoPosizione: string;
  canale: string;
  clusterMobile: string;
  clusterFisso: string;
  clusterCB: string;
  clusterPIva: string;
  abilitaEnergia: boolean;
  abilitaAssicurazioni: boolean;
  calendar: {
    weeklySchedule: { workingDays: number[] };
    specialDays?: { date: string; isOpen: boolean; note?: string }[];
  };
}

export interface GaraConfigData {
  pdvList: GaraConfigPdv[];
  importedFrom?: {
    type: string;
    pdvConfigurationId?: string;
    pdvConfigurationName?: string;
    organizationConfigId?: string;
    importedAt: string;
  };
  tipologiaGara?: 'gara_operatore' | 'gara_operatore_rs';
  modalitaInserimentoRS?: 'per_pdv' | 'per_rs' | null;
  pistaMobileConfig?: {
    sogliePerPos: Array<{
      posCode: string;
      soglia1: number;
      soglia2: number;
      soglia3: number;
      soglia4: number;
      multiplierSoglia1?: number;
      multiplierSoglia2?: number;
      multiplierSoglia3?: number;
      multiplierSoglia4?: number;
      forecastTargetPunti: number;
      clusterPista?: number;
    }>;
  };
  pistaFissoConfig?: {
    sogliePerPos: Array<{
      posCode: string;
      soglia1: number;
      soglia2: number;
      soglia3: number;
      soglia4: number;
      soglia5: number;
      multiplierSoglia1?: number;
      multiplierSoglia2?: number;
      multiplierSoglia3?: number;
      multiplierSoglia4?: number;
      multiplierSoglia5?: number;
      forecastTargetPunti: number;
    }>;
  };
  partnershipRewardConfig?: {
    configPerPos: Array<{
      posCode: string;
      config: {
        target100: number;
        target80: number;
        premio100: number;
        premio80: number;
      };
    }>;
  };
  pistaMobileRSConfig?: {
    sogliePerRS: Array<{
      ragioneSociale: string;
      soglia1: number;
      soglia2: number;
      soglia3: number;
      soglia4: number;
      multiplierSoglia1?: number;
      multiplierSoglia2?: number;
      multiplierSoglia3?: number;
      multiplierSoglia4?: number;
      forecastTargetPunti: number;
    }>;
  };
  pistaFissoRSConfig?: {
    sogliePerRS: Array<{
      ragioneSociale: string;
      soglia1: number;
      soglia2: number;
      soglia3: number;
      soglia4: number;
      soglia5: number;
      multiplierSoglia1?: number;
      multiplierSoglia2?: number;
      multiplierSoglia3?: number;
      multiplierSoglia4?: number;
      multiplierSoglia5?: number;
      forecastTargetPunti: number;
    }>;
  };
  partnershipRewardRSConfig?: {
    configPerRS: Array<{
      ragioneSociale: string;
      target100: number;
      target80: number;
      premio100: number;
      premio80: number;
    }>;
  };
  energiaConfig?: {
    pdvInGara: number;
    targetNoMalus: number;
    targetS1: number;
    targetS2: number;
    targetS3: number;
    premio?: number;
    premioS1?: number;
    premioS2?: number;
    premioS3?: number;
    pistaSoglia_S1?: number;
    pistaSoglia_S2?: number;
    pistaSoglia_S3?: number;
    pistaSoglia_S4?: number;
    pistaSoglia_S5?: number;
  };
  assicurazioniConfig?: {
    pdvInGara: number;
    targetNoMalus: number;
    targetS1: number;
    targetS2: number;
    premio?: number;
    premioS1?: number;
    premioS2?: number;
  };
  energiaRSConfig?: {
    configPerRS: Array<{
      ragioneSociale: string;
      pdvInGara: number;
      targetNoMalus: number;
      targetS1: number;
      targetS2: number;
      targetS3: number;
      premio?: number;
      premioS1?: number;
      premioS2?: number;
      premioS3?: number;
      pistaSoglia_S1?: number;
      pistaSoglia_S2?: number;
      pistaSoglia_S3?: number;
      pistaSoglia_S4?: number;
      pistaSoglia_S5?: number;
    }>;
  };
  assicurazioniRSConfig?: {
    configPerRS: Array<{
      ragioneSociale: string;
      pdvInGara: number;
      targetNoMalus: number;
      targetS1: number;
      targetS2: number;
      premio?: number;
      premioS1?: number;
      premioS2?: number;
    }>;
  };
  extraGaraIvaConfig?: {
    puntiAttivazione?: Record<string, number>;
    soglieMultipos?: Record<string, Record<string, number>>;
    soglieMonopos?: Record<string, Record<string, number>>;
    premiPerSoglia?: Record<string, number[]>;
  };
  extraGaraIvaSogliePerRS?: {
    [ragioneSociale: string]: { s1?: number; s2?: number; s3?: number; s4?: number; pdvCount?: number; clusterPIva?: string; codiciRS?: string[] };
  };
  tabelleCalcolo?: {
    mobile?: {
      soglieCluster?: Record<string, number[]>;
      puntiAttivazione?: Record<string, number>;
      moltiplicatoriCanone?: Record<string, number[]>;
    };
    fisso?: {
      soglieCluster?: Record<string, number[]>;
      euroPerPezzo?: Record<string, number>;
      gettoniContrattuali?: Record<string, number>;
    };
    energia?: {
      compensiBase?: Record<string, number>;
      pistaBase?: Record<string, number>;
      pistaDa4?: Record<string, number>;
      bonusPerContratto?: Record<string, number>;
    };
    assicurazioni?: {
      puntiProdotto?: Record<string, number>;
      premiProdotto?: Record<string, number>;
    };
    protecta?: {
      gettoniProdotto?: Record<string, number>;
    };
    extraGara?: {
      puntiAttivazione?: Record<string, number>;
      soglieMultipos?: Record<string, Record<string, number>>;
      soglieMonopos?: Record<string, Record<string, number>>;
      premiPerSoglia?: Record<string, number[]>;
    };
  };
  pistaMobile?: Record<string, unknown>;
  pistaFisso?: Record<string, unknown>;
  calendarioGara?: Record<string, unknown>;
}

export interface GaraConfigRecord {
  id: string;
  organizationId: string;
  month: number;
  year: number;
  name: string | null;
  config: GaraConfigData;
  createdAt: string;
  updatedAt: string;
}

export interface GaraConfigListItem {
  id: string;
  name: string | null;
  month: number;
  year: number;
  updatedAt: string | null;
  createdAt: string | null;
}

export interface GaraConfigHistoryEntry {
  month: number;
  year: number;
  updatedAt: string | null;
}

export interface SalesPdvEntry {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  salesCount: number;
}

export function useGaraConfig() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<GaraConfigRecord | null>(null);
  const [configList, setConfigList] = useState<GaraConfigListItem[]>([]);
  const [history, setHistory] = useState<GaraConfigHistoryEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchConfig = useCallback(async (month: number, year: number, id?: string) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const url = id
        ? apiUrl(`/api/gara-config?id=${id}`)
        : apiUrl(`/api/gara-config?month=${month}&year=${year}`);
      const res = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Failed to fetch config');
      const data = await res.json();
      if (!controller.signal.aborted) {
        setConfig(data);
      }
      return data as GaraConfigRecord | null;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      console.error('[GaraConfig] Error fetching:', err);
      if (!controller.signal.aborted) setConfig(null);
      return null;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const fetchConfigList = useCallback(async (month: number, year: number) => {
    try {
      const res = await fetch(apiUrl(`/api/gara-config/list?month=${month}&year=${year}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch config list');
      const data = await res.json();
      setConfigList(data);
      return data as GaraConfigListItem[];
    } catch (err) {
      console.error('[GaraConfig] Error fetching list:', err);
      setConfigList([]);
      return [];
    }
  }, []);

  const saveConfig = useCallback(async (month: number, year: number, configData: GaraConfigData, name: string, existingId?: string) => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/gara-config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ month, year, config: configData, name, id: existingId }),
      });
      if (!res.ok) throw new Error('Failed to save config');
      const data = await res.json();
      setConfig(data);
      return data as GaraConfigRecord;
    } catch (err) {
      console.error('[GaraConfig] Error saving:', err);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const deleteConfig = useCallback(async (id: string) => {
    try {
      const res = await fetch(apiUrl(`/api/gara-config/${id}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete config');
      return true;
    } catch (err) {
      console.error('[GaraConfig] Error deleting:', err);
      return false;
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/gara-config/history'), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      setHistory(data);
      return data as GaraConfigHistoryEntry[];
    } catch (err) {
      console.error('[GaraConfig] Error fetching history:', err);
      return [];
    }
  }, []);

  const fetchPdvFromSales = useCallback(async (month: number, year: number) => {
    try {
      const res = await fetch(apiUrl(`/api/gara-config/pdv-from-sales?month=${month}&year=${year}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch PDV from sales');
      return await res.json() as SalesPdvEntry[];
    } catch (err) {
      console.error('[GaraConfig] Error fetching PDV from sales:', err);
      return [];
    }
  }, []);

  const importFromSimulator = useCallback(async (
    month: number,
    year: number,
    source: 'pdv_configuration' | 'organization_config',
    pdvConfigurationId?: string,
  ) => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/gara-config/import-from-simulator'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ month, year, source, pdvConfigurationId }),
      });
      if (!res.ok) throw new Error('Failed to import');
      const data = await res.json();
      setConfig(data);
      return data as GaraConfigRecord;
    } catch (err) {
      console.error('[GaraConfig] Error importing:', err);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    config,
    configList,
    loading,
    saving,
    history,
    fetchConfig,
    fetchConfigList,
    saveConfig,
    deleteConfig,
    fetchHistory,
    fetchPdvFromSales,
    importFromSimulator,
    setConfig,
  };
}
