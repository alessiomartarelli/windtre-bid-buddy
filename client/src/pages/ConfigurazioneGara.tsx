import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppNavbar } from '@/components/AppNavbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useGaraConfig, GaraConfigPdv, GaraConfigData } from '@/hooks/useGaraConfig';
import { CLUSTER_OPTIONS, CLUSTER_PIVA_OPTIONS, WEEKDAY_LABELS, ClusterCode } from '@/types/preventivatore';
import { getDefaultTarget100, calculateTarget80, calculatePremio80 } from '@/types/partnership-reward';
import { getThresholdsByCluster, mapClusterMobileToClusterPista, getDefaultFissoThresholds, mapClusterFissoToNumber } from '@/utils/preventivatore-helpers';
import { calcolaSoglieDefaultPerRS as calcolaSoglieEnergiaDefault } from '@/types/energia';
import { apiUrl } from '@/lib/basePath';
import {
  Loader2, Save, Download, Plus, Trash2, CalendarDays, Store,
  ChevronDown, ChevronUp, History, Upload, Settings, Target, Zap, Shield,
} from 'lucide-react';

const MONTHS = [
  { value: 1, label: 'Gennaio' },
  { value: 2, label: 'Febbraio' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Aprile' },
  { value: 5, label: 'Maggio' },
  { value: 6, label: 'Giugno' },
  { value: 7, label: 'Luglio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Settembre' },
  { value: 10, label: 'Ottobre' },
  { value: 11, label: 'Novembre' },
  { value: 12, label: 'Dicembre' },
];

function createEmptyGaraPdv(codicePos: string, nome: string, ragioneSociale: string): GaraConfigPdv {
  return {
    id: codicePos || crypto.randomUUID(),
    codicePos,
    nome,
    ragioneSociale,
    tipoPosizione: 'altro',
    canale: 'franchising',
    clusterMobile: '',
    clusterFisso: '',
    clusterCB: '',
    clusterPIva: '',
    abilitaEnergia: false,
    abilitaAssicurazioni: false,
    calendar: { weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] } },
  };
}

function initMobileConfigForPdv(pdv: GaraConfigPdv) {
  if (!pdv.clusterMobile) {
    return { posCode: pdv.codicePos, soglia1: 70, soglia2: 105, soglia3: 135, soglia4: 165, canoneMedio: 10, forecastTargetPunti: 100, clusterPista: 1 };
  }
  const clusterPista = mapClusterMobileToClusterPista(pdv.clusterMobile as ClusterCode);
  const thresholds = getThresholdsByCluster(pdv.tipoPosizione || 'altro', clusterPista, pdv.clusterMobile);
  return {
    posCode: pdv.codicePos,
    ...thresholds,
    canoneMedio: 10,
    forecastTargetPunti: thresholds.soglia4,
    clusterPista,
  };
}

function initFissoConfigForPdv(pdv: GaraConfigPdv) {
  if (!pdv.clusterFisso) {
    return { posCode: pdv.codicePos, soglia1: 28, soglia2: 46, soglia3: 57, soglia4: 67, soglia5: 80, forecastTargetPunti: 80 };
  }
  const clusterNum = mapClusterFissoToNumber(pdv.clusterFisso as ClusterCode);
  const thresholds = getDefaultFissoThresholds(pdv.tipoPosizione || 'altro', clusterNum);
  return {
    posCode: pdv.codicePos,
    ...thresholds,
    forecastTargetPunti: thresholds.soglia5,
  };
}

function initPartnershipConfigForPdv(pdv: GaraConfigPdv) {
  const tipoPosizione = (pdv.tipoPosizione === 'centro_commerciale' ? 'centro_commerciale' : pdv.tipoPosizione === 'strada' ? 'strada' : 'altro') as 'centro_commerciale' | 'strada' | 'altro';
  const target100 = getDefaultTarget100(tipoPosizione, pdv.clusterCB || 'strada_1');
  const premio100 = 100;
  return {
    posCode: pdv.codicePos,
    config: {
      target100,
      target80: calculateTarget80(target100),
      premio100,
      premio80: calculatePremio80(premio100),
    },
  };
}

