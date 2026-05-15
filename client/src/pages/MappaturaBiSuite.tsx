import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { apiUrl } from '@/lib/basePath';
import { queryClient } from '@/lib/queryClient';
import { Info } from 'lucide-react';
import { DataTableSkeleton } from '@/components/skeletons';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  getEffectiveRulesForEditor,
  buildDefaultsByEditorKey,
  findDefaultForEditor,
  diffSavedRuleAgainstDefault,
  type RuleDefaultDiffEntry,
} from '@shared/bisuiteMapping';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const PISTA_ICONS: Record<GaraPista, React.ReactNode> = {
  mobile: <Smartphone className="h-4 w-4" />,
  fisso: <Wifi className="h-4 w-4" />,
  energia: <Zap className="h-4 w-4" />,
  assicurazioni: <Shield className="h-4 w-4" />,
  protecta: <Award className="h-4 w-4" />,
  partnership: <Users className="h-4 w-4" />,
  cb: <Users className="h-4 w-4" />,
};

const ALL_PISTE: GaraPista[] = ['mobile', 'fisso', 'energia', 'assicurazioni', 'protecta', 'partnership', 'cb'];

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

interface DivergentEntry {
  rule: BiSuiteMappingRule;
  def: BiSuiteMappingRule;
  diff: RuleDefaultDiffEntry[];
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
  const [serverEffectiveRules, setServerEffectiveRules] = useState<BiSuiteMappingRule[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('mobile');
  const [editingRule, setEditingRule] = useState<BiSuiteMappingRule | null>(null);
  const [editingFromNonMappati, setEditingFromNonMappati] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [bulkAlignScope, setBulkAlignScope] = useState<'all' | 'tab' | null>(null);

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
      if (data && Array.isArray(data.effectiveRules)) {
        setServerEffectiveRules(data.effectiveRules as BiSuiteMappingRule[]);
      } else {
        setServerEffectiveRules(null);
      }
      if (data && data.rules) {
        setRules(data.rules);
      } else {
        setRules(getDefaultMappingRules());
        setHasChanges(true);
      }
    } catch (err) {
      console.error('Error loading mapping:', err);
      setServerEffectiveRules(null);
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
      // Refresh effective rules from the saved snapshot so the editor stays
      // in sync with the runtime engine immediately (no page reload needed).
      const responseBody = await res.json().catch(() => null);
      const savedMapping = responseBody?.mapping as
        | { rules?: BiSuiteMappingRule[]; effectiveRules?: BiSuiteMappingRule[] }
        | undefined;
      const nextSavedRules = Array.isArray(savedMapping?.rules)
        ? (savedMapping!.rules as BiSuiteMappingRule[])
        : rules;
      const nextEffective = Array.isArray(savedMapping?.effectiveRules)
        ? (savedMapping!.effectiveRules as BiSuiteMappingRule[])
        : getEffectiveRulesForEditor(nextSavedRules);
      setRules(nextSavedRules);
      setServerEffectiveRules(nextEffective);
      setHasChanges(false);
      // Invalida le cache delle vendite mappate così la Dashboard Gara Reale
      // (e gli altri consumer) ricarica i dati con le nuove regole alla
      // prossima visualizzazione, senza bisogno di rilanciare "Importa BiSuite".
      queryClient.invalidateQueries({ queryKey: ['/api/admin/bisuite-mapped-sales'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/bisuite-articles-summary'] });
      // Forza il refetch del marker di versione: tutti i consumer che lo
      // includono nella loro queryKey (es. Dashboard Gara Reale) rifetchano
      // automaticamente non appena la versione cambia.
      queryClient.invalidateQueries({ queryKey: ['/api/bisuite-mapping-version'] });
      toast({
        title: 'Mappatura salvata',
        description: 'Le vendite verranno rimappate automaticamente alla prossima visualizzazione.',
      });
      if (isExtraTab) {
        loadArticlesSummary(summaryMonth, summaryYear);
      }
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

  const alignRuleToDefault = (ruleId: string, defaultRule: BiSuiteMappingRule) => {
    setRules((prev) =>
      prev.map((r) =>
        r.id === ruleId
          ? { ...defaultRule, id: r.id, conditions: { ...defaultRule.conditions } }
          : r,
      ),
    );
    setHasChanges(true);
    toast({
      title: 'Regola allineata',
      description: 'La regola è stata aggiornata con i valori di default. Ricordati di salvare.',
    });
  };

  const alignRulesBulk = (entries: DivergentEntry[]) => {
    if (entries.length === 0) return;
    const map = new Map(entries.map((e) => [e.rule.id, e.def]));
    setRules((prev) =>
      prev.map((r) => {
        const def = map.get(r.id);
        return def
          ? { ...def, id: r.id, conditions: { ...def.conditions } }
          : r;
      }),
    );
    setHasChanges(true);
    toast({
      title: 'Regole allineate',
      description: `${entries.length} ${entries.length === 1 ? 'regola è stata aggiornata' : 'regole sono state aggiornate'} ai valori di default. Ricordati di salvare.`,
    });
  };

  // Indicizza i default per editor key (looser di rulePrimaryKey: ignora
  // domanda/risposta) così il RuleCard può mostrare un badge "Default
  // aggiornato" con il diff dei campi (incl. priorità, esclusioni, soglie
  // numeriche, domanda e risposta) anche quando il default ha cambiato
  // proprio le condizioni di domanda/risposta. La risoluzione strict→
  // domanda→unico-candidato è in `findDefaultForEditor`.
  // Memoizzato: `getDefaultMappingRules()` incrementa un contatore interno
  // di id ad ogni chiamata, quindi non va ri-eseguito ad ogni render.
  const defaultsByEditorKey = useMemo(
    () => buildDefaultsByEditorKey(getDefaultMappingRules()),
    [],
  );

  // Calcola le regole salvate (non sintetiche) che divergono dal default
  // canonico corrente, raggruppate per pista. Usato per il pannello "Allinea
  // in blocco" in cima alla pagina e per i bottoni per-tab. Le sintetiche e
  // le "Personalizzate" (senza match nei default) sono escluse, in linea
  // col badge per-regola.
  const divergentByPista = useMemo(() => {
    const result: Record<GaraPista, DivergentEntry[]> = {
      mobile: [],
      fisso: [],
      energia: [],
      assicurazioni: [],
      protecta: [],
      partnership: [],
      cb: [],
    };
    for (const r of rules) {
      if (r.synthetic) continue;
      const def = findDefaultForEditor(r, defaultsByEditorKey);
      if (!def) continue;
      const diff = diffSavedRuleAgainstDefault(r, def);
      if (diff.length === 0) continue;
      if (result[r.pista]) result[r.pista].push({ rule: r, def, diff });
    }
    return result;
  }, [rules, defaultsByEditorKey]);

  const allDivergent = useMemo<DivergentEntry[]>(
    () => ALL_PISTE.flatMap((p) => divergentByPista[p]),
    [divergentByPista],
  );
  const totalDivergent = allDivergent.length;
  const tabDivergent: DivergentEntry[] = isExtraTab
    ? []
    : divergentByPista[activePista] || [];

  const bulkAlignEntries: DivergentEntry[] =
    bulkAlignScope === 'all'
      ? allDivergent
      : bulkAlignScope === 'tab'
      ? tabDivergent
      : [];

  // displayRules = saved rules + synthesized partnership twins (read-only).
  // When the user has pending unsaved edits, recompute twins locally so the
  // partnership tab stays in sync with current CB rules. Otherwise use the
  // server-computed effectiveRules for parity with the runtime engine.
  const displayRules = hasChanges
    ? getEffectiveRulesForEditor(rules)
    : (serverEffectiveRules ?? getEffectiveRulesForEditor(rules));

  const pistaRules = isExtraTab ? [] : displayRules.filter((r) => r.pista === activePista);

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
          <CardContent className="pt-0">
            <div
              className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
              data-testid="note-auto-remap"
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Quando salvi le regole, le vendite BiSuite già importate vengono rimappate
                automaticamente alla prossima visualizzazione: non serve rilanciare
                "Importa BiSuite".
              </span>
            </div>
          </CardContent>
        </Card>

        {!loading && totalDivergent > 0 && (
          <Card
            className="mb-6 border-orange-300 bg-orange-50/50 dark:bg-orange-950/10"
            data-testid="card-bulk-align"
          >
            <CardContent className="py-3 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <RotateCcw className="h-4 w-4 mt-0.5 text-orange-600" />
                <div className="text-sm">
                  <span
                    className="font-medium text-orange-900 dark:text-orange-200"
                    data-testid="text-divergent-count"
                  >
                    {totalDivergent} {totalDivergent === 1 ? 'regola diverge' : 'regole divergono'} dai default
                  </span>
                  {!isExtraTab && tabDivergent.length > 0 && (
                    <span className="text-orange-700 dark:text-orange-300 ml-1">
                      ({tabDivergent.length} in {PISTA_LABELS[activePista]})
                    </span>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Allinea le regole salvate ai valori del default canonico aggiornato.
                    Le sintetiche e le "Personalizzate" sono escluse.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {!isExtraTab && tabDivergent.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-orange-300 text-orange-700 hover:bg-orange-100 hover:text-orange-800"
                    onClick={() => setBulkAlignScope('tab')}
                    data-testid="btn-bulk-align-tab"
                  >
                    Allinea solo {PISTA_LABELS[activePista]} ({tabDivergent.length})
                  </Button>
                )}
                <Button
                  size="sm"
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                  onClick={() => setBulkAlignScope('all')}
                  data-testid="btn-bulk-align-all"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Allinea tutte ({totalDivergent})
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <DataTableSkeleton rows={8} columns={5} className="py-6" />
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="grid w-max sm:w-full grid-cols-9 mb-6">
              {ALL_PISTE.map((pista) => {
                const count = displayRules.filter((r) => r.pista === pista).length;
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
                {articlesSummary && articlesSummary.nonMappati.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">
                    {articlesSummary.nonMappati.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            </div>

            {ALL_PISTE.map((pista) => {
              const pistaList = displayRules.filter((r) => r.pista === pista);
              const syntheticCount = pistaList.filter((r) => r.synthetic).length;
              return (
              <TabsContent key={pista} value={pista}>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {pistaList.length} regole per {PISTA_LABELS[pista]}
                      {syntheticCount > 0 && (
                        <span className="ml-1 text-xs">
                          ({syntheticCount} auto-generate da CB)
                        </span>
                      )}
                    </h3>
                    <Button size="sm" onClick={() => addRule(pista)} data-testid={`btn-add-rule-${pista}`}>
                      <Plus className="h-4 w-4 mr-2" />
                      Aggiungi Regola
                    </Button>
                  </div>

                  {pistaList.length === 0 ? (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        Nessuna regola configurata per {PISTA_LABELS[pista]}.
                        Clicca "Aggiungi Regola" per iniziare.
                      </CardContent>
                    </Card>
                  ) : (
                    pistaList
                      .slice()
                      .sort((a, b) => b.priority - a.priority)
                      .map((rule) => {
                        const def = rule.synthetic ? undefined : findDefaultForEditor(rule, defaultsByEditorKey);
                        const diff = def ? diffSavedRuleAgainstDefault(rule, def) : [];
                        return (
                          <RuleCard
                            key={rule.id}
                            rule={rule}
                            defaultRule={def}
                            diff={diff}
                            onEdit={() => setEditingRule(rule)}
                            onDelete={() => deleteRule(rule.id)}
                            onToggle={() => toggleRule(rule.id)}
                            onAlignToDefault={
                              def && diff.length > 0
                                ? () => alignRuleToDefault(rule.id, def)
                                : undefined
                            }
                          />
                        );
                      })
                  )}
                </div>
              </TabsContent>
              );
            })}

            {(['prodotti', 'servizi', 'non_mappati'] as ExtraTab[]).map((tab) => (
              <TabsContent key={tab} value={tab}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="text-base font-semibold">
                        {tab === 'prodotti' ? 'Prodotti' : tab === 'servizi' ? 'Servizi' : 'Articoli Non Mappati'}
                      </h3>
                      {tab === 'non_mappati' && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Articoli venduti che non corrispondono a nessuna regola. Crea una regola per mapparli nella pista corretta, salva e verranno spostati.
                        </p>
                      )}
                    </div>
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
                      showImporto={false}
                      showClienteTipo={tab === 'non_mappati'}
                      onCreateRule={tab === 'non_mappati' ? (item) => {
                        const newRule = createEmptyRule('mobile');
                        newRule.conditions = {
                          categoriaBiSuite: item.categoria,
                          tipologiaBiSuite: item.tipologia || undefined,
                          descrizioneBiSuite: item.descrizione || undefined,
                          clienteTipo: item.clienteTipo || undefined,
                        };
                        setEditingFromNonMappati(true);
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
          allowPistaChange={editingFromNonMappati}
          onSave={(updated) => {
            updateRule(updated);
            setEditingRule(null);
            setEditingFromNonMappati(false);
          }}
          onCancel={() => {
            setEditingRule(null);
            setEditingFromNonMappati(false);
          }}
        />
      )}

      <AlertDialog
        open={bulkAlignScope !== null}
        onOpenChange={(open) => {
          if (!open) setBulkAlignScope(null);
        }}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Allineare {bulkAlignEntries.length}{' '}
              {bulkAlignEntries.length === 1 ? 'regola' : 'regole'} ai default?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAlignScope === 'all'
                ? 'Tutte le regole salvate divergenti dai default canonici verranno sovrascritte.'
                : `Solo le regole della pista ${PISTA_LABELS[activePista]} verranno sovrascritte.`}{' '}
              Le regole sintetiche e quelle "Personalizzate" sono escluse. Le modifiche
              non verranno applicate finché non clicchi Salva.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {bulkAlignEntries.length > 0 && (
            <ScrollArea className="max-h-72 rounded-md border bg-muted/20 p-2">
              <div className="space-y-2">
                {bulkAlignEntries.map(({ rule, diff }) => (
                  <div
                    key={rule.id}
                    className="text-xs rounded border bg-background px-2 py-1.5"
                    data-testid={`bulk-align-row-${rule.id}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant="outline" className="text-[10px]">
                        {PISTA_LABELS[rule.pista]}
                      </Badge>
                      <Badge variant="default" className="text-[10px]">
                        → {rule.targetLabel}
                      </Badge>
                      <span className="text-muted-foreground">
                        {[
                          rule.conditions.categoriaBiSuite &&
                            `Cat: ${rule.conditions.categoriaBiSuite}`,
                          rule.conditions.tipologiaBiSuite &&
                            `Tip: ${rule.conditions.tipologiaBiSuite}`,
                          rule.conditions.descrizioneBiSuite &&
                            `Desc: "${rule.conditions.descrizioneBiSuite}"`,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '(nessuna condizione)'}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Campi sovrascritti:{' '}
                      <span className="text-orange-700 dark:text-orange-300 font-medium">
                        {diff.map((d) => d.label).join(', ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-bulk-align-cancel">
              Annulla
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                alignRulesBulk(bulkAlignEntries);
                setBulkAlignScope(null);
              }}
              data-testid="btn-bulk-align-confirm"
            >
              Allinea {bulkAlignEntries.length}{' '}
              {bulkAlignEntries.length === 1 ? 'regola' : 'regole'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
          {onCreateRule
            ? 'Tutti gli articoli sono mappati correttamente!'
            : 'Nessun articolo trovato per il periodo selezionato.'}
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
  defaultRule,
  diff,
  onEdit,
  onDelete,
  onToggle,
  onAlignToDefault,
}: {
  rule: BiSuiteMappingRule;
  defaultRule?: BiSuiteMappingRule;
  diff: RuleDefaultDiffEntry[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onAlignToDefault?: () => void;
}) {
  const cond = rule.conditions;
  const conditionParts: string[] = [];
  if (cond.categoriaBiSuite) conditionParts.push(`Cat: ${cond.categoriaBiSuite}`);
  if (cond.tipologiaBiSuite) conditionParts.push(`Tip: ${cond.tipologiaBiSuite}`);
  if (cond.descrizioneBiSuite) conditionParts.push(`Desc: "${cond.descrizioneBiSuite}"`);
  if (cond.descrizioneEscludi) conditionParts.push(`Escludi: "${cond.descrizioneEscludi}"`);
  if (cond.clienteTipo) conditionParts.push(`Cliente: ${cond.clienteTipo}`);
  if (cond.domandaTesto) {
    if (cond.rispostaDiversaDa) {
      conditionParts.push(`D: "${cond.domandaTesto}" ≠ "${cond.rispostaDiversaDa}"`);
    } else {
      conditionParts.push(`D: "${cond.domandaTesto}" → "${cond.rispostaContiene || ''}"`);
    }
  }

  const isSynthetic = !!rule.synthetic;
  const hasDefaultDiff = !isSynthetic && diff.length > 0;
  const isCustomRule = !isSynthetic && !defaultRule;

  return (
    <Card
      className={`transition-opacity ${!rule.enabled ? 'opacity-50' : ''} ${isSynthetic ? 'border-dashed bg-muted/20' : ''} ${hasDefaultDiff ? 'border-orange-300 bg-orange-50/30 dark:bg-orange-950/10' : ''}`}
      data-testid={`rule-card-${rule.id}`}
    >
      <CardContent className="py-3 px-3 sm:px-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 hidden sm:block" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="default" className="text-xs">
                → {rule.targetLabel}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                P: {rule.priority}
              </Badge>
              {isSynthetic && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-amber-400 text-amber-700 bg-amber-50"
                  title="Regola sintetizzata automaticamente dalla regola CB equivalente. Non modificabile: edita la regola CB per cambiarla."
                  data-testid={`badge-synthetic-${rule.id}`}
                >
                  Auto-generata da CB
                </Badge>
              )}
              {isCustomRule && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-slate-300 text-slate-600 bg-slate-50 dark:bg-slate-900 dark:text-slate-300"
                  title="Regola personalizzata: nessuna controparte nei default canonici."
                  data-testid={`badge-custom-${rule.id}`}
                >
                  Personalizzata
                </Badge>
              )}
              {hasDefaultDiff && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-orange-400 text-orange-700 bg-orange-50 cursor-help"
                        data-testid={`badge-default-diff-${rule.id}`}
                      >
                        Default aggiornato ({diff.length})
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm">
                      <div className="text-xs space-y-1">
                        <div className="font-medium mb-1">
                          La regola differisce dal default corrente:
                        </div>
                        {diff.map((d) => (
                          <div key={d.field} className="grid grid-cols-[auto_1fr] gap-x-2">
                            <span className="font-medium">{d.label}:</span>
                            <span>
                              <span className="text-orange-700 dark:text-orange-300">tua</span> "{d.saved}" →{' '}
                              <span className="text-emerald-700 dark:text-emerald-300">default</span> "{d.defaultValue}"
                            </span>
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
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
            {hasDefaultDiff && onAlignToDefault && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-orange-300 text-orange-700 hover:bg-orange-100 hover:text-orange-800"
                onClick={onAlignToDefault}
                title="Sostituisce questa regola con i valori del default corrente."
                data-testid={`btn-align-default-${rule.id}`}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Allinea ai default
              </Button>
            )}
            <Switch
              checked={rule.enabled}
              onCheckedChange={onToggle}
              disabled={isSynthetic}
              data-testid={`switch-rule-${rule.id}`}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onEdit}
              disabled={isSynthetic}
              data-testid={`btn-edit-rule-${rule.id}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={isSynthetic}
              data-testid={`btn-delete-rule-${rule.id}`}
            >
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
  allowPistaChange,
}: {
  rule: BiSuiteMappingRule;
  onSave: (rule: BiSuiteMappingRule) => void;
  onCancel: () => void;
  allowPistaChange?: boolean;
}) {
  const [draft, setDraft] = useState<BiSuiteMappingRule>({ ...rule, conditions: { ...rule.conditions } });

  const targets = PISTA_TARGETS[draft.pista] || [];

  const updateCondition = (key: keyof BiSuiteMappingCondition, value: string) => {
    setDraft((prev) => ({
      ...prev,
      conditions: { ...prev.conditions, [key]: value || undefined },
    }));
  };

  const setPista = (pista: GaraPista) => {
    const newTargets = PISTA_TARGETS[pista] || [];
    setDraft((prev) => ({
      ...prev,
      pista,
      targetCategory: newTargets[0]?.value || '',
      targetLabel: newTargets[0]?.label || '',
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
          {allowPistaChange && (
            <div>
              <Label>Pista di Destinazione</Label>
              <Select value={draft.pista} onValueChange={(v) => setPista(v as GaraPista)}>
                <SelectTrigger data-testid="select-pista">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_PISTE.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PISTA_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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

          <div className={`grid ${draft.conditions.domandaTesto ? 'grid-cols-3' : 'grid-cols-1'} gap-3`}>
            <div>
              <Label className="text-xs">Testo Domanda (contiene)</Label>
              <Input
                placeholder="es. Tipologia Offerta"
                value={draft.conditions.domandaTesto || ''}
                onChange={(e) => updateCondition('domandaTesto', e.target.value)}
                data-testid="input-domanda-testo"
              />
            </div>
            {draft.conditions.domandaTesto && (
              <>
                <div>
                  <Label className="text-xs">Risposta (contiene)</Label>
                  <Input
                    placeholder="es. TIED"
                    value={draft.conditions.rispostaContiene || ''}
                    onChange={(e) => {
                      updateCondition('rispostaContiene', e.target.value);
                      if (e.target.value) updateCondition('rispostaDiversaDa', '');
                    }}
                    disabled={!!draft.conditions.rispostaDiversaDa}
                    data-testid="input-risposta-contiene"
                  />
                </div>
                <div>
                  <Label className="text-xs">Risposta (diversa da)</Label>
                  <Input
                    placeholder="es. NO"
                    value={draft.conditions.rispostaDiversaDa || ''}
                    onChange={(e) => {
                      updateCondition('rispostaDiversaDa', e.target.value);
                      if (e.target.value) updateCondition('rispostaContiene', '');
                    }}
                    disabled={!!draft.conditions.rispostaContiene}
                    data-testid="input-risposta-diversa-da"
                  />
                </div>
              </>
            )}
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
