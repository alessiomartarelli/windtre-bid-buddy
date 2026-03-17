import { useState, useEffect, useCallback } from 'react';
import { AppNavbar } from '@/components/AppNavbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useGaraConfig, GaraConfigPdv, GaraConfigData } from '@/hooks/useGaraConfig';
import { CLUSTER_OPTIONS, CLUSTER_PIVA_OPTIONS, WEEKDAY_LABELS } from '@/types/preventivatore';
import { apiUrl } from '@/lib/basePath';
import {
  Loader2, Save, Download, Plus, Trash2, CalendarDays, Store,
  ChevronDown, ChevronUp, History, Upload,
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

function PdvCard({
  pdv,
  index,
  onUpdate,
  onRemove,
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
              <Input
                value={pdv.codicePos}
                onChange={e => updateField('codicePos', e.target.value)}
                className="h-8 text-sm"
                data-testid={`input-codice-pos-${index}`}
              />
            </div>
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                value={pdv.nome}
                onChange={e => updateField('nome', e.target.value)}
                className="h-8 text-sm"
                data-testid={`input-nome-pdv-${index}`}
              />
            </div>
            <div>
              <Label className="text-xs">Ragione Sociale</Label>
              <Input
                value={pdv.ragioneSociale}
                onChange={e => updateField('ragioneSociale', e.target.value)}
                className="h-8 text-sm"
                data-testid={`input-rs-pdv-${index}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs">Cluster Mobile</Label>
              <Select value={pdv.clusterMobile || '__none__'} onValueChange={v => updateField('clusterMobile', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm" data-testid={`select-cluster-mobile-${index}`}>
                  <SelectValue placeholder="--" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">--</SelectItem>
                  {CLUSTER_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cluster Fisso</Label>
              <Select value={pdv.clusterFisso || '__none__'} onValueChange={v => updateField('clusterFisso', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm" data-testid={`select-cluster-fisso-${index}`}>
                  <SelectValue placeholder="--" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">--</SelectItem>
                  {CLUSTER_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cluster CB</Label>
              <Select value={pdv.clusterCB || '__none__'} onValueChange={v => updateField('clusterCB', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm" data-testid={`select-cluster-cb-${index}`}>
                  <SelectValue placeholder="--" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">--</SelectItem>
                  {CLUSTER_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cluster P.IVA</Label>
              <Select value={pdv.clusterPIva || '__none__'} onValueChange={v => updateField('clusterPIva', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm" data-testid={`select-cluster-piva-${index}`}>
                  <SelectValue placeholder="--" />
                </SelectTrigger>
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

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={pdv.abilitaEnergia}
                onCheckedChange={v => updateField('abilitaEnergia', !!v)}
                data-testid={`checkbox-energia-${index}`}
              />
              <Label className="text-xs">Energia</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={pdv.abilitaAssicurazioni}
                onCheckedChange={v => updateField('abilitaAssicurazioni', !!v)}
                data-testid={`checkbox-assicurazioni-${index}`}
              />
              <Label className="text-xs">Assicurazioni</Label>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onRemove(index)}
              data-testid={`button-remove-pdv-${index}`}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Rimuovi
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

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

  const { profile } = useAuth();
  const { toast } = useToast();
  const {
    config: garaConfigRecord,
    loading,
    saving,
    history,
    fetchConfig,
    saveConfig,
    fetchHistory,
    fetchPdvFromSales,
    importFromSimulator,
  } = useGaraConfig();

  const isAdminOrSuper = ['super_admin', 'admin'].includes(profile?.role || '');

  const loadMonthConfig = useCallback(async (month: number, year: number) => {
    setInitialLoaded(false);
    const result = await fetchConfig(month, year);
    if (result?.config) {
      const configData = result.config as unknown as GaraConfigData;
      setPdvList(configData.pdvList || []);
    } else {
      const salesPdvs = await fetchPdvFromSales(month, year);
      if (salesPdvs.length > 0) {
        const autoPdvList = salesPdvs.map(sp =>
          createEmptyGaraPdv(sp.codicePos, sp.nomeNegozio, sp.ragioneSociale)
        );
        setPdvList(autoPdvList);
        toast({
          title: 'PDV auto-popolati',
          description: `${autoPdvList.length} PDV trovati dalle vendite BiSuite di ${MONTHS.find(m => m.value === month)?.label} ${year}.`,
        });
      } else {
        setPdvList([]);
      }
    }
    setIsDirty(false);
    setInitialLoaded(true);
  }, [fetchConfig, fetchPdvFromSales, toast]);

  useEffect(() => {
    loadMonthConfig(selectedMonth, selectedYear);
    fetchHistory();
  }, [selectedMonth, selectedYear, loadMonthConfig, fetchHistory]);

  const handleSave = async () => {
    const configData: GaraConfigData = {
      pdvList,
      ...(garaConfigRecord?.config ? {
        importedFrom: (garaConfigRecord.config as unknown as GaraConfigData).importedFrom,
        pistaMobile: (garaConfigRecord.config as unknown as GaraConfigData).pistaMobile,
        pistaFisso: (garaConfigRecord.config as unknown as GaraConfigData).pistaFisso,
        calendarioGara: (garaConfigRecord.config as unknown as GaraConfigData).calendarioGara,
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
    setPdvList(prev => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  };

  const handleAddPdv = () => {
    if (!newPdvCode.trim()) return;
    setPdvList(prev => [...prev, createEmptyGaraPdv(newPdvCode.trim(), newPdvName.trim(), newPdvRS.trim())]);
    setNewPdvCode('');
    setNewPdvName('');
    setNewPdvRS('');
    setAddPdvDialogOpen(false);
    setIsDirty(true);
  };

  const openImportDialog = async () => {
    setImportDialogOpen(true);
    setLoadingSimConfigs(true);
    try {
      const res = await fetch(apiUrl('/api/pdv-configurations'), { credentials: 'include' });
      if (res.ok) {
        setSimulatorConfigs(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoadingSimConfigs(false);
    }
  };

  const handleImport = async (source: 'pdv_configuration' | 'organization_config', pdvConfigId?: string) => {
    const result = await importFromSimulator(selectedMonth, selectedYear, source, pdvConfigId);
    if (result?.config) {
      const configData = result.config as unknown as GaraConfigData;
      setPdvList(configData.pdvList || []);
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

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Configurazione Gara" />
      <div className="container mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Select
              value={String(selectedMonth)}
              onValueChange={v => handleMonthChange(Number(v), selectedYear)}
            >
              <SelectTrigger className="w-[140px] h-9" data-testid="select-month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(selectedYear)}
              onValueChange={v => handleMonthChange(selectedMonth, Number(v))}
            >
              <SelectTrigger className="w-[100px] h-9" data-testid="select-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026, 2027].map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {garaConfigRecord && (
              <Badge variant="secondary" className="text-xs">
                Salvato
              </Badge>
            )}
            {isDirty && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                Modifiche non salvate
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setHistoryDialogOpen(true); fetchHistory(); }}
              data-testid="button-history"
            >
              <History className="h-4 w-4 mr-1" />
              Storico
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openImportDialog}
              data-testid="button-import"
            >
              <Download className="h-4 w-4 mr-1" />
              Importa da Simulatore
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddPdvDialogOpen(true)}
              data-testid="button-add-pdv"
            >
              <Plus className="h-4 w-4 mr-1" />
              Aggiungi PDV
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !isDirty}
              data-testid="button-save"
            >
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Salva
            </Button>
          </div>
        </div>

        {loading && !initialLoaded ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : pdvList.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                Nessun PDV configurato per {MONTHS.find(m => m.value === selectedMonth)?.label} {selectedYear}.
              </p>
              <div className="flex items-center justify-center gap-3">
                <Button variant="outline" onClick={openImportDialog} data-testid="button-import-empty">
                  <Download className="h-4 w-4 mr-1" />
                  Importa da Simulatore
                </Button>
                <Button variant="outline" onClick={() => setAddPdvDialogOpen(true)} data-testid="button-add-pdv-empty">
                  <Plus className="h-4 w-4 mr-1" />
                  Aggiungi PDV
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground mb-2">
              {pdvList.length} PDV configurati
            </div>
            {pdvList.map((pdv, idx) => (
              <PdvCard
                key={pdv.id || idx}
                pdv={pdv}
                index={idx}
                onUpdate={handleUpdatePdv}
                onRemove={handleRemovePdv}
              />
            ))}
          </div>
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
              <Button
                variant="outline"
                className="w-full justify-start h-auto py-3"
                onClick={() => handleImport('organization_config')}
                disabled={saving}
                data-testid="button-import-org-config"
              >
                <Upload className="h-4 w-4 mr-2 shrink-0" />
                <div className="text-left">
                  <div className="font-medium text-sm">Configurazione corrente</div>
                  <div className="text-xs text-muted-foreground">Importa dalla config attiva dell'organizzazione</div>
                </div>
              </Button>

              {loadingSimConfigs ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : simulatorConfigs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nessuna configurazione salvata nel simulatore.</p>
              ) : (
                simulatorConfigs.map(cfg => (
                  <Button
                    key={cfg.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    onClick={() => handleImport('pdv_configuration', cfg.id)}
                    disabled={saving}
                    data-testid={`button-import-config-${cfg.id}`}
                  >
                    <Store className="h-4 w-4 mr-2 shrink-0" />
                    <div className="text-left min-w-0">
                      <div className="font-medium text-sm truncate">{cfg.name}</div>
                      {cfg.updatedAt && (
                        <div className="text-xs text-muted-foreground">
                          Aggiornata: {new Date(cfg.updatedAt).toLocaleDateString('it-IT')}
                        </div>
                      )}
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
              <DialogDescription>
                Seleziona un mese per visualizzare o modificare la configurazione.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nessuna configurazione salvata.</p>
              ) : (
                history.map(h => (
                  <Button
                    key={`${h.year}-${h.month}`}
                    variant={h.month === selectedMonth && h.year === selectedYear ? "secondary" : "ghost"}
                    className="w-full justify-between h-auto py-2"
                    onClick={() => {
                      handleMonthChange(h.month, h.year);
                      setHistoryDialogOpen(false);
                    }}
                    data-testid={`button-history-${h.year}-${h.month}`}
                  >
                    <span>{MONTHS.find(m => m.value === h.month)?.label} {h.year}</span>
                    {h.updatedAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(h.updatedAt).toLocaleDateString('it-IT')}
                      </span>
                    )}
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
                <Input
                  value={newPdvCode}
                  onChange={e => setNewPdvCode(e.target.value)}
                  placeholder="es. W1234"
                  data-testid="input-new-pdv-code"
                />
              </div>
              <div>
                <Label className="text-sm">Nome</Label>
                <Input
                  value={newPdvName}
                  onChange={e => setNewPdvName(e.target.value)}
                  placeholder="Nome negozio"
                  data-testid="input-new-pdv-name"
                />
              </div>
              <div>
                <Label className="text-sm">Ragione Sociale</Label>
                <Input
                  value={newPdvRS}
                  onChange={e => setNewPdvRS(e.target.value)}
                  placeholder="Ragione sociale"
                  data-testid="input-new-pdv-rs"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddPdvDialogOpen(false)} data-testid="button-cancel-add-pdv">
                Annulla
              </Button>
              <Button onClick={handleAddPdv} disabled={!newPdvCode.trim()} data-testid="button-confirm-add-pdv">
                <Plus className="h-4 w-4 mr-1" />
                Aggiungi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
