import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { apiUrl } from '@/lib/basePath';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { AppNavbar } from '@/components/AppNavbar';
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  RotateCcw,
  Loader2,
  MapPin,
  Smartphone,
  Wifi,
  Zap,
  Shield,
  Award,
  Users,
  GripVertical,
  Pencil,
  Package,
  Wrench,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useLocation } from 'wouter';
import type {
  BiSuiteMappingRule,
  BiSuiteMappingConfig,
  GaraPista,
  BiSuiteMappingCondition,
} from '@shared/bisuiteMapping';
import {
  PISTA_TARGETS,
  PISTA_LABELS,
  getDefaultMappingRules,
} from '@shared/bisuiteMapping';

const PISTA_ICONS: Record<GaraPista, React.ReactNode> = {
  mobile: <Smartphone className="h-4 w-4" />,
  fisso: <Wifi className="h-4 w-4" />,
  energia: <Zap className="h-4 w-4" />,
  assicurazioni: <Shield className="h-4 w-4" />,
  protecta: <Award className="h-4 w-4" />,
  partnership: <Users className="h-4 w-4" />,
};

const ALL_PISTE: GaraPista[] = ['mobile', 'fisso', 'energia', 'assicurazioni', 'protecta', 'partnership'];

type ExtraTab = 'prodotti' | 'servizi' | 'non_mappati';
type ActiveTab = GaraPista | ExtraTab;

interface ArticleSummaryItem {
  categoria: string;
  tipologia: string;
  descrizione: string;
  pezzi: number;
  importo?: number;
  clienteTipo?: string;
}

interface ArticlesSummaryData {
  month: number;
  year: number;
  prodotti: ArticleSummaryItem[];
  servizi: ArticleSummaryItem[];
  nonMappati: ArticleSummaryItem[];
}

function generateRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyRule(pista: GaraPista): BiSuiteMappingRule {
  const targets = PISTA_TARGETS[pista];
  return {
    id: generateRuleId(),
    pista,
    targetCategory: targets[0]?.value || '',
    targetLabel: targets[0]?.label || '',
    conditions: {},
    priority: 10,
    enabled: true,
  };
}

