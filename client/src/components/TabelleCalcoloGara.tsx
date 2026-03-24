import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { X, RotateCcw, Info } from 'lucide-react';
import { MobileActivationType, MOBILE_CATEGORY_LABELS, MOBILE_CATEGORIES_CONFIG_DEFAULT, ClusterPIvaCode } from '@/types/preventivatore';
import { ENERGIA_BASE_PAY, ENERGIA_CATEGORY_LABELS, ENERGIA_W3_CATEGORY_LABELS, PISTA_ENERGIA_SOGLIE_BASE, PISTA_ENERGIA_SOGLIE_DA4, PISTA_ENERGIA_BONUS_PER_CONTRATTO } from '@/types/energia';
import { ASSICURAZIONI_POINTS, ASSICURAZIONI_PREMIUMS, ASSICURAZIONI_LABELS } from '@/types/assicurazioni';
import { FISSO_CATEGORIE_DEFAULT } from '@/lib/calcoloPistaFisso';
import { PROTECTA_GETTONI, PROTECTA_LABELS, ProtectaProduct } from '@/types/protecta';
import { PUNTI_EXTRA_GARA, SOGLIE_BASE_EXTRA_GARA, PREMI_EXTRA_GARA } from '@/lib/calcoloExtraGaraIva';

export interface TabelleCalcoloConfig {
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
}

const MOBILE_SOGLIE_DEFAULTS: Record<string, number[]> = {
  strada_1: [70, 105, 135, 165],
  strada_2: [70, 115, 160, 200],
  strada_3: [70, 130, 185, 225],
  cc_1: [80, 115, 160, 205],
  cc_2: [80, 120, 185, 225],
  cc_3: [80, 135, 205, 245],
};

const MOBILE_SOGLIE_LABELS: Record<string, string> = {
  strada_1: 'Strada Cluster 1',
  strada_2: 'Strada Cluster 2',
  strada_3: 'Strada Cluster 3',
  cc_1: 'CC Cluster 1',
  cc_2: 'CC Cluster 2',
  cc_3: 'CC Cluster 3',
};

const MOLTIPLICATORI_DEFAULTS: Record<string, number[]> = {
  ga_base: [1.0, 1.5, 2.0, 2.25],
  ga_underground: [0.5, 1.0, 1.5, 1.75],
  mnp: [1.0, 1.0, 1.0, 1.0],
  tied: [2.0, 2.0, 2.25, 2.25],
  piva: [1.0, 1.0, 1.0, 1.0],
};

const MOLTIPLICATORI_LABELS: Record<string, string> = {
  ga_base: 'GA BASE (escl. Underground)',
  ga_underground: 'GA BASE Underground',
  mnp: '+ MNP',
  tied: '+ TIED',
  piva: '+ P.IVA',
};

const FISSO_SOGLIE_DEFAULTS: Record<string, number[]> = {
  strada_1: [28, 46, 57, 67, 80],
  strada_2: [34, 60, 72, 83, 97],
  strada_3: [39, 67, 82, 96, 108],
  cc_1: [30, 48, 59, 70, 84],
  cc_2: [36, 62, 74, 86, 100],
  cc_3: [41, 69, 84, 99, 110],
};

const GETTONI_DEFAULTS: Record<string, number> = {
  FISSO_FTTC: 23, FISSO_FTTH: 23, FISSO_FWA_OUT: 23, FISSO_FWA_IND_2P: 23,
  CONVERGENZA: 23, LINEA_ATTIVA: 23, FISSO_PIVA_1A_LINEA: 23, FISSO_PIVA_2A_LINEA: 10,
  MIGRAZIONI_FTTH_FWA: 40, FRITZ_BOX: 0, NETFLIX_CON_ADV: 0, NETFLIX_SENZA_ADV: 0,
  CHIAMATE_ILLIMITATE: 0, BOLLETTINO_POSTALE: 0, PIU_SICURI_CASA_UFFICIO: 0, FISSO_VOCE: 0,
};

const GETTONI_LABELS: Record<string, string> = {
  FISSO_FTTC: 'FTTC', FISSO_FTTH: 'FTTH', FISSO_FWA_OUT: 'FWA OUT', FISSO_FWA_IND_2P: 'FWA IND 2P',
  CONVERGENZA: 'Convergenza', LINEA_ATTIVA: 'Linea Attiva', FISSO_PIVA_1A_LINEA: 'P.IVA 1\u00AA Linea',
  FISSO_PIVA_2A_LINEA: 'P.IVA 2\u00AA Linea', MIGRAZIONI_FTTH_FWA: 'Migrazioni FTTH/FWA',
  FRITZ_BOX: 'Fritz Box', NETFLIX_CON_ADV: 'Netflix con ADV', NETFLIX_SENZA_ADV: 'Netflix senza ADV',
  CHIAMATE_ILLIMITATE: 'Chiamate illimitate', BOLLETTINO_POSTALE: 'Bollettino postale',
  PIU_SICURI_CASA_UFFICIO: 'Assicurazioni', FISSO_VOCE: 'Fisso Voce',
};