function PdvCard({
  pdv, index, onUpdate, onRemove,
}: {
  pdv: GaraConfigPdv;
  index: number;
  onUpdate: (index: number, updated: GaraConfigPdv) => void;
  onRemove: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const updateField = <K extends keyof GaraConfigPdv>(field: K, value: GaraConfigPdv[K]) => {
    onUpdate(index, { ...pdv, [field]: value });
  };

  const toggleWorkingDay = (day: number) => {
    const current = pdv.calendar.weeklySchedule.workingDays;
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day].sort((a, b) => a - b);
    onUpdate(index, {
      ...pdv,
      calendar: { ...pdv.calendar, weeklySchedule: { workingDays: updated } },
    });
  };

  return (
    <Card className="border" data-testid={`card-pdv-${pdv.codicePos || index}`}>
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-toggle-pdv-${index}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Store className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <span className="font-medium text-sm">{pdv.codicePos || '(no code)'}</span>
            {pdv.nome && <span className="text-muted-foreground text-sm ml-2">{pdv.nome}</span>}
            {pdv.ragioneSociale && <span className="text-muted-foreground text-xs ml-2">({pdv.ragioneSociale})</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pdv.clusterMobile && <Badge variant="outline" className="text-xs">M:{pdv.clusterMobile}</Badge>}
          {pdv.clusterFisso && <Badge variant="outline" className="text-xs">F:{pdv.clusterFisso}</Badge>}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Codice POS</Label>
              <Input value={pdv.codicePos} onChange={e => updateField('codicePos', e.target.value)} className="h-8 text-sm" data-testid={`input-codice-pos-${index}`} />
            </div>
            <div>
              <Label className="text-xs">Nome</Label>
              <Input value={pdv.nome} onChange={e => updateField('nome', e.target.value)} className="h-8 text-sm" data-testid={`input-nome-pdv-${index}`} />
            </div>
            <div>
              <Label className="text-xs">Ragione Sociale</Label>
              <Input value={pdv.ragioneSociale} onChange={e => updateField('ragioneSociale', e.target.value)} className="h-8 text-sm" data-testid={`input-rs-pdv-${index}`} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs">Cluster Mobile</Label>
              <Select value={pdv.clusterMobile || '__none__'} onValueChange={v => updateField('clusterMobile', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm" data-testid={`select-cluster-mobile-${index}`}><SelectValue placeholder="--" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">--</SelectItem>
                  {CLUSTER_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cluster Fisso</Label>
              <Select value={pdv.clusterFisso || '__none__'} onValueChange={v => updateField('clusterFisso', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm" data-testid={`select-cluster-fisso-${index}`}><SelectValue placeholder="--" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">--</SelectItem>
                  {CLUSTER_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cluster CB</Label>
              <Select value={pdv.clusterCB || '__none__'} onValueChange={v => updateField('clusterCB', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm" data-testid={`select-cluster-cb-${index}`}><SelectValue placeholder="--" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">--</SelectItem>
                  {CLUSTER_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cluster P.IVA</Label>
              <Select value={pdv.clusterPIva || '__none__'} onValueChange={v => updateField('clusterPIva', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm" data-testid={`select-cluster-piva-${index}`}><SelectValue placeholder="--" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">--</SelectItem>
                  {CLUSTER_PIVA_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1 mb-2">
              <CalendarDays className="h-3.5 w-3.5" />
              Giorni lavorativi
            </Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_LABELS.map(day => {
                const isActive = pdv.calendar.weeklySchedule.workingDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
                    }`}
                    onClick={() => toggleWorkingDay(day.value)}
                    data-testid={`button-day-${day.value}-pdv-${index}`}
                  >
                    {day.label.substring(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1 mb-2">
              <CalendarDays className="h-3.5 w-3.5" />
              Giorni speciali
            </Label>
            <div className="space-y-2">
              {(pdv.calendar.specialDays || []).map((sd, sdIdx) => (
                <div key={sdIdx} className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={sd.date}
                    onChange={e => {
                      const updated = [...(pdv.calendar.specialDays || [])];
                      updated[sdIdx] = { ...updated[sdIdx], date: e.target.value };
                      onUpdate(index, { ...pdv, calendar: { ...pdv.calendar, specialDays: updated } });
                    }}
                    className="h-7 text-xs w-[140px]"
                    data-testid={`input-special-date-${sdIdx}-pdv-${index}`}
                  />
                  <Select
                    value={sd.isOpen ? 'open' : 'closed'}
                    onValueChange={v => {
                      const updated = [...(pdv.calendar.specialDays || [])];
                      updated[sdIdx] = { ...updated[sdIdx], isOpen: v === 'open' };
                      onUpdate(index, { ...pdv, calendar: { ...pdv.calendar, specialDays: updated } });
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs w-[100px]" data-testid={`select-special-type-${sdIdx}-pdv-${index}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Aperto</SelectItem>
                      <SelectItem value="closed">Chiuso</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={sd.note || ''}
                    onChange={e => {
                      const updated = [...(pdv.calendar.specialDays || [])];
                      updated[sdIdx] = { ...updated[sdIdx], note: e.target.value };
                      onUpdate(index, { ...pdv, calendar: { ...pdv.calendar, specialDays: updated } });
                    }}
                    placeholder="Nota"
                    className="h-7 text-xs flex-1"
                    data-testid={`input-special-note-${sdIdx}-pdv-${index}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => {
                      const updated = (pdv.calendar.specialDays || []).filter((_, i) => i !== sdIdx);
                      onUpdate(index, { ...pdv, calendar: { ...pdv.calendar, specialDays: updated } });
                    }}
                    data-testid={`button-remove-special-${sdIdx}-pdv-${index}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const newDay = { date: '', isOpen: false, note: '' };
                  const updated = [...(pdv.calendar.specialDays || []), newDay];
                  onUpdate(index, { ...pdv, calendar: { ...pdv.calendar, specialDays: updated } });
                }}
                data-testid={`button-add-special-day-pdv-${index}`}
              >
                <Plus className="h-3 w-3 mr-1" />
                Aggiungi giorno speciale
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox checked={pdv.abilitaEnergia} onCheckedChange={v => updateField('abilitaEnergia', !!v)} data-testid={`checkbox-energia-${index}`} />
              <Label className="text-xs">Energia</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={pdv.abilitaAssicurazioni} onCheckedChange={v => updateField('abilitaAssicurazioni', !!v)} data-testid={`checkbox-assicurazioni-${index}`} />
              <Label className="text-xs">Assicurazioni</Label>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onRemove(index)} data-testid={`button-remove-pdv-${index}`}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Rimuovi
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

type MobilePosConf = NonNullable<GaraConfigData['pistaMobileConfig']>['sogliePerPos'][number];
type FissoPosConf = NonNullable<GaraConfigData['pistaFissoConfig']>['sogliePerPos'][number];
type PartnershipPosConf = NonNullable<GaraConfigData['partnershipRewardConfig']>['configPerPos'][number];
type MobileRSConf = NonNullable<GaraConfigData['pistaMobileRSConfig']>['sogliePerRS'][number];
type FissoRSConf = NonNullable<GaraConfigData['pistaFissoRSConfig']>['sogliePerRS'][number];
type PartnershipRSConf = NonNullable<GaraConfigData['partnershipRewardRSConfig']>['configPerRS'][number];

export default function ConfigurazioneGara() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [pdvList, setPdvList] = useState<GaraConfigPdv[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [addPdvDialogOpen, setAddPdvDialogOpen] = useState(false);
  const [newPdvCode, setNewPdvCode] = useState('');
  const [newPdvName, setNewPdvName] = useState('');
  const [newPdvRS, setNewPdvRS] = useState('');
  const [simulatorConfigs, setSimulatorConfigs] = useState<Array<{ id: string; name: string; updatedAt: string | null }>>([]);
  const [loadingSimConfigs, setLoadingSimConfigs] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const [tipologiaGara, setTipologiaGara] = useState<'gara_operatore' | 'gara_operatore_rs'>('gara_operatore');
  const [modalitaRS, setModalitaRS] = useState<'per_pdv' | 'per_rs'>('per_pdv');

  const [mobileConfig, setMobileConfig] = useState<MobilePosConf[]>([]);
  const [fissoConfig, setFissoConfig] = useState<FissoPosConf[]>([]);
  const [partnershipConfig, setPartnershipConfig] = useState<PartnershipPosConf[]>([]);

  const [mobileRSConfig, setMobileRSConfig] = useState<MobileRSConf[]>([]);
  const [fissoRSConfig, setFissoRSConfig] = useState<FissoRSConf[]>([]);
  const [partnershipRSConfig, setPartnershipRSConfig] = useState<PartnershipRSConf[]>([]);

  const [energiaConfig, setEnergiaConfig] = useState<NonNullable<GaraConfigData['energiaConfig']>>({
    pdvInGara: 0, targetNoMalus: 3, targetS1: 5, targetS2: 8, targetS3: 12,
  });
  const [assicurazioniConfig, setAssicurazioniConfig] = useState<NonNullable<GaraConfigData['assicurazioniConfig']>>({
    pdvInGara: 0, targetNoMalus: 3, targetS1: 8, targetS2: 15,
  });

  const { profile } = useAuth();
  const { toast } = useToast();
  const {
    config: garaConfigRecord,
    loading, saving, history,
    fetchConfig, saveConfig, fetchHistory, fetchPdvFromSales, importFromSimulator,
  } = useGaraConfig();

  const isAdminOrSuper = ['super_admin', 'admin'].includes(profile?.role || '');

  const rsGroups = useMemo(() => {
    const map = new Map<string, GaraConfigPdv[]>();
    for (const pdv of pdvList) {
      const rs = pdv.ragioneSociale || 'Senza RS';
      if (!map.has(rs)) map.set(rs, []);
      map.get(rs)!.push(pdv);
    }
    return map;
  }, [pdvList]);

  const initializeRSConfigsFromPdvList = useCallback((pdvs: GaraConfigPdv[]) => {
    const rsMap = new Map<string, GaraConfigPdv[]>();
    for (const pdv of pdvs) {
      const rs = pdv.ragioneSociale || 'Senza RS';
      if (!rsMap.has(rs)) rsMap.set(rs, []);
      rsMap.get(rs)!.push(pdv);
    }

    const mobileRS: MobileRSConf[] = [];
    const fissoRS: FissoRSConf[] = [];
    const partnershipRS: PartnershipRSConf[] = [];

    rsMap.forEach((pdvs, ragioneSociale) => {
      let mS1 = 0, mS2 = 0, mS3 = 0, mS4 = 0;
      let fS1 = 0, fS2 = 0, fS3 = 0, fS4 = 0, fS5 = 0;
      let pTarget = 0, pPremio = 0;

      for (const p of pdvs) {
        const mc = initMobileConfigForPdv(p);
        mS1 += mc.soglia1; mS2 += mc.soglia2; mS3 += mc.soglia3; mS4 += mc.soglia4;
        const fc = initFissoConfigForPdv(p);
        fS1 += fc.soglia1; fS2 += fc.soglia2; fS3 += fc.soglia3; fS4 += fc.soglia4; fS5 += fc.soglia5;
        const pc = initPartnershipConfigForPdv(p);
        pTarget += pc.config.target100; pPremio += pc.config.premio100;
      }

      mobileRS.push({ ragioneSociale, soglia1: mS1, soglia2: mS2, soglia3: mS3, soglia4: mS4, canoneMedio: 10, forecastTargetPunti: mS4 });
      fissoRS.push({ ragioneSociale, soglia1: fS1, soglia2: fS2, soglia3: fS3, soglia4: fS4, soglia5: fS5, forecastTargetPunti: fS5 });
      partnershipRS.push({ ragioneSociale, target100: pTarget, target80: calculateTarget80(pTarget), premio100: pPremio, premio80: calculatePremio80(pPremio) });
    });

    setMobileRSConfig(mobileRS);
    setFissoRSConfig(fissoRS);
    setPartnershipRSConfig(partnershipRS);
  }, []);

  const initializeConfigsFromPdvList = useCallback((pdvs: GaraConfigPdv[]) => {
    setMobileConfig(pdvs.map(p => initMobileConfigForPdv(p)));
    setFissoConfig(pdvs.map(p => initFissoConfigForPdv(p)));
    setPartnershipConfig(pdvs.map(p => initPartnershipConfigForPdv(p)));

    initializeRSConfigsFromPdvList(pdvs);

    const pdvEnergia = pdvs.filter(p => p.abilitaEnergia).length;
    const pdvAssicurazioni = pdvs.filter(p => p.abilitaAssicurazioni).length;
    const soglieEnergia = calcolaSoglieEnergiaDefault(pdvEnergia);
    setEnergiaConfig(prev => ({ ...prev, pdvInGara: pdvEnergia, pistaSoglia_S1: soglieEnergia.S1, pistaSoglia_S2: soglieEnergia.S2, pistaSoglia_S3: soglieEnergia.S3, pistaSoglia_S4: soglieEnergia.S4, pistaSoglia_S5: soglieEnergia.S5 }));
    setAssicurazioniConfig(prev => ({ ...prev, pdvInGara: pdvAssicurazioni }));
  }, [initializeRSConfigsFromPdvList]);

  const loadMonthConfig = useCallback(async (month: number, year: number) => {
    setInitialLoaded(false);
    const result = await fetchConfig(month, year);
    if (result?.config) {
      const cfg = result.config as unknown as GaraConfigData;
      const pdvs = cfg.pdvList || [];
      setPdvList(pdvs);

      if (cfg.tipologiaGara) setTipologiaGara(cfg.tipologiaGara);
      else setTipologiaGara('gara_operatore');

      if (cfg.modalitaInserimentoRS) setModalitaRS(cfg.modalitaInserimentoRS as 'per_pdv' | 'per_rs');
      else setModalitaRS('per_pdv');

      if (cfg.pistaMobileConfig?.sogliePerPos?.length) {
        setMobileConfig(cfg.pistaMobileConfig.sogliePerPos);
      } else {
        setMobileConfig(pdvs.map(p => initMobileConfigForPdv(p)));
      }
      if (cfg.pistaFissoConfig?.sogliePerPos?.length) {
        setFissoConfig(cfg.pistaFissoConfig.sogliePerPos);
      } else {
        setFissoConfig(pdvs.map(p => initFissoConfigForPdv(p)));
      }
      if (cfg.partnershipRewardConfig?.configPerPos?.length) {
        setPartnershipConfig(cfg.partnershipRewardConfig.configPerPos);
      } else {
        setPartnershipConfig(pdvs.map(p => initPartnershipConfigForPdv(p)));
      }
      if (cfg.pistaMobileRSConfig?.sogliePerRS?.length) {
        setMobileRSConfig(cfg.pistaMobileRSConfig.sogliePerRS);
      } else {
        initializeRSConfigsFromPdvList(pdvs);
      }
      if (cfg.pistaFissoRSConfig?.sogliePerRS?.length) {
        setFissoRSConfig(cfg.pistaFissoRSConfig.sogliePerRS);
      }
      if (cfg.partnershipRewardRSConfig?.configPerRS?.length) {
        setPartnershipRSConfig(cfg.partnershipRewardRSConfig.configPerRS);
      }
      if (cfg.energiaConfig) {
        setEnergiaConfig(cfg.energiaConfig);
      } else {
        const pdvE = pdvs.filter(p => p.abilitaEnergia).length;
        const se = calcolaSoglieEnergiaDefault(pdvE);
        setEnergiaConfig({ pdvInGara: pdvE, targetNoMalus: 3, targetS1: 5, targetS2: 8, targetS3: 12, pistaSoglia_S1: se.S1, pistaSoglia_S2: se.S2, pistaSoglia_S3: se.S3, pistaSoglia_S4: se.S4, pistaSoglia_S5: se.S5 });
      }
      if (cfg.assicurazioniConfig) {
        setAssicurazioniConfig(cfg.assicurazioniConfig);
      } else {
        const pdvA = pdvs.filter(p => p.abilitaAssicurazioni).length;
        setAssicurazioniConfig({ pdvInGara: pdvA, targetNoMalus: 3, targetS1: 8, targetS2: 15 });
      }
    } else {
      setTipologiaGara('gara_operatore');
      setModalitaRS('per_pdv');
      setMobileRSConfig([]);
      setFissoRSConfig([]);
      setPartnershipRSConfig([]);
      setEnergiaConfig({ pdvInGara: 0, targetNoMalus: 3, targetS1: 5, targetS2: 8, targetS3: 12 });
      setAssicurazioniConfig({ pdvInGara: 0, targetNoMalus: 3, targetS1: 8, targetS2: 15 });

      const salesPdvs = await fetchPdvFromSales(month, year);
      if (salesPdvs.length > 0) {
        const autoPdvList = salesPdvs.map(sp => createEmptyGaraPdv(sp.codicePos, sp.nomeNegozio, sp.ragioneSociale));
        setPdvList(autoPdvList);
        initializeConfigsFromPdvList(autoPdvList);
        toast({ title: 'PDV auto-popolati', description: `${autoPdvList.length} PDV trovati dalle vendite BiSuite.` });
      } else {
        setPdvList([]);
        setMobileConfig([]);
        setFissoConfig([]);
        setPartnershipConfig([]);
      }
    }
    setIsDirty(false);
    setInitialLoaded(true);
  }, [fetchConfig, fetchPdvFromSales, toast, initializeConfigsFromPdvList]);

  useEffect(() => {
    loadMonthConfig(selectedMonth, selectedYear);
    fetchHistory();
  }, [selectedMonth, selectedYear, loadMonthConfig, fetchHistory]);

  const handleSave = async () => {
    const configData: GaraConfigData = {
      pdvList,
      tipologiaGara,
      modalitaInserimentoRS: tipologiaGara === 'gara_operatore_rs' ? modalitaRS : null,
      pistaMobileConfig: { sogliePerPos: mobileConfig },
      pistaFissoConfig: { sogliePerPos: fissoConfig },
      partnershipRewardConfig: { configPerPos: partnershipConfig },
      pistaMobileRSConfig: { sogliePerRS: mobileRSConfig },
      pistaFissoRSConfig: { sogliePerRS: fissoRSConfig },
      partnershipRewardRSConfig: { configPerRS: partnershipRSConfig },
      energiaConfig,
      assicurazioniConfig,
      ...(garaConfigRecord?.config ? {
        importedFrom: (garaConfigRecord.config as unknown as GaraConfigData).importedFrom,
      } : {}),
    };
    const result = await saveConfig(selectedMonth, selectedYear, configData);
    if (result) {
      setIsDirty(false);
      fetchHistory();
      toast({ title: 'Salvato', description: 'Configurazione gara salvata con successo.' });
    } else {
      toast({ title: 'Errore', description: 'Impossibile salvare la configurazione.', variant: 'destructive' });
    }
  };

  const handleUpdatePdv = (index: number, updated: GaraConfigPdv) => {
    setPdvList(prev => prev.map((p, i) => i === index ? updated : p));
    setIsDirty(true);
  };

  const handleRemovePdv = (index: number) => {
    const updatedPdvs = pdvList.filter((_, i) => i !== index);
    setPdvList(updatedPdvs);
    setMobileConfig(prev => prev.filter((_, i) => i !== index));
    setFissoConfig(prev => prev.filter((_, i) => i !== index));
    setPartnershipConfig(prev => prev.filter((_, i) => i !== index));
    if (tipologiaGara === 'gara_operatore_rs') {
      initializeRSConfigsFromPdvList(updatedPdvs);
    }
    setIsDirty(true);
  };

  const handleAddPdv = () => {
    if (!newPdvCode.trim()) return;
    const newPdv = createEmptyGaraPdv(newPdvCode.trim(), newPdvName.trim(), newPdvRS.trim());
    const updatedPdvs = [...pdvList, newPdv];
    setPdvList(updatedPdvs);
    setMobileConfig(prev => [...prev, initMobileConfigForPdv(newPdv)]);
    setFissoConfig(prev => [...prev, initFissoConfigForPdv(newPdv)]);
    setPartnershipConfig(prev => [...prev, initPartnershipConfigForPdv(newPdv)]);
    if (tipologiaGara === 'gara_operatore_rs') {
      initializeRSConfigsFromPdvList(updatedPdvs);
    }
    setNewPdvCode('');
    setNewPdvName('');
    setNewPdvRS('');
    setAddPdvDialogOpen(false);
    setIsDirty(true);
  };

  const reinitFromClusters = () => {
    initializeConfigsFromPdvList(pdvList);
    setIsDirty(true);
    toast({ title: 'Soglie ricalcolate', description: 'Le soglie sono state ricalcolate dai cluster dei PDV.' });
  };

  const openImportDialog = async () => {
    setImportDialogOpen(true);
    setLoadingSimConfigs(true);
    try {
      const res = await fetch(apiUrl('/api/pdv-configurations'), { credentials: 'include' });
      if (res.ok) setSimulatorConfigs(await res.json());
    } catch { /* ignore */ } finally {
      setLoadingSimConfigs(false);
    }
  };

  const handleImport = async (source: 'pdv_configuration' | 'organization_config', pdvConfigId?: string) => {
    const result = await importFromSimulator(selectedMonth, selectedYear, source, pdvConfigId);
    if (result?.config) {
      const cfg = result.config as unknown as GaraConfigData;
      const pdvs = cfg.pdvList || [];
      setPdvList(pdvs);

      setTipologiaGara(cfg.tipologiaGara || 'gara_operatore');
      setModalitaRS((cfg.modalitaInserimentoRS as 'per_pdv' | 'per_rs') || 'per_pdv');

      if (cfg.pistaMobileConfig?.sogliePerPos?.length) {
        setMobileConfig(cfg.pistaMobileConfig.sogliePerPos);
      } else {
        setMobileConfig(pdvs.map(p => initMobileConfigForPdv(p)));
      }
      if (cfg.pistaFissoConfig?.sogliePerPos?.length) {
        setFissoConfig(cfg.pistaFissoConfig.sogliePerPos);
      } else {
        setFissoConfig(pdvs.map(p => initFissoConfigForPdv(p)));
      }
      if (cfg.partnershipRewardConfig?.configPerPos?.length) {
        setPartnershipConfig(cfg.partnershipRewardConfig.configPerPos);
      } else {
        setPartnershipConfig(pdvs.map(p => initPartnershipConfigForPdv(p)));
      }

      setMobileRSConfig(cfg.pistaMobileRSConfig?.sogliePerRS || []);
      setFissoRSConfig(cfg.pistaFissoRSConfig?.sogliePerRS || []);
      setPartnershipRSConfig(cfg.partnershipRewardRSConfig?.configPerRS || []);

      if (cfg.energiaConfig) {
        setEnergiaConfig(cfg.energiaConfig);
      } else {
        const pdvE = pdvs.filter(p => p.abilitaEnergia).length;
        const se = calcolaSoglieEnergiaDefault(pdvE);
        setEnergiaConfig({ pdvInGara: pdvE, targetNoMalus: 3, targetS1: 5, targetS2: 8, targetS3: 12, pistaSoglia_S1: se.S1, pistaSoglia_S2: se.S2, pistaSoglia_S3: se.S3, pistaSoglia_S4: se.S4, pistaSoglia_S5: se.S5 });
      }
      if (cfg.assicurazioniConfig) {
        setAssicurazioniConfig(cfg.assicurazioniConfig);
      } else {
        const pdvA = pdvs.filter(p => p.abilitaAssicurazioni).length;
        setAssicurazioniConfig({ pdvInGara: pdvA, targetNoMalus: 3, targetS1: 8, targetS2: 15 });
      }

      setIsDirty(false);
      setImportDialogOpen(false);
      fetchHistory();
      toast({ title: 'Importazione completata', description: 'Configurazione importata dal simulatore.' });
    } else {
      toast({ title: 'Errore', description: "Impossibile importare la configurazione.", variant: 'destructive' });
    }
  };

  const handleMonthChange = (month: number, year: number) => {
    setSelectedMonth(month);
    setSelectedYear(year);
  };

  const updateMobilePos = (index: number, field: keyof MobilePosConf, value: number) => {
    setMobileConfig(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
    setIsDirty(true);
  };

  const updateFissoPos = (index: number, field: keyof FissoPosConf, value: number) => {
    setFissoConfig(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
    setIsDirty(true);
  };

  const updatePartnershipPos = (index: number, field: 'target100' | 'premio100', value: number) => {
    setPartnershipConfig(prev => prev.map((c, i) => {
      if (i !== index) return c;
      const updated = { ...c.config, [field]: value };
      if (field === 'target100') updated.target80 = calculateTarget80(value);
      if (field === 'premio100') updated.premio80 = calculatePremio80(value);
      return { ...c, config: updated };
    }));
    setIsDirty(true);
  };

  const updateMobileRS = (index: number, field: keyof MobileRSConf, value: number) => {
    setMobileRSConfig(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
    setIsDirty(true);
  };

  const updateFissoRS = (index: number, field: keyof FissoRSConf, value: number) => {
    setFissoRSConfig(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
    setIsDirty(true);
  };

  const updatePartnershipRS = (index: number, field: 'target100' | 'premio100', value: number) => {
    setPartnershipRSConfig(prev => prev.map((c, i) => {
      if (i !== index) return c;
      const updated = { ...c, [field]: value };
      if (field === 'target100') updated.target80 = calculateTarget80(value);
      if (field === 'premio100') updated.premio80 = calculatePremio80(value);
      return updated;
    }));
    setIsDirty(true);
  };

  if (!isAdminOrSuper) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavbar title="Configurazione Gara" />
        <div className="container mx-auto p-6">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Accesso riservato agli amministratori.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const showPerPdv = tipologiaGara === 'gara_operatore' || (tipologiaGara === 'gara_operatore_rs' && modalitaRS === 'per_pdv');
  const showPerRS = tipologiaGara === 'gara_operatore_rs' && modalitaRS === 'per_rs';

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Configurazione Gara" />
      <div className="container mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={String(selectedMonth)} onValueChange={v => handleMonthChange(Number(v), selectedYear)}>
              <SelectTrigger className="w-[140px] h-9" data-testid="select-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(selectedYear)} onValueChange={v => handleMonthChange(selectedMonth, Number(v))}>
              <SelectTrigger className="w-[100px] h-9" data-testid="select-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {garaConfigRecord && <Badge variant="secondary" className="text-xs">Salvato</Badge>}
            {isDirty && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Modifiche non salvate</Badge>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => { setHistoryDialogOpen(true); fetchHistory(); }} data-testid="button-history">
              <History className="h-4 w-4 mr-1" />Storico
            </Button>
            <Button variant="outline" size="sm" onClick={openImportDialog} data-testid="button-import">
              <Download className="h-4 w-4 mr-1" />Importa
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddPdvDialogOpen(true)} data-testid="button-add-pdv">
              <Plus className="h-4 w-4 mr-1" />PDV
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !isDirty} data-testid="button-save">
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Salva
            </Button>
          </div>
        </div>

        {loading && !initialLoaded ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="pdv" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="pdv" data-testid="tab-pdv">
                <Store className="h-4 w-4 mr-1" />PDV ({pdvList.length})
              </TabsTrigger>
              <TabsTrigger value="soglie" data-testid="tab-soglie">
                <Target className="h-4 w-4 mr-1" />Soglie
              </TabsTrigger>
              <TabsTrigger value="extra" data-testid="tab-extra">
                <Settings className="h-4 w-4 mr-1" />Energia & Ass.
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pdv" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Tipo Gara
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Tipologia Gara</Label>
                      <Select value={tipologiaGara} onValueChange={(v: string) => {
                        const newTipo = v as 'gara_operatore' | 'gara_operatore_rs';
                        setTipologiaGara(newTipo);
                        if (newTipo === 'gara_operatore_rs' && mobileRSConfig.length === 0 && pdvList.length > 0) {
                          initializeRSConfigsFromPdvList(pdvList);
                        }
                        setIsDirty(true);
                      }}>
                        <SelectTrigger className="h-8 text-sm" data-testid="select-tipologia-gara"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gara_operatore">Gara Operatore</SelectItem>
                          <SelectItem value="gara_operatore_rs">Gara Operatore RS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {tipologiaGara === 'gara_operatore_rs' && (
                      <div>
                        <Label className="text-xs">Modalita Inserimento RS</Label>
                        <Select value={modalitaRS} onValueChange={(v: string) => { setModalitaRS(v as 'per_pdv' | 'per_rs'); setIsDirty(true); }}>
                          <SelectTrigger className="h-8 text-sm" data-testid="select-modalita-rs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="per_pdv">Per PDV</SelectItem>
                            <SelectItem value="per_rs">Per Ragione Sociale</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {pdvList.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-4">
                      Nessun PDV configurato per {MONTHS.find(m => m.value === selectedMonth)?.label} {selectedYear}.
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <Button variant="outline" onClick={openImportDialog} data-testid="button-import-empty">
                        <Download className="h-4 w-4 mr-1" />Importa da Simulatore
                      </Button>
                      <Button variant="outline" onClick={() => setAddPdvDialogOpen(true)} data-testid="button-add-pdv-empty">
                        <Plus className="h-4 w-4 mr-1" />Aggiungi PDV
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground mb-2">{pdvList.length} PDV configurati</div>
                  {pdvList.map((pdv, idx) => (
                    <PdvCard key={pdv.id || idx} pdv={pdv} index={idx} onUpdate={handleUpdatePdv} onRemove={handleRemovePdv} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="soglie" className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Configura soglie Mobile, Fisso e Partnership Reward {showPerRS ? 'per Ragione Sociale' : 'per PDV'}.
                </p>
                <Button variant="outline" size="sm" onClick={reinitFromClusters} data-testid="button-reinit-soglie">
                  <Target className="h-4 w-4 mr-1" />Ricalcola dai cluster
                </Button>
              </div>

              {pdvList.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Nessun PDV configurato. Vai alla tab PDV per aggiungere punti vendita.
                  </CardContent>
                </Card>
              ) : showPerPdv ? (
                <div className="space-y-4">
                  {pdvList.map((pdv, index) => {
                    const mc = mobileConfig[index];
                    const fc = fissoConfig[index];
                    const pc = partnershipConfig[index];
                    if (!mc || !fc || !pc) return null;

                    return (
                      <Card key={pdv.id || index} className="border" data-testid={`card-soglie-pdv-${pdv.codicePos || index}`}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">
                            {pdv.codicePos || '—'} — {pdv.nome || 'PDV'}
                            {pdv.ragioneSociale && <span className="text-muted-foreground font-normal ml-2">({pdv.ragioneSociale})</span>}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="h-5 w-1 bg-blue-500 rounded-full" />
                              <h4 className="font-semibold text-xs">Pista Mobile</h4>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                              {(['soglia1', 'soglia2', 'soglia3', 'soglia4'] as const).map(f => (
                                <div key={f} className="space-y-0.5">
                                  <Label className="text-[10px]">{f.replace('soglia', 'S')}</Label>
                                  <Input type="number" className="h-7 text-xs" value={mc[f] ?? ''} onChange={e => updateMobilePos(index, f, Number(e.target.value) || 0)} data-testid={`input-mobile-${f}-${index}`} />
                                </div>
                              ))}
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Canone M.</Label>
                                <Input type="number" step="0.5" className="h-7 text-xs" value={mc.canoneMedio ?? ''} onChange={e => updateMobilePos(index, 'canoneMedio', Number(e.target.value) || 0)} data-testid={`input-mobile-canone-${index}`} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Forecast</Label>
                                <Input type="number" className="h-7 text-xs" value={mc.forecastTargetPunti ?? ''} onChange={e => updateMobilePos(index, 'forecastTargetPunti', Number(e.target.value) || 0)} data-testid={`input-mobile-forecast-${index}`} />
                              </div>
                            </div>
                          </div>

                          <Separator />

                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="h-5 w-1 bg-green-500 rounded-full" />
                              <h4 className="font-semibold text-xs">Pista Fisso</h4>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                              {(['soglia1', 'soglia2', 'soglia3', 'soglia4', 'soglia5'] as const).map(f => (
                                <div key={f} className="space-y-0.5">
                                  <Label className="text-[10px]">{f.replace('soglia', 'S')}</Label>
                                  <Input type="number" className="h-7 text-xs" value={fc[f] ?? ''} onChange={e => updateFissoPos(index, f, Number(e.target.value) || 0)} data-testid={`input-fisso-${f}-${index}`} />
                                </div>
                              ))}
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Forecast</Label>
                                <Input type="number" className="h-7 text-xs" value={fc.forecastTargetPunti ?? ''} onChange={e => updateFissoPos(index, 'forecastTargetPunti', Number(e.target.value) || 0)} data-testid={`input-fisso-forecast-${index}`} />
                              </div>
                            </div>
                          </div>

                          <Separator />

                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="h-5 w-1 bg-purple-500 rounded-full" />
                              <h4 className="font-semibold text-xs">Partnership Reward</h4>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Target 100%</Label>
                                <Input type="number" className="h-7 text-xs" value={pc.config.target100 ?? ''} onChange={e => updatePartnershipPos(index, 'target100', Number(e.target.value) || 0)} data-testid={`input-partnership-target100-${index}`} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Target 80%</Label>
                                <Input type="number" className="h-7 text-xs bg-muted" value={pc.config.target80} disabled data-testid={`input-partnership-target80-${index}`} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Premio 100%</Label>
                                <Input type="number" step="0.01" className="h-7 text-xs" value={pc.config.premio100 ?? ''} onChange={e => updatePartnershipPos(index, 'premio100', Number(e.target.value) || 0)} data-testid={`input-partnership-premio100-${index}`} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Premio 80%</Label>
                                <Input type="number" step="0.01" className="h-7 text-xs bg-muted" value={pc.config.premio80} disabled data-testid={`input-partnership-premio80-${index}`} />
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4">
                  {Array.from(rsGroups.entries()).map(([rs, _pdvs]) => {
                    const mcIdx = mobileRSConfig.findIndex(c => c.ragioneSociale === rs);
                    const fcIdx = fissoRSConfig.findIndex(c => c.ragioneSociale === rs);
                    const pcIdx = partnershipRSConfig.findIndex(c => c.ragioneSociale === rs);
                    const mc = mcIdx >= 0 ? mobileRSConfig[mcIdx] : null;
                    const fc = fcIdx >= 0 ? fissoRSConfig[fcIdx] : null;
                    const pc = pcIdx >= 0 ? partnershipRSConfig[pcIdx] : null;
                    if (!mc || !fc || !pc) return null;

                    return (
                      <Card key={rs} className="border" data-testid={`card-soglie-rs-${rs}`}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">{rs}</CardTitle>
                          <CardDescription className="text-xs">{_pdvs.length} PDV</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="h-5 w-1 bg-blue-500 rounded-full" />
                              <h4 className="font-semibold text-xs">Pista Mobile</h4>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                              {(['soglia1', 'soglia2', 'soglia3', 'soglia4'] as const).map(f => (
                                <div key={f} className="space-y-0.5">
                                  <Label className="text-[10px]">{f.replace('soglia', 'S')}</Label>
                                  <Input type="number" className="h-7 text-xs" value={mc[f] ?? ''} onChange={e => updateMobileRS(mcIdx, f, Number(e.target.value) || 0)} data-testid={`input-mobile-rs-${f}-${rs}`} />
                                </div>
                              ))}
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Canone M.</Label>
                                <Input type="number" step="0.5" className="h-7 text-xs" value={mc.canoneMedio ?? ''} onChange={e => updateMobileRS(mcIdx, 'canoneMedio', Number(e.target.value) || 0)} data-testid={`input-mobile-rs-canone-${rs}`} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Forecast</Label>
                                <Input type="number" className="h-7 text-xs" value={mc.forecastTargetPunti ?? ''} onChange={e => updateMobileRS(mcIdx, 'forecastTargetPunti', Number(e.target.value) || 0)} data-testid={`input-mobile-rs-forecast-${rs}`} />
                              </div>
                            </div>
                          </div>

                          <Separator />

                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="h-5 w-1 bg-green-500 rounded-full" />
                              <h4 className="font-semibold text-xs">Pista Fisso</h4>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                              {(['soglia1', 'soglia2', 'soglia3', 'soglia4', 'soglia5'] as const).map(f => (
                                <div key={f} className="space-y-0.5">
                                  <Label className="text-[10px]">{f.replace('soglia', 'S')}</Label>
                                  <Input type="number" className="h-7 text-xs" value={fc[f] ?? ''} onChange={e => updateFissoRS(fcIdx, f, Number(e.target.value) || 0)} data-testid={`input-fisso-rs-${f}-${rs}`} />
                                </div>
                              ))}
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Forecast</Label>
                                <Input type="number" className="h-7 text-xs" value={fc.forecastTargetPunti ?? ''} onChange={e => updateFissoRS(fcIdx, 'forecastTargetPunti', Number(e.target.value) || 0)} data-testid={`input-fisso-rs-forecast-${rs}`} />
                              </div>
                            </div>
                          </div>

                          <Separator />

                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="h-5 w-1 bg-purple-500 rounded-full" />
                              <h4 className="font-semibold text-xs">Partnership Reward</h4>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Target 100%</Label>
                                <Input type="number" className="h-7 text-xs" value={pc.target100 ?? ''} onChange={e => updatePartnershipRS(pcIdx, 'target100', Number(e.target.value) || 0)} data-testid={`input-partnership-rs-target100-${rs}`} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Target 80%</Label>
                                <Input type="number" className="h-7 text-xs bg-muted" value={pc.target80} disabled />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Premio 100%</Label>
                                <Input type="number" step="0.01" className="h-7 text-xs" value={pc.premio100 ?? ''} onChange={e => updatePartnershipRS(pcIdx, 'premio100', Number(e.target.value) || 0)} data-testid={`input-partnership-rs-premio100-${rs}`} />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Premio 80%</Label>
                                <Input type="number" step="0.01" className="h-7 text-xs bg-muted" value={pc.premio80} disabled />
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="extra" className="space-y-4">
              <Card data-testid="card-energia-config">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Configurazione Energia
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {pdvList.filter(p => p.abilitaEnergia).length} PDV abilitati energia
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">PDV in Gara</Label>
                      <Input type="number" className="h-8 text-sm" value={energiaConfig.pdvInGara} onChange={e => { setEnergiaConfig(prev => ({ ...prev, pdvInGara: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-energia-pdv-in-gara" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target No Malus</Label>
                      <Input type="number" className="h-8 text-sm" value={energiaConfig.targetNoMalus} onChange={e => { setEnergiaConfig(prev => ({ ...prev, targetNoMalus: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-energia-target-no-malus" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target S1</Label>
                      <Input type="number" className="h-8 text-sm" value={energiaConfig.targetS1} onChange={e => { setEnergiaConfig(prev => ({ ...prev, targetS1: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-energia-target-s1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target S2</Label>
                      <Input type="number" className="h-8 text-sm" value={energiaConfig.targetS2} onChange={e => { setEnergiaConfig(prev => ({ ...prev, targetS2: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-energia-target-s2" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Target S3</Label>
                      <Input type="number" className="h-8 text-sm" value={energiaConfig.targetS3} onChange={e => { setEnergiaConfig(prev => ({ ...prev, targetS3: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-energia-target-s3" />
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label className="text-xs font-semibold mb-2 block">Soglie Pista Energia (aggregate)</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {(['pistaSoglia_S1', 'pistaSoglia_S2', 'pistaSoglia_S3', 'pistaSoglia_S4', 'pistaSoglia_S5'] as const).map(f => (
                        <div key={f} className="space-y-1">
                          <Label className="text-xs">{f.replace('pistaSoglia_', 'Soglia ')}</Label>
                          <Input type="number" className="h-8 text-sm" value={energiaConfig[f] ?? ''} onChange={e => { setEnergiaConfig(prev => ({ ...prev, [f]: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid={`input-energia-${f}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-assicurazioni-config">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Configurazione Assicurazioni
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {pdvList.filter(p => p.abilitaAssicurazioni).length} PDV abilitati assicurazioni
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">PDV in Gara</Label>
                      <Input type="number" className="h-8 text-sm" value={assicurazioniConfig.pdvInGara} onChange={e => { setAssicurazioniConfig(prev => ({ ...prev, pdvInGara: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-assicurazioni-pdv-in-gara" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target No Malus</Label>
                      <Input type="number" className="h-8 text-sm" value={assicurazioniConfig.targetNoMalus} onChange={e => { setAssicurazioniConfig(prev => ({ ...prev, targetNoMalus: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-assicurazioni-target-no-malus" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target S1</Label>
                      <Input type="number" className="h-8 text-sm" value={assicurazioniConfig.targetS1} onChange={e => { setAssicurazioniConfig(prev => ({ ...prev, targetS1: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-assicurazioni-target-s1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target S2</Label>
                      <Input type="number" className="h-8 text-sm" value={assicurazioniConfig.targetS2} onChange={e => { setAssicurazioniConfig(prev => ({ ...prev, targetS2: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-assicurazioni-target-s2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Importa da Simulatore</DialogTitle>
              <DialogDescription>
                Importa la configurazione PDV da una configurazione salvata nel simulatore o dalla configurazione corrente dell'organizzazione.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              <Button variant="outline" className="w-full justify-start h-auto py-3" onClick={() => handleImport('organization_config')} disabled={saving} data-testid="button-import-org-config">
                <Upload className="h-4 w-4 mr-2 shrink-0" />
                <div className="text-left">
                  <div className="font-medium text-sm">Configurazione corrente</div>
                  <div className="text-xs text-muted-foreground">Importa dalla config attiva dell'organizzazione</div>
                </div>
              </Button>

              {loadingSimConfigs ? (
                <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : simulatorConfigs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nessuna configurazione salvata nel simulatore.</p>
              ) : (
                simulatorConfigs.map(cfg => (
                  <Button key={cfg.id} variant="outline" className="w-full justify-start h-auto py-3" onClick={() => handleImport('pdv_configuration', cfg.id)} disabled={saving} data-testid={`button-import-config-${cfg.id}`}>
                    <Store className="h-4 w-4 mr-2 shrink-0" />
                    <div className="text-left min-w-0">
                      <div className="font-medium text-sm truncate">{cfg.name}</div>
                      {cfg.updatedAt && <div className="text-xs text-muted-foreground">Aggiornata: {new Date(cfg.updatedAt).toLocaleDateString('it-IT')}</div>}
                    </div>
                  </Button>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Storico Configurazioni</DialogTitle>
              <DialogDescription>Seleziona un mese per visualizzare o modificare la configurazione.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nessuna configurazione salvata.</p>
              ) : (
                history.map(h => (
                  <Button
                    key={`${h.year}-${h.month}`}
                    variant={h.month === selectedMonth && h.year === selectedYear ? 'secondary' : 'ghost'}
                    className="w-full justify-between h-auto py-2"
                    onClick={() => { handleMonthChange(h.month, h.year); setHistoryDialogOpen(false); }}
                    data-testid={`button-history-${h.year}-${h.month}`}
                  >
                    <span>{MONTHS.find(m => m.value === h.month)?.label} {h.year}</span>
                    {h.updatedAt && <span className="text-xs text-muted-foreground">{new Date(h.updatedAt).toLocaleDateString('it-IT')}</span>}
                  </Button>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={addPdvDialogOpen} onOpenChange={setAddPdvDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Aggiungi PDV</DialogTitle>
              <DialogDescription>Inserisci i dati del nuovo punto vendita.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Codice POS *</Label>
                <Input value={newPdvCode} onChange={e => setNewPdvCode(e.target.value)} placeholder="es. W1234" data-testid="input-new-pdv-code" />
              </div>
              <div>
                <Label className="text-sm">Nome</Label>
                <Input value={newPdvName} onChange={e => setNewPdvName(e.target.value)} placeholder="Nome negozio" data-testid="input-new-pdv-name" />
              </div>
              <div>
                <Label className="text-sm">Ragione Sociale</Label>
                <Input value={newPdvRS} onChange={e => setNewPdvRS(e.target.value)} placeholder="Ragione sociale" data-testid="input-new-pdv-rs" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddPdvDialogOpen(false)} data-testid="button-cancel-add-pdv">Annulla</Button>
              <Button onClick={handleAddPdv} disabled={!newPdvCode.trim()} data-testid="button-confirm-add-pdv">
                <Plus className="h-4 w-4 mr-1" />Aggiungi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