export default function MappaturaBiSuite() {
  const [, setLocation] = useLocation();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [rules, setRules] = useState<BiSuiteMappingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('mobile');
  const [editingRule, setEditingRule] = useState<BiSuiteMappingRule | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const now = new Date();
  const [summaryMonth, setSummaryMonth] = useState(now.getMonth() + 1);
  const [summaryYear, setSummaryYear] = useState(now.getFullYear());
  const [articlesSummary, setArticlesSummary] = useState<ArticlesSummaryData | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const isExtraTab = activeTab === 'prodotti' || activeTab === 'servizi' || activeTab === 'non_mappati';
  const activePista = isExtraTab ? 'mobile' : (activeTab as GaraPista);

  const loadArticlesSummary = useCallback(async (m: number, y: number) => {
    try {
      setLoadingSummary(true);
      const res = await fetch(apiUrl(`/api/admin/bisuite-articles-summary?month=${m}&year=${y}`), { credentials: 'include' });
      if (!res.ok) throw new Error('Errore');
      const data = await res.json();
      setArticlesSummary(data);
    } catch (err) {
      console.error('Error loading articles summary:', err);
      toast({ title: 'Errore', description: 'Impossibile caricare il riepilogo articoli.', variant: 'destructive' });
    } finally {
      setLoadingSummary(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isExtraTab && profile) {
      loadArticlesSummary(summaryMonth, summaryYear);
    }
  }, [isExtraTab, summaryMonth, summaryYear, profile, loadArticlesSummary]);

  const loadMapping = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(apiUrl('/api/admin/bisuite-mapping'), { credentials: 'include' });
      if (!res.ok) throw new Error('Errore nel caricamento');
      const data = await res.json();
      if (data && data.rules) {
        setRules(data.rules);
      } else {
        setRules(getDefaultMappingRules());
        setHasChanges(true);
      }
    } catch (err) {
      console.error('Error loading mapping:', err);
      setRules(getDefaultMappingRules());
      setHasChanges(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile) loadMapping();
  }, [profile, loadMapping]);

  const saveMapping = async () => {
    try {
      setSaving(true);
      const mapping: BiSuiteMappingConfig = { rules, version: '1.0' };
      const res = await fetch(apiUrl('/api/admin/bisuite-mapping'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mapping }),
      });
      if (!res.ok) throw new Error('Errore nel salvataggio');
      setHasChanges(false);
      toast({ title: 'Mappatura salvata', description: 'Le regole di mappatura sono state salvate.' });
    } catch (err) {
      toast({ title: 'Errore', description: 'Impossibile salvare la mappatura.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    setRules(getDefaultMappingRules());
    setHasChanges(true);
    setShowResetDialog(false);
    toast({ title: 'Regole ripristinate', description: 'Le regole di default sono state caricate.' });
  };

  const addRule = (pista: GaraPista) => {
    const newRule = createEmptyRule(pista);
    setRules((prev) => [...prev, newRule]);
    setHasChanges(true);
    setEditingRule(newRule);
  };

  const deleteRule = (ruleId: string) => {
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    setHasChanges(true);
  };

  const toggleRule = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r))
    );
    setHasChanges(true);
  };

  const updateRule = (updated: BiSuiteMappingRule) => {
    setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setHasChanges(true);
  };

  const pistaRules = isExtraTab ? [] : rules.filter((r) => r.pista === activePista);

  const changeMonth = (delta: number) => {
    let m = summaryMonth + delta;
    let y = summaryYear;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setSummaryMonth(m);
    setSummaryYear(y);
  };

  const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

  if (!['super_admin', 'admin'].includes(profile?.role || '')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Accesso non autorizzato</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Incentive W3">
        {hasChanges && (
          <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50">
            Modifiche non salvate
          </Badge>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowResetDialog(true)}
          data-testid="btn-reset-defaults"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Ripristina Default
        </Button>
        <Button
          size="sm"
          onClick={saveMapping}
          disabled={saving || !hasChanges}
          data-testid="btn-save-mapping"
        >
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Salva
        </Button>
      </AppNavbar>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Regole di Mappatura</CardTitle>
            <CardDescription>
              Configura come le vendite BiSuite vengono classificate nelle categorie della gara.
              Ogni regola definisce condizioni (categoria, tipologia, tipo cliente) e la categoria gara di destinazione.
              Le regole con priorità più alta vengono valutate per prime.
            </CardDescription>
          </CardHeader>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="grid w-max sm:w-full grid-cols-9 mb-6">
              {ALL_PISTE.map((pista) => {
                const count = rules.filter((r) => r.pista === pista).length;
                return (
                  <TabsTrigger key={pista} value={pista} className="gap-1.5 text-xs sm:text-sm" data-testid={`tab-${pista}`}>
                    {PISTA_ICONS[pista]}
                    <span className="hidden sm:inline">{PISTA_LABELS[pista]}</span>
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                      {count}
                    </Badge>
                  </TabsTrigger>
                );
              })}
              <TabsTrigger value="prodotti" className="gap-1.5 text-xs sm:text-sm" data-testid="tab-prodotti">
                <Package className="h-4 w-4" />
                <span className="hidden sm:inline">Prodotti</span>
              </TabsTrigger>
              <TabsTrigger value="servizi" className="gap-1.5 text-xs sm:text-sm" data-testid="tab-servizi">
                <Wrench className="h-4 w-4" />
                <span className="hidden sm:inline">Servizi</span>
              </TabsTrigger>
              <TabsTrigger value="non_mappati" className="gap-1.5 text-xs sm:text-sm" data-testid="tab-non-mappati">
                <AlertTriangle className="h-4 w-4" />
                <span className="hidden sm:inline">Non Mappati</span>
              </TabsTrigger>
            </TabsList>
            </div>

            {ALL_PISTE.map((pista) => (
              <TabsContent key={pista} value={pista}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {rules.filter((r) => r.pista === pista).length} regole per {PISTA_LABELS[pista]}
                    </h3>
                    <Button size="sm" onClick={() => addRule(pista)} data-testid={`btn-add-rule-${pista}`}>
                      <Plus className="h-4 w-4 mr-2" />
                      Aggiungi Regola
                    </Button>
                  </div>

                  {rules.filter((r) => r.pista === pista).length === 0 ? (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        Nessuna regola configurata per {PISTA_LABELS[pista]}.
                        Clicca "Aggiungi Regola" per iniziare.
                      </CardContent>
                    </Card>
                  ) : (
                    rules
                      .filter((r) => r.pista === pista)
                      .sort((a, b) => b.priority - a.priority)
                      .map((rule) => (
                        <RuleCard
                          key={rule.id}
                          rule={rule}
                          onEdit={() => setEditingRule(rule)}
                          onDelete={() => deleteRule(rule.id)}
                          onToggle={() => toggleRule(rule.id)}
                        />
                      ))
                  )}
                </div>
              </TabsContent>
            ))}

            {(['prodotti', 'servizi', 'non_mappati'] as ExtraTab[]).map((tab) => (
              <TabsContent key={tab} value={tab}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">
                      {tab === 'prodotti' ? 'Prodotti' : tab === 'servizi' ? 'Servizi' : 'Articoli Non Mappati'}
                    </h3>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => changeMonth(-1)} data-testid="btn-prev-month">
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm font-medium min-w-[140px] text-center">
                        {MONTH_NAMES[summaryMonth - 1]} {summaryYear}
                      </span>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => changeMonth(1)} data-testid="btn-next-month">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {loadingSummary ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : !articlesSummary ? (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        Nessun dato disponibile per il periodo selezionato.
                      </CardContent>
                    </Card>
                  ) : (
                    <ArticlesTable
                      items={tab === 'prodotti' ? articlesSummary.prodotti : tab === 'servizi' ? articlesSummary.servizi : articlesSummary.nonMappati}
                      showImporto={tab !== 'non_mappati'}
                      showClienteTipo={tab === 'non_mappati'}
                      onCreateRule={tab === 'non_mappati' ? (item) => {
                        const newRule = createEmptyRule('mobile');
                        newRule.conditions = { categoriaBiSuite: item.categoria, tipologiaBiSuite: item.tipologia };
                        setEditingRule(newRule);
                        setRules(prev => [...prev, newRule]);
                        setHasChanges(true);
                      } : undefined}
                    />
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </main>

      {editingRule && (
        <RuleEditDialog
          rule={editingRule}
          onSave={(updated) => {
            updateRule(updated);
            setEditingRule(null);
          }}
          onCancel={() => setEditingRule(null)}
        />
      )}

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ripristinare le regole di default?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tutte le regole attuali verranno sostituite con le regole di default.
            Questa azione non può essere annullata finché non salvi.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)}>Annulla</Button>
            <Button variant="destructive" onClick={resetToDefaults} data-testid="btn-confirm-reset">Ripristina</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArticlesTable({
  items,
  showImporto,
  showClienteTipo,
  onCreateRule,
}: {
  items: ArticleSummaryItem[];
  showImporto: boolean;
  showClienteTipo: boolean;
  onCreateRule?: (item: ArticleSummaryItem) => void;
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Nessun articolo trovato per il periodo selezionato.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="articles-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2 font-medium">Categoria</th>
                <th className="text-left px-4 py-2 font-medium">Tipologia</th>
                <th className="text-left px-4 py-2 font-medium">Descrizione</th>
                <th className="text-right px-4 py-2 font-medium">Pezzi</th>
                {showImporto && <th className="text-right px-4 py-2 font-medium">Importo</th>}
                {showClienteTipo && <th className="text-left px-4 py-2 font-medium">Tipo Cliente</th>}
                {onCreateRule && <th className="text-center px-4 py-2 font-medium">Azioni</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-article-${i}`}>
                  <td className="px-4 py-2">
                    <Badge variant="outline" className="text-xs">{item.categoria}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{item.tipologia || '—'}</td>
                  <td className="px-4 py-2 text-xs max-w-[300px] truncate">{item.descrizione || '—'}</td>
                  <td className="px-4 py-2 text-right font-medium">{item.pezzi}</td>
                  {showImporto && (
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {(item.importo || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}
                    </td>
                  )}
                  {showClienteTipo && (
                    <td className="px-4 py-2 text-xs">{item.clienteTipo || '—'}</td>
                  )}
                  {onCreateRule && (
                    <td className="px-4 py-2 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => onCreateRule(item)}
                        data-testid={`btn-create-rule-${i}`}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Crea Regola
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleCard({
  rule,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: BiSuiteMappingRule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const cond = rule.conditions;
  const conditionParts: string[] = [];
  if (cond.categoriaBiSuite) conditionParts.push(`Cat: ${cond.categoriaBiSuite}`);
  if (cond.tipologiaBiSuite) conditionParts.push(`Tip: ${cond.tipologiaBiSuite}`);
  if (cond.descrizioneBiSuite) conditionParts.push(`Desc: "${cond.descrizioneBiSuite}"`);
  if (cond.descrizioneEscludi) conditionParts.push(`Escludi: "${cond.descrizioneEscludi}"`);
  if (cond.clienteTipo) conditionParts.push(`Cliente: ${cond.clienteTipo}`);
  if (cond.domandaTesto) conditionParts.push(`D: "${cond.domandaTesto}" → "${cond.rispostaContiene || ''}"`);

  return (
    <Card className={`transition-opacity ${!rule.enabled ? 'opacity-50' : ''}`} data-testid={`rule-card-${rule.id}`}>
      <CardContent className="py-3 px-3 sm:px-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 hidden sm:block" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="default" className="text-xs">
                → {rule.targetLabel}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                P: {rule.priority}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {conditionParts.length > 0 ? (
                conditionParts.map((part, i) => (
                  <Badge key={i} variant="secondary" className="text-[11px] font-normal">
                    {part}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground italic">Nessuna condizione (cattura tutto)</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Switch
              checked={rule.enabled}
              onCheckedChange={onToggle}
              data-testid={`switch-rule-${rule.id}`}
            />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} data-testid={`btn-edit-rule-${rule.id}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete} data-testid={`btn-delete-rule-${rule.id}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleEditDialog({
  rule,
  onSave,
  onCancel,
}: {
  rule: BiSuiteMappingRule;
  onSave: (rule: BiSuiteMappingRule) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BiSuiteMappingRule>({ ...rule, conditions: { ...rule.conditions } });

  const targets = PISTA_TARGETS[draft.pista] || [];

  const updateCondition = (key: keyof BiSuiteMappingCondition, value: string) => {
    setDraft((prev) => ({
      ...prev,
      conditions: { ...prev.conditions, [key]: value || undefined },
    }));
  };

  const setTarget = (value: string) => {
    const target = targets.find((t) => t.value === value);
    setDraft((prev) => ({
      ...prev,
      targetCategory: value,
      targetLabel: target?.label || value,
    }));
  };

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifica Regola — {PISTA_LABELS[draft.pista]}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Categoria Gara di Destinazione</Label>
            <Select value={draft.targetCategory} onValueChange={setTarget}>
              <SelectTrigger data-testid="select-target-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />
          <h4 className="text-sm font-medium">Condizioni di Corrispondenza</h4>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Categoria BiSuite</Label>
              <Input
                placeholder="es. MIA TIED"
                value={draft.conditions.categoriaBiSuite || ''}
                onChange={(e) => updateCondition('categoriaBiSuite', e.target.value)}
                data-testid="input-categoria-bisuite"
              />
            </div>
            <div>
              <Label className="text-xs">Tipologia BiSuite</Label>
              <Input
                placeholder="es. MIA EASYPAY STANDARD"
                value={draft.conditions.tipologiaBiSuite || ''}
                onChange={(e) => updateCondition('tipologiaBiSuite', e.target.value)}
                data-testid="input-tipologia-bisuite"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Descrizione (contiene)</Label>
              <Input
                placeholder="es. LUCE - BOLLETTINO POSTALE"
                value={draft.conditions.descrizioneBiSuite || ''}
                onChange={(e) => updateCondition('descrizioneBiSuite', e.target.value)}
                data-testid="input-descrizione-bisuite"
              />
            </div>
            <div>
              <Label className="text-xs">Descrizione (escludi, separare con virgola)</Label>
              <Input
                placeholder="es. MIGRAZIONE,ACEA"
                value={draft.conditions.descrizioneEscludi || ''}
                onChange={(e) => updateCondition('descrizioneEscludi', e.target.value)}
                data-testid="input-descrizione-escludi"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Tipo Cliente</Label>
            <Select
              value={draft.conditions.clienteTipo || '_any_'}
              onValueChange={(v) => updateCondition('clienteTipo', v === '_any_' ? '' : v)}
            >
              <SelectTrigger data-testid="select-cliente-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_any_">Qualsiasi</SelectItem>
                <SelectItem value="FISICA">FISICA (Persona Fisica)</SelectItem>
                <SelectItem value="PROFESSIONISTA">PROFESSIONISTA</SelectItem>
                <SelectItem value="GIURIDICA">GIURIDICA (Azienda)</SelectItem>
                <SelectItem value="ESTERO">ESTERO</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />
          <h4 className="text-sm font-medium">Condizione su Domande/Risposte (opzionale)</h4>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Testo Domanda (contiene)</Label>
              <Input
                placeholder="es. Tipologia Offerta"
                value={draft.conditions.domandaTesto || ''}
                onChange={(e) => updateCondition('domandaTesto', e.target.value)}
                data-testid="input-domanda-testo"
              />
            </div>
            <div>
              <Label className="text-xs">Risposta (contiene)</Label>
              <Input
                placeholder="es. TIED"
                value={draft.conditions.rispostaContiene || ''}
                onChange={(e) => updateCondition('rispostaContiene', e.target.value)}
                data-testid="input-risposta-contiene"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Priorità (più alto = valutato prima)</Label>
            <Input
              type="number"
              value={draft.priority}
              onChange={(e) => setDraft((prev) => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
              className="w-24"
              data-testid="input-priority"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Annulla</Button>
          <Button onClick={() => onSave(draft)} data-testid="btn-save-rule">Salva Regola</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