const ASSICURAZIONI_PRODUCT_KEYS = [
  'protezionePro', 'casaFamigliaFull', 'casaFamigliaPlus', 'casaFamigliaStart',
  'sportFamiglia', 'sportIndividuale', 'viaggiVacanze', 'elettrodomestici', 'micioFido',
] as const;

const PROTECTA_PRODUCT_KEYS: ProtectaProduct[] = [
  'casaStart', 'casaStartFinanziato', 'casaPlus', 'casaPlusFinanziato',
  'negozioProtetti', 'negozioProtettiFinanziato',
];

const EXTRA_GARA_PUNTI_LABELS: Record<string, string> = {
  worldStaff: 'World / Staff', fullPlusData60_100: 'Full Plus / Data 60-100',
  flexSpecialData10: 'Flex / Special / Data 10', fissoPIva: 'Fisso P.IVA (1\u00AA + 2\u00AA Linea)',
  fritzBox: 'FRITZ!Box', luceGas: 'Luce & Gas (Business)',
  protezionePro: 'Protezione Pro', negozioProtetti: 'Negozio Protetti',
};

const EXTRA_GARA_SOGLIE_LABELS: Record<string, string> = {
  conBP: 'Con Business Promoter', senzaBP: 'Senza Business Promoter',
};

const CLUSTER_PIVA_LABELS: Record<string, string> = {
  business_promoter_plus: 'Business Promoter Plus',
  business_promoter: 'Business Promoter',
  senza_business_promoter: 'Senza Business Promoter',
};

export function buildHardcodedDefaults(): TabelleCalcoloConfig {
  const puntiAttivazione: Record<string, number> = {};
  MOBILE_CATEGORIES_CONFIG_DEFAULT.forEach(c => { puntiAttivazione[c.type] = c.punti; });

  const euroPerPezzo: Record<string, number> = {};
  FISSO_CATEGORIE_DEFAULT.forEach(c => { euroPerPezzo[c.type] = c.euroPerPezzo; });

  const compensiBase: Record<string, number> = { ...ENERGIA_BASE_PAY };
  const pistaBase: Record<string, number> = { ...PISTA_ENERGIA_SOGLIE_BASE };
  const pistaDa4: Record<string, number> = { ...PISTA_ENERGIA_SOGLIE_DA4 };
  const bonusPerContratto: Record<string, number> = { ...PISTA_ENERGIA_BONUS_PER_CONTRATTO };

  const puntiProdotto: Record<string, number> = {};
  const premiProdotto: Record<string, number> = {};
  ASSICURAZIONI_PRODUCT_KEYS.forEach(k => {
    puntiProdotto[k] = (ASSICURAZIONI_POINTS as Record<string, number>)[k] ?? 0;
    premiProdotto[k] = (ASSICURAZIONI_PREMIUMS as Record<string, number>)[k] ?? 0;
  });

  const gettoniProdotto: Record<string, number> = {};
  PROTECTA_PRODUCT_KEYS.forEach(k => { gettoniProdotto[k] = PROTECTA_GETTONI[k]; });

  const extraGaraPunti: Record<string, number> = { ...PUNTI_EXTRA_GARA };
  const soglieMultipos: Record<string, Record<string, number>> = {
    conBP: { ...SOGLIE_BASE_EXTRA_GARA.multipos.conBP }, senzaBP: { ...SOGLIE_BASE_EXTRA_GARA.multipos.senzaBP },
  };
  const soglieMonopos: Record<string, Record<string, number>> = {
    conBP: { ...SOGLIE_BASE_EXTRA_GARA.monopos.conBP }, senzaBP: { ...SOGLIE_BASE_EXTRA_GARA.monopos.senzaBP },
  };
  const premiPerSoglia: Record<string, number[]> = {};
  for (const cluster of Object.keys(PREMI_EXTRA_GARA)) {
    premiPerSoglia[cluster] = [...PREMI_EXTRA_GARA[cluster as ClusterPIvaCode]];
  }

  return {
    mobile: { soglieCluster: { ...MOBILE_SOGLIE_DEFAULTS }, puntiAttivazione, moltiplicatoriCanone: { ...MOLTIPLICATORI_DEFAULTS } },
    fisso: { soglieCluster: { ...FISSO_SOGLIE_DEFAULTS }, euroPerPezzo, gettoniContrattuali: { ...GETTONI_DEFAULTS } },
    energia: { compensiBase, pistaBase, pistaDa4, bonusPerContratto },
    assicurazioni: { puntiProdotto, premiProdotto },
    protecta: { gettoniProdotto },
    extraGara: { puntiAttivazione: extraGaraPunti, soglieMultipos, soglieMonopos, premiPerSoglia },
  };
}

