import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  ChevronDown, ChevronUp, History, Upload, Settings, Target, Zap, Shield, Calculator,
  FileText, X, Check, AlertTriangle,
} from 'lucide-react';
import { TabelleCalcoloGara, deepMergeTabelleCalcolo, type TabelleCalcoloConfig } from '@/components/TabelleCalcoloGara';
import { useTabelleCalcoloConfig } from '@/hooks/useTabelleCalcoloConfig';
import type { ExtraGaraSogliePerRS } from '@/lib/calcoloExtraGaraIva';
import { parseGaraPdf, type PdfGaraData, type PdfType } from '@/lib/parseGaraPdf';

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
  const defaultMultipliers = { multiplierSoglia1: 1, multiplierSoglia2: 1.2, multiplierSoglia3: 1.5, multiplierSoglia4: 2 };
  if (!pdv.clusterMobile) {
    return { posCode: pdv.codicePos, soglia1: 70, soglia2: 105, soglia3: 135, soglia4: 165, ...defaultMultipliers, forecastTargetPunti: 100, clusterPista: 1 as const };
  }
  const clusterPista = mapClusterMobileToClusterPista(pdv.clusterMobile as ClusterCode);
  const thresholds = getThresholdsByCluster(pdv.tipoPosizione || 'altro', clusterPista, pdv.clusterMobile);
  return {
    posCode: pdv.codicePos,
    ...thresholds,
    ...defaultMultipliers,
    forecastTargetPunti: thresholds.soglia4,
    clusterPista,
  };
}

