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
      /** true = pista rimossa per questa RS nel mese; il record resta per non farla ricreare dagli initializer. */
      rimosso?: boolean;
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
      rimosso?: boolean;
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
      rimosso?: boolean;
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
      rimosso?: boolean;
      /** Livelli disattivati: 'S1'|'S2'|'S3' (target/premio) e 'PS1'..'PS5' (soglie pista). */
      livelliRimossi?: string[];
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
      rimosso?: boolean;
      /** Livelli disattivati: 'S1'|'S2'. */
      livelliRimossi?: string[];
      pdvInGara: number;
      targetNoMalus: number;
      targetS1: number;
      targetS2: number;
      premio?: number;
      premioS1?: number;
      premioS2?: number;
    }>;
  };
  /**
   * Task #528 — obiettivi/soglie/premi per le 5 piste Vodafone/Fastweb
   * (luce, gas, iva_mobile, iva_wireline, vas). Target = pezzi; premio =
   * € flat della soglia più alta raggiunta. Assente = solo conteggio pezzi
   * (comportamento Task #527).
   */
  vfPisteConfig?: {
    configPerPista: Partial<Record<string, {
      targetS1: number;
      targetS2: number;
      targetS3: number;
      premioS1?: number;
      premioS2?: number;
      premioS3?: number;
    }>>;
  };
  /** Task #528 — override per Ragione Sociale delle piste VF. */
  vfPisteRSConfig?: {
    configPerRS: Array<{
      ragioneSociale: string;
      rimosso?: boolean;
      perPista: Partial<Record<string, {
        targetS1: number;
        targetS2: number;
        targetS3: number;
        premioS1?: number;
        premioS2?: number;
        premioS3?: number;
      }>>;
    }>;
  };
  protectaRSConfig?: {
    configPerRS: Array<{
      ragioneSociale: string;
      targetExtra: number;
      targetDecurtazione: number;
      premioExtra: number;
    }>;
  };
  decurtazioneRSConfig?: {
    configPerRS: Array<{
      ragioneSociale: string;
      importo: number;
    }>;
  };
  importedFiles?: Array<{
    label: string;
    type: string;
    fileName: string;
  }>;
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
      puntiPerPezzo?: Record<string, number>;
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
  venditeForecast?: {
    mobileVolumi?: number | null;
    mobileIvaVolumi?: number | null;
    fissoVolumi?: number | null;
    fissoIvaVolumi?: number | null;
    energiaVolumi?: number | null;
    assicurazioniVolumi?: number | null;
    protettiVolumi?: number | null;
    cbVolumi?: number | null;
    telefoniPezzi?: number | null;
    accessoriFatturato?: number | null;
    serviziFatturato?: number | null;
    numeroNegoziCc?: number | null;
    numeroNegoziStrada?: number | null;
  };
  performanceWeights?: {
    mobile?: number | null;
    fisso?: number | null;
    energia?: number | null;
    assicurazioni?: number | null;
    protecta?: number | null;
    cb?: number | null;
    telefoni?: number | null;
    ivaMultiplier?: number | null;
  };
  /** Gara SOS Caring (Task #327): dataset Excel caring PDV + fasce premio. */
  sosCaring?: import('@shared/sosCaring').SosCaringData | null;
  /**
   * Contenuti report Telegram (Task #515): piste visibili nel report e
   * gruppi TELCO/NEW CORE dei "migliori del giorno" (per pezzi).
   */
  telegramReportContent?: {
    pisteVisibili?: string[];
    telcoPiste?: string[];
    newCorePiste?: string[];
    /**
     * Report separati per brand (Task #519): selezioni per brandId; un
     * brand senza voce eredita la selezione root (legacy).
     */
    perBrand?: Record<string, {
      pisteVisibili?: string[];
      telcoPiste?: string[];
      newCorePiste?: string[];
    }>;
  };
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
  id: string;
  name: string | null;
  month: number;
  year: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GaraConfigRevisionEntry {
  id: string;
  name: string | null;
  month: number;
  year: number;
  createdAt: string | null;
  changedBy: string | null;
  changedByName: string | null;
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
  const fetchSequenceRef = useRef(0);
  const listSequenceRef = useRef(0);

  const fetchConfig = useCallback(async (month: number, year: number, id?: string) => {
    const sequence = ++fetchSequenceRef.current;
    setLoading(true);
    try {
      const url = id
        ? apiUrl(`/api/gara-config?id=${id}`)
        : apiUrl(`/api/gara-config?month=${month}&year=${year}`);
      const res = await fetch(url, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch config');
      const data = await res.json();
      if (sequence !== fetchSequenceRef.current) return null;
      setConfig(data);
      return data as GaraConfigRecord | null;
    } catch (err: unknown) {
      console.error('[GaraConfig] Error fetching:', err);
      if (sequence === fetchSequenceRef.current) setConfig(null);
      return null;
    } finally {
      if (sequence === fetchSequenceRef.current) setLoading(false);
    }
  }, []);

  const fetchConfigList = useCallback(async (month: number, year: number) => {
    const sequence = ++listSequenceRef.current;
    try {
      const res = await fetch(apiUrl(`/api/gara-config/list?month=${month}&year=${year}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch config list');
      const data = await res.json();
      if (sequence !== listSequenceRef.current) return null;
      setConfigList(data);
      return data as GaraConfigListItem[];
    } catch (err) {
      console.error('[GaraConfig] Error fetching list:', err);
      if (sequence === listSequenceRef.current) setConfigList([]);
      return null;
    }
  }, []);

  const saveConfig = useCallback(async (month: number, year: number, configData: GaraConfigData, name: string, existingId?: string, expectedUpdatedAt?: string) => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/gara-config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ month, year, config: configData, name, id: existingId, expectedUpdatedAt }),
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

  const fetchRevisions = useCallback(async (configId: string) => {
    try {
      const res = await fetch(apiUrl(`/api/gara-config/revisions?configId=${configId}`), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch revisions');
      return (await res.json()) as GaraConfigRevisionEntry[];
    } catch (err) {
      console.error('[GaraConfig] Error fetching revisions:', err);
      return null;
    }
  }, []);

  const restoreRevision = useCallback(async (revisionId: string) => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/gara-config/revisions/restore'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ revisionId }),
      });
      if (!res.ok) throw new Error('Failed to restore revision');
      const data = await res.json();
      setConfig(data);
      return data as GaraConfigRecord;
    } catch (err) {
      console.error('[GaraConfig] Error restoring revision:', err);
      return null;
    } finally {
      setSaving(false);
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
      fetchSequenceRef.current += 1;
      listSequenceRef.current += 1;
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
    fetchRevisions,
    restoreRevision,
    fetchPdvFromSales,
    importFromSimulator,
    setConfig,
  };
}