export function deepMergeTabelleCalcolo(target: TabelleCalcoloConfig, source: TabelleCalcoloConfig | undefined | null): TabelleCalcoloConfig {
  if (!source) return JSON.parse(JSON.stringify(target));
  const result = JSON.parse(JSON.stringify(target)) as Record<string, Record<string, Record<string, number> | Record<string, number[]>>>;
  const src = source as Record<string, Record<string, Record<string, number> | Record<string, number[]>> | undefined>;
  for (const section of Object.keys(src)) {
    if (!src[section]) continue;
    if (!result[section]) result[section] = {};
    for (const field of Object.keys(src[section]!)) {
      const srcField = src[section]![field];
      if (!srcField || typeof srcField !== 'object') continue;
      if (!result[section][field]) result[section][field] = {};
      const resultField = result[section][field] as Record<string, unknown>;
      for (const key of Object.keys(srcField)) {
        resultField[key] = (srcField as Record<string, unknown>)[key];
      }
    }
  }
  return result as unknown as TabelleCalcoloConfig;
}

function getNestedValue(config: TabelleCalcoloConfig, path: string): number | undefined {
  const parts = path.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'number' ? current : undefined;
}

function getNestedArrayValue(config: TabelleCalcoloConfig, path: string, index: number): number | undefined {
  const parts = path.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (Array.isArray(current) && index < current.length) return current[index];
  return undefined;
}

interface CellProps {
  value: number;
  defaultValue: number;
  isOverridden: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
  testId: string;
  step?: string;
}

function EditableCell({ value, defaultValue, isOverridden, onChange, onReset, testId, step = '1' }: CellProps) {
  return (
    <td className={`relative p-1 ${isOverridden ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800' : 'border border-border'}`}>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="text-sm text-center w-full"
          step={step}
          data-testid={testId}
        />
        {isOverridden && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onReset} className="shrink-0 h-6 w-6 text-blue-500 dark:text-blue-400" data-testid={`${testId}-reset`}>
                <X className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Ripristina default ({defaultValue})</p></TooltipContent>
          </Tooltip>
        )}
      </div>
      {isOverridden && (
        <span className="absolute -top-2 right-1 text-[9px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-1 rounded">(modificato)</span>
      )}
    </td>
  );
}

interface TabelleCalcoloGaraProps {
  config: TabelleCalcoloConfig;
  onChange: (config: TabelleCalcoloConfig) => void;
  baseDefaults: TabelleCalcoloConfig;
}

