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
  config: GaraConfigData;
  createdAt: string;
  updatedAt: string;
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
  const [history, setHistory] = useState<GaraConfigHistoryEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchConfig = useCallback(async (month: number, year: number) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/gara-config?month=${month}&year=${year}`), {
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

  const saveConfig = useCallback(async (month: number, year: number, configData: GaraConfigData) => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/gara-config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ month, year, config: configData }),
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
    loading,
    saving,
    history,
    fetchConfig,
    saveConfig,
    fetchHistory,
    fetchPdvFromSales,
    importFromSimulator,
    setConfig,
  };
}