function initFissoConfigForPdv(pdv: GaraConfigPdv) {
  const defaultFissoMultipliers = { multiplierSoglia1: 2, multiplierSoglia2: 3, multiplierSoglia3: 3.5, multiplierSoglia4: 4, multiplierSoglia5: 5 };
  if (!pdv.clusterFisso) {
    return { posCode: pdv.codicePos, soglia1: 28, soglia2: 46, soglia3: 57, soglia4: 67, soglia5: 80, ...defaultFissoMultipliers, forecastTargetPunti: 80 };
  }
  const clusterNum = mapClusterFissoToNumber(pdv.clusterFisso as ClusterCode);
  const thresholds = getDefaultFissoThresholds(pdv.tipoPosizione || 'altro', clusterNum);
  return {
    posCode: pdv.codicePos,
    ...thresholds,
    ...defaultFissoMultipliers,
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
  pdv, index, onUpdate, onRemove, onSave, saving, existingRSNames,
}: {
  pdv: GaraConfigPdv;
  index: number;
  onUpdate: (index: number, updated: GaraConfigPdv) => void;
  onRemove: (index: number) => void;
  onSave?: () => void;
  saving?: boolean;
  existingRSNames: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [rsEditMode, setRsEditMode] = useState<'select' | 'new'>(
    pdv.ragioneSociale && existingRSNames.includes(pdv.ragioneSociale) ? 'select' : (existingRSNames.length > 0 ? 'select' : 'new')
  );

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
              {rsEditMode === 'select' && existingRSNames.length > 0 ? (
                <Select value={pdv.ragioneSociale || ''} onValueChange={(v) => { if (v === '__new__') { setRsEditMode('new'); updateField('ragioneSociale', ''); } else { updateField('ragioneSociale', v); } }}>
                  <SelectTrigger className="h-8 text-sm" data-testid={`select-rs-pdv-${index}`}><SelectValue placeholder="Seleziona RS" /></SelectTrigger>
                  <SelectContent>
                    {existingRSNames.map(rs => (
                      <SelectItem key={rs} value={rs}>{rs}</SelectItem>
                    ))}
                    <SelectItem value="__new__">+ Nuova ragione sociale...</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex gap-1">
                  <Input value={pdv.ragioneSociale} onChange={e => updateField('ragioneSociale', e.target.value)} className="h-8 text-sm flex-1" data-testid={`input-rs-pdv-${index}`} placeholder="Nuova ragione sociale" />
                  {existingRSNames.length > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRsEditMode('select')} className="h-8 shrink-0 text-xs px-2" data-testid={`button-rs-back-select-${index}`}>
                      Esistente
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onRemove(index)} data-testid={`button-remove-pdv-${index}`}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Rimuovi
            </Button>
            {onSave && (
              <Button size="sm" onClick={onSave} disabled={saving} data-testid={`button-save-pdv-${index}`}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Salva
              </Button>
            )}
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
type EnergiaRSConf = NonNullable<GaraConfigData['energiaRSConfig']>['configPerRS'][number];
type AssicurazioniRSConf = NonNullable<GaraConfigData['assicurazioniRSConfig']>['configPerRS'][number];

function CodiciRSInput({ codici, onChange, rsName }: { codici: string[]; onChange: (codici: string[]) => void; rsName: string }) {
  const [inputVal, setInputVal] = useState('');

  const handleAdd = () => {
    const val = inputVal.trim();
    if (val && !codici.includes(val)) {
      onChange([...codici, val]);
    }
    setInputVal('');
  };

  const handleRemove = (codice: string) => {
    onChange(codici.filter(c => c !== codice));
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Label className="text-xs text-muted-foreground whitespace-nowrap">Codici RS</Label>
      {codici.map(codice => (
        <Badge key={codice} variant="secondary" className="text-xs gap-1 pl-2 pr-1 py-0.5">
          {codice}
          <button
            type="button"
            onClick={() => handleRemove(codice)}
            className="hover:bg-muted rounded-full p-0.5"
            data-testid={`button-remove-codice-rs-${codice}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <div className="flex items-center gap-1">
        <Input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          placeholder="es. 8000006456"
          className="h-6 text-xs w-32"
          data-testid={`input-codice-rs-${rsName.replace(/\s+/g, '-')}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleAdd}
          disabled={!inputVal.trim()}
          data-testid={`button-add-codice-rs-${rsName.replace(/\s+/g, '-')}`}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export default function ConfigurazioneGara() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [pdvList, setPdvList] = useState<GaraConfigPdv[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [pdfImportDialogOpen, setPdfImportDialogOpen] = useState(false);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfData, setPdfData] = useState<PdfGaraData | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [importedFiles, setImportedFiles] = useState<Array<{ label: string; type: PdfType; fileName: string }>>([]);
  const [importedFilesPopoverOpen, setImportedFilesPopoverOpen] = useState(false);
  const importedFilesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!importedFilesPopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (importedFilesRef.current && !importedFilesRef.current.contains(e.target as Node)) {
        setImportedFilesPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [importedFilesPopoverOpen]);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [addPdvDialogOpen, setAddPdvDialogOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [configName, setConfigName] = useState('');
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [configListDialogOpen, setConfigListDialogOpen] = useState(false);
  const [newPdvCode, setNewPdvCode] = useState('');
  const [newPdvName, setNewPdvName] = useState('');
  const [newPdvRS, setNewPdvRS] = useState('');
  const [newPdvRSMode, setNewPdvRSMode] = useState<'select' | 'new'>('select');
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
    pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0, targetS3: 0, premioS1: 250, premioS2: 500, premioS3: 1000,
  });
  const [assicurazioniConfig, setAssicurazioniConfig] = useState<NonNullable<GaraConfigData['assicurazioniConfig']>>({
    pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0, premioS1: 500, premioS2: 750,
  });

  const [energiaRSConfig, setEnergiaRSConfig] = useState<EnergiaRSConf[]>([]);
  const [assicurazioniRSConfig, setAssicurazioniRSConfig] = useState<AssicurazioniRSConf[]>([]);
  const [protectaRSConfig, setProtectaRSConfig] = useState<Array<{ ragioneSociale: string; targetExtra: number; targetDecurtazione: number; premioExtra: number }>>([]);
  const [decurtazioneRSConfig, setDecurtazioneRSConfig] = useState<Array<{ ragioneSociale: string; importo: number }>>([]);

  const { config: orgTabelleConfig } = useTabelleCalcoloConfig();
  const tabelleCalcoloDefaults = useMemo<TabelleCalcoloConfig>(() => {
    return {
      mobile: {
        soglieCluster: { ...orgTabelleConfig.mobile.soglieCluster },
        puntiAttivazione: Object.fromEntries(orgTabelleConfig.mobile.categories.map(c => [c.type, c.punti])),
        moltiplicatoriCanone: { ...orgTabelleConfig.mobile.moltiplicatoriCanone },
      },
      fisso: {
        soglieCluster: { ...orgTabelleConfig.fisso.soglieCluster },
        euroPerPezzo: { ...orgTabelleConfig.fisso.euroPerPezzo },
        gettoniContrattuali: { ...orgTabelleConfig.fisso.gettoniContrattuali },
      },
      energia: {
        compensiBase: { ...orgTabelleConfig.energia.compensiBase },
        pistaBase: { ...orgTabelleConfig.energia.pistaBase },
        pistaDa4: { ...orgTabelleConfig.energia.pistaDa4 },
        bonusPerContratto: { ...orgTabelleConfig.energia.bonusPerContratto },
      },
      assicurazioni: { puntiProdotto: { ...orgTabelleConfig.assicurazioni.puntiProdotto }, premiProdotto: { ...orgTabelleConfig.assicurazioni.premiProdotto } },
      protecta: { gettoniProdotto: { ...orgTabelleConfig.protecta.gettoniProdotto } },
      extraGara: { puntiAttivazione: { ...orgTabelleConfig.extraGara.puntiAttivazione }, soglieMultipos: JSON.parse(JSON.stringify(orgTabelleConfig.extraGara.soglieMultipos)), soglieMonopos: JSON.parse(JSON.stringify(orgTabelleConfig.extraGara.soglieMonopos)), premiPerSoglia: JSON.parse(JSON.stringify(orgTabelleConfig.extraGara.premiPerSoglia)) },
    };
  }, [orgTabelleConfig]);
  const [tabelleCalcolo, setTabelleCalcolo] = useState<TabelleCalcoloConfig>(tabelleCalcoloDefaults);
  const [extraGaraIvaSogliePerRS, setExtraGaraIvaSogliePerRS] = useState<ExtraGaraSogliePerRS>({});

  const { profile } = useAuth();
  const { toast } = useToast();
  const {
    config: garaConfigRecord,
    configList,
    loading, saving, history,
    fetchConfig, fetchConfigList, saveConfig, deleteConfig, fetchHistory, fetchPdvFromSales, importFromSimulator,
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
    const energiaRS: EnergiaRSConf[] = [];
    const assicurazioniRS: AssicurazioniRSConf[] = [];

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

      mobileRS.push({ ragioneSociale, soglia1: mS1, soglia2: mS2, soglia3: mS3, soglia4: mS4, multiplierSoglia1: 1, multiplierSoglia2: 1.2, multiplierSoglia3: 1.5, multiplierSoglia4: 2, forecastTargetPunti: mS4 });
      fissoRS.push({ ragioneSociale, soglia1: fS1, soglia2: fS2, soglia3: fS3, soglia4: fS4, soglia5: fS5, multiplierSoglia1: 2, multiplierSoglia2: 3, multiplierSoglia3: 3.5, multiplierSoglia4: 4, multiplierSoglia5: 5, forecastTargetPunti: fS5 });
      partnershipRS.push({ ragioneSociale, target100: pTarget, target80: calculateTarget80(pTarget), premio100: pPremio, premio80: calculatePremio80(pPremio) });

      const pdvEnergia = pdvs.filter(p => p.abilitaEnergia).length;
      const soglieE = calcolaSoglieEnergiaDefault(pdvEnergia);
      energiaRS.push({
        ragioneSociale,
        pdvInGara: pdvEnergia,
        targetNoMalus: 10 * pdvEnergia,
        targetS1: 15 * pdvEnergia,
        targetS2: 25 * pdvEnergia,
        targetS3: 40 * pdvEnergia,
        premioS1: 250, premioS2: 500, premioS3: 1000,
        pistaSoglia_S1: soglieE.S1,
        pistaSoglia_S2: soglieE.S2,
        pistaSoglia_S3: soglieE.S3,
        pistaSoglia_S4: soglieE.S4,
        pistaSoglia_S5: soglieE.S5,
      });

      const pdvAssic = pdvs.filter(p => p.abilitaAssicurazioni).length;
      assicurazioniRS.push({
        ragioneSociale,
        pdvInGara: pdvAssic,
        targetNoMalus: 15 * pdvAssic,
        targetS1: 20 * pdvAssic,
        targetS2: 25 * pdvAssic,
        premioS1: 500, premioS2: 750,
      });
    });

    const protectaRS = rsNames.map(rs => ({ ragioneSociale: rs, targetExtra: 0, targetDecurtazione: 0, premioExtra: 350 }));
    const decurtazioneRS = rsNames.map(rs => ({ ragioneSociale: rs, importo: 0 }));

    setMobileRSConfig(mobileRS);
    setFissoRSConfig(fissoRS);
    setPartnershipRSConfig(partnershipRS);
    setEnergiaRSConfig(energiaRS);
    setAssicurazioniRSConfig(assicurazioniRS);
    setProtectaRSConfig(protectaRS);
    setDecurtazioneRSConfig(decurtazioneRS);
  }, []);

  const initializeConfigsFromPdvList = useCallback((pdvs: GaraConfigPdv[]) => {
    setMobileConfig(pdvs.map(p => initMobileConfigForPdv(p)));
    setFissoConfig(pdvs.map(p => initFissoConfigForPdv(p)));
    setPartnershipConfig(pdvs.map(p => initPartnershipConfigForPdv(p)));

    initializeRSConfigsFromPdvList(pdvs);

    const pdvEnergia = pdvs.filter(p => p.abilitaEnergia).length;
    const pdvAssicurazioni = pdvs.filter(p => p.abilitaAssicurazioni).length;
    const soglieEnergia = calcolaSoglieEnergiaDefault(pdvEnergia);
    setEnergiaConfig(prev => ({ ...prev, pdvInGara: pdvEnergia, targetNoMalus: 10 * pdvEnergia, targetS1: 15 * pdvEnergia, targetS2: 25 * pdvEnergia, targetS3: 40 * pdvEnergia, premioS1: prev.premioS1 ?? 250, premioS2: prev.premioS2 ?? 500, premioS3: prev.premioS3 ?? 1000, pistaSoglia_S1: soglieEnergia.S1, pistaSoglia_S2: soglieEnergia.S2, pistaSoglia_S3: soglieEnergia.S3, pistaSoglia_S4: soglieEnergia.S4, pistaSoglia_S5: soglieEnergia.S5 }));
    setAssicurazioniConfig(prev => ({ ...prev, pdvInGara: pdvAssicurazioni, targetNoMalus: 15 * pdvAssicurazioni, targetS1: 20 * pdvAssicurazioni, targetS2: 25 * pdvAssicurazioni, premioS1: prev.premioS1 ?? 500, premioS2: prev.premioS2 ?? 750 }));
  }, [initializeRSConfigsFromPdvList]);

  const loadConfigById = useCallback(async (id: string, month: number, year: number) => {
    setInitialLoaded(false);
    const result = await fetchConfig(month, year, id);
    if (result?.config) {
      const cfg = result.config as unknown as GaraConfigData;
      const pdvs = cfg.pdvList || [];
      setPdvList(pdvs);
      setConfigName(result.name || '');
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
      initializeRSConfigsFromPdvList(pdvs);
      if (cfg.pistaMobileRSConfig?.sogliePerRS?.length) setMobileRSConfig(cfg.pistaMobileRSConfig.sogliePerRS);
      if (cfg.pistaFissoRSConfig?.sogliePerRS?.length) setFissoRSConfig(cfg.pistaFissoRSConfig.sogliePerRS);
      if (cfg.partnershipRewardRSConfig?.configPerRS?.length) setPartnershipRSConfig(cfg.partnershipRewardRSConfig.configPerRS);
      if (cfg.energiaConfig) setEnergiaConfig(cfg.energiaConfig);
      if (cfg.assicurazioniConfig) setAssicurazioniConfig(cfg.assicurazioniConfig);
      if (cfg.energiaRSConfig?.configPerRS?.length) setEnergiaRSConfig(cfg.energiaRSConfig.configPerRS);
      if (cfg.assicurazioniRSConfig?.configPerRS?.length) setAssicurazioniRSConfig(cfg.assicurazioniRSConfig.configPerRS);
      if (cfg.protectaRSConfig?.configPerRS?.length) setProtectaRSConfig(cfg.protectaRSConfig.configPerRS);
      if (cfg.decurtazioneRSConfig?.configPerRS?.length) setDecurtazioneRSConfig(cfg.decurtazioneRSConfig.configPerRS);
      setTabelleCalcolo(cfg.tabelleCalcolo ? deepMergeTabelleCalcolo(tabelleCalcoloDefaults, cfg.tabelleCalcolo) : JSON.parse(JSON.stringify(tabelleCalcoloDefaults)));
      setExtraGaraIvaSogliePerRS(cfg.extraGaraIvaSogliePerRS || {});
    }
    setIsDirty(false);
    setInitialLoaded(true);
  }, [fetchConfig, initializeRSConfigsFromPdvList, tabelleCalcoloDefaults]);

  const loadMonthConfig = useCallback(async (month: number, year: number) => {
    setInitialLoaded(false);
    fetchConfigList(month, year);
    const result = await fetchConfig(month, year);
    if (result?.config) {
      setConfigName(result.name || '');
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
      initializeRSConfigsFromPdvList(pdvs);
      if (cfg.pistaMobileRSConfig?.sogliePerRS?.length) {
        setMobileRSConfig(cfg.pistaMobileRSConfig.sogliePerRS);
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
        setEnergiaConfig({ pdvInGara: pdvE, targetNoMalus: 10 * pdvE, targetS1: 15 * pdvE, targetS2: 25 * pdvE, targetS3: 40 * pdvE, premioS1: 250, premioS2: 500, premioS3: 1000, pistaSoglia_S1: se.S1, pistaSoglia_S2: se.S2, pistaSoglia_S3: se.S3, pistaSoglia_S4: se.S4, pistaSoglia_S5: se.S5 });
      }
      if (cfg.assicurazioniConfig) {
        setAssicurazioniConfig(cfg.assicurazioniConfig);
      } else {
        const pdvA = pdvs.filter(p => p.abilitaAssicurazioni).length;
        setAssicurazioniConfig({ pdvInGara: pdvA, targetNoMalus: 15 * pdvA, targetS1: 20 * pdvA, targetS2: 25 * pdvA, premioS1: 500, premioS2: 750 });
      }
      if (cfg.energiaRSConfig?.configPerRS?.length) {
        setEnergiaRSConfig(cfg.energiaRSConfig.configPerRS);
      }
      if (cfg.assicurazioniRSConfig?.configPerRS?.length) {
        setAssicurazioniRSConfig(cfg.assicurazioniRSConfig.configPerRS);
      }
      if (cfg.protectaRSConfig?.configPerRS?.length) {
        setProtectaRSConfig(cfg.protectaRSConfig.configPerRS);
      }
      if (cfg.decurtazioneRSConfig?.configPerRS?.length) {
        setDecurtazioneRSConfig(cfg.decurtazioneRSConfig.configPerRS);
      }
      setTabelleCalcolo(cfg.tabelleCalcolo ? deepMergeTabelleCalcolo(tabelleCalcoloDefaults, cfg.tabelleCalcolo) : JSON.parse(JSON.stringify(tabelleCalcoloDefaults)));
      setExtraGaraIvaSogliePerRS(cfg.extraGaraIvaSogliePerRS || {});
    } else {
      setConfigName('');
      setTipologiaGara('gara_operatore');
      setModalitaRS('per_pdv');
      setMobileRSConfig([]);
      setFissoRSConfig([]);
      setPartnershipRSConfig([]);
      setEnergiaRSConfig([]);
      setAssicurazioniRSConfig([]);
      setProtectaRSConfig([]);
      setDecurtazioneRSConfig([]);
      setEnergiaConfig({ pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0, targetS3: 0, premioS1: 250, premioS2: 500, premioS3: 1000 });
      setAssicurazioniConfig({ pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0, premioS1: 500, premioS2: 750 });
      setTabelleCalcolo(JSON.parse(JSON.stringify(tabelleCalcoloDefaults)));
      setExtraGaraIvaSogliePerRS({});

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
  }, [fetchConfig, fetchPdvFromSales, toast, initializeConfigsFromPdvList, tabelleCalcoloDefaults]);

  useEffect(() => {
    loadMonthConfig(selectedMonth, selectedYear);
    fetchHistory();
  }, [selectedMonth, selectedYear, loadMonthConfig, fetchHistory]);

  const buildConfigData = useCallback((): GaraConfigData => ({
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
    energiaRSConfig: { configPerRS: energiaRSConfig },
    assicurazioniRSConfig: { configPerRS: assicurazioniRSConfig },
    protectaRSConfig: { configPerRS: protectaRSConfig },
    decurtazioneRSConfig: { configPerRS: decurtazioneRSConfig },
    tabelleCalcolo,
    ...(Object.keys(extraGaraIvaSogliePerRS).length > 0 ? { extraGaraIvaSogliePerRS } : {}),
    ...(garaConfigRecord?.config ? {
      importedFrom: (garaConfigRecord.config as unknown as GaraConfigData).importedFrom,
    } : {}),
  }), [pdvList, tipologiaGara, modalitaRS, mobileConfig, fissoConfig, partnershipConfig, mobileRSConfig, fissoRSConfig, partnershipRSConfig, energiaConfig, assicurazioniConfig, energiaRSConfig, assicurazioniRSConfig, protectaRSConfig, decurtazioneRSConfig, tabelleCalcolo, extraGaraIvaSogliePerRS, garaConfigRecord]);

  const handleQuickSave = useCallback(async () => {
    if (!garaConfigRecord?.id) {
      setSaveAsNew(false);
      setSaveDialogOpen(true);
      return;
    }
    const configData = buildConfigData();
    const result = await saveConfig(selectedMonth, selectedYear, configData, garaConfigRecord.name || 'Configurazione', garaConfigRecord.id);
    if (result) {
      setIsDirty(false);
      fetchHistory();
      fetchConfigList(selectedMonth, selectedYear);
      toast({ title: 'Salvato', description: 'Configurazione salvata con successo.' });
    } else {
      toast({ title: 'Errore', description: 'Impossibile salvare la configurazione.', variant: 'destructive' });
    }
  }, [garaConfigRecord, buildConfigData, saveConfig, selectedMonth, selectedYear, fetchHistory, fetchConfigList, toast]);

  const handleSaveClick = () => {
    if (garaConfigRecord?.id && !saveAsNew) {
      setConfigName(garaConfigRecord.name || configName || 'Configurazione');
    } else if (!configName) {
      setConfigName('');
    }
    setSaveAsNew(false);
    setSaveDialogOpen(true);
  };

  const handleSaveAsNewClick = () => {
    setConfigName('');
    setSaveAsNew(true);
    setSaveDialogOpen(true);
  };

  const handleSaveConfirm = async () => {
    const nameToUse = configName.trim() || 'Configurazione';
    const configData = buildConfigData();
    const existingId = (!saveAsNew && garaConfigRecord?.id) ? garaConfigRecord.id : undefined;
    const result = await saveConfig(selectedMonth, selectedYear, configData, nameToUse, existingId);
    if (result) {
      setIsDirty(false);
      setConfigName(nameToUse);
      setSaveDialogOpen(false);
      fetchHistory();
      fetchConfigList(selectedMonth, selectedYear);
      toast({ title: 'Salvato', description: `Configurazione "${nameToUse}" salvata con successo.` });
    } else {
      toast({ title: 'Errore', description: 'Impossibile salvare la configurazione.', variant: 'destructive' });
    }
  };

  const handleDeleteConfig = async (id: string) => {
    const success = await deleteConfig(id);
    if (success) {
      fetchConfigList(selectedMonth, selectedYear);
      fetchHistory();
      if (garaConfigRecord?.id === id) {
        loadMonthConfig(selectedMonth, selectedYear);
      }
      toast({ title: 'Eliminata', description: 'Configurazione eliminata.' });
    } else {
      toast({ title: 'Errore', description: 'Impossibile eliminare la configurazione.', variant: 'destructive' });
    }
  };

  const handleUpdatePdv = (index: number, updated: GaraConfigPdv) => {
    setPdvList(prev => prev.map((p, i) => i === index ? updated : p));
    setIsDirty(true);
  };

  const handleRSClusterPIvaChange = useCallback((rs: string, cluster: string) => {
    setExtraGaraIvaSogliePerRS(prev => {
      const existing = prev[rs] || {};
      if (!cluster) {
        const entry = { ...existing };
        delete entry.clusterPIva;
        const hasOther = entry.s1 !== undefined || entry.s2 !== undefined || entry.s3 !== undefined || entry.s4 !== undefined || entry.pdvCount !== undefined;
        if (!hasOther) {
          const updated = { ...prev };
          delete updated[rs];
          return updated;
        }
        return { ...prev, [rs]: entry };
      }
      return { ...prev, [rs]: { ...existing, clusterPIva: cluster as any } };
    });
    setIsDirty(true);
  }, []);

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

  const handleRSCodiciChange = useCallback((rs: string, codici: string[]) => {
    setExtraGaraIvaSogliePerRS(prev => {
      const existing = prev[rs] || {};
      return { ...prev, [rs]: { ...existing, codiciRS: codici } };
    });
    setIsDirty(true);
  }, []);

  const handlePdfFileSelect = async (file: File) => {
    setPdfParsing(true);
    setPdfError(null);
    setPdfData(null);
    setPdfFileName(file.name);
    try {
      const data = await parseGaraPdf(file);
      if (data.pdfType === 'partnership_reward') {
        if (!data.partnershipTarget && !data.soglieEnergia && !data.soglieAssicurazioni && !data.soglieProtecta) {
          setPdfError('Nessun dato riconosciuto nel PDF Partnership Reward. Verificare che il file contenga gli allegati A-E.');
        } else {
          setPdfData(data);
        }
      } else {
        if (data.pdvList.length === 0 && !data.soglieMobile && !data.soglieFisso) {
          setPdfError('Nessun dato riconosciuto nel PDF. Verificare che sia un PDF di gara WindTre con allegato PDV.');
        } else {
          setPdfData(data);
        }
      }
    } catch (err) {
      console.error('PDF parse error:', err);
      setPdfError('Errore nella lettura del PDF. Verificare che il file sia un PDF valido.');
    } finally {
      setPdfParsing(false);
    }
  };

  const findTargetRS = useCallback((dealerCodes: string[], currentPdvList: GaraConfigPdv[], pdfPdvCodes: string[]): string | null => {
    if (dealerCodes.length > 0) {
      for (const [rs, soglieData] of Object.entries(extraGaraIvaSogliePerRS)) {
        if (soglieData.codiciRS?.some(c => dealerCodes.includes(c))) {
          return rs;
        }
      }
    }

    const rsNames = Array.from(new Set(currentPdvList.map(p => p.ragioneSociale).filter(Boolean)));
    if (rsNames.length === 1) return rsNames[0];
    if (rsNames.length > 1) {
      for (const rs of rsNames) {
        const rsPdvCodes = currentPdvList.filter(p => p.ragioneSociale === rs).map(p => p.codicePos);
        const overlap = rsPdvCodes.filter(c => pdfPdvCodes.includes(c));
        if (overlap.length > 0) return rs;
      }
    }
    return null;
  }, [extraGaraIvaSogliePerRS]);

  const handleApplyPdfImport = useCallback(() => {
    if (!pdfData) return;

    const parts: string[] = [];

    if (pdfData.pdfType === 'partnership_reward') {
      const targetRS = findTargetRS(pdfData.codiciDealer, pdvList, []);

      if (targetRS) {
        const updatedSoglie = { ...extraGaraIvaSogliePerRS };
        const existing = updatedSoglie[targetRS] || {};
        updatedSoglie[targetRS] = {
          ...existing,
          codiciRS: [...new Set([...(existing.codiciRS || []), ...pdfData.codiciDealer])],
        };
        setExtraGaraIvaSogliePerRS(updatedSoglie);

        if (pdfData.partnershipTarget) {
          if (tipologiaGara === 'gara_operatore_rs' && modalitaRS === 'per_rs') {
            setPartnershipRSConfig(prev => prev.map(c => {
              if (c.ragioneSociale !== targetRS) return c;
              return {
                ...c,
                target100: pdfData.partnershipTarget!.target100,
                premio100: pdfData.partnershipTarget!.premio100,
                target80: pdfData.partnershipTarget!.target80,
                premio80: pdfData.partnershipTarget!.premio80,
              };
            }));
          }
          parts.push('Partnership target/premio impostati');
        }

        if (pdfData.soglieEnergia) {
          if (tipologiaGara === 'gara_operatore_rs' && modalitaRS === 'per_rs') {
            setEnergiaRSConfig(prev => prev.map(c => {
              if (c.ragioneSociale !== targetRS) return c;
              return {
                ...c,
                targetS1: pdfData.soglieEnergia!.targetS1,
                targetS2: pdfData.soglieEnergia!.targetS2,
                targetS3: pdfData.soglieEnergia!.targetS3,
                targetNoMalus: pdfData.soglieEnergia!.targetNoMalus,
                premioS1: pdfData.soglieEnergia!.premioS1,
                premioS2: pdfData.soglieEnergia!.premioS2,
                premioS3: pdfData.soglieEnergia!.premioS3,
              };
            }));
          } else {
            setEnergiaConfig(prev => ({
              ...prev,
              targetS1: pdfData.soglieEnergia!.targetS1,
              targetS2: pdfData.soglieEnergia!.targetS2,
              targetS3: pdfData.soglieEnergia!.targetS3,
              targetNoMalus: pdfData.soglieEnergia!.targetNoMalus,
              premioS1: pdfData.soglieEnergia!.premioS1,
              premioS2: pdfData.soglieEnergia!.premioS2,
              premioS3: pdfData.soglieEnergia!.premioS3,
            }));
          }
          parts.push('soglie Energia impostate');
        }

        if (pdfData.soglieAssicurazioni) {
          if (tipologiaGara === 'gara_operatore_rs' && modalitaRS === 'per_rs') {
            setAssicurazioniRSConfig(prev => prev.map(c => {
              if (c.ragioneSociale !== targetRS) return c;
              return {
                ...c,
                targetS1: pdfData.soglieAssicurazioni!.targetS1,
                targetS2: pdfData.soglieAssicurazioni!.targetS2,
                targetNoMalus: pdfData.soglieAssicurazioni!.targetNoMalus,
                premioS1: pdfData.soglieAssicurazioni!.premioS1,
                premioS2: pdfData.soglieAssicurazioni!.premioS2,
              };
            }));
          } else {
            setAssicurazioniConfig(prev => ({
              ...prev,
              targetS1: pdfData.soglieAssicurazioni!.targetS1,
              targetS2: pdfData.soglieAssicurazioni!.targetS2,
              targetNoMalus: pdfData.soglieAssicurazioni!.targetNoMalus,
              premioS1: pdfData.soglieAssicurazioni!.premioS1,
              premioS2: pdfData.soglieAssicurazioni!.premioS2,
            }));
          }
          parts.push('soglie Assicurazioni impostate');
        }

        if (pdfData.soglieProtecta) {
          setProtectaRSConfig(prev => prev.map(c => {
            if (c.ragioneSociale !== targetRS) return c;
            return {
              ...c,
              targetExtra: pdfData.soglieProtecta!.targetExtra,
              targetDecurtazione: pdfData.soglieProtecta!.targetDecurtazione,
              premioExtra: pdfData.soglieProtecta!.premioExtra,
            };
          }));
          parts.push('Protecta target/decurtazione impostati');
        }

        if (pdfData.decurtazione) {
          setDecurtazioneRSConfig(prev => prev.map(c => {
            if (c.ragioneSociale !== targetRS) return c;
            return { ...c, importo: pdfData.decurtazione!.importo };
          }));
          parts.push(`decurtazione ${pdfData.decurtazione.importo.toLocaleString('it-IT')}€ impostata`);
        }

        if (pdfData.soglieEnergia?.targetFissoRS) {
          if (tipologiaGara === 'gara_operatore_rs' && modalitaRS === 'per_rs') {
            setFissoRSConfig(prev => prev.map(c => {
              if (c.ragioneSociale !== targetRS) return c;
              return { ...c, forecastTargetPunti: pdfData.soglieEnergia!.targetFissoRS };
            }));
          }
          parts.push(`target Fisso RS: ${pdfData.soglieEnergia.targetFissoRS}`);
        }

        parts.push(`RS: ${targetRS}`);
      } else {
        parts.push('RS non identificata — codici dealer non corrispondono');
      }

      setIsDirty(true);
      setPdfImportDialogOpen(false);
      setPdfData(null);

      const importLabel = pdfData.mese
        ? `Partnership Reward ${pdfData.mese}`
        : (pdfFileName || 'PDF Partnership Reward');
      setImportedFiles(prev => [...prev, { label: importLabel, type: pdfData.pdfType, fileName: pdfFileName || '' }]);

      toast({
        title: 'Importazione PDF completata',
        description: parts.join(', ') || 'Dati importati dal PDF.',
      });
      return;
    }

    const updatedPdvList = [...pdvList];
    let matchedCount = 0;
    let unmatchedPdf: string[] = [];

    for (const pdfPdv of pdfData.pdvList) {
      const idx = updatedPdvList.findIndex(p => p.codicePos === pdfPdv.codicePos);
      if (idx >= 0) {
        if (pdfPdv.clusterMobile > 0) {
          const clusterVal = `strada_${pdfPdv.clusterMobile}`;
          updatedPdvList[idx] = { ...updatedPdvList[idx], clusterMobile: clusterVal };
        }
        if (pdfPdv.clusterFisso > 0) {
          const clusterVal = `strada_${pdfPdv.clusterFisso}`;
          updatedPdvList[idx] = { ...updatedPdvList[idx], clusterFisso: clusterVal };
        }
        matchedCount++;
      } else {
        unmatchedPdf.push(pdfPdv.codicePos);
      }
    }

    setPdvList(updatedPdvList);

    setMobileConfig(updatedPdvList.map(p => initMobileConfigForPdv(p)));
    setFissoConfig(updatedPdvList.map(p => initFissoConfigForPdv(p)));
    setPartnershipConfig(updatedPdvList.map(p => initPartnershipConfigForPdv(p)));

    const targetRS = findTargetRS(pdfData.codiciDealer, updatedPdvList, pdfData.pdvList.map(p => p.codicePos));

    if (targetRS) {
      const updatedSoglie = { ...extraGaraIvaSogliePerRS };
      const existing = updatedSoglie[targetRS] || {};

      updatedSoglie[targetRS] = {
        ...existing,
        codiciRS: [...new Set([...(existing.codiciRS || []), ...pdfData.codiciDealer])],
      };

      if (pdfData.soglieExtraPIva) {
        updatedSoglie[targetRS].clusterPIva = pdfData.soglieExtraPIva.cluster;
        updatedSoglie[targetRS].s1 = pdfData.soglieExtraPIva.s1;
        updatedSoglie[targetRS].s2 = pdfData.soglieExtraPIva.s2;
        updatedSoglie[targetRS].s3 = pdfData.soglieExtraPIva.s3;
        updatedSoglie[targetRS].s4 = pdfData.soglieExtraPIva.s4;
      }

      setExtraGaraIvaSogliePerRS(updatedSoglie);

      if (pdfData.soglieMobile) {
        if (tipologiaGara === 'gara_operatore_rs' && modalitaRS === 'per_rs') {
          setMobileRSConfig(prev => prev.map(c => {
            if (c.ragioneSociale !== targetRS) return c;
            return {
              ...c,
              soglia1: pdfData.soglieMobile!.s1,
              soglia2: pdfData.soglieMobile!.s2,
              soglia3: pdfData.soglieMobile!.s3,
              soglia4: pdfData.soglieMobile!.s4,
              forecastTargetPunti: pdfData.soglieMobile!.s4,
            };
          }));
        }
      }

      if (pdfData.soglieFisso) {
        if (tipologiaGara === 'gara_operatore_rs' && modalitaRS === 'per_rs') {
          setFissoRSConfig(prev => prev.map(c => {
            if (c.ragioneSociale !== targetRS) return c;
            return {
              ...c,
              soglia1: pdfData.soglieFisso!.s1,
              soglia2: pdfData.soglieFisso!.s2,
              soglia3: pdfData.soglieFisso!.s3,
              soglia4: pdfData.soglieFisso!.s4,
              soglia5: pdfData.soglieFisso!.s5,
              forecastTargetPunti: pdfData.soglieFisso!.s5,
            };
          }));
        }
      }
    }

    setIsDirty(true);
    setPdfImportDialogOpen(false);
    setPdfData(null);

    if (matchedCount > 0) parts.push(`${matchedCount} PDV aggiornati`);
    if (unmatchedPdf.length > 0) parts.push(`${unmatchedPdf.length} PDV del PDF non trovati`);
    if (pdfData.soglieMobile) parts.push('soglie Mobile impostate');
    if (pdfData.soglieFisso) parts.push('soglie Fisso impostate');
    if (pdfData.soglieExtraPIva) parts.push('soglie Extra P.IVA impostate');
    if (targetRS) parts.push(`RS: ${targetRS}`);

    const importLabel = pdfData.mese
      ? `Incentivazione Franchising WindTre ${pdfData.mese}`
      : (pdfFileName || 'PDF importato');
    setImportedFiles(prev => [...prev, { label: importLabel, type: pdfData.pdfType, fileName: pdfFileName || '' }]);

    toast({
      title: 'Importazione PDF completata',
      description: parts.join(', ') || 'Dati importati dal PDF.',
    });
  }, [pdfData, pdvList, extraGaraIvaSogliePerRS, tipologiaGara, modalitaRS, pdfFileName, toast, findTargetRS]);

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

      initializeRSConfigsFromPdvList(pdvs);
      if (cfg.pistaMobileRSConfig?.sogliePerRS?.length) setMobileRSConfig(cfg.pistaMobileRSConfig.sogliePerRS);
      if (cfg.pistaFissoRSConfig?.sogliePerRS?.length) setFissoRSConfig(cfg.pistaFissoRSConfig.sogliePerRS);
      if (cfg.partnershipRewardRSConfig?.configPerRS?.length) setPartnershipRSConfig(cfg.partnershipRewardRSConfig.configPerRS);
      if (cfg.energiaRSConfig?.configPerRS?.length) setEnergiaRSConfig(cfg.energiaRSConfig.configPerRS);
      if (cfg.assicurazioniRSConfig?.configPerRS?.length) setAssicurazioniRSConfig(cfg.assicurazioniRSConfig.configPerRS);
      if (cfg.protectaRSConfig?.configPerRS?.length) setProtectaRSConfig(cfg.protectaRSConfig.configPerRS);
      if (cfg.decurtazioneRSConfig?.configPerRS?.length) setDecurtazioneRSConfig(cfg.decurtazioneRSConfig.configPerRS);

      if (cfg.energiaConfig) {
        setEnergiaConfig(cfg.energiaConfig);
      } else {
        const pdvE = pdvs.filter(p => p.abilitaEnergia).length;
        const se = calcolaSoglieEnergiaDefault(pdvE);
        setEnergiaConfig({ pdvInGara: pdvE, targetNoMalus: 10 * pdvE, targetS1: 15 * pdvE, targetS2: 25 * pdvE, targetS3: 40 * pdvE, premioS1: 250, premioS2: 500, premioS3: 1000, pistaSoglia_S1: se.S1, pistaSoglia_S2: se.S2, pistaSoglia_S3: se.S3, pistaSoglia_S4: se.S4, pistaSoglia_S5: se.S5 });
      }
      if (cfg.assicurazioniConfig) {
        setAssicurazioniConfig(cfg.assicurazioniConfig);
      } else {
        const pdvA = pdvs.filter(p => p.abilitaAssicurazioni).length;
        setAssicurazioniConfig({ pdvInGara: pdvA, targetNoMalus: 15 * pdvA, targetS1: 20 * pdvA, targetS2: 25 * pdvA, premioS1: 500, premioS2: 750 });
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
            {garaConfigRecord && <Badge variant="secondary" className="text-xs">{garaConfigRecord.name || 'Salvato'}</Badge>}
            {importedFiles.length > 0 && (
              <div className="relative" ref={importedFilesRef}>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs text-blue-700 border-blue-300 bg-blue-50 hover:bg-blue-100 dark:text-blue-300 dark:border-blue-700 dark:bg-blue-950 gap-1"
                  onClick={() => setImportedFilesPopoverOpen(!importedFilesPopoverOpen)}
                  data-testid="button-imported-files"
                >
                  <FileText className="h-3 w-3" />
                  File caricati ({importedFiles.length})
                  <ChevronDown className="h-3 w-3" />
                </Button>
                {importedFilesPopoverOpen && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-background border rounded-lg shadow-lg p-2 min-w-[280px] max-w-[400px]">
                    <div className="text-xs font-semibold text-muted-foreground mb-2 px-1">File PDF importati</div>
                    <div className="space-y-1">
                      {importedFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-xs">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{f.label}</div>
                            <div className="text-muted-foreground truncate">{f.fileName}</div>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0 ml-auto">
                            {f.type === 'partnership_reward' ? 'PR' : 'Fonia'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {isDirty && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Modifiche non salvate</Badge>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => { setConfigListDialogOpen(true); fetchConfigList(selectedMonth, selectedYear); }} data-testid="button-config-list">
              <Settings className="h-4 w-4 mr-1" />Configurazioni ({configList.length})
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setHistoryDialogOpen(true); fetchHistory(); }} data-testid="button-history">
              <History className="h-4 w-4 mr-1" />Storico
            </Button>
            <Button variant="outline" size="sm" onClick={openImportDialog} data-testid="button-import">
              <Download className="h-4 w-4 mr-1" />Importa
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setNewPdvCode(''); setNewPdvName(''); setNewPdvRS(''); setNewPdvRSMode('select'); setAddPdvDialogOpen(true); }} data-testid="button-add-pdv">
              <Plus className="h-4 w-4 mr-1" />PDV
            </Button>
            {garaConfigRecord?.id && (
              <Button variant="outline" size="sm" onClick={handleSaveAsNewClick} disabled={saving} data-testid="button-save-as-new">
                <Plus className="h-4 w-4 mr-1" />Salva come nuova
              </Button>
            )}
            <Button size="sm" onClick={handleSaveClick} disabled={saving} data-testid="button-save">
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              {garaConfigRecord?.id ? 'Salva' : 'Salva nuova'}
            </Button>
          </div>
        </div>

        {loading && !initialLoaded ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="pdv" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="pdv" className="text-xs sm:text-sm" data-testid="tab-pdv">
                <Store className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" /><span className="hidden sm:inline">PDV</span> ({pdvList.length})
              </TabsTrigger>
              <TabsTrigger value="soglie" className="text-xs sm:text-sm" data-testid="tab-soglie">
                <Target className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />Soglie
              </TabsTrigger>
              <TabsTrigger value="extra" className="text-xs sm:text-sm" data-testid="tab-extra">
                <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" /><span className="hidden sm:inline">Energia &</span> Ass.
              </TabsTrigger>
              <TabsTrigger value="tabelleCalcolo" className="text-xs sm:text-sm" data-testid="tab-tabelle-calcolo">
                <Calculator className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" /><span className="hidden sm:inline">Tabelle</span><span className="sm:hidden">Tab.</span>
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
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground mb-2">{pdvList.length} PDV configurati</div>
                  {(() => {
                    const grouped: { rs: string; pdvs: { pdv: GaraConfigPdv; globalIdx: number }[] }[] = [];
                    const rsOrder: string[] = [];
                    pdvList.forEach((pdv, idx) => {
                      const rs = pdv.ragioneSociale || 'Senza RS';
                      let group = grouped.find(g => g.rs === rs);
                      if (!group) {
                        group = { rs, pdvs: [] };
                        grouped.push(group);
                        rsOrder.push(rs);
                      }
                      group.pdvs.push({ pdv, globalIdx: idx });
                    });
                    return grouped.map(({ rs, pdvs }) => {
                      const rsCluster = extraGaraIvaSogliePerRS?.[rs]?.clusterPIva || '';
                      const rsCodici = extraGaraIvaSogliePerRS?.[rs]?.codiciRS || [];
                      return (
                        <div key={rs} className="space-y-2">
                          <div className="flex flex-col gap-2 bg-muted/50 rounded-lg px-4 py-2">
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-sm flex-1">{rs} <span className="text-muted-foreground font-normal">({pdvs.length} PDV)</span></span>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs text-muted-foreground whitespace-nowrap">Cluster P.IVA</Label>
                                <Select value={rsCluster || '__none__'} onValueChange={v => handleRSClusterPIvaChange(rs, v === '__none__' ? '' : v)}>
                                  <SelectTrigger className="h-7 text-xs w-44" data-testid={`select-cluster-piva-rs-${rs.replace(/\s+/g, '-')}`}><SelectValue placeholder="--" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">--</SelectItem>
                                    {CLUSTER_PIVA_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <CodiciRSInput
                              codici={rsCodici}
                              onChange={(codici) => handleRSCodiciChange(rs, codici)}
                              rsName={rs}
                            />
                          </div>
                          {pdvs.map(({ pdv, globalIdx }) => (
                            <PdvCard key={pdv.id || globalIdx} pdv={pdv} index={globalIdx} onUpdate={handleUpdatePdv} onRemove={handleRemovePdv} onSave={handleQuickSave} saving={saving} existingRSNames={Array.from(rsGroups.keys()).filter(r => r !== 'Senza RS')} />
                          ))}
                        </div>
                      );
                    });
                  })()}
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
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                              {(['soglia1', 'soglia2', 'soglia3', 'soglia4'] as const).map(f => (
                                <div key={f} className="space-y-0.5">
                                  <Label className="text-[10px]">{f.replace('soglia', 'S')}</Label>
                                  <Input type="number" className="h-7 text-xs" value={mc[f] ?? ''} onChange={e => updateMobilePos(index, f, Number(e.target.value) || 0)} data-testid={`input-mobile-${f}-${index}`} />
                                </div>
                              ))}
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Forecast</Label>
                                <Input type="number" className="h-7 text-xs" value={mc.forecastTargetPunti ?? ''} onChange={e => updateMobilePos(index, 'forecastTargetPunti', Number(e.target.value) || 0)} data-testid={`input-mobile-forecast-${index}`} />
                              </div>
                            </div>
                            <div className="mt-2">
                              <Label className="text-[10px] text-muted-foreground mb-1 block">Moltiplicatori canone</Label>
                              <div className="grid grid-cols-4 gap-2">
                                {(['multiplierSoglia1', 'multiplierSoglia2', 'multiplierSoglia3', 'multiplierSoglia4'] as const).map((f, i) => (
                                  <div key={f} className="space-y-0.5">
                                    <Label className="text-[10px]">x S{i + 1}</Label>
                                    <Input type="number" step="0.1" className="h-7 text-xs" value={mc[f] ?? ''} onChange={e => updateMobilePos(index, f, Number(e.target.value) || 0)} data-testid={`input-mobile-${f}-${index}`} />
                                  </div>
                                ))}
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
                            <div className="mt-2">
                              <Label className="text-[10px] text-muted-foreground mb-1 block">Moltiplicatori €/pezzo</Label>
                              <div className="grid grid-cols-5 gap-2">
                                {(['multiplierSoglia1', 'multiplierSoglia2', 'multiplierSoglia3', 'multiplierSoglia4', 'multiplierSoglia5'] as const).map((f, i) => (
                                  <div key={f} className="space-y-0.5">
                                    <Label className="text-[10px]">x S{i + 1}</Label>
                                    <Input type="number" step="0.1" className="h-7 text-xs" value={fc[f] ?? ''} onChange={e => updateFissoPos(index, f, Number(e.target.value) || 0)} data-testid={`input-fisso-${f}-${index}`} />
                                  </div>
                                ))}
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
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                              {(['soglia1', 'soglia2', 'soglia3', 'soglia4'] as const).map(f => (
                                <div key={f} className="space-y-0.5">
                                  <Label className="text-[10px]">{f.replace('soglia', 'S')}</Label>
                                  <Input type="number" className="h-7 text-xs" value={mc[f] ?? ''} onChange={e => updateMobileRS(mcIdx, f, Number(e.target.value) || 0)} data-testid={`input-mobile-rs-${f}-${rs}`} />
                                </div>
                              ))}
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Forecast</Label>
                                <Input type="number" className="h-7 text-xs" value={mc.forecastTargetPunti ?? ''} onChange={e => updateMobileRS(mcIdx, 'forecastTargetPunti', Number(e.target.value) || 0)} data-testid={`input-mobile-rs-forecast-${rs}`} />
                              </div>
                            </div>
                            <div className="mt-2">
                              <Label className="text-[10px] text-muted-foreground mb-1 block">Moltiplicatori canone</Label>
                              <div className="grid grid-cols-4 gap-2">
                                {(['multiplierSoglia1', 'multiplierSoglia2', 'multiplierSoglia3', 'multiplierSoglia4'] as const).map((f, i) => (
                                  <div key={f} className="space-y-0.5">
                                    <Label className="text-[10px]">x S{i + 1}</Label>
                                    <Input type="number" step="0.1" className="h-7 text-xs" value={mc[f] ?? ''} onChange={e => updateMobileRS(mcIdx, f, Number(e.target.value) || 0)} data-testid={`input-mobile-rs-${f}-${rs}`} />
                                  </div>
                                ))}
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
                            <div className="mt-2">
                              <Label className="text-[10px] text-muted-foreground mb-1 block">Moltiplicatori €/pezzo</Label>
                              <div className="grid grid-cols-5 gap-2">
                                {(['multiplierSoglia1', 'multiplierSoglia2', 'multiplierSoglia3', 'multiplierSoglia4', 'multiplierSoglia5'] as const).map((f, i) => (
                                  <div key={f} className="space-y-0.5">
                                    <Label className="text-[10px]">x S{i + 1}</Label>
                                    <Input type="number" step="0.1" className="h-7 text-xs" value={fc[f] ?? ''} onChange={e => updateFissoRS(fcIdx, f, Number(e.target.value) || 0)} data-testid={`input-fisso-rs-${f}-${rs}`} />
                                  </div>
                                ))}
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
              {showPerRS ? (
                <div className="space-y-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Energia & Assicurazioni per Ragione Sociale</CardTitle>
                      <CardDescription className="text-xs">
                        Configura i target di Energia e Assicurazioni separatamente per ogni Ragione Sociale.
                      </CardDescription>
                    </CardHeader>
                  </Card>

                  {Array.from(rsGroups.entries()).map(([rs, rsPdvs]) => {
                    const eConf = energiaRSConfig.find(c => c.ragioneSociale === rs);
                    const aConf = assicurazioniRSConfig.find(c => c.ragioneSociale === rs);
                    const pdvECount = rsPdvs.filter(p => p.abilitaEnergia).length;
                    const pdvACount = rsPdvs.filter(p => p.abilitaAssicurazioni).length;

                    const updateEnergiaRS = (field: string, value: number) => {
                      setEnergiaRSConfig(prev => prev.map(c => c.ragioneSociale === rs ? { ...c, [field]: value } : c));
                      setIsDirty(true);
                    };
                    const updateAssicRS = (field: string, value: number) => {
                      setAssicurazioniRSConfig(prev => prev.map(c => c.ragioneSociale === rs ? { ...c, [field]: value } : c));
                      setIsDirty(true);
                    };

                    return (
                      <Card key={rs} data-testid={`card-extra-rs-${rs}`}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold">{rs}</CardTitle>
                          <CardDescription className="text-xs">
                            {rsPdvs.length} PDV — {pdvECount} abil. Energia, {pdvACount} abil. Assicurazioni
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {eConf && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <Zap className="h-4 w-4 text-amber-600" />
                                <Label className="text-xs font-semibold">Energia</Label>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">PDV in Gara</Label>
                                  <Input type="number" className="h-8 text-sm" value={eConf.pdvInGara} onChange={e => updateEnergiaRS('pdvInGara', Number(e.target.value) || 0)} data-testid={`input-energia-rs-pdvInGara-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">No Malus</Label>
                                  <Input type="number" className="h-8 text-sm" value={eConf.targetNoMalus} onChange={e => updateEnergiaRS('targetNoMalus', Number(e.target.value) || 0)} data-testid={`input-energia-rs-targetNoMalus-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Target S1</Label>
                                  <Input type="number" className="h-8 text-sm" value={eConf.targetS1} onChange={e => updateEnergiaRS('targetS1', Number(e.target.value) || 0)} data-testid={`input-energia-rs-targetS1-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Target S2</Label>
                                  <Input type="number" className="h-8 text-sm" value={eConf.targetS2} onChange={e => updateEnergiaRS('targetS2', Number(e.target.value) || 0)} data-testid={`input-energia-rs-targetS2-${rs}`} />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">Target S3</Label>
                                  <Input type="number" className="h-8 text-sm" value={eConf.targetS3} onChange={e => updateEnergiaRS('targetS3', Number(e.target.value) || 0)} data-testid={`input-energia-rs-targetS3-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs font-semibold">Premio S1 € per PDV</Label>
                                  <Input type="number" className="h-8 text-sm" value={eConf.premioS1 ?? 250} onChange={e => updateEnergiaRS('premioS1', Number(e.target.value) || 0)} data-testid={`input-energia-rs-premioS1-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs font-semibold">Premio S2 € per PDV</Label>
                                  <Input type="number" className="h-8 text-sm" value={eConf.premioS2 ?? 500} onChange={e => updateEnergiaRS('premioS2', Number(e.target.value) || 0)} data-testid={`input-energia-rs-premioS2-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs font-semibold">Premio S3 € per PDV</Label>
                                  <Input type="number" className="h-8 text-sm" value={eConf.premioS3 ?? 1000} onChange={e => updateEnergiaRS('premioS3', Number(e.target.value) || 0)} data-testid={`input-energia-rs-premioS3-${rs}`} />
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs font-semibold mb-2 block">Soglie Pista</Label>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                  {(['pistaSoglia_S1', 'pistaSoglia_S2', 'pistaSoglia_S3', 'pistaSoglia_S4', 'pistaSoglia_S5'] as const).map(f => (
                                    <div key={f} className="space-y-1">
                                      <Label className="text-xs">{f.replace('pistaSoglia_', 'S')}</Label>
                                      <Input type="number" className="h-8 text-sm" value={eConf[f] ?? ''} onChange={e => updateEnergiaRS(f, Number(e.target.value) || 0)} data-testid={`input-energia-rs-${f}-${rs}`} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}

                          {eConf && aConf && <Separator />}

                          {aConf && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-purple-600" />
                                <Label className="text-xs font-semibold">Assicurazioni</Label>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">PDV in Gara</Label>
                                  <Input type="number" className="h-8 text-sm" value={aConf.pdvInGara} onChange={e => updateAssicRS('pdvInGara', Number(e.target.value) || 0)} data-testid={`input-assic-rs-pdvInGara-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">No Malus</Label>
                                  <Input type="number" className="h-8 text-sm" value={aConf.targetNoMalus} onChange={e => updateAssicRS('targetNoMalus', Number(e.target.value) || 0)} data-testid={`input-assic-rs-targetNoMalus-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Target S1</Label>
                                  <Input type="number" className="h-8 text-sm" value={aConf.targetS1} onChange={e => updateAssicRS('targetS1', Number(e.target.value) || 0)} data-testid={`input-assic-rs-targetS1-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Target S2</Label>
                                  <Input type="number" className="h-8 text-sm" value={aConf.targetS2} onChange={e => updateAssicRS('targetS2', Number(e.target.value) || 0)} data-testid={`input-assic-rs-targetS2-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs font-semibold">Premio S1 € per PDV</Label>
                                  <Input type="number" className="h-8 text-sm" value={aConf.premioS1 ?? 500} onChange={e => updateAssicRS('premioS1', Number(e.target.value) || 0)} data-testid={`input-assic-rs-premioS1-${rs}`} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs font-semibold">Premio S2 € per PDV</Label>
                                  <Input type="number" className="h-8 text-sm" value={aConf.premioS2 ?? 750} onChange={e => updateAssicRS('premioS2', Number(e.target.value) || 0)} data-testid={`input-assic-rs-premioS2-${rs}`} />
                                </div>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <>
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
                      <Label className="text-xs">Contratti no malus</Label>
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
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Premio S1 € per PDV</Label>
                      <Input type="number" className="h-8 text-sm" value={energiaConfig.premioS1 ?? 250} onChange={e => { setEnergiaConfig(prev => ({ ...prev, premioS1: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-energia-premioS1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Premio S2 € per PDV</Label>
                      <Input type="number" className="h-8 text-sm" value={energiaConfig.premioS2 ?? 500} onChange={e => { setEnergiaConfig(prev => ({ ...prev, premioS2: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-energia-premioS2" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Premio S3 € per PDV</Label>
                      <Input type="number" className="h-8 text-sm" value={energiaConfig.premioS3 ?? 1000} onChange={e => { setEnergiaConfig(prev => ({ ...prev, premioS3: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-energia-premioS3" />
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
                      <Label className="text-xs">Punti no malus</Label>
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
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Premio S1 € per PDV</Label>
                      <Input type="number" className="h-8 text-sm" value={assicurazioniConfig.premioS1 ?? 500} onChange={e => { setAssicurazioniConfig(prev => ({ ...prev, premioS1: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-assicurazioni-premioS1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Premio S2 € per PDV</Label>
                      <Input type="number" className="h-8 text-sm" value={assicurazioniConfig.premioS2 ?? 750} onChange={e => { setAssicurazioniConfig(prev => ({ ...prev, premioS2: Number(e.target.value) || 0 })); setIsDirty(true); }} data-testid="input-assicurazioni-premioS2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
                </>
              )}
            </TabsContent>

            <TabsContent value="tabelleCalcolo" className="space-y-4">
              <TabelleCalcoloGara
                config={tabelleCalcolo}
                onChange={(newConfig) => { setTabelleCalcolo(newConfig); setIsDirty(true); }}
                baseDefaults={tabelleCalcoloDefaults}
                pdvList={pdvList}
                extraGaraIvaSogliePerRS={extraGaraIvaSogliePerRS}
                onExtraGaraIvaSogliePerRSChange={(soglie) => { setExtraGaraIvaSogliePerRS(soglie); setIsDirty(true); }}
              />
            </TabsContent>
          </Tabs>
        )}

        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Importa Configurazione</DialogTitle>
              <DialogDescription>
                Importa da PDF gara WindTre, dal simulatore o dalla configurazione corrente.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              <Button variant="outline" className="w-full justify-start h-auto py-3" onClick={() => { setImportDialogOpen(false); setPdfData(null); setPdfError(null); setPdfImportDialogOpen(true); }} data-testid="button-import-pdf-gara">
                <FileText className="h-4 w-4 mr-2 shrink-0" />
                <div className="text-left">
                  <div className="font-medium text-sm">Importa da PDF Gara</div>
                  <div className="text-xs text-muted-foreground">Legge cluster PDV, soglie e codici RS dal PDF WindTre</div>
                </div>
              </Button>

              <Separator />

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

        <Dialog open={pdfImportDialogOpen} onOpenChange={(open) => { setPdfImportDialogOpen(open); if (!open) { setPdfData(null); setPdfError(null); } }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {pdfData?.pdfType === 'partnership_reward' && pdfData.mese
                  ? `Partnership Reward ${pdfData.mese}`
                  : pdfData?.mese
                    ? `Incentivazione Franchising W3 ${pdfData.mese}`
                    : 'Importa da PDF Gara WindTre'}
              </DialogTitle>
              <DialogDescription>
                {pdfData ? 'Riepilogo dei dati estratti dal PDF. Verifica e applica.' : 'Carica il PDF della lettera di incentivazione per importare automaticamente cluster PDV, soglie e codici RS.'}
              </DialogDescription>
            </DialogHeader>

            {!pdfData && !pdfParsing && (
              <div className="space-y-4">
                <label
                  htmlFor="pdf-upload"
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <FileText className="h-10 w-10 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Clicca per selezionare il PDF</span>
                  <span className="text-xs text-muted-foreground">Formato: PDF gara WindTre con allegato PDV</span>
                </label>
                <input
                  id="pdf-upload"
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFileSelect(f); e.target.value = ''; }}
                  data-testid="input-pdf-upload"
                />
                {pdfError && (
                  <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{pdfError}</span>
                  </div>
                )}
              </div>
            )}

            {pdfParsing && (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Analisi del PDF in corso...</span>
              </div>
            )}

            {pdfData && (
              <div className="space-y-4 max-h-[400px] overflow-y-auto">
                {pdfFileName && (
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">File:</span>
                    <span className="font-medium truncate">{pdfFileName}</span>
                  </div>
                )}
                {pdfData.nomeRS && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">RS:</span>
                    <span className="font-medium">{pdfData.nomeRS}</span>
                  </div>
                )}
                {pdfData.mese && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Periodo:</span>
                    <span className="font-medium">{pdfData.mese}</span>
                  </div>
                )}

                {pdfData.codiciDealer.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Codici Dealer (RS)</Label>
                    <div className="flex gap-1 flex-wrap">
                      {pdfData.codiciDealer.map(c => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}
                    </div>
                  </div>
                )}

                {pdfData.pdvList.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">PDV trovati nel PDF ({pdfData.pdvList.length})</Label>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="px-2 py-1 text-left">Codice POS</th>
                            <th className="px-2 py-1 text-center">Cluster M</th>
                            <th className="px-2 py-1 text-center">Cluster F</th>
                            <th className="px-2 py-1 text-center">Stato</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pdfData.pdvList.map(p => {
                            const found = pdvList.some(pdv => pdv.codicePos === p.codicePos);
                            return (
                              <tr key={p.codicePos} className="border-t">
                                <td className="px-2 py-1 font-mono">{p.codicePos}</td>
                                <td className="px-2 py-1 text-center">{p.clusterMobile || '-'}</td>
                                <td className="px-2 py-1 text-center">{p.clusterFisso || '-'}</td>
                                <td className="px-2 py-1 text-center">
                                  {found ? (
                                    <Badge variant="secondary" className="text-[10px]"><Check className="h-3 w-3 mr-0.5" />Trovato</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] text-amber-600"><AlertTriangle className="h-3 w-3 mr-0.5" />Non trovato</Badge>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {pdfData.soglieMobile && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Soglie Pista Mobile</Label>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S1</div>
                        <div className="text-sm font-semibold">{pdfData.soglieMobile.s1}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S2</div>
                        <div className="text-sm font-semibold">{pdfData.soglieMobile.s2}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S3</div>
                        <div className="text-sm font-semibold">{pdfData.soglieMobile.s3}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S4</div>
                        <div className="text-sm font-semibold">{pdfData.soglieMobile.s4}</div>
                      </div>
                    </div>
                  </div>
                )}

                {pdfData.soglieFisso && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Soglie Pista Fisso</Label>
                    <div className="grid grid-cols-5 gap-2">
                      {[pdfData.soglieFisso.s1, pdfData.soglieFisso.s2, pdfData.soglieFisso.s3, pdfData.soglieFisso.s4, pdfData.soglieFisso.s5].map((v, i) => (
                        <div key={i} className="bg-muted/50 rounded p-2 text-center">
                          <div className="text-[10px] text-muted-foreground">S{i + 1}</div>
                          <div className="text-sm font-semibold">{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pdfData.soglieExtraPIva && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Pista Extra P.IVA</Label>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground">Cluster:</span>
                      <Badge variant="outline" className="text-xs">
                        {pdfData.soglieExtraPIva.cluster === 'business_promoter_plus' ? 'Business Promoter Plus' :
                         pdfData.soglieExtraPIva.cluster === 'business_promoter' ? 'Business Promoter' :
                         pdfData.soglieExtraPIva.cluster === 'senza_business_promoter' ? 'Senza Business Promoter' :
                         pdfData.soglieExtraPIva.cluster || '—'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[pdfData.soglieExtraPIva.s1, pdfData.soglieExtraPIva.s2, pdfData.soglieExtraPIva.s3, pdfData.soglieExtraPIva.s4].map((v, i) => (
                        <div key={i} className="bg-muted/50 rounded p-2 text-center">
                          <div className="text-[10px] text-muted-foreground">S{i + 1}</div>
                          <div className="text-sm font-semibold">{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pdfData.partnershipTarget && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Partnership Reward</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Target 100%</div>
                        <div className="text-sm font-semibold">{pdfData.partnershipTarget.target100.toLocaleString('it-IT')}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Premio 100%</div>
                        <div className="text-sm font-semibold">{pdfData.partnershipTarget.premio100.toLocaleString('it-IT')} €</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Target 80%</div>
                        <div className="text-sm font-semibold">{pdfData.partnershipTarget.target80.toLocaleString('it-IT')}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Premio 80%</div>
                        <div className="text-sm font-semibold">{pdfData.partnershipTarget.premio80.toLocaleString('it-IT')} €</div>
                      </div>
                    </div>
                  </div>
                )}

                {pdfData.soglieEnergia && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Energia (Luce & Gas)</Label>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S1 (250€/PDV)</div>
                        <div className="text-sm font-semibold">{pdfData.soglieEnergia.targetS1}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S2 (20% min 500€)</div>
                        <div className="text-sm font-semibold">{pdfData.soglieEnergia.targetS2}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S3 (1.000€/PDV)</div>
                        <div className="text-sm font-semibold">{pdfData.soglieEnergia.targetS3}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-amber-50 dark:bg-amber-950/30 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Decurtazione (&lt;)</div>
                        <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">{pdfData.soglieEnergia.targetNoMalus}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Target Fisso RS</div>
                        <div className="text-sm font-semibold">{pdfData.soglieEnergia.targetFissoRS}</div>
                      </div>
                    </div>
                  </div>
                )}

                {pdfData.soglieAssicurazioni && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Assicurazioni</Label>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S1 (500€/PDV)</div>
                        <div className="text-sm font-semibold">{pdfData.soglieAssicurazioni.targetS1}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">S2 (750€/PDV)</div>
                        <div className="text-sm font-semibold">{pdfData.soglieAssicurazioni.targetS2}</div>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-950/30 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Decurtazione (&lt;)</div>
                        <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">{pdfData.soglieAssicurazioni.targetNoMalus}</div>
                      </div>
                    </div>
                  </div>
                )}

                {pdfData.soglieProtecta && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Protecta (Casa e Negozio Protetti)</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/50 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Target Extra ({pdfData.soglieProtecta.premioExtra}€/PDV)</div>
                        <div className="text-sm font-semibold">≥ {pdfData.soglieProtecta.targetExtra}</div>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-950/30 rounded p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">Decurtazione (&lt;)</div>
                        <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">{pdfData.soglieProtecta.targetDecurtazione}</div>
                      </div>
                    </div>
                  </div>
                )}

                {pdfData.decurtazione && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-muted-foreground">Importo Decurtazione Totale:</span>
                      <span className="font-semibold text-amber-700 dark:text-amber-400">{pdfData.decurtazione.importo.toLocaleString('it-IT')} €</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              {pdfData && (
                <>
                  <Button variant="outline" onClick={() => { setPdfData(null); setPdfError(null); }} data-testid="button-pdf-back">
                    Cambia file
                  </Button>
                  <Button onClick={handleApplyPdfImport} data-testid="button-pdf-apply">
                    <Check className="h-4 w-4 mr-1" />
                    Applica modifiche
                  </Button>
                </>
              )}
            </DialogFooter>
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
                {newPdvRSMode === 'select' && Array.from(rsGroups.keys()).filter(rs => rs !== 'Senza RS').length > 0 ? (
                  <div className="space-y-2">
                    <Select value={newPdvRS} onValueChange={(v) => { if (v === '__new__') { setNewPdvRSMode('new'); setNewPdvRS(''); } else { setNewPdvRS(v); } }}>
                      <SelectTrigger data-testid="select-new-pdv-rs"><SelectValue placeholder="Seleziona ragione sociale" /></SelectTrigger>
                      <SelectContent>
                        {Array.from(rsGroups.keys()).filter(rs => rs !== 'Senza RS').map(rs => (
                          <SelectItem key={rs} value={rs}>{rs}</SelectItem>
                        ))}
                        <SelectItem value="__new__">+ Nuova ragione sociale...</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input value={newPdvRS} onChange={e => setNewPdvRS(e.target.value)} placeholder="Nuova ragione sociale" data-testid="input-new-pdv-rs" className="flex-1" />
                    {Array.from(rsGroups.keys()).filter(rs => rs !== 'Senza RS').length > 0 && (
                      <Button type="button" variant="outline" size="sm" onClick={() => { setNewPdvRSMode('select'); setNewPdvRS(''); }} data-testid="button-rs-back-to-select" className="shrink-0 text-xs">
                        Esistente
                      </Button>
                    )}
                  </div>
                )}
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

        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{saveAsNew || !garaConfigRecord?.id ? 'Salva nuova configurazione' : 'Salva configurazione'}</DialogTitle>
              <DialogDescription>Inserisci un nome per la configurazione.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Nome configurazione *</Label>
                <Input
                  value={configName}
                  onChange={e => setConfigName(e.target.value)}
                  placeholder="es. Base, Ottimista, Conservativa"
                  data-testid="input-config-name"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && configName.trim()) handleSaveConfirm(); }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveDialogOpen(false)} data-testid="button-cancel-save">Annulla</Button>
              <Button onClick={handleSaveConfirm} disabled={saving || !configName.trim()} data-testid="button-confirm-save">
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Salva
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={configListDialogOpen} onOpenChange={setConfigListDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Configurazioni salvate — {MONTHS.find(m => m.value === selectedMonth)?.label} {selectedYear}</DialogTitle>
              <DialogDescription>Seleziona una configurazione da caricare o elimina quelle non necessarie.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {configList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nessuna configurazione salvata per questo mese.</p>
              ) : (
                configList.map(c => (
                  <div key={c.id} className="flex items-center gap-2">
                    <Button
                      variant={garaConfigRecord?.id === c.id ? 'secondary' : 'ghost'}
                      className="flex-1 justify-between h-auto py-2"
                      onClick={() => { loadConfigById(c.id, selectedMonth, selectedYear); setConfigListDialogOpen(false); }}
                      data-testid={`button-config-${c.id}`}
                    >
                      <span className="font-medium">{c.name || 'Senza nome'}</span>
                      {c.updatedAt && <span className="text-xs text-muted-foreground">{new Date(c.updatedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteConfig(c.id)}
                      data-testid={`button-delete-config-${c.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