export function TabelleCalcoloGara({ config, onChange, baseDefaults }: TabelleCalcoloGaraProps) {
  const isOverridden = useCallback((path: string): boolean => {
    const current = getNestedValue(config, path);
    const def = getNestedValue(baseDefaults, path);
    if (current === undefined || def === undefined) return false;
    return current !== def;
  }, [config, baseDefaults]);

  const isArrayOverridden = useCallback((path: string, index: number): boolean => {
    const current = getNestedArrayValue(config, path, index);
    const def = getNestedArrayValue(baseDefaults, path, index);
    if (current === undefined || def === undefined) return false;
    return current !== def;
  }, [config, baseDefaults]);

  const updateValue = useCallback((path: string, value: number) => {
    const next = JSON.parse(JSON.stringify(config));
    const parts = path.split('.');
    let current: Record<string, unknown> = next;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
    onChange(next);
  }, [config, onChange]);

  const updateArrayValue = useCallback((path: string, index: number, value: number) => {
    const next = JSON.parse(JSON.stringify(config));
    const parts = path.split('.');
    let current: Record<string, unknown> = next;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    const arr = current[parts[parts.length - 1]] as number[];
    if (Array.isArray(arr)) arr[index] = value;
    onChange(next);
  }, [config, onChange]);

  const resetValue = useCallback((path: string) => {
    const def = getNestedValue(baseDefaults, path);
    if (def !== undefined) updateValue(path, def);
  }, [baseDefaults, updateValue]);

  const resetArrayValue = useCallback((path: string, index: number) => {
    const def = getNestedArrayValue(baseDefaults, path, index);
    if (def !== undefined) updateArrayValue(path, index, def);
  }, [baseDefaults, updateArrayValue]);

  const handleResetAll = () => {
    onChange(JSON.parse(JSON.stringify(baseDefaults)));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Valori di calcolo per questo mese. Le modifiche sovrascrivono i default di sistema/organizzazione.
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleResetAll} data-testid="button-reset-tabelle-gara">
          <RotateCcw className="h-4 w-4 mr-1" />Ripristina Defaults
        </Button>
      </div>

      <Tabs defaultValue="mobile" className="space-y-4">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="bg-muted/50 p-1 w-max sm:w-full">
            <TabsTrigger value="mobile" className="text-xs sm:text-sm" data-testid="tab-gara-tc-mobile">Mobile</TabsTrigger>
            <TabsTrigger value="fisso" className="text-xs sm:text-sm" data-testid="tab-gara-tc-fisso">Fisso</TabsTrigger>
            <TabsTrigger value="energia" className="text-xs sm:text-sm" data-testid="tab-gara-tc-energia">Energia</TabsTrigger>
            <TabsTrigger value="assicurazioni" className="text-xs sm:text-sm" data-testid="tab-gara-tc-assicurazioni">Assicurazioni</TabsTrigger>
            <TabsTrigger value="protecta" className="text-xs sm:text-sm" data-testid="tab-gara-tc-protecta">Protecta</TabsTrigger>
            <TabsTrigger value="extraGara" className="text-xs sm:text-sm" data-testid="tab-gara-tc-extra-gara">Extra Gara</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="mobile" className="space-y-6">
          <MobileSubTab config={config} baseDefaults={baseDefaults} isOverridden={isOverridden} isArrayOverridden={isArrayOverridden} updateValue={updateValue} updateArrayValue={updateArrayValue} resetValue={resetValue} resetArrayValue={resetArrayValue} />
        </TabsContent>
        <TabsContent value="fisso" className="space-y-6">
          <FissoSubTab config={config} baseDefaults={baseDefaults} isOverridden={isOverridden} isArrayOverridden={isArrayOverridden} updateValue={updateValue} updateArrayValue={updateArrayValue} resetValue={resetValue} resetArrayValue={resetArrayValue} />
        </TabsContent>
        <TabsContent value="energia" className="space-y-6">
          <EnergiaSubTab config={config} baseDefaults={baseDefaults} isOverridden={isOverridden} updateValue={updateValue} resetValue={resetValue} />
        </TabsContent>
        <TabsContent value="assicurazioni" className="space-y-6">
          <AssicurazioniSubTab config={config} baseDefaults={baseDefaults} isOverridden={isOverridden} updateValue={updateValue} resetValue={resetValue} />
        </TabsContent>
        <TabsContent value="protecta" className="space-y-6">
          <ProtectaSubTab config={config} baseDefaults={baseDefaults} isOverridden={isOverridden} updateValue={updateValue} resetValue={resetValue} />
        </TabsContent>
        <TabsContent value="extraGara" className="space-y-6">
          <ExtraGaraSubTab config={config} baseDefaults={baseDefaults} isOverridden={isOverridden} isArrayOverridden={isArrayOverridden} updateValue={updateValue} updateArrayValue={updateArrayValue} resetValue={resetValue} resetArrayValue={resetArrayValue} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface SubTabProps {
  config: TabelleCalcoloConfig;
  baseDefaults: TabelleCalcoloConfig;
  isOverridden: (path: string) => boolean;
  isArrayOverridden: (path: string, index: number) => boolean;
  updateValue: (path: string, value: number) => void;
  updateArrayValue: (path: string, index: number, value: number) => void;
  resetValue: (path: string) => void;
  resetArrayValue: (path: string, index: number) => void;
}

interface SimpleSubTabProps {
  config: TabelleCalcoloConfig;
  baseDefaults: TabelleCalcoloConfig;
  isOverridden: (path: string) => boolean;
  updateValue: (path: string, value: number) => void;
  resetValue: (path: string) => void;
}

function MobileSubTab({ config, baseDefaults, isArrayOverridden, updateArrayValue, resetArrayValue, isOverridden, updateValue, resetValue }: SubTabProps) {
  const soglieKeys = Object.keys(MOBILE_SOGLIE_DEFAULTS);
  const soglieLabels = ['1\u00B0 Soglia', '2\u00B0 Soglia', '3\u00B0 Soglia', '4\u00B0 Soglia'];
  const moltiplicatoriKeys = Object.keys(MOLTIPLICATORI_DEFAULTS);

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Soglie Punti per Punto Vendita</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]" data-testid="table-gara-mobile-soglie">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Cluster</th>
                {soglieLabels.map((l, i) => <th key={i} className={`p-2 text-center font-medium ${i === 3 ? 'rounded-tr-md' : ''}`}>{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {soglieKeys.map(key => (
                <tr key={key} className="even:bg-muted/30">
                  <td className="p-2 font-medium border border-border">{MOBILE_SOGLIE_LABELS[key]}</td>
                  {[0, 1, 2, 3].map(i => {
                    const path = `mobile.soglieCluster.${key}`;
                    const val = getNestedArrayValue(config, path, i) ?? MOBILE_SOGLIE_DEFAULTS[key][i];
                    const def = getNestedArrayValue(baseDefaults, path, i) ?? MOBILE_SOGLIE_DEFAULTS[key][i];
                    return <EditableCell key={i} value={val} defaultValue={def} isOverridden={isArrayOverridden(path, i)} onChange={v => updateArrayValue(path, i, v)} onReset={() => resetArrayValue(path, i)} testId={`input-gara-mobile-soglia-${key}-${i}`} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Punti per Tipo Attivazione</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-mobile-punti">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Tipo Attivazione</th>
                <th className="p-2 text-center font-medium rounded-tr-md w-32">Punti</th>
              </tr>
            </thead>
            <tbody>
              {MOBILE_CATEGORY_LABELS.filter(cat => cat.value !== MobileActivationType.SIM_CNS && cat.value !== MobileActivationType.SIM_IVA).map(cat => {
                const path = `mobile.puntiAttivazione.${cat.value}`;
                const val = getNestedValue(config, path) ?? MOBILE_CATEGORIES_CONFIG_DEFAULT.find(c => c.type === cat.value)?.punti ?? 0;
                const def = getNestedValue(baseDefaults, path) ?? MOBILE_CATEGORIES_CONFIG_DEFAULT.find(c => c.type === cat.value)?.punti ?? 0;
                return (
                  <tr key={cat.value} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{cat.label}</td>
                    <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-mobile-punti-${cat.value}`} step="0.25" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Moltiplicatori Canone per Soglia Raggiunta</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]" data-testid="table-gara-mobile-moltiplicatori">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Gruppo</th>
                <th className="p-2 text-center font-medium">1\u00B0</th>
                <th className="p-2 text-center font-medium">2\u00B0</th>
                <th className="p-2 text-center font-medium">3\u00B0</th>
                <th className="p-2 text-center font-medium rounded-tr-md">4\u00B0</th>
              </tr>
            </thead>
            <tbody>
              {moltiplicatoriKeys.map(key => (
                <tr key={key} className="even:bg-muted/30">
                  <td className="p-2 font-medium border border-border">{MOLTIPLICATORI_LABELS[key]}</td>
                  {[0, 1, 2, 3].map(i => {
                    const path = `mobile.moltiplicatoriCanone.${key}`;
                    const val = getNestedArrayValue(config, path, i) ?? MOLTIPLICATORI_DEFAULTS[key][i];
                    const def = getNestedArrayValue(baseDefaults, path, i) ?? MOLTIPLICATORI_DEFAULTS[key][i];
                    return <EditableCell key={i} value={val} defaultValue={def} isOverridden={isArrayOverridden(path, i)} onChange={v => updateArrayValue(path, i, v)} onReset={() => resetArrayValue(path, i)} testId={`input-gara-mobile-molt-${key}-${i}`} step="0.25" />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function FissoSubTab({ config, baseDefaults, isArrayOverridden, updateArrayValue, resetArrayValue, isOverridden, updateValue, resetValue }: SubTabProps) {
  const soglieKeys = Object.keys(FISSO_SOGLIE_DEFAULTS);
  const soglieLabels = ['S1', 'S2', 'S3', 'S4', 'S5'];
  const fissoCategories = FISSO_CATEGORIE_DEFAULT.filter(c => c.type !== 'ASSICURAZIONI_PLUS_FULL' && c.type !== 'MIGRAZIONI_FTTH_FWA');
  const gettoniKeys = Object.keys(GETTONI_DEFAULTS);

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Soglie Punti per Punto Vendita</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[550px]" data-testid="table-gara-fisso-soglie">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Cluster</th>
                {soglieLabels.map((l, i) => <th key={i} className={`p-2 text-center font-medium ${i === 4 ? 'rounded-tr-md' : ''}`}>{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {soglieKeys.map(key => (
                <tr key={key} className="even:bg-muted/30">
                  <td className="p-2 font-medium border border-border">{MOBILE_SOGLIE_LABELS[key]}</td>
                  {[0, 1, 2, 3, 4].map(i => {
                    const path = `fisso.soglieCluster.${key}`;
                    const val = getNestedArrayValue(config, path, i) ?? FISSO_SOGLIE_DEFAULTS[key][i];
                    const def = getNestedArrayValue(baseDefaults, path, i) ?? FISSO_SOGLIE_DEFAULTS[key][i];
                    return <EditableCell key={i} value={val} defaultValue={def} isOverridden={isArrayOverridden(path, i)} onChange={v => updateArrayValue(path, i, v)} onReset={() => resetArrayValue(path, i)} testId={`input-gara-fisso-soglia-${key}-${i}`} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Euro/Pezzo per Categoria Fisso</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-fisso-euro">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Categoria</th>
                <th className="p-2 text-center font-medium rounded-tr-md w-32">{'\u20AC'}/pezzo</th>
              </tr>
            </thead>
            <tbody>
              {fissoCategories.map(cat => {
                const path = `fisso.euroPerPezzo.${cat.type}`;
                const val = getNestedValue(config, path) ?? cat.euroPerPezzo;
                const def = getNestedValue(baseDefaults, path) ?? cat.euroPerPezzo;
                return (
                  <tr key={cat.type} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{cat.label}</td>
                    <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-fisso-euro-${cat.type}`} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Gettoni Contrattuali Fisso</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-fisso-gettoni">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Categoria</th>
                <th className="p-2 text-center font-medium rounded-tr-md w-32">Gettone {'\u20AC'}</th>
              </tr>
            </thead>
            <tbody>
              {gettoniKeys.map(key => {
                const path = `fisso.gettoniContrattuali.${key}`;
                const val = getNestedValue(config, path) ?? GETTONI_DEFAULTS[key];
                const def = getNestedValue(baseDefaults, path) ?? GETTONI_DEFAULTS[key];
                return (
                  <tr key={key} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{GETTONI_LABELS[key]}</td>
                    <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-fisso-gettone-${key}`} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function EnergiaSubTab({ config, baseDefaults, isOverridden, updateValue, resetValue }: SimpleSubTabProps) {
  const allCats = [...ENERGIA_CATEGORY_LABELS, ...ENERGIA_W3_CATEGORY_LABELS];
  const pistaKeys = ['S1', 'S2', 'S3', 'S4', 'S5'];

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Compensi Base per Contratto</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-energia-compensi">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Categoria</th>
                <th className="p-2 text-center font-medium rounded-tr-md w-32">{'\u20AC'}/contratto</th>
              </tr>
            </thead>
            <tbody>
              {allCats.map(cat => {
                const path = `energia.compensiBase.${cat.value}`;
                const val = getNestedValue(config, path) ?? ENERGIA_BASE_PAY[cat.value as keyof typeof ENERGIA_BASE_PAY] ?? 0;
                const def = getNestedValue(baseDefaults, path) ?? ENERGIA_BASE_PAY[cat.value as keyof typeof ENERGIA_BASE_PAY] ?? 0;
                return (
                  <tr key={cat.value} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{cat.label}</td>
                    <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-energia-compenso-${cat.value}`} step="0.5" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pista Energia - Parametri Base</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-energia-pista">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Soglia</th>
                <th className="p-2 text-center font-medium">Per PDV (primi 3)</th>
                <th className="p-2 text-center font-medium rounded-tr-md">Da 4{'\u00B0'} PDV</th>
              </tr>
            </thead>
            <tbody>
              {pistaKeys.map(key => {
                const pathBase = `energia.pistaBase.${key}`;
                const pathDa4 = `energia.pistaDa4.${key}`;
                const valBase = getNestedValue(config, pathBase) ?? PISTA_ENERGIA_SOGLIE_BASE[key as keyof typeof PISTA_ENERGIA_SOGLIE_BASE];
                const defBase = getNestedValue(baseDefaults, pathBase) ?? PISTA_ENERGIA_SOGLIE_BASE[key as keyof typeof PISTA_ENERGIA_SOGLIE_BASE];
                const valDa4 = getNestedValue(config, pathDa4) ?? PISTA_ENERGIA_SOGLIE_DA4[key as keyof typeof PISTA_ENERGIA_SOGLIE_DA4];
                const defDa4 = getNestedValue(baseDefaults, pathDa4) ?? PISTA_ENERGIA_SOGLIE_DA4[key as keyof typeof PISTA_ENERGIA_SOGLIE_DA4];
                return (
                  <tr key={key} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{key}</td>
                    <EditableCell value={valBase} defaultValue={defBase} isOverridden={isOverridden(pathBase)} onChange={v => updateValue(pathBase, v)} onReset={() => resetValue(pathBase)} testId={`input-gara-energia-pista-base-${key}`} />
                    <EditableCell value={valDa4} defaultValue={defDa4} isOverridden={isOverridden(pathDa4)} onChange={v => updateValue(pathDa4, v)} onReset={() => resetValue(pathDa4)} testId={`input-gara-energia-pista-da4-${key}`} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Bonus per Contratto per Soglia</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-energia-bonus">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Soglia</th>
                <th className="p-2 text-center font-medium rounded-tr-md w-32">Bonus {'\u20AC'}</th>
              </tr>
            </thead>
            <tbody>
              {pistaKeys.map(key => {
                const path = `energia.bonusPerContratto.${key}`;
                const val = getNestedValue(config, path) ?? PISTA_ENERGIA_BONUS_PER_CONTRATTO[key as keyof typeof PISTA_ENERGIA_BONUS_PER_CONTRATTO];
                const def = getNestedValue(baseDefaults, path) ?? PISTA_ENERGIA_BONUS_PER_CONTRATTO[key as keyof typeof PISTA_ENERGIA_BONUS_PER_CONTRATTO];
                return (
                  <tr key={key} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{key}</td>
                    <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-energia-bonus-${key}`} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function AssicurazioniSubTab({ config, baseDefaults, isOverridden, updateValue, resetValue }: SimpleSubTabProps) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Punti per Prodotto</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-assicurazioni-punti">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Prodotto</th>
                <th className="p-2 text-center font-medium rounded-tr-md w-32">Punti</th>
              </tr>
            </thead>
            <tbody>
              {ASSICURAZIONI_PRODUCT_KEYS.map(key => {
                const path = `assicurazioni.puntiProdotto.${key}`;
                const val = getNestedValue(config, path) ?? (ASSICURAZIONI_POINTS as Record<string, number>)[key] ?? 0;
                const def = getNestedValue(baseDefaults, path) ?? (ASSICURAZIONI_POINTS as Record<string, number>)[key] ?? 0;
                return (
                  <tr key={key} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{ASSICURAZIONI_LABELS[key as keyof typeof ASSICURAZIONI_LABELS]}</td>
                    <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-assicurazioni-punti-${key}`} step="0.5" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Premi per Prodotto ({'\u20AC'}/pezzo)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-assicurazioni-premi">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Prodotto</th>
                <th className="p-2 text-center font-medium rounded-tr-md w-32">{'\u20AC'}/pezzo</th>
              </tr>
            </thead>
            <tbody>
              {ASSICURAZIONI_PRODUCT_KEYS.map(key => {
                const path = `assicurazioni.premiProdotto.${key}`;
                const val = getNestedValue(config, path) ?? (ASSICURAZIONI_PREMIUMS as Record<string, number>)[key] ?? 0;
                const def = getNestedValue(baseDefaults, path) ?? (ASSICURAZIONI_PREMIUMS as Record<string, number>)[key] ?? 0;
                return (
                  <tr key={key} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{ASSICURAZIONI_LABELS[key as keyof typeof ASSICURAZIONI_LABELS]}</td>
                    <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-assicurazioni-premi-${key}`} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function ProtectaSubTab({ config, baseDefaults, isOverridden, updateValue, resetValue }: SimpleSubTabProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Gettoni per Prodotto Protecta</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-gara-protecta-gettoni">
          <thead>
            <tr className="bg-orange-500 text-white">
              <th className="p-2 text-left font-medium rounded-tl-md">Prodotto</th>
              <th className="p-2 text-center font-medium rounded-tr-md w-32">Gettone {'\u20AC'}</th>
            </tr>
          </thead>
          <tbody>
            {PROTECTA_PRODUCT_KEYS.map(key => {
              const path = `protecta.gettoniProdotto.${key}`;
              const val = getNestedValue(config, path) ?? PROTECTA_GETTONI[key];
              const def = getNestedValue(baseDefaults, path) ?? PROTECTA_GETTONI[key];
              return (
                <tr key={key} className="even:bg-muted/30">
                  <td className="p-2 font-medium border border-border">{PROTECTA_LABELS[key]}</td>
                  <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-protecta-gettone-${key}`} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ExtraGaraSubTab({ config, baseDefaults, isOverridden, isArrayOverridden, updateValue, updateArrayValue, resetValue, resetArrayValue }: SubTabProps) {
  const puntiKeys = Object.keys(PUNTI_EXTRA_GARA);
  const soglieKeys = Object.keys(EXTRA_GARA_SOGLIE_LABELS);
  const clusterKeys = Object.keys(PREMI_EXTRA_GARA);

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Punti per Tipo Attivazione P.IVA</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-extra-gara-punti">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Tipo Attivazione</th>
                <th className="p-2 text-center font-medium rounded-tr-md w-32">Punti</th>
              </tr>
            </thead>
            <tbody>
              {puntiKeys.map(key => {
                const path = `extraGara.puntiAttivazione.${key}`;
                const val = getNestedValue(config, path) ?? PUNTI_EXTRA_GARA[key as keyof typeof PUNTI_EXTRA_GARA];
                const def = getNestedValue(baseDefaults, path) ?? PUNTI_EXTRA_GARA[key as keyof typeof PUNTI_EXTRA_GARA];
                return (
                  <tr key={key} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{EXTRA_GARA_PUNTI_LABELS[key] || key}</td>
                    <EditableCell value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-extra-gara-punti-${key}`} step="0.5" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Soglie Base Multi-POS (per PDV)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-extra-gara-soglie-multi">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Tipo</th>
                <th className="p-2 text-center font-medium">S1</th>
                <th className="p-2 text-center font-medium">S2</th>
                <th className="p-2 text-center font-medium">S3</th>
                <th className="p-2 text-center font-medium rounded-tr-md">S4</th>
              </tr>
            </thead>
            <tbody>
              {soglieKeys.map(bpKey => {
                const soglieRef = bpKey === 'conBP' ? SOGLIE_BASE_EXTRA_GARA.multipos.conBP : SOGLIE_BASE_EXTRA_GARA.multipos.senzaBP;
                return (
                  <tr key={bpKey} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{EXTRA_GARA_SOGLIE_LABELS[bpKey]}</td>
                    {(['s1', 's2', 's3', 's4'] as const).map(sk => {
                      const path = `extraGara.soglieMultipos.${bpKey}.${sk}`;
                      const val = getNestedValue(config, path) ?? soglieRef[sk];
                      const def = getNestedValue(baseDefaults, path) ?? soglieRef[sk];
                      return <EditableCell key={sk} value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-extra-gara-multi-${bpKey}-${sk}`} />;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Soglie Base Mono-POS (per PDV)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-extra-gara-soglie-mono">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Tipo</th>
                <th className="p-2 text-center font-medium">S1</th>
                <th className="p-2 text-center font-medium">S2</th>
                <th className="p-2 text-center font-medium">S3</th>
                <th className="p-2 text-center font-medium rounded-tr-md">S4</th>
              </tr>
            </thead>
            <tbody>
              {soglieKeys.map(bpKey => {
                const soglieRef = bpKey === 'conBP' ? SOGLIE_BASE_EXTRA_GARA.monopos.conBP : SOGLIE_BASE_EXTRA_GARA.monopos.senzaBP;
                return (
                  <tr key={bpKey} className="even:bg-muted/30">
                    <td className="p-2 font-medium border border-border">{EXTRA_GARA_SOGLIE_LABELS[bpKey]}</td>
                    {(['s1', 's2', 's3', 's4'] as const).map(sk => {
                      const path = `extraGara.soglieMonopos.${bpKey}.${sk}`;
                      const val = getNestedValue(config, path) ?? soglieRef[sk];
                      const def = getNestedValue(baseDefaults, path) ?? soglieRef[sk];
                      return <EditableCell key={sk} value={val} defaultValue={def} isOverridden={isOverridden(path)} onChange={v => updateValue(path, v)} onReset={() => resetValue(path)} testId={`input-gara-extra-gara-mono-${bpKey}-${sk}`} />;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Premi per Soglia Raggiunta ({'\u20AC'}/pezzo)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-gara-extra-gara-premi">
            <thead>
              <tr className="bg-orange-500 text-white">
                <th className="p-2 text-left font-medium rounded-tl-md">Cluster P.IVA</th>
                <th className="p-2 text-center font-medium">Nessuna</th>
                <th className="p-2 text-center font-medium">S1</th>
                <th className="p-2 text-center font-medium">S2</th>
                <th className="p-2 text-center font-medium">S3</th>
                <th className="p-2 text-center font-medium rounded-tr-md">S4</th>
              </tr>
            </thead>
            <tbody>
              {clusterKeys.map(cluster => (
                <tr key={cluster} className="even:bg-muted/30">
                  <td className="p-2 font-medium border border-border">{CLUSTER_PIVA_LABELS[cluster] || cluster}</td>
                  {[0, 1, 2, 3, 4].map(i => {
                    const path = `extraGara.premiPerSoglia.${cluster}`;
                    const val = getNestedArrayValue(config, path, i) ?? PREMI_EXTRA_GARA[cluster as ClusterPIvaCode][i];
                    const def = getNestedArrayValue(baseDefaults, path, i) ?? PREMI_EXTRA_GARA[cluster as ClusterPIvaCode][i];
                    return <EditableCell key={i} value={val} defaultValue={def} isOverridden={isArrayOverridden(path, i)} onChange={v => updateArrayValue(path, i, v)} onReset={() => resetArrayValue(path, i)} testId={`input-gara-extra-gara-premio-${cluster}-${i}`} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
