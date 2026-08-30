import { useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { apiUrl } from "@/lib/basePath";
import { useLocation } from "wouter";
import * as XLSX from "xlsx";
import { KpiCardsSkeleton, DataTableSkeleton } from "@/components/skeletons";
import {
  computeIncassoTotals,
  saleUsesPaymentMethod,
  INCASSO_ITEMS_CONFIG,
  type IncassoTotals,
} from "@/lib/incassoUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShoppingCart,
  Store,
  Search,
  Filter,
  Package,
  Headphones,
  User,
  Calendar,
  ChevronRight,
  Euro,
  TrendingUp,
  Loader2,
  BarChart3,
  Smartphone,
  Wifi,
  Users,
  Shield,
  Lock,
  Zap,
  Tag,
  Wrench,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  Banknote,
  CreditCard,
  Landmark,
  FileText,
  Wallet,
  Download,
  CalendarRange,
  Filter as FilterIcon,
  Layers,
  Route,
  Flame,
  Briefcase,
} from "lucide-react";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { AppNavbar } from "@/components/AppNavbar";
import {
  type ArticleType,
  type PistaCanvass,
  type SaleClassification,
  classifySaleArticles,
  classifyArticle,
  isPezzoIva,
  PISTA_CANVASS_LABELS,
  getPistaCanvassLabels,
  PISTA_CANVASS_COLORS,
  venditePisteForModel,
  trendPisteForModel,
  trendExtraForModel,
  pezziExtraColKeysForModel,
  TYPE_LABELS,
  TYPE_COLORS,
} from "@/lib/bisuiteClassification";
import { TabellaPdvPistaPezzi } from "@/components/TabellaPdvPistaPezzi";
import { GraficoAndamentoPezzi, type PezziTrendPoint } from "@/components/GraficoAndamentoPezzi";
import { buildCanvassIndex, type CanvassOffer } from "@shared/canvassMapping";
import { accumulaPezziExtra, emptyPezziExtra, type PezziExtraCounters } from "@shared/pdvPezziExtra";
import {
  resolveSalePdvForView,
  resolveSaleRagioneSocialeForView,
  extractPdvOrigine,
  extractPdvDestinazione,
  SENZA_DESTINAZIONE_POS,
  type PdvView,
  type PdvViewDirectory,
} from "@shared/pdvView";
import type { CanvassKpiRule } from "@shared/canvassKpiRules";

interface BisuiteSale {
  id: string;
  organizationId: string;
  bisuiteId: number;
  dataVendita: string | null;
  codicePos: string | null;
  nomeNegozio: string | null;
  ragioneSociale: string | null;
  nomeAddetto: string | null;
  nomeCliente: string | null;
  totale: string | null;
  stato: string | null;
  categorieArticoli: string | null;
  rawData: any;
  fetchedAt: string | null;
}

/** Chiave PDV coerente per filtri, KPI, riepiloghi ed export.
 * BiSuite può lasciare codicePos vuoto pur fornendo nomeNegozio. */
function salePdvKey(sale: Pick<BisuiteSale, "codicePos" | "nomeNegozio">): string {
  return sale.codicePos?.trim() || sale.nomeNegozio?.trim() || "N/D";
}

/** Phone&Phone: i banchetti temporanei non fanno parte dei PDV del report. */
function isPhonePhoneBanchetto(sale: Pick<BisuiteSale, "ragioneSociale" | "nomeNegozio">): boolean {
  const rs = (sale.ragioneSociale ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return rs.startsWith("phonephone") && /\bbanchett[oi]\b/i.test(sale.nomeNegozio ?? "");
}

interface ArticleIncasso {
  scontrinato: number;
  fuoriScontrino: number;
  finanziato: number;
  credito: number;
}

interface PdvSummary {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  totaleVendite: number;
  totaleImporto: number;
  countByType: Record<ArticleType, number>;
  amountByType: Record<ArticleType, number>;
  /** Importo lordo degli articoli categoria ACCESSORI (per scorporo IVA a display). */
  accessoriImporto: number;
  countByPista: Partial<Record<PistaCanvass, number>>;
  amountByPista: Partial<Record<PistaCanvass, number>>;
  /** Pezzi IVA (business) per pista — vedi isPezzoIva in shared. */
  ivaByPista: Partial<Record<PistaCanvass, number>>;
  /** Dettaglio categorie canvass vendute, per pista: nome → pezzi/IVA. */
  categorieByPista: CategorieByPista;
  /** Task #398 — contatori extra per la Tabella PDV × Pista (Pezzi):
   * IVA, CB (solo cambi piano), Telefoni, € Accessori/Servizi netto IVA. */
  pezziExtra: PezziExtraCounters;
  vendite: BisuiteSale[];
  articleIncasso: ArticleIncasso;
}

/** pista → (nome categoria → { pezzi, iva }) */
type CategorieByPista = Partial<Record<PistaCanvass, Record<string, { pezzi: number; iva: number }>>>;
type SalesSummaryCategory = "canvass" | "servizi" | "accessori" | "prodotti";
const PISTA_ICONS: Record<PistaCanvass, React.ReactNode> = {
  mobile: <Smartphone className="h-3.5 w-3.5" />,
  fisso: <Wifi className="h-3.5 w-3.5" />,
  cb: <Users className="h-3.5 w-3.5" />,
  iva: <Landmark className="h-3.5 w-3.5" />,
  assicurazioni: <Shield className="h-3.5 w-3.5" />,
  protecta: <Lock className="h-3.5 w-3.5" />,
  energia: <Zap className="h-3.5 w-3.5" />,
  // Piste Vodafone/Fastweb (Task #527).
  luce: <Zap className="h-3.5 w-3.5" />,
  gas: <Flame className="h-3.5 w-3.5" />,
  iva_mobile: <Smartphone className="h-3.5 w-3.5" />,
  iva_wireline: <Wifi className="h-3.5 w-3.5" />,
  vas: <Briefcase className="h-3.5 w-3.5" />,
};

const INCASSO_ICON_MAP: Record<string, React.ReactNode> = {
  banknote: <Banknote className="h-3.5 w-3.5" />,
  creditcard: <CreditCard className="h-3.5 w-3.5" />,
  landmark: <Landmark className="h-3.5 w-3.5" />,
  filetext: <FileText className="h-3.5 w-3.5" />,
  wallet: <Wallet className="h-3.5 w-3.5" />,
  tag: <Tag className="h-3.5 w-3.5" />,
};

function IncassoBadges({ totals, formatter, compact, activeKey, onSelect }: { totals: IncassoTotals; formatter: (v: number) => string; compact?: boolean; activeKey?: keyof IncassoTotals | null; onSelect?: (key: keyof IncassoTotals) => void }) {
  const active = INCASSO_ITEMS_CONFIG.filter(i => totals[i.key] > 0);
  if (active.length === 0) return null;
  const clickable = !!onSelect;
  return (
    <div className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2 sm:gap-3"}`}>
      {active.map(item => {
        const isActive = activeKey === item.key;
        const baseCls = `flex items-center gap-1 ${compact ? "bg-muted/40 rounded px-1.5 py-0.5" : "bg-muted/50 rounded-lg px-2.5 py-1.5"}`;
        const interactiveCls = clickable
          ? `cursor-pointer transition-all ${isActive ? "ring-2 ring-primary bg-primary/10" : "hover:ring-1 hover:ring-primary/40"}`
          : "";
        const content = (
          <>
            <span className={item.color}>{INCASSO_ICON_MAP[item.icon]}</span>
            <span className={`${compact ? "text-xs" : "text-sm"} text-muted-foreground`}>{item.label}</span>
            <span className={`${compact ? "text-sm" : "text-base"} font-bold tabular-nums ${item.color}`}>{formatter(totals[item.key])}</span>
          </>
        );
        if (clickable) {
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect!(item.key)}
              className={`${baseCls} ${interactiveCls}`}
              aria-pressed={isActive}
              title={isActive ? `Rimuovi filtro ${item.label}` : `Filtra le vendite con ${item.label}`}
              data-testid={`incasso-${item.key}`}
            >
              {content}
            </button>
          );
        }
        return (
          <div key={item.key} className={baseCls} data-testid={`incasso-${item.key}`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function ArticleIncassoRecap({
  incasso,
  formatCurrency,
}: {
  incasso: { scontrinato: number; fuoriScontrino: number; finanziato: number; credito: number };
  formatCurrency: (v: number | string) => string;
}) {
  const items: { key: string; label: string; value: number; cls: string }[] = [
    { key: "scontrinato", label: "Scontrinato", value: incasso.scontrinato, cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" },
    { key: "fuoriScontrino", label: "Fuori scont.", value: incasso.fuoriScontrino, cls: "bg-rose-500/10 text-rose-700 border-rose-500/20" },
    { key: "finanziato", label: "Finanziato", value: incasso.finanziato, cls: "bg-purple-500/10 text-purple-700 border-purple-500/20" },
    { key: "credito", label: "Credito/VAR", value: incasso.credito, cls: "bg-amber-500/10 text-amber-700 border-amber-500/20" },
  ].filter(i => i.value > 0);
  if (items.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t flex flex-wrap gap-1">
      {items.map(i => (
        <Badge key={i.key} variant="outline" className={`${i.cls} text-xs sm:text-sm font-normal py-1`} data-testid={`recap-${i.key}`}>
          <span className="opacity-75 mr-1">{i.label}</span>
          <span className="font-semibold">{formatCurrency(i.value)}</span>
        </Badge>
      ))}
    </div>
  );
}

/**
 * Riga riepilogativa a colonne fisse: su smartphone le metriche restano
 * affiancate all'etichetta, anche quando cambiano numero di cifre o scala
 * del font del browser. Tutte le card di sintesi la riusano per evitare
 * regressioni di allineamento fra categorie.
 */
function SummaryMetricRow({
  label,
  amount,
  count,
  countClassName = "",
  extra,
  reserveExtraSpace = false,
  testId,
  countTestId,
}: {
  label: ReactNode;
  amount?: ReactNode;
  count: ReactNode;
  countClassName?: string;
  extra?: ReactNode;
  reserveExtraSpace?: boolean;
  testId?: string;
  countTestId?: string;
}) {
  return (
    <div
      className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 text-sm leading-5"
      data-testid={testId}
    >
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-x-2 whitespace-nowrap tabular-nums">
        {amount}
        {extra ? (
          <span className="min-w-[5.5rem] text-right text-xs font-semibold leading-5 text-indigo-600 dark:text-indigo-400">
            {extra}
          </span>
        ) : reserveExtraSpace ? (
          <span className="min-w-[5.5rem]" aria-hidden="true" />
        ) : null}
      </div>
      <Badge
        variant="outline"
        className={`min-w-10 justify-center px-2 py-1 text-sm font-bold leading-5 tabular-nums ${countClassName}`}
        data-testid={countTestId}
      >
        {count}
      </Badge>
    </div>
  );
}

/** Aliquota IVA ordinaria: Accessori (cat. ACCESSORI) e tutti i Servizi
 *  vengono mostrati al netto per coerenza con il report Telegram. */
const IVA_RATE = 1.22;
const nettoIva = (v: number) => v / IVA_RATE;
const ivaOf = (lordo: number) => lordo - nettoIva(lordo);

function getDefaultDates() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  };
}

export default function VenditeBiSuite() {
  const { profile } = useAuth();
  const { scheme, resolvedTheme } = useTheme();
  const isMidnightViolet = scheme === "midnight-violet";
  const useDarkSalesContrast = resolvedTheme === "dark";
  const [, setLocation] = useLocation();
  const defaults = getDefaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const fromDateRef = useRef<HTMLInputElement>(null);
  const toDateRef = useRef<HTMLInputElement>(null);
  // Il controllo nativo del calendario è nascosto (hotspot disallineato al
  // centro del campo): il pulsante-icona a destra apre il picker sul vero input.
  const openDatePicker = useCallback((ref: React.RefObject<HTMLInputElement>) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    try {
      el.showPicker?.();
    } catch {
      // showPicker può fallire senza gesto utente: il focus resta comunque.
    }
  }, []);
  const [searchTerm, setSearchTerm] = useState("");
  // Task #463 — filtro PDV multiselezione: selezione vuota = tutti i PDV;
  // con una o più selezioni si includono le vendite di uno QUALSIASI dei
  // codici scelti. Le vendite senza codice sono raggruppate sotto "N/D".
  const [selectedPdvs, setSelectedPdvs] = useState<string[]>([]);
  const [selectedSale, setSelectedSale] = useState<BisuiteSale | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [summaryCategory, setSummaryCategory] = useState<SalesSummaryCategory>("canvass");
  const [filterPista, setFilterPista] = useState<string>("all");
  const [filterStato, setFilterStato] = useState<string>("finalizzate");
  const [filterPagamento, setFilterPagamento] = useState<keyof IncassoTotals | null>(null);
  const [viewMode, setViewMode] = useState<"vendite" | "addetti">("vendite");
  const [selectedAddetto, setSelectedAddetto] = useState<string | null>(null);
  // Task #462 — vista PDV: 'origine' (default, campi legacy della vendita)
  // oppure 'destinazione' (attribuzione al PDV di destinazione dal raw,
  // con bucket esplicito per le vendite che non ne hanno uno).
  const [pdvView, setPdvView] = useState<PdvView>("origine");

  const orgId = profile?.organizationId || "";
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const queryClient = useQueryClient();
  const [fetchResult, setFetchResult] = useState<{ success: boolean; partial?: boolean; message: string; failedMonths?: string[]; source?: "fetch" | "reconcile" } | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileFrom, setReconcileFrom] = useState(defaults.from);
  const [reconcileTo, setReconcileTo] = useState(defaults.to);

  const { data: credStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/bisuite-credentials-status"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/bisuite-credentials-status"), { credentials: "include" });
      if (!res.ok) return { configured: false };
      return res.json();
    },
    enabled: !!orgId,
  });

  const fetchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/bisuite-fetch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ start_date: fromDate, end_date: toDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore durante l'importazione");
      return data;
    },
    onSuccess: (data) => {
      const partial = !!data.partial;
      setFetchResult({
        success: true,
        partial,
        source: "fetch",
        message: data.message || `Importate ${data.count} vendite`,
        failedMonths: Array.isArray(data.failedMonths) ? data.failedMonths : [],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bisuite-sales"] });
      setTimeout(() => setFetchResult(null), partial ? 12000 : 5000);
    },
    onError: (error: Error) => {
      setFetchResult({ success: false, source: "fetch", message: error.message });
      setTimeout(() => setFetchResult(null), 8000);
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const res = await fetch(apiUrl("/api/admin/bisuite-reconcile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organization_id: orgId, from, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || "Errore durante l'allineamento");
      return data;
    },
    onSuccess: (data) => {
      const reconciled = data.reconciled;
      const partial = !reconciled;
      setReconcileOpen(false);
      setFetchResult({
        success: true,
        partial,
        source: "reconcile",
        message: data.message ||
          (reconciled
            ? `Allineamento BiSuite: ${data.totalFromApi} vendite sincronizzate, ${reconciled.deleted} obsolete eliminate`
            : `Allineamento BiSuite parziale: ${data.totalFromApi} vendite scaricate ma reconcile saltato per chunk falliti`),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bisuite-sales"] });
      setTimeout(() => setFetchResult(null), partial ? 12000 : 6000);
    },
    onError: (error: Error) => {
      setFetchResult({ success: false, source: "reconcile", message: `Allineamento BiSuite fallito: ${error.message}` });
      setTimeout(() => setFetchResult(null), 8000);
    },
  });

  const { data, isLoading } = useQuery<{ sales: BisuiteSale[]; count: number; pdvDirectory?: PdvViewDirectory }>({
    queryKey: ["/api/bisuite-sales", orgId, fromDate, toDate, "includeAnnullate", pdvView],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgId) params.set("organization_id", orgId);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      // La pagina vendite grezze deve mostrare anche le ANNULLATA con badge,
      // quindi disattiva il filtro server-side che le esclude di default.
      params.set("includeAnnullate", "true");
      if (pdvView !== "origine") params.set("pdvView", pdvView);
      const res = await fetch(apiUrl(`/api/bisuite-sales?${params.toString()}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Errore nel caricamento vendite");
      return res.json();
    },
    enabled: !!orgId,
  });

  // Task #317 — listino canvass Vodafone/Fastweb: se l'org ha il brand VF il
  // server restituisce le offerte del listino, usate per classificare gli
  // articoli come "canvass" (con pista dal listino) invece che "prodotti".
  // Per org WindTre/senza brand VF: offers vuoto → classificazione invariata.
  const { data: canvassRef } = useQuery<{ hasCanvassBrand: boolean; offers: CanvassOffer[]; kpiRules?: CanvassKpiRule[] }>({
    queryKey: ["/api/bisuite-canvass-reference", orgId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgId) params.set("organization_id", orgId);
      const res = await fetch(apiUrl(`/api/bisuite-canvass-reference?${params.toString()}`), {
        credentials: "include",
      });
      if (!res.ok) return { hasCanvassBrand: false, offers: [] };
      return res.json();
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  const canvassIndex = useMemo(() => {
    if (!canvassRef?.hasCanvassBrand || !canvassRef.offers?.length) return null;
    return buildCanvassIndex(canvassRef.offers);
  }, [canvassRef]);

  // Regole KPI per-org (solo org VF): associano categorie/tipologie/
  // descrizioni/domande alle piste del conteggio, o le escludono.
  const kpiRules = canvassIndex ? (canvassRef?.kpiRules ?? null) : null;

  // Per le org VF la pista "protecta" si chiama "Verisure" (lead Verisure,
  // non esiste "Windtre Protetti").
  // Task #534 — il modello brand deriva da hasCanvassBrand (l'API lo
  // restituisce anche con listino vuoto), NON dalla presenza di offerte:
  // un'org VF senza offerte caricate deve comunque vedere la tassonomia VF.
  const isVfModel = !!canvassRef?.hasCanvassBrand;
  const pistaLabels = getPistaCanvassLabels(isVfModel);
  // Tassonomia piste per modello brand, condivisa tra grafico Andamento KPI,
  // Tabella PDV × Pista (Pezzi) ed export: stesse piste, stesso ordine,
  // stessi totali in tutta la pagina.
  const venditePiste = useMemo(() => venditePisteForModel(isVfModel), [isVfModel]);
  const trendPiste = useMemo(() => trendPisteForModel(isVfModel), [isVfModel]);
  const trendExtras = useMemo(() => trendExtraForModel(isVfModel), [isVfModel]);
  const pezziExtraColKeys = useMemo(() => pezziExtraColKeysForModel(isVfModel), [isVfModel]);
  // Piste ammesse alla visualizzazione (filtro Pista, riepiloghi, badge):
  // per VF SOLO le piste del modello (niente energia/assicurazioni/protecta/
  // P.IVA generica); per WindTre comportamento storico (tutte le label).
  const vfPisteSet = useMemo(() => new Set<PistaCanvass>(venditePiste), [venditePiste]);
  const isPistaVisible = useCallback(
    (p: PistaCanvass) => (isVfModel ? vfPisteSet.has(p) : true),
    [isVfModel, vfPisteSet],
  );
  const visiblePistaKeys = useMemo(
    () => (isVfModel
      ? [...venditePiste]
      : (Object.keys(pistaLabels) as PistaCanvass[])),
    [isVfModel, venditePiste, pistaLabels],
  );

  // rawSales include anche le ANNULLATA (visibili nella tabella grezza con badge),
  // mentre `sales` viene usato per tutti i conteggi/aggregati e le esclude.
  const fetchedSales = data?.sales || [];
  const pdvDirectory = data?.pdvDirectory;
  // Task #462 — in vista Destinazione riscriviamo (solo in memoria) i campi
  // PDV della vendita con il PDV di destinazione risolto dal raw: tutti i
  // filtri/riepiloghi/export a valle riflettono così la vista scelta senza
  // toccare i dati memorizzati. In vista Origine l'array resta invariato.
  const rawSales = useMemo(() => {
    // Regola concordata per Phone&Phone: conserva tutti gli store e Back
    // Office, esclude soltanto i banchetti temporanei. Applicata a monte,
    // così KPI, tabella, riepiloghi ed export usano lo stesso perimetro.
    const sourceSales = fetchedSales.filter((s) => !isPhonePhoneBanchetto(s));
    if (pdvView === "origine") return sourceSales;
    return sourceSales.map((s) => {
      const r = resolveSalePdvForView(s, "destinazione");
      return {
        ...s,
        codicePos: r.codicePos,
        nomeNegozio: r.nomeNegozio,
        ragioneSociale: resolveSaleRagioneSocialeForView(s, "destinazione", pdvDirectory) || null,
      };
    });
  }, [fetchedSales, pdvView, pdvDirectory]);
  const sales = useMemo(
    () => rawSales.filter(s => (s.stato || "").trim().toUpperCase() !== "ANNULLATA"),
    [rawSales],
  );
  // N. vendite (non annullate) senza PDV destinazione nella vista corrente.
  const senzaDestinazioneCount = useMemo(
    () => (pdvView === "destinazione"
      ? sales.filter((s) => s.codicePos === SENZA_DESTINAZIONE_POS).length
      : 0),
    [sales, pdvView],
  );

  const saleClassifications = useMemo(() => {
    const map = new Map<string, SaleClassification>();
    rawSales.forEach((s) => {
      map.set(s.id, classifySaleArticles(s.rawData, canvassIndex, kpiRules));
    });
    return map;
  }, [rawSales, canvassIndex, kpiRules]);

  // Indica se almeno un filtro "componente" (Tipo / Pista) è attivo: in tal
  // caso gli aggregati di pezzi/importi devono essere calcolati a livello
  // articolo, non a livello vendita intera.
  const componentFilterActive = filterType !== "all" || filterPista !== "all";

  const articleMatchesFilter = useCallback(
    (art: { type: ArticleType; pista?: PistaCanvass }) => {
      if (filterType !== "all" && art.type !== filterType) return false;
      if (filterPista !== "all" && art.pista !== filterPista) return false;
      return true;
    },
    [filterType, filterPista],
  );

  // Vendite filtrate da TUTTI i filtri tranne il metodo di pagamento. Serve
  // come base per i badge "Modalità di Incasso", che devono restare tutti
  // visibili e cliccabili anche quando un metodo è selezionato (così l'utente
  // può cambiare scelta).
  const filteredSalesNoPay = useMemo(() => {
    // Tabella vendite grezze: parte da rawSales per mantenere visibili anche
    // le righe ANNULLATA (con il loro badge), che invece sono escluse dagli
    // aggregati calcolati su `sales`.
    let filtered = selectedPdvs.length > 0
      ? rawSales.filter((s) => selectedPdvs.includes(salePdvKey(s)))
      : rawSales;

    if (filterStato !== "all") {
      filtered = filtered.filter((s) => {
        const isAnnullata = (s.stato || "").trim().toUpperCase() === "ANNULLATA";
        return filterStato === "annullate" ? isAnnullata : !isAnnullata;
      });
    }

    if (filterType !== "all") {
      filtered = filtered.filter((s) => {
        const sc = saleClassifications.get(s.id);
        if (!sc) return false;
        return sc.countByType[filterType as ArticleType] > 0;
      });
    }

    if (filterPista !== "all") {
      filtered = filtered.filter((s) => {
        const sc = saleClassifications.get(s.id);
        if (!sc) return false;
        return (sc.countByPista[filterPista as PistaCanvass] || 0) > 0;
      });
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          (s.nomeCliente || "").toLowerCase().includes(term) ||
          (s.nomeAddetto || "").toLowerCase().includes(term) ||
          (s.codicePos || "").toLowerCase().includes(term) ||
          (s.nomeNegozio || "").toLowerCase().includes(term) ||
          (s.categorieArticoli || "").toLowerCase().includes(term) ||
          String(s.bisuiteId).includes(term)
      );
    }

    return filtered;
  }, [rawSales, selectedPdvs, filterStato, filterType, filterPista, searchTerm, saleClassifications]);

  // Task #463 — opzioni del filtro PDV: elenco stabile (codice + nome) dei
  // punti vendita presenti nella finestra caricata, nella vista corrente.
  // Se manca il codice POS, il nome negozio distingue comunque i PDV.
  const pdvOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of rawSales) {
      const code = salePdvKey(s);
      if (!map.has(code)) map.set(code, s.nomeNegozio || code);
    }
    return Array.from(map, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "it"));
  }, [rawSales]);

  const pdvLabelFor = useCallback(
    (code: string) => pdvOptions.find((o) => o.value === code)?.label || code,
    [pdvOptions],
  );

  // Vendite finali mostrate in tabella/aggregati: applica anche il filtro per
  // metodo di pagamento (cliccando un badge "Modalità di Incasso").
  const filteredSales = useMemo(() => {
    if (!filterPagamento) return filteredSalesNoPay;
    return filteredSalesNoPay.filter((s) => saleUsesPaymentMethod(s, filterPagamento));
  }, [filteredSalesNoPay, filterPagamento]);

  const handleSelectPagamento = useCallback((key: keyof IncassoTotals) => {
    setFilterPagamento((prev) => (prev === key ? null : key));
  }, []);

  // Vendite "in vista" (per gli aggregati): partono da `filteredSales`
  // (che già rispetta stato/tipo/pista/PDV/ricerca/pagamento) ma escludono
  // comunque le ANNULLATA dagli importi/incassi quando lo stato selezionato
  // non è proprio "annullate" — coerente con la card Importo storica.
  const aggregateSales = filteredSales;

  // Aggregati globali derivati dalle vendite filtrate. Quando è attivo un
  // filtro per Tipo/Pista, contiamo SOLO gli articoli che corrispondono al
  // filtro (livello componente). Altrimenti somma tutti gli articoli.
  const globalCounts = useMemo(() => {
    const byType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
    const amtByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
    const byPista: Partial<Record<PistaCanvass, number>> = {};
    const amtByPista: Partial<Record<PistaCanvass, number>> = {};
    const ivaByPista: Partial<Record<PistaCanvass, number>> = {};
    const couponCaring = { pezzi: 0, importo: 0 };
    let totalArticles = 0;
    let filteredArticles = 0;
    let filteredAmount = 0;
    const prodottiByCategory: Record<string, { pezzi: number; importo: number }> = {};
    const serviziByLabel: Record<string, { pezzi: number; importo: number }> = {};
    const emptyIncasso = () => ({ scontrinato: 0, fuoriScontrino: 0, finanziato: 0, credito: 0 });
    const addIncasso = (
      target: { scontrinato: number; fuoriScontrino: number; finanziato: number; credito: number },
      art: SaleClassification["articles"][number],
    ) => {
      if (art.scontrinato) target.scontrinato += art.importoScontrino > 0 ? art.importoScontrino : art.prezzo;
      else target.fuoriScontrino += art.importoScontrino > 0 ? art.importoScontrino : art.prezzo;
      target.finanziato += art.importoFinanziato;
      target.credito += art.importoCredito;
    };
    const incassoByType: Record<ArticleType, { scontrinato: number; fuoriScontrino: number; finanziato: number; credito: number }> = {
      canvass: emptyIncasso(),
      prodotti: emptyIncasso(),
      servizi: emptyIncasso(),
    };
    const incassoAccessori = emptyIncasso();
    const incassoProdotti = emptyIncasso();

    for (const sale of aggregateSales) {
      const sc = saleClassifications.get(sale.id);
      if (!sc) continue;
      totalArticles += sc.articles.length;

      for (const art of sc.articles) {
        const matches = articleMatchesFilter(art);
        if (matches) {
          filteredArticles++;
          filteredAmount += art.prezzo;
        }
        // Per le card Canvass/Prodotti/Servizi mostriamo solo i pezzi
        // coerenti col filtro attivo (se è "all", tutti).
        if (!matches) continue;
        byType[art.type]++;
        amtByType[art.type] += art.prezzo;
        addIncasso(incassoByType[art.type], art);
        if (art.pista) {
          byPista[art.pista] = (byPista[art.pista] || 0) + 1;
          amtByPista[art.pista] = (amtByPista[art.pista] || 0) + art.prezzo;
          if (isPezzoIva(art)) ivaByPista[art.pista] = (ivaByPista[art.pista] || 0) + 1;
        }
        // Coupon Caring: esclusi dai pezzi CB, contati in un riquadro dedicato.
        if (art.couponCaring) {
          couponCaring.pezzi++;
          couponCaring.importo += art.prezzo;
        }
        if (art.type === 'prodotti') {
          const key = (art.categoriaNome || 'SENZA CATEGORIA').toUpperCase();
          if (!prodottiByCategory[key]) prodottiByCategory[key] = { pezzi: 0, importo: 0 };
          prodottiByCategory[key].pezzi++;
          prodottiByCategory[key].importo += art.prezzo;
          addIncasso(key === 'ACCESSORI' ? incassoAccessori : incassoProdotti, art);
        }
        if (art.type === 'servizi' && art.descrizione) {
          if (!serviziByLabel[art.descrizione]) serviziByLabel[art.descrizione] = { pezzi: 0, importo: 0 };
          serviziByLabel[art.descrizione].pezzi++;
          serviziByLabel[art.descrizione].importo += art.prezzo;
        }
      }
    }

    // Lordo pre-scorporo: serve a mostrare il separato importo IVA in UI.
    const accessoriLordo = prodottiByCategory['ACCESSORI']?.importo ?? 0;
    const serviziLordo = amtByType.servizi;

    return {
      byType,
      amtByType,
      byPista,
      amtByPista,
      ivaByPista,
      couponCaring,
      totalArticles,
      filteredArticles,
      filteredAmount,
      prodottiByCategory,
      serviziByLabel,
      incassoByType,
      incassoAccessori,
      incassoProdotti,
      /** Fatturato lordo Accessori (categoria ACCESSORI), usato per calcolare IVA a display. */
      accessoriLordo,
      /** Fatturato lordo Servizi, usato per calcolare IVA a display. */
      serviziLordo,
    };
  }, [aggregateSales, saleClassifications, articleMatchesFilter]);

  // KPI top: numero "vendite/articoli" e importo. Quando un filtro Tipo/Pista
  // è attivo i numeri riflettono i SOLI articoli di quel tipo; altrimenti
  // restano i totali a livello vendita (sale.totale).
  const totaleImporto = useMemo(() => {
    if (componentFilterActive) return globalCounts.filteredAmount;
    return aggregateSales.reduce((sum, s) => sum + (parseFloat(s.totale || "0") || 0), 0);
  }, [aggregateSales, componentFilterActive, globalCounts.filteredAmount]);

  const venditeCount = componentFilterActive
    ? globalCounts.filteredArticles
    : aggregateSales.length;

  // Modalità di Incasso: gli incassi non si possono splittare per articolo,
  // quindi sono sempre "a livello vendita". Quando il filtro Tipo è attivo
  // restano comunque coerenti perché derivano dalle vendite filtrate
  // (cioè quelle che CONTENGONO almeno un articolo del tipo selezionato).
  // Calcolato sulle vendite SENZA il filtro per metodo di pagamento: così i
  // badge restano tutti visibili/cliccabili anche dopo aver selezionato un
  // metodo, permettendo all'utente di cambiare scelta o azzerare il filtro.
  const incassoTotals = useMemo(
    () => computeIncassoTotals(filteredSalesNoPay),
    [filteredSalesNoPay],
  );

  const pdvSummaries = useMemo(() => {
    const map: Record<string, PdvSummary> = {};
    for (const sale of aggregateSales) {
      const code = salePdvKey(sale);
      if (!map[code]) {
        map[code] = {
          codicePos: code,
          nomeNegozio: sale.nomeNegozio || code,
          ragioneSociale: sale.ragioneSociale || "",
          totaleVendite: 0,
          totaleImporto: 0,
          countByType: { canvass: 0, prodotti: 0, servizi: 0 },
          amountByType: { canvass: 0, prodotti: 0, servizi: 0 },
          accessoriImporto: 0,
          countByPista: {},
          amountByPista: {},
          ivaByPista: {},
          categorieByPista: {},
          pezziExtra: emptyPezziExtra(),
          vendite: [],
          articleIncasso: { scontrinato: 0, fuoriScontrino: 0, finanziato: 0, credito: 0 },
        };
      }
      const entry = map[code];
      entry.vendite.push(sale);

      const sc = saleClassifications.get(sale.id);
      let saleMatchesFilter = !componentFilterActive;
      let saleFilteredAmount = 0;
      if (sc) {
        for (const art of sc.articles) {
          if (!articleMatchesFilter(art)) continue;
          saleMatchesFilter = true;
          saleFilteredAmount += art.prezzo;
          entry.countByType[art.type]++;
          entry.amountByType[art.type] += art.prezzo;
          if (art.type === 'prodotti' && (art.categoriaNome ?? '').toUpperCase() === 'ACCESSORI') {
            entry.accessoriImporto += art.prezzo;
          }
          if (art.scontrinato) entry.articleIncasso.scontrinato += art.importoScontrino > 0 ? art.importoScontrino : art.prezzo;
          else entry.articleIncasso.fuoriScontrino += art.importoScontrino > 0 ? art.importoScontrino : art.prezzo;
          entry.articleIncasso.finanziato += art.importoFinanziato;
          entry.articleIncasso.credito += art.importoCredito;
          if (art.pista) {
            entry.countByPista[art.pista] = (entry.countByPista[art.pista] || 0) + 1;
            entry.amountByPista[art.pista] = (entry.amountByPista[art.pista] || 0) + art.prezzo;
            accumulaCategoriaCanvass(entry.categorieByPista, entry.ivaByPista, art);
          }
          // Task #398 — contatori extra (IVA/CB/Telefoni/€ Accessori/€ Servizi)
          // per la Tabella PDV × Pista (Pezzi): stessi filtri e stessa
          // esclusione annullate degli altri aggregati.
          accumulaPezziExtra(entry.pezziExtra, art);
        }
      }
      if (saleMatchesFilter) {
        entry.totaleVendite++;
        entry.totaleImporto += componentFilterActive
          ? saleFilteredAmount
          : (parseFloat(sale.totale || "0") || 0);
      }
    }
    // Rimuovi PDV senza match (può capitare con filtri stretti)
    return Object.values(map)
      .filter((p) => p.totaleVendite > 0 || p.vendite.length > 0)
      .sort((a, b) => b.totaleVendite - a.totaleVendite);
  }, [aggregateSales, saleClassifications, articleMatchesFilter, componentFilterActive]);

  // Andamento giornaliero dei KPI della Tabella PDV × Pista (Pezzi): stessi
  // conteggi classificati e stessi filtri attivi di pdvSummaries, ma
  // bucketizzati per data vendita. I giorni del periodo filtrato senza
  // vendite compaiono a 0 (linea continua, niente buchi).
  const andamentoPezzi = useMemo((): PezziTrendPoint[] => {
    const emptyPoint = (day: string): PezziTrendPoint => ({
      day, perPista: {}, iva: 0, cb: 0, telefoni: 0,
    });
    const trendPisteSet = new Set<PistaCanvass>(trendPiste);
    const byDay = new Map<string, PezziTrendPoint>();
    for (const sale of aggregateSales) {
      // data_vendita è salvata come wall-time italiano e serializzata ISO "Z"
      // con gli stessi campi: il giorno è i primi 10 caratteri della stringa.
      // NON usare new Date()+format locale: un browser fuori da Europe/Rome
      // sposterebbe le vendite vicino a mezzanotte sul giorno sbagliato,
      // rompendo la parità col filtro date della pagina (che è per giorno
      // di calendario italiano).
      const day = typeof sale.dataVendita === "string" ? sale.dataVendita.slice(0, 10) : null;
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const sc = saleClassifications.get(sale.id);
      if (!sc) continue;
      let point = byDay.get(day);
      for (const art of sc.articles) {
        if (!articleMatchesFilter(art)) continue;
        if (!point) {
          point = emptyPoint(day);
          byDay.set(day, point);
        }
        if (art.pista && trendPisteSet.has(art.pista)) {
          point.perPista[art.pista] = (point.perPista[art.pista] || 0) + 1;
        }
        // Stessi contatori extra della tabella (IVA/CB/Telefoni), riusando la
        // logica condivisa per non divergere dalle regole di classificazione.
        const extra = emptyPezziExtra();
        accumulaPezziExtra(extra, art);
        point.iva += extra.iva;
        point.cb += extra.cb;
        point.telefoni += extra.telefoni;
      }
    }
    if (byDay.size === 0) return [];
    // Riempi i giorni del periodo filtrato (o, in mancanza, del range dei dati)
    const days = Array.from(byDay.keys()).sort();
    const start = fromDate && fromDate <= days[0] ? fromDate : days[0];
    const end = toDate && toDate >= days[days.length - 1] ? toDate : days[days.length - 1];
    const out: PezziTrendPoint[] = [];
    const cursor = new Date(`${start}T00:00:00Z`);
    const stop = new Date(`${end}T00:00:00Z`);
    while (cursor <= stop && out.length < 800) {
      const day = cursor.toISOString().slice(0, 10);
      out.push(byDay.get(day) ?? emptyPoint(day));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    // Periodi oltre il tetto (improbabile: il default è il mese corrente):
    // mostra i giorni PIÙ RECENTI, non i primi, così il grafico resta
    // coerente con "cosa sta succedendo adesso".
    return out.length >= 800 ? out.slice(-400) : out;
  }, [aggregateSales, saleClassifications, articleMatchesFilter, fromDate, toDate, trendPiste]);

  const incassoByPdv = useMemo(() => {
    const map = new Map<string, IncassoTotals>();
    const grouped = new Map<string, BisuiteSale[]>();
    for (const sale of aggregateSales) {
      const code = salePdvKey(sale);
      if (!grouped.has(code)) grouped.set(code, []);
      grouped.get(code)!.push(sale);
    }
    for (const [code, pdvSales] of grouped) {
      map.set(code, computeIncassoTotals(pdvSales));
    }
    return map;
  }, [aggregateSales]);

  const rsSummaries = useMemo(() => {
    const map = new Map<string, { ragioneSociale: string; vendite: BisuiteSale[]; totaleImporto: number; pdvCodes: Set<string>; articleIncasso: ArticleIncasso }>();
    for (const sale of aggregateSales) {
      const rs = sale.ragioneSociale || "N/D";
      if (!map.has(rs)) map.set(rs, { ragioneSociale: rs, vendite: [], totaleImporto: 0, pdvCodes: new Set(), articleIncasso: { scontrinato: 0, fuoriScontrino: 0, finanziato: 0, credito: 0 } });
      const entry = map.get(rs)!;
      entry.vendite.push(sale);
      const sc = saleClassifications.get(sale.id);
      if (sc) {
        for (const art of sc.articles) {
          if (!articleMatchesFilter(art)) continue;
          if (componentFilterActive) entry.totaleImporto += art.prezzo;
          if (art.scontrinato) entry.articleIncasso.scontrinato += art.importoScontrino > 0 ? art.importoScontrino : art.prezzo;
          else entry.articleIncasso.fuoriScontrino += art.importoScontrino > 0 ? art.importoScontrino : art.prezzo;
          entry.articleIncasso.finanziato += art.importoFinanziato;
          entry.articleIncasso.credito += art.importoCredito;
        }
      }
      if (!componentFilterActive) {
        entry.totaleImporto += parseFloat(sale.totale || "0") || 0;
      }
      entry.pdvCodes.add(salePdvKey(sale));
    }
    return Array.from(map.values()).sort((a, b) => b.vendite.length - a.vendite.length);
  }, [aggregateSales, componentFilterActive, saleClassifications, articleMatchesFilter]);

  const addettoSummaries = useMemo(() => {
    const map = new Map<string, {
      nomeAddetto: string;
      vendite: BisuiteSale[];
      totaleImporto: number;
      pdvCodes: Set<string>;
      countByType: Record<ArticleType, number>;
      amountByType: Record<ArticleType, number>;
      /** Importo lordo degli articoli di categoria ACCESSORI (per scorporo IVA a display). */
      accessoriImporto: number;
      countByPista: Partial<Record<PistaCanvass, number>>;
      amountByPista: Partial<Record<PistaCanvass, number>>;
      ivaByPista: Partial<Record<PistaCanvass, number>>;
      categorieByPista: CategorieByPista;
      articleIncasso: ArticleIncasso;
    }>();
    for (const sale of aggregateSales) {
      const addetto = sale.nomeAddetto || "N/D";
      if (!map.has(addetto)) map.set(addetto, {
        nomeAddetto: addetto, vendite: [], totaleImporto: 0, pdvCodes: new Set(),
        countByType: { canvass: 0, prodotti: 0, servizi: 0 },
        amountByType: { canvass: 0, prodotti: 0, servizi: 0 },
        accessoriImporto: 0,
        countByPista: {}, amountByPista: {},
        ivaByPista: {}, categorieByPista: {},
        articleIncasso: { scontrinato: 0, fuoriScontrino: 0, finanziato: 0, credito: 0 },
      });
      const entry = map.get(addetto)!;
      entry.vendite.push(sale);
      entry.pdvCodes.add(salePdvKey(sale));
      const sc = saleClassifications.get(sale.id);
      let saleFilteredAmount = 0;
      if (sc) {
        for (const art of sc.articles) {
          if (!articleMatchesFilter(art)) continue;
          saleFilteredAmount += art.prezzo;
          entry.countByType[art.type]++;
          entry.amountByType[art.type] += art.prezzo;
          if (art.type === 'prodotti' && (art.categoriaNome ?? '').toUpperCase() === 'ACCESSORI') {
            entry.accessoriImporto += art.prezzo;
          }
          if (art.scontrinato) entry.articleIncasso.scontrinato += art.importoScontrino > 0 ? art.importoScontrino : art.prezzo;
          else entry.articleIncasso.fuoriScontrino += art.importoScontrino > 0 ? art.importoScontrino : art.prezzo;
          entry.articleIncasso.finanziato += art.importoFinanziato;
          entry.articleIncasso.credito += art.importoCredito;
          if (art.pista) {
            entry.countByPista[art.pista] = (entry.countByPista[art.pista] || 0) + 1;
            entry.amountByPista[art.pista] = (entry.amountByPista[art.pista] || 0) + art.prezzo;
            accumulaCategoriaCanvass(entry.categorieByPista, entry.ivaByPista, art);
          }
        }
      }
      entry.totaleImporto += componentFilterActive
        ? saleFilteredAmount
        : (parseFloat(sale.totale || "0") || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.vendite.length - a.vendite.length);
  }, [aggregateSales, saleClassifications, articleMatchesFilter, componentFilterActive]);

  const allDomande = useMemo(() => {
    const set = new Set<string>();
    for (const sale of sales) {
      const articoli: any[] = sale.rawData?.articoli || [];
      for (const art of articoli) {
        const qas: any[] = art.dettaglio?.domandeRisposte || [];
        for (const qa of qas) {
          if (qa.domandaTesto) set.add(qa.domandaTesto);
        }
      }
    }
    return Array.from(set).sort();
  }, [sales]);

  const buildSaleRow = useCallback((sale: BisuiteSale) => {
    const raw = sale.rawData || {};
    const articoli: any[] = raw.articoli || [];
    const cliente = raw.cliente || {};
    const canvassArts = articoli.filter((a: any) => {
      const cls = classifyArticle(a, canvassIndex, kpiRules);
      return cls?.type === 'canvass';
    });
    const prodottiArts = articoli.filter((a: any) => {
      const cls = classifyArticle(a, canvassIndex, kpiRules);
      return cls?.type === 'prodotti' || cls?.type === 'servizi';
    });
    const domandeMap: Record<string, string> = {};
    for (const art of articoli) {
      const qas: any[] = art.dettaglio?.domandeRisposte || [];
      for (const qa of qas) {
        if (qa.domandaTesto && qa.risposta) {
          domandeMap[qa.domandaTesto] = qa.risposta;
        }
      }
    }
    return {
      catCanvass: [...new Set(canvassArts.map((a: any) => (a.categoria?.nome || '').trim()).filter(Boolean))].join(', '),
      tipCanvass: [...new Set(canvassArts.map((a: any) => (a.tipologia?.nome || '').trim()).filter(Boolean))].join(', '),
      descCanvass: canvassArts.map((a: any) => (a.descrizione || '').trim()).filter(Boolean).join(', '),
      catProdotto: [...new Set(prodottiArts.map((a: any) => (a.categoria?.nome || '').trim()).filter(Boolean))].join(', '),
      tipProdotto: [...new Set(prodottiArts.map((a: any) => (a.tipologia?.nome || '').trim()).filter(Boolean))].join(', '),
      descProdotto: prodottiArts.map((a: any) => (a.descrizione || '').trim()).filter(Boolean).join(', '),
      domandeMap,
      codiceContratto: String(raw.codiceEsterno || raw.id || ''),
      cf: cliente.codiceFiscale || '',
      piva: cliente.piva || '',
      nomeCliente: sale.nomeCliente || cliente.nominativo || '',
    };
  }, [canvassIndex, kpiRules]);

  const exportExcelDettaglio = useCallback(() => {
    // Esporta la selezione corrente (stessi filtri della tabella a schermo: PDV,
    // stato, tipo, pista, ricerca, pagamento). Le ANNULLATE sono incluse solo
    // se il filtro Stato è "annullate" o "all", coerente con la vista.
    const rows: Record<string, any>[] = [];
    for (const sale of aggregateSales) {
      const r = buildSaleRow(sale);
      const row: Record<string, any> = {
        'Addetto': sale.nomeAddetto || '-',
        'Data': sale.dataVendita ? format(new Date(sale.dataVendita), "dd/MM/yyyy", { locale: it }) : '-',
        'Negozio': sale.nomeNegozio || '-',
        'Cod. POS': sale.codicePos || '-',
        'Stato': sale.stato || '-',
        'Cat. Canvass': r.catCanvass || '-',
        'Tip. Canvass': r.tipCanvass || '-',
        'Desc. Canvass': r.descCanvass || '-',
        'Cat. Prodotto': r.catProdotto || '-',
        'Tip. Prodotto': r.tipProdotto || '-',
        'Desc. Prodotto': r.descProdotto || '-',
      };
      for (const d of allDomande) {
        row[d] = r.domandeMap[d] || '';
      }
      row['Cod. Contratto'] = r.codiceContratto || '-';
      row['CF'] = r.cf || '-';
      row['P.IVA'] = r.piva || '-';
      row['Cliente'] = r.nomeCliente || '-';
      row['Importo (IVA incl.)'] = parseFloat(sale.totale || '0') || 0;
      // Calcola "di cui IVA" su Accessori + Servizi della singola vendita.
      const sc = saleClassifications.get(sale.id);
      let accSrvLordo = 0;
      if (sc) {
        for (const art of sc.articles) {
          if (art.type === 'servizi') accSrvLordo += art.prezzo;
          if (art.type === 'prodotti' && (art.categoriaNome ?? '').toUpperCase() === 'ACCESSORI') accSrvLordo += art.prezzo;
        }
      }
      row['Di cui IVA Acc.+Serv.'] = accSrvLordo > 0 ? Math.round(ivaOf(accSrvLordo) * 100) / 100 : 0;
      rows.push(row);
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendite Dettaglio');
    XLSX.writeFile(wb, `vendite_dettaglio_${fromDate}_${toDate}.xlsx`);
  }, [aggregateSales, saleClassifications, allDomande, buildSaleRow, fromDate, toDate]);

  const exportExcelPerAddetto = useCallback(() => {
    const rows: Record<string, any>[] = [];
    for (const addetto of addettoSummaries) {
      const accIva = ivaOf(addetto.accessoriImporto);
      const srvIva = ivaOf(addetto.amountByType.servizi);
      const row: Record<string, any> = {
        'Addetto': addetto.nomeAddetto,
        'N. Vendite': addetto.vendite.length,
        'Importo Totale (IVA incl.)': addetto.totaleImporto,
        'Di cui IVA Acc.+Serv.': Math.round((accIva + srvIva) * 100) / 100,
        'N. PDV': addetto.pdvCodes.size,
        'PDV': Array.from(addetto.pdvCodes).join(', '),
      };
      const canvassCounts: Record<string, number> = {};
      const prodottiCounts: Record<string, number> = {};
      const domandeSi: Record<string, number> = {};
      for (const sale of addetto.vendite) {
        const articoli: any[] = sale.rawData?.articoli || [];
        for (const art of articoli) {
          const catName = (art.categoria?.nome || '').trim();
          const cls = classifyArticle(art, canvassIndex, kpiRules);
          if (cls?.type === 'canvass') canvassCounts[catName] = (canvassCounts[catName] || 0) + 1;
          if (cls?.type === 'prodotti' || cls?.type === 'servizi') prodottiCounts[catName] = (prodottiCounts[catName] || 0) + 1;
          const qas: any[] = art.dettaglio?.domandeRisposte || [];
          for (const qa of qas) {
            if (qa.domandaTesto && qa.risposta?.toUpperCase() === 'SI') {
              domandeSi[qa.domandaTesto] = (domandeSi[qa.domandaTesto] || 0) + 1;
            }
          }
        }
      }
      row['Categorie Canvass'] = Object.entries(canvassCounts).map(([k, v]) => `${k} (${v})`).join(', ');
      row['Categorie Prodotto'] = Object.entries(prodottiCounts).map(([k, v]) => `${k} (${v})`).join(', ');
      for (const d of allDomande) {
        row[`SI: ${d}`] = domandeSi[d] || 0;
      }
      rows.push(row);
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Riepilogo Addetti');
    XLSX.writeFile(wb, `vendite_per_addetto_${fromDate}_${toDate}.xlsx`);
  }, [addettoSummaries, allDomande, fromDate, toDate]);

  const formatCurrency = (val: number | string) =>
    new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(typeof val === "string" ? parseFloat(val) || 0 : val);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return format(new Date(dateStr), "dd/MM/yyyy", { locale: it });
    } catch {
      return dateStr;
    }
  };

  // Le vecchie tre card affiancate diventano un solo pannello navigabile:
  // desktop = elenco verticale + contenuto; mobile = quattro pulsanti a icona
  // sopra il contenuto (reference Task #461). Accessori è scorporato da
  // Prodotti senza cambiare la classificazione/filtro dati sottostante.
  const accessoriSummary = globalCounts.prodottiByCategory.ACCESSORI ?? { pezzi: 0, importo: 0 };
  const prodottiSummaryEntries = Object.entries(globalCounts.prodottiByCategory)
    .filter(([categoria]) => categoria !== "ACCESSORI")
    .sort(([, a], [, b]) => b.pezzi - a.pezzi);
  const prodottiSummaryCount = prodottiSummaryEntries.reduce((sum, [, row]) => sum + row.pezzi, 0);
  const prodottiSummaryAmount = prodottiSummaryEntries.reduce((sum, [, row]) => sum + row.importo, 0);
  const summaryTabs: Array<{
    value: SalesSummaryCategory;
    label: string;
    count: number;
    icon: typeof Tag;
  }> = [
    { value: "canvass", label: "Canvass", count: globalCounts.byType.canvass, icon: Tag },
    { value: "servizi", label: "Servizi", count: globalCounts.byType.servizi, icon: Wrench },
    { value: "accessori", label: "Accessori", count: accessoriSummary.pezzi, icon: Headphones },
    { value: "prodotti", label: "Prodotti", count: prodottiSummaryCount, icon: Package },
  ];
  const visibleSummaryTabs = summaryTabs.filter((tab) => (
    filterType === "all"
    || filterType === tab.value
    || (filterType === "prodotti" && (tab.value === "accessori" || tab.value === "prodotti"))
  ));
  const activeSummaryCategory = visibleSummaryTabs.some((tab) => tab.value === summaryCategory)
    ? summaryCategory
    : visibleSummaryTabs[0]?.value ?? "canvass";

  return (
    <div
      className={`min-h-screen bg-background ${isMidnightViolet ? "vendite-midnight" : ""} ${useDarkSalesContrast ? "vendite-dark-contrast" : ""}`}
      data-testid="vendite-bisuite-page"
      data-sales-style={isMidnightViolet ? "midnight-violet" : "standard"}
    >
      <AppNavbar title="MyStoreDesk" />

      <main className="vendite-main container mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {fetchResult && (
          <div
            className={`flex items-start gap-2 px-4 py-3 rounded-lg text-sm ${
              !fetchResult.success
                ? "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"
                : fetchResult.partial
                ? "bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900"
                : "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900"
            }`}
            data-testid={
              !fetchResult.success
                ? "alert-fetch-error"
                : fetchResult.partial
                ? "alert-fetch-partial"
                : "alert-fetch-success"
            }
          >
            {!fetchResult.success ? (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            ) : fetchResult.partial ? (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 space-y-1">
              <div>{fetchResult.message}</div>
              {fetchResult.partial && fetchResult.failedMonths && fetchResult.failedMonths.length > 0 && (
                <div className="text-xs opacity-90" data-testid="text-failed-months">
                  Mesi non aggiornati: <strong>{fetchResult.failedMonths.join(", ")}</strong>
                </div>
              )}
            </div>
            {fetchResult.partial && fetchResult.source !== "reconcile" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-amber-300 text-amber-800 hover:bg-amber-100"
                onClick={() => {
                  setFetchResult(null);
                  fetchMutation.mutate();
                }}
                disabled={fetchMutation.isPending}
                data-testid="button-retry-fetch"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchMutation.isPending ? "animate-spin" : ""}`} />
                Riprova
              </Button>
            )}
          </div>
        )}

        <FilterBar
          activeCount={
            (searchTerm.trim() ? 1 : 0) +
            (filterType !== "all" ? 1 : 0) +
            (filterPista !== "all" ? 1 : 0) +
            (filterStato !== "finalizzate" ? 1 : 0) +
            (filterPagamento ? 1 : 0) +
            (selectedPdvs.length > 0 ? 1 : 0) +
            (pdvView !== "origine" ? 1 : 0)
          }
          onReset={() => {
            setSearchTerm("");
            setFilterType("all");
            setFilterPista("all");
            setFilterStato("finalizzate");
            setFilterPagamento(null);
            setSelectedPdvs([]);
            setPdvView("origine");
          }}
          actions={
            credStatus?.configured ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => fetchMutation.mutate()}
                  disabled={fetchMutation.isPending}
                  data-testid="button-fetch-bisuite"
                >
                  {fetchMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {fetchMutation.isPending ? "Importazione..." : "Aggiorna Vendite"}
                </Button>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      const d = getDefaultDates();
                      setReconcileFrom(d.from);
                      setReconcileTo(d.to);
                      setReconcileOpen(true);
                    }}
                    disabled={reconcileMutation.isPending}
                    data-testid="button-open-reconcile"
                  >
                    <Route className="h-3.5 w-3.5 mr-1.5" />
                    Allinea con BiSuite
                  </Button>
                )}
              </div>
            ) : credStatus && !credStatus.configured ? (
              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Credenziali BiSuite non configurate</span>
              </div>
            ) : null
          }
        >
          <FilterField label="Da" icon={CalendarRange}>
            <div className="relative">
              <Input
                ref={fromDateRef}
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="vendite-date-input pr-10"
                data-testid="input-from-date"
              />
              <button
                type="button"
                onClick={() => openDatePicker(fromDateRef)}
                className="absolute inset-y-px right-px z-10 flex w-9 cursor-pointer items-center justify-center rounded-r-md bg-background text-muted-foreground"
                data-testid="icon-from-date-calendar"
                aria-label="Mostra selettore date"
              >
                <CalendarRange className="h-4 w-4" />
              </button>
            </div>
          </FilterField>
          <FilterField label="A" icon={CalendarRange}>
            <div className="relative">
              <Input
                ref={toDateRef}
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="vendite-date-input pr-10"
                data-testid="input-to-date"
              />
              <button
                type="button"
                onClick={() => openDatePicker(toDateRef)}
                className="absolute inset-y-px right-px z-10 flex w-9 cursor-pointer items-center justify-center rounded-r-md bg-background text-muted-foreground"
                data-testid="icon-to-date-calendar"
                aria-label="Mostra selettore date"
              >
                <CalendarRange className="h-4 w-4" />
              </button>
            </div>
          </FilterField>
          <FilterField label="Cerca" icon={Search} span={2}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Cliente, addetto, negozio, categoria..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
                data-testid="input-search"
              />
            </div>
          </FilterField>
          <FilterField label="Tipo" icon={Layers}>
            <Select
              value={filterType}
              onValueChange={(v) => {
                setFilterType(v);
                if (v !== "canvass") setFilterPista("all");
                if (v === "canvass" || v === "servizi" || v === "prodotti") {
                  setSummaryCategory(v);
                }
              }}
            >
              <SelectTrigger data-testid="select-tipo">
                <SelectValue placeholder="Tutti" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="all">Tutti i tipi</SelectItem>
                <SelectItem value="canvass">Canvass</SelectItem>
                <SelectItem value="prodotti">Prodotti</SelectItem>
                <SelectItem value="servizi">Servizi</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Vista PDV" icon={Store}>
            <Select
              value={pdvView}
              onValueChange={(v) => {
                setPdvView(v as PdvView);
                // I codici PDV cambiano tra le due viste: i PDV selezionati
                // nell'altra vista non esistono più → azzera il filtro.
                setSelectedPdvs([]);
              }}
            >
              <SelectTrigger data-testid="select-pdv-view">
                <SelectValue placeholder="Origine" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="origine">PDV Origine</SelectItem>
                <SelectItem value="destinazione">PDV Destinazione</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Stato" icon={FilterIcon}>
            <Select value={filterStato} onValueChange={setFilterStato}>
              <SelectTrigger data-testid="select-stato">
                <SelectValue placeholder="Finalizzate" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="finalizzate">Solo finalizzate</SelectItem>
                <SelectItem value="annullate">Solo annullate</SelectItem>
                <SelectItem value="all">Tutte (incluse annullate)</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          {(filterType === "canvass" || filterType === "all") && (
            <FilterField label="Pista" icon={Route}>
              <Select
                value={filterPista}
                onValueChange={(v) => {
                  setFilterPista(v);
                  setSummaryCategory("canvass");
                }}
              >
                <SelectTrigger data-testid="select-pista">
                  <SelectValue placeholder="Tutte" />
                </SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  <SelectItem value="all">Tutte le piste</SelectItem>
                  {visiblePistaKeys.map((p) => (
                    <SelectItem key={p} value={p}>
                      {pistaLabels[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          )}
          <FilterField label="Punti vendita" icon={Store}>
            <MultiSelectFilter
              values={selectedPdvs}
              onChange={setSelectedPdvs}
              options={pdvOptions}
              allLabel="Tutti i punti vendita"
              countLabel={(n) => `${n} punti vendita`}
              searchPlaceholder="Cerca punto vendita..."
              emptyText="Nessun punto vendita."
              testid="select-pdv-filter"
            />
          </FilterField>
        </FilterBar>

        {pdvView === "destinazione" && senzaDestinazioneCount > 0 && (
          <div
            className="flex items-center gap-1.5 text-xs text-amber-600"
            data-testid="banner-senza-destinazione"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {senzaDestinazioneCount} vendite senza PDV destinazione: raggruppate in
              «Senza PDV destinazione», non attribuite ad altri negozi.
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4 py-4">
            <KpiCardsSkeleton />
            <DataTableSkeleton rows={10} columns={6} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
              <Card>
                <CardContent className="p-3 sm:p-4 text-center">
                  <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5 mx-auto mb-1 text-primary" />
                   <p className="text-xl sm:text-3xl font-bold tabular-nums" data-testid="text-total-sales">
                    {venditeCount}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">
                    {componentFilterActive
                      ? (filterType !== "all"
                          ? `Articoli ${TYPE_LABELS[filterType as ArticleType]}`
                          : `Articoli ${pistaLabels[filterPista as PistaCanvass]}`)
                      : "Vendite Totali"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 sm:p-4 text-center">
                  <Euro className="h-4 w-4 sm:h-5 sm:w-5 mx-auto mb-1 text-green-500" />
                  <p
                     className="text-lg sm:text-3xl font-bold text-green-600 tabular-nums"
                    data-testid="text-total-amount"
                  >
                    {formatCurrency(totaleImporto)}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">
                    {componentFilterActive ? "Importo (filtrato)" : "Importo Totale"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 sm:p-4 text-center">
                  <Store className="h-4 w-4 sm:h-5 sm:w-5 mx-auto mb-1 text-blue-500" />
                   <p className="text-xl sm:text-3xl font-bold tabular-nums" data-testid="text-total-pdv">
                    {pdvSummaries.length}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Punti Vendita</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 sm:p-4 text-center">
                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 mx-auto mb-1 text-orange-500" />
                   <p className="text-lg sm:text-3xl font-bold tabular-nums" data-testid="text-avg-sale">
                    {aggregateSales.length > 0
                      ? formatCurrency(totaleImporto / aggregateSales.length)
                      : "€ 0"}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">
                    {componentFilterActive ? "Media per Vendita (filtro)" : "Media per Vendita"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {filteredSalesNoPay.length > 0 && (
              <Card>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <Wallet className="h-4 w-4 text-primary" />
                     <span className="font-semibold text-base">Modalità di Incasso{selectedPdvs.length === 1 ? ` - ${pdvLabelFor(selectedPdvs[0])}` : selectedPdvs.length > 1 ? ` - ${selectedPdvs.length} punti vendita` : ""}</span>
                    {filterPagamento && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs ml-auto"
                        onClick={() => setFilterPagamento(null)}
                        data-testid="button-clear-pagamento"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Azzera filtro pagamento
                      </Button>
                    )}
                  </div>
                   <p className="text-xs text-muted-foreground mb-2">
                    Clicca un metodo per filtrare le vendite con quell'incasso.
                  </p>
                  <IncassoBadges
                    totals={incassoTotals}
                    formatter={formatCurrency}
                    activeKey={filterPagamento}
                    onSelect={handleSelectPagamento}
                  />
                  {componentFilterActive && (
                    <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t" data-testid="text-incasso-scontrino-note">
                      Importi riferiti all'intero scontrino: i metodi di pagamento non sono divisibili per singolo tipo articolo.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <section
              className="grid gap-3 md:grid-cols-[minmax(180px,230px)_minmax(0,1fr)] md:items-stretch"
              aria-labelledby="sales-summary-heading"
              data-testid="sales-category-summary"
            >
              <h2 id="sales-summary-heading" className="sr-only">Riepilogo vendite per categoria</h2>

              <nav
                className="hidden md:flex md:flex-col gap-3"
                aria-label="Categorie riepilogo vendite"
                data-testid="sales-category-nav-desktop"
              >
                {visibleSummaryTabs.map((tab) => {
                  const Icon = tab.icon;
                  const selected = activeSummaryCategory === tab.value;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setSummaryCategory(tab.value)}
                      aria-pressed={selected}
                      className={`group flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        selected
                          ? "border-foreground/55 bg-foreground/10 text-foreground shadow-sm"
                          : "border-border/80 bg-card/75 text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
                      }`}
                      data-testid={`sales-category-desktop-${tab.value}`}
                    >
                      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                       <span className="min-w-0 flex-1 truncate text-base font-semibold">{tab.label}</span>
                      <span
                         className={`rounded-md border px-2.5 py-1 text-sm font-bold tabular-nums ${
                          selected ? "border-foreground/30 bg-background/10" : "border-border bg-background/50"
                        }`}
                        aria-label={`${tab.count} elementi`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </nav>

              <div className="min-w-0">
                <nav
                  className={`mb-2 grid gap-1 md:hidden ${
                    visibleSummaryTabs.length >= 4 ? "grid-cols-4" : visibleSummaryTabs.length === 2 ? "grid-cols-2" : "grid-cols-1"
                  }`}
                  aria-label="Categorie riepilogo vendite"
                  data-testid="sales-category-nav-mobile"
                >
                  {visibleSummaryTabs.map((tab) => {
                    const Icon = tab.icon;
                    const selected = activeSummaryCategory === tab.value;
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => setSummaryCategory(tab.value)}
                        aria-pressed={selected}
                        className={`flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? "border-foreground/55 bg-foreground/10 text-foreground shadow-sm"
                            : "border-border/80 bg-card/75 text-muted-foreground"
                        }`}
                        data-testid={`sales-category-mobile-${tab.value}`}
                      >
                        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                         <span className="w-full truncate text-center text-xs font-semibold leading-none">
                          {tab.label}
                        </span>
                        <span className="sr-only">{tab.count} elementi</span>
                      </button>
                    );
                  })}
                </nav>
              {activeSummaryCategory === "canvass" && (
              <Card className="min-h-[320px] md:min-h-full" data-testid="sales-category-panel-canvass">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Tag className="h-5 w-5 text-primary" />
                       <span className="text-2xl font-bold tracking-tight">Canvass</span>
                    </div>
                     <Badge className={TYPE_COLORS.canvass + " text-base font-bold px-3 py-1 tabular-nums"}>
                      {globalCounts.byType.canvass}
                    </Badge>
                  </div>
                  {(globalCounts.amtByType.canvass || 0) > 0 && (
                     <p className="text-lg text-green-600 font-bold mb-3 tabular-nums">{formatCurrency(globalCounts.amtByType.canvass)}</p>
                  )}
                  <div className="space-y-1.5">
                    {(() => {
                      // Slot IVA riservato su ogni riga quando almeno una pista
                      // ha pezzi IVA: la colonna "di cui N IVA" e i badge restano
                      // così incolonnati alla stessa estremità destra anche a 375px.
                      const hasAnyIva = !isVfModel
                        && Object.values(globalCounts.ivaByPista).some((v) => (v || 0) > 0);
                      return (Object.entries(globalCounts.byPista) as [PistaCanvass, number][])
                        .filter(([pista]) => isPistaVisible(pista))
                        .sort(([, a], [, b]) => b - a)
                        .map(([pista, count]) => (
                           <SummaryMetricRow
                             key={pista}
                             testId={`row-summary-pista-${pista}`}
                             label={<span className="flex min-w-0 items-center gap-1.5">{PISTA_ICONS[pista]}<span className="min-w-0 truncate">{pistaLabels[pista]}</span></span>}
                             amount={(globalCounts.amtByPista[pista] || 0) > 0 ? <span className="font-semibold text-muted-foreground">{formatCurrency(globalCounts.amtByPista[pista] || 0)}</span> : undefined}
                              extra={!isVfModel && (globalCounts.ivaByPista[pista] || 0) > 0 ? <span data-testid={`text-iva-${pista}`}>di cui {globalCounts.ivaByPista[pista]} IVA</span> : undefined}
                             reserveExtraSpace={hasAnyIva}
                             count={count}
                             countClassName={PISTA_CANVASS_COLORS[pista]}
                             countTestId={`row-summary-pista-${pista}-count`}
                           />
                        ));
                    })()}
                    {globalCounts.couponCaring.pezzi > 0 && (
                        <div className="mt-1 border-t border-dashed pt-1.5">
                          <SummaryMetricRow
                            testId="row-coupon-caring"
                            label={<span className="flex min-w-0 items-center gap-1.5"><Tag className="h-3 w-3 shrink-0 text-amber-600" /><span className="truncate">Coupon Caring <span className="text-xs">(esclusi da CB)</span></span></span>}
                            amount={globalCounts.couponCaring.importo > 0 ? <span className="font-semibold text-muted-foreground">{formatCurrency(globalCounts.couponCaring.importo)}</span> : undefined}
                            count={globalCounts.couponCaring.pezzi}
                            countClassName="bg-amber-500/10 text-amber-700 border-amber-500/20"
                          />
                        </div>
                    )}
                  </div>
                  <ArticleIncassoRecap incasso={globalCounts.incassoByType.canvass} formatCurrency={formatCurrency} />
                </CardContent>
              </Card>
              )}
              {activeSummaryCategory === "accessori" && (() => {
                const accessoriNetto = nettoIva(accessoriSummary.importo);
                const accessoriIva = ivaOf(accessoriSummary.importo);
                return (
                  <Card className="min-h-[320px] md:min-h-full" data-testid="sales-category-panel-accessori">
                    <CardContent className="p-4 sm:p-6">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Headphones className="h-5 w-5 text-primary" />
                           <span className="text-2xl font-bold tracking-tight">Accessori</span>
                          {accessoriSummary.importo > 0 && (
                             <span className="text-xs text-muted-foreground">(acc. netto IVA)</span>
                          )}
                        </div>
                         <Badge className={TYPE_COLORS.prodotti + " text-base font-bold px-3 py-1 tabular-nums"}>
                          {accessoriSummary.pezzi}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mb-3">
                         <p className="text-lg text-green-600 font-bold tabular-nums">{formatCurrency(accessoriNetto)}</p>
                        {accessoriIva > 0 && (
                           <span className="text-sm text-muted-foreground">
                            IVA {formatCurrency(accessoriIva)}
                          </span>
                        )}
                      </div>
                       <SummaryMetricRow
                         label="ACCESSORI"
                         amount={accessoriNetto > 0 ? <span className="font-semibold text-green-600">{formatCurrency(accessoriNetto)} <span className="text-muted-foreground">(n.IVA)</span></span> : undefined}
                         count={accessoriSummary.pezzi}
                       />
                      <ArticleIncassoRecap incasso={globalCounts.incassoAccessori} formatCurrency={formatCurrency} />
                    </CardContent>
                  </Card>
                );
              })()}
              {activeSummaryCategory === "prodotti" && (() => {
                return (
                <Card className="min-h-[320px] md:min-h-full" data-testid="sales-category-panel-prodotti">
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-primary" />
                         <span className="text-2xl font-bold tracking-tight">Prodotti</span>
                      </div>
                       <Badge className={TYPE_COLORS.prodotti + " text-base font-bold px-3 py-1 tabular-nums"}>
                        {prodottiSummaryCount}
                      </Badge>
                    </div>
                     <p className="text-lg text-green-600 font-bold mb-2 tabular-nums">{formatCurrency(prodottiSummaryAmount)}</p>
                    <div className="space-y-1">
                      {prodottiSummaryEntries.map(([cat, { pezzi, importo }]) => (
                              <SummaryMetricRow
                                key={cat}
                                testId={`row-summary-prodotto-${cat}`}
                                label={cat}
                                amount={importo > 0 ? <span className="font-semibold text-green-600">{formatCurrency(importo)}</span> : undefined}
                                count={pezzi}
                              />
                      ))}
                    </div>
                    <ArticleIncassoRecap incasso={globalCounts.incassoProdotti} formatCurrency={formatCurrency} />
                  </CardContent>
                </Card>
                );
              })()}
              {activeSummaryCategory === "servizi" && (() => {
                const serviziNetto = nettoIva(globalCounts.serviziLordo);
                const serviziIva = ivaOf(globalCounts.serviziLordo);
                return (
                <Card className="min-h-[320px] md:min-h-full" data-testid="sales-category-panel-servizi">
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-5 w-5 text-primary" />
                         <span className="text-2xl font-bold tracking-tight">Servizi</span>
                         {globalCounts.serviziLordo > 0 && <span className="text-xs text-muted-foreground">(netto IVA)</span>}
                      </div>
                       <Badge className={TYPE_COLORS.servizi + " text-base font-bold px-3 py-1 tabular-nums"}>
                        {globalCounts.byType.servizi}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                       <p className="text-lg text-green-600 font-bold tabular-nums">{formatCurrency(serviziNetto)}</p>
                       {serviziIva > 0 && <span className="text-sm text-muted-foreground">IVA {formatCurrency(serviziIva)}</span>}
                    </div>
                    <div className="space-y-1">
                      {Object.entries(globalCounts.serviziByLabel)
                        .sort(([, a], [, b]) => b.pezzi - a.pezzi)
                        .map(([label, { pezzi, importo }]) => {
                          const netto = nettoIva(importo);
                          const iva = ivaOf(importo);
                          return (
                              <SummaryMetricRow
                                key={label}
                                label={label}
                                amount={netto > 0 ? <span className="font-semibold text-green-600">{formatCurrency(netto)}</span> : undefined}
                                extra={iva > 0 ? <>IVA {formatCurrency(iva)}</> : undefined}
                                count={pezzi}
                              />
                          );
                        })}
                    </div>
                    <ArticleIncassoRecap incasso={globalCounts.incassoByType.servizi} formatCurrency={formatCurrency} />
                  </CardContent>
                </Card>
                );
              })()}
              </div>
            </section>

            {rsSummaries.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-5 w-5 text-primary" />
                    Riepilogo per Ragione Sociale
                  </CardTitle>
                </CardHeader>
                  <CardContent className="px-3 sm:px-6">
                  <Accordion type="multiple" className="space-y-2">
                    {rsSummaries.map((rs) => {
                      const rsIncasso = computeIncassoTotals(rs.vendite);
                      return (
                        <AccordionItem key={rs.ragioneSociale} value={rs.ragioneSociale} className="border rounded-lg px-2 sm:px-4">
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full pr-4 gap-1 sm:gap-2">
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                <div className="h-8 w-8 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
                                  <Users className="h-4 w-4 text-violet-600" />
                                </div>
                                <div className="text-left min-w-0">
                                  <div className="font-semibold text-sm truncate">{rs.ragioneSociale}</div>
                                 <div className="text-sm text-muted-foreground">{rs.pdvCodes.size} PDV</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 sm:gap-3 pl-10 sm:pl-0">
                                 <Badge variant="outline" className="text-sm font-semibold shrink-0 py-1">{rs.vendite.length} vendite</Badge>
                                 <Badge className="text-sm font-bold bg-green-500/10 text-green-600 border-green-500/20 shrink-0 py-1 tabular-nums">{formatCurrency(rs.totaleImporto)}</Badge>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-2 pb-2">
                              {!componentFilterActive && (
                                <IncassoBadges totals={rsIncasso} formatter={formatCurrency} compact />
                              )}
                              <ArticleIncassoRecap incasso={rs.articleIncasso} formatCurrency={formatCurrency} />
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </CardContent>
              </Card>
            )}

            <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === "vendite" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { setViewMode("vendite"); setSelectedAddetto(null); }}
                  data-testid="button-view-vendite"
                >
                  <Store className="h-3.5 w-3.5 mr-1" />
                  Per PDV
                </Button>
                <Button
                  variant={viewMode === "addetti" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setViewMode("addetti")}
                  data-testid="button-view-addetti"
                >
                  <User className="h-3.5 w-3.5 mr-1" />
                  Per Addetto ({addettoSummaries.length})
                </Button>
              </div>

            {viewMode === "addetti" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between w-full flex-wrap gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <User className="h-5 w-5 text-primary" />
                      Riepilogo per Addetto
                    </CardTitle>
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={exportExcelDettaglio} data-testid="button-export-dettaglio-header">
                        <Download className="h-4 w-4 mr-1" /> Dettaglio
                      </Button>
                      <Button variant="outline" size="sm" onClick={exportExcelPerAddetto} data-testid="button-export-per-addetto-header">
                        <Download className="h-4 w-4 mr-1" /> Per Addetto
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {addettoSummaries.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">Nessun addetto trovato</p>
                  ) : selectedAddetto ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <User className="h-4 w-4 text-blue-600" />
                          </div>
                          <div>
                            <div className="font-semibold text-sm">{selectedAddetto}</div>
                             <div className="text-sm text-muted-foreground">
                              {addettoSummaries.find(a => a.nomeAddetto === selectedAddetto)?.vendite.length || 0} vendite ·{" "}
                              {formatCurrency(addettoSummaries.find(a => a.nomeAddetto === selectedAddetto)?.totaleImporto || 0)}
                            </div>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setSelectedAddetto(null)} data-testid="button-back-addetti">
                          <X className="h-4 w-4 mr-1" /> Torna alla lista
                        </Button>
                      </div>
                      <ScrollableTable className="-mx-2 sm:mx-0 border rounded-md">
                        <div className="max-h-[500px] overflow-y-auto min-w-max">
                          <table className="w-full caption-bottom text-sm">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[90px] sticky left-0 top-0 bg-background z-20">Data</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Negozio</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Stato</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Cat. Canvass</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Tip. Canvass</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Desc. Canvass</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Cat. Prodotto</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Tip. Prodotto</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Desc. Prodotto</TableHead>
                                {allDomande.map((d) => (
                                  <TableHead key={d} className="whitespace-nowrap text-[10px] max-w-[120px] sticky top-0 bg-background z-10" title={d}>{d.length > 20 ? d.slice(0, 20) + '…' : d}</TableHead>
                                ))}
                                <TableHead className="sticky top-0 bg-background z-10">Cod. Contratto</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">CF / P.IVA</TableHead>
                                <TableHead className="sticky top-0 bg-background z-10">Cliente</TableHead>
                                <TableHead className="text-right sticky top-0 bg-background z-10">Importo</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(addettoSummaries.find(a => a.nomeAddetto === selectedAddetto)?.vendite || []).map((sale) => {
                                const r = buildSaleRow(sale);
                                const cfPiva = [r.cf, r.piva].filter(Boolean).join(' / ');
                                return (
                                  <TableRow
                                    key={sale.id}
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => setSelectedSale(sale)}
                                    data-testid={`row-addetto-sale-${sale.bisuiteId}`}
                                  >
                                    <TableCell className="text-xs whitespace-nowrap sticky left-0 bg-background z-10">{formatDate(sale.dataVendita)}</TableCell>
                                    <TableCell>
                                      <div className="text-sm font-medium">{sale.nomeNegozio || '-'}</div>
                                      <div className="text-[10px] text-muted-foreground font-mono">{sale.codicePos || '-'}</div>
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className="text-[10px]">{sale.stato || '-'}</Badge>
                                    </TableCell>
                                    <TableCell className="text-xs max-w-[110px] truncate" title={r.catCanvass}>{r.catCanvass || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[110px] truncate" title={r.tipCanvass}>{r.tipCanvass || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[130px] truncate" title={r.descCanvass}>{r.descCanvass || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[110px] truncate" title={r.catProdotto}>{r.catProdotto || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[110px] truncate" title={r.tipProdotto}>{r.tipProdotto || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[130px] truncate" title={r.descProdotto}>{r.descProdotto || '-'}</TableCell>
                                    {allDomande.map((d) => (
                                      <TableCell key={d} className="text-xs text-center whitespace-nowrap">
                                        {r.domandeMap[d] ? (
                                          <Badge variant={r.domandeMap[d].toUpperCase() === 'SI' ? 'default' : 'outline'} className="text-[9px]">
                                            {r.domandeMap[d]}
                                          </Badge>
                                        ) : '-'}
                                      </TableCell>
                                    ))}
                                    <TableCell className="text-xs font-mono">{r.codiceContratto || '-'}</TableCell>
                                    <TableCell className="text-xs font-mono max-w-[130px] truncate" title={cfPiva}>{cfPiva || '-'}</TableCell>
                                    <TableCell className="text-sm">{r.nomeCliente || '-'}</TableCell>
                                    <TableCell className="text-right font-medium">{formatCurrency(parseFloat(sale.totale || '0') || 0)}</TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </table>
                        </div>
                      </ScrollableTable>
                    </div>
                  ) : (
                    <Accordion type="multiple" className="space-y-2">
                      {addettoSummaries.map((addetto) => (
                        <AccordionItem key={addetto.nomeAddetto} value={addetto.nomeAddetto} className="border rounded-lg px-2 sm:px-4">
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full pr-4 gap-1 sm:gap-2">
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                                  <User className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="text-left min-w-0">
                                  <div className="font-semibold text-sm truncate">{addetto.nomeAddetto}</div>
                                   <div className="text-sm text-muted-foreground">{addetto.pdvCodes.size} PDV</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 sm:gap-3 pl-10 sm:pl-0">
                                 <Badge variant="outline" className="text-sm font-semibold shrink-0 py-1">{addetto.vendite.length} vendite</Badge>
                                 <Badge className="text-sm font-bold bg-green-500/10 text-green-600 border-green-500/20 shrink-0 py-1 tabular-nums">{formatCurrency(addetto.totaleImporto)}</Badge>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pb-2">
                              <div className="flex flex-wrap gap-2">
                                {(Object.entries(addetto.countByPista) as [PistaCanvass, number][])
                                  .filter(([pista, c]) => c > 0 && isPistaVisible(pista))
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([pista, count]) => (
                                    <Badge
                                      key={pista}
                                       className={PISTA_CANVASS_COLORS[pista] + " text-sm gap-1 py-1"}
                                    >
                                      {PISTA_ICONS[pista]}
                                      {pistaLabels[pista]}: {count}
                                       <span className="text-xs opacity-75 tabular-nums">({formatCurrency(addetto.amountByPista[pista] || 0)})</span>
                                    </Badge>
                                  ))}
                                {addetto.countByType.prodotti > 0 && (() => {
                                  const accL = addetto.accessoriImporto;
                                  const prodNetto = addetto.amountByType.prodotti - accL + nettoIva(accL);
                                  const accIva = ivaOf(accL);
                                  return (
                                     <Badge className={TYPE_COLORS.prodotti + " text-sm py-1"}>
                                      Prodotti: {addetto.countByType.prodotti}
                                       <span className="text-xs opacity-75 ml-1 tabular-nums">({formatCurrency(prodNetto)}{accL > 0 ? " n.IVA acc." : ""})</span>
                                       {accIva > 0 && <span className="text-xs opacity-60 ml-1">IVA {formatCurrency(accIva)}</span>}
                                    </Badge>
                                  );
                                })()}
                                {addetto.countByType.servizi > 0 && (() => {
                                  const srvNetto = nettoIva(addetto.amountByType.servizi);
                                  const srvIva = ivaOf(addetto.amountByType.servizi);
                                  return (
                                     <Badge className={TYPE_COLORS.servizi + " text-sm py-1"}>
                                      Servizi: {addetto.countByType.servizi}
                                       <span className="text-xs opacity-75 ml-1 tabular-nums">({formatCurrency(srvNetto)} n.IVA)</span>
                                       {srvIva > 0 && <span className="text-xs opacity-60 ml-1">IVA {formatCurrency(srvIva)}</span>}
                                    </Badge>
                                  );
                                })()}
                              </div>
                              <CanvassCategorieDettaglio
                                categorieByPista={addetto.categorieByPista}
                                ivaByPista={addetto.ivaByPista}
                                pistaLabels={pistaLabels}
                                testIdPrefix={`addetto-${addetto.nomeAddetto}`}
                              />
                              {!componentFilterActive && (() => {
                                const addettoInc = computeIncassoTotals(addetto.vendite);
                                const hasIncasso = INCASSO_ITEMS_CONFIG.some(i => addettoInc[i.key] > 0);
                                if (!hasIncasso) return null;
                                return (
                                  <div className="mt-1">
                                    <IncassoBadges totals={addettoInc} formatter={formatCurrency} compact />
                                  </div>
                                );
                              })()}
                              {addetto.articleIncasso && (
                                <div className="mt-1">
                                  <ArticleIncassoRecap incasso={addetto.articleIncasso} formatCurrency={formatCurrency} />
                                </div>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedAddetto(addetto.nomeAddetto)}
                                data-testid={`button-view-addetto-${addetto.nomeAddetto}`}
                              >
                                Vedi tutte le vendite
                                <ChevronRight className="h-4 w-4 ml-1" />
                              </Button>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </CardContent>
              </Card>
            )}

            <GraficoAndamentoPezzi
              data={andamentoPezzi}
              pistaLabels={pistaLabels}
              piste={trendPiste}
              extras={trendExtras}
              hasExtra={trendExtras.some(k => pdvSummaries.some(p => p.pezziExtra[k] > 0))}
            />
            <TabellaPdvPistaPezzi rows={pdvSummaries} pistaLabels={pistaLabels} piste={venditePiste} extraColKeys={pezziExtraColKeys} />

            {viewMode === "vendite" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Riepilogo per Punto Vendita
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {pdvSummaries.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      Nessuna vendita importata. Vai nel pannello Super Admin per
                      importare le vendite da BiSuite.
                    </p>
                  ) : (
                    <Accordion type="multiple" className="space-y-2">
                      {pdvSummaries.map((pdv) => (
                        <AccordionItem
                          key={pdv.codicePos}
                          value={pdv.codicePos}
                          className="min-w-0 overflow-hidden border rounded-lg px-2 sm:px-4"
                        >
                          <AccordionTrigger className="min-w-0 overflow-hidden hover:no-underline">
                            <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:justify-between pr-2 sm:pr-4 gap-1 sm:gap-2">
                              <div className="flex min-w-0 max-w-full items-start gap-2 sm:items-center sm:gap-3">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                  <Store className="h-4 w-4 text-primary" />
                                </div>
                                <div className="min-w-0 flex-1 text-left">
                                  <div className="break-words text-sm font-semibold leading-tight">
                                    {pdv.nomeNegozio}
                                  </div>
                                   <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-1 text-sm leading-tight text-muted-foreground">
                                     <span className="min-w-0 break-words font-mono">{pdv.codicePos}</span>
                                    {pdv.ragioneSociale && (
                                       <span className="min-w-0 break-words font-sans">
                                         · {pdv.ragioneSociale}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex min-w-0 flex-wrap items-center gap-2 pl-10 sm:flex-nowrap sm:gap-3 sm:pl-0">
                                 <Badge variant="outline" className="text-sm font-semibold shrink-0 py-1">
                                  {pdv.totaleVendite} vendite
                                </Badge>
                                 <Badge className="text-sm font-bold bg-green-500/10 text-green-600 border-green-500/20 shrink-0 py-1 tabular-nums">
                                  {formatCurrency(pdv.totaleImporto)}
                                </Badge>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pb-2">
                              <div className="flex flex-wrap gap-2">
                                {(Object.entries(pdv.countByPista) as [PistaCanvass, number][])
                                  .filter(([pista, c]) => c > 0 && isPistaVisible(pista))
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([pista, count]) => (
                                    <Badge
                                      key={pista}
                                       className={PISTA_CANVASS_COLORS[pista] + " text-sm gap-1 py-1"}
                                    >
                                      {PISTA_ICONS[pista]}
                                      {pistaLabels[pista]}: {count}
                                       <span className="text-xs opacity-75 tabular-nums">({formatCurrency(pdv.amountByPista[pista] || 0)})</span>
                                    </Badge>
                                  ))}
                                {pdv.countByType.prodotti > 0 && (() => {
                                  const accL = pdv.accessoriImporto;
                                  const prodNetto = pdv.amountByType.prodotti - accL + nettoIva(accL);
                                  const accIva = ivaOf(accL);
                                  return (
                                     <Badge className={TYPE_COLORS.prodotti + " text-sm py-1"}>
                                      Prodotti: {pdv.countByType.prodotti}
                                       <span className="text-xs opacity-75 ml-1 tabular-nums">({formatCurrency(prodNetto)}{accL > 0 ? " n.IVA acc." : ""})</span>
                                       {accIva > 0 && <span className="text-xs opacity-60 ml-1">IVA {formatCurrency(accIva)}</span>}
                                    </Badge>
                                  );
                                })()}
                                {pdv.countByType.servizi > 0 && (() => {
                                  const srvNetto = nettoIva(pdv.amountByType.servizi);
                                  const srvIva = ivaOf(pdv.amountByType.servizi);
                                  return (
                                     <Badge className={TYPE_COLORS.servizi + " text-sm py-1"}>
                                      Servizi: {pdv.countByType.servizi}
                                       <span className="text-xs opacity-75 ml-1 tabular-nums">({formatCurrency(srvNetto)} n.IVA)</span>
                                       {srvIva > 0 && <span className="text-xs opacity-60 ml-1">IVA {formatCurrency(srvIva)}</span>}
                                    </Badge>
                                  );
                                })()}
                              </div>
                              <CanvassCategorieDettaglio
                                categorieByPista={pdv.categorieByPista}
                                ivaByPista={pdv.ivaByPista}
                                pistaLabels={pistaLabels}
                                testIdPrefix={`pdv-${pdv.codicePos}`}
                              />
                              {!componentFilterActive && (() => {
                                const pdvInc = incassoByPdv.get(pdv.codicePos);
                                if (!pdvInc) return null;
                                return (
                                  <div className="mt-1">
                                    <IncassoBadges totals={pdvInc} formatter={formatCurrency} compact />
                                  </div>
                                );
                              })()}
                              <div className="mt-1">
                                <ArticleIncassoRecap incasso={pdv.articleIncasso} formatCurrency={formatCurrency} />
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setSelectedPdvs((prev) =>
                                    prev.includes(pdv.codicePos) ? prev : [...prev, pdv.codicePos],
                                  )
                                }
                                data-testid={`button-view-pdv-${pdv.codicePos}`}
                              >
                                Vedi tutte le vendite
                                <ChevronRight className="h-4 w-4 ml-1" />
                              </Button>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </CardContent>
              </Card>
            )}

            <Card data-testid="card-lista-vendite">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-5 w-5 text-primary" />
                  {selectedPdvs.length === 1
                    ? `Vendite - ${pdvLabelFor(selectedPdvs[0])}`
                    : selectedPdvs.length > 1
                    ? `Vendite - ${selectedPdvs.length} punti vendita`
                    : "Tutte le Vendite"}
                  <Badge variant="outline" className="ml-2 text-xs">
                    {filteredSales.length} record
                  </Badge>
                  {selectedPdvs.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 ml-auto"
                      onClick={() => setSelectedPdvs([])}
                      data-testid="button-close-pdv-filter"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredSales.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Nessuna vendita trovata per i filtri selezionati
                  </p>
                ) : (
                  <ScrollableTable className="-mx-2 sm:mx-0">
                  <div className="max-h-[500px] overflow-y-auto min-w-max">
                    <table className="w-full caption-bottom text-sm min-w-[500px] sm:min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[80px] sm:w-[100px] sticky top-0 bg-background z-10">Data</TableHead>
                          <TableHead className="hidden sm:table-cell w-[80px] sticky top-0 bg-background z-10">ID BiSuite</TableHead>
                          <TableHead className="sticky top-0 bg-background z-10">Negozio</TableHead>
                          <TableHead className="hidden md:table-cell sticky top-0 bg-background z-10">Addetto</TableHead>
                          <TableHead className="hidden lg:table-cell sticky top-0 bg-background z-10">Cliente</TableHead>
                          <TableHead className="sticky top-0 bg-background z-10">Pista / Tipo</TableHead>
                          <TableHead className="hidden sm:table-cell sticky top-0 bg-background z-10">Stato</TableHead>
                          <TableHead className="text-right sticky top-0 bg-background z-10">Importo</TableHead>
                          <TableHead className="w-[40px] sm:w-[50px] sticky top-0 bg-background z-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSales.map((sale) => {
                          const sc = saleClassifications.get(sale.id);
                          return (
                            <TableRow
                              key={sale.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => setSelectedSale(sale)}
                              data-testid={`row-sale-${sale.bisuiteId}`}
                            >
                              <TableCell className="text-xs whitespace-nowrap">
                                {formatDate(sale.dataVendita)}
                              </TableCell>
                              <TableCell
                                className="hidden sm:table-cell text-xs font-mono text-muted-foreground"
                                data-testid={`cell-bisuite-id-${sale.bisuiteId}`}
                              >
                                {sale.bisuiteId}
                              </TableCell>
                              <TableCell>
                                <div className="text-sm font-medium">
                                  {sale.nomeNegozio || "-"}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {sale.codicePos || "-"}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm hidden md:table-cell">
                                {sale.nomeAddetto || "-"}
                              </TableCell>
                              <TableCell className="text-sm hidden lg:table-cell">
                                {sale.nomeCliente || "-"}
                              </TableCell>
                              <TableCell>
                                <SalePistaBadges classification={sc} pistaLabels={pistaLabels} hideLegacyIva={isVfModel} />
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                <Badge
                                  variant={
                                    sale.stato === "FINALIZZATA IN CASSA"
                                      ? "default"
                                      : "outline"
                                  }
                                  className="text-[10px]"
                                >
                                  {sale.stato || "-"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(
                                  parseFloat(sale.totale || "0") || 0
                                )}
                              </TableCell>
                              <TableCell>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </table>
                  </div>
                  </ScrollableTable>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <SaleDetailDialog
        sale={selectedSale}
        classification={selectedSale ? saleClassifications.get(selectedSale.id) : undefined}
        canvassIndex={canvassIndex}
        isVfModel={isVfModel}
        kpiRules={kpiRules}
        pistaLabels={pistaLabels}
        onClose={() => setSelectedSale(null)}
      />

      <Dialog open={reconcileOpen} onOpenChange={(o) => !reconcileMutation.isPending && setReconcileOpen(o)}>
        <ResponsiveDialogContent className="max-w-md" data-testid="dialog-reconcile">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Route className="h-4 w-4" />
              Allinea con BiSuite
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Riscarica le vendite del periodo selezionato e <strong>elimina in locale</strong> le vendite che su BiSuite sono state cancellate o accorpate.
              Le vendite ANNULLATA vengono comunque mantenute.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reconcile-from">Da</Label>
                <Input
                  id="reconcile-from"
                  type="date"
                  value={reconcileFrom}
                  onChange={(e) => setReconcileFrom(e.target.value)}
                  data-testid="input-reconcile-from"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reconcile-to">A</Label>
                <Input
                  id="reconcile-to"
                  type="date"
                  value={reconcileTo}
                  onChange={(e) => setReconcileTo(e.target.value)}
                  data-testid="input-reconcile-to"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
              <div className="flex gap-1.5 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const d = getDefaultDates();
                    setReconcileFrom(d.from);
                    setReconcileTo(d.to);
                  }}
                  disabled={reconcileMutation.isPending}
                  data-testid="button-reconcile-current-month"
                >
                  Mese corrente
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const now = new Date();
                    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    const to = new Date(now.getFullYear(), now.getMonth(), 0);
                    setReconcileFrom(format(from, "yyyy-MM-dd"));
                    setReconcileTo(format(to, "yyyy-MM-dd"));
                  }}
                  disabled={reconcileMutation.isPending}
                  data-testid="button-reconcile-previous-month"
                >
                  Mese precedente
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReconcileOpen(false)}
                  disabled={reconcileMutation.isPending}
                  data-testid="button-reconcile-cancel"
                >
                  Annulla
                </Button>
                <Button
                  size="sm"
                  onClick={() => reconcileMutation.mutate({ from: reconcileFrom, to: reconcileTo })}
                  disabled={reconcileMutation.isPending || !reconcileFrom || !reconcileTo || reconcileFrom > reconcileTo}
                  data-testid="button-reconcile-confirm"
                >
                  {reconcileMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Route className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {reconcileMutation.isPending ? "Allineamento..." : "Allinea"}
                </Button>
              </div>
            </div>
          </div>
        </ResponsiveDialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Task #377 — dettaglio compatto delle categorie canvass vendute, raggruppate
 * per pista (usato nel contenuto espanso di PDV e Addetto). Evidenzia i pezzi
 * IVA per categoria. Layout a chip/righe che regge anche su smartphone.
 */
function CanvassCategorieDettaglio({
  categorieByPista,
  ivaByPista,
  pistaLabels,
  testIdPrefix,
}: {
  categorieByPista: CategorieByPista;
  ivaByPista: Partial<Record<PistaCanvass, number>>;
  pistaLabels: Record<PistaCanvass, string>;
  testIdPrefix: string;
}) {
  const piste = (Object.entries(categorieByPista) as [PistaCanvass, Record<string, { pezzi: number; iva: number }>][])
    .filter(([, cats]) => Object.keys(cats).length > 0)
    .sort(([, a], [, b]) => {
      const tot = (c: Record<string, { pezzi: number }>) => Object.values(c).reduce((s, x) => s + x.pezzi, 0);
      return tot(b) - tot(a);
    });
  if (piste.length === 0) return null;
  // Task #497 — come nel riquadro Canvass globale, su mobile ogni riga
  // categoria mantiene una colonna numerica comune: conteggi incolonnati a
  // destra e slot "(N IVA)" riservato anche sulle righe senza IVA, così i
  // valori non ballano a seconda della lunghezza delle etichette. Le
  // min-width sono solo mobile (sm:min-w-0) per lasciare il desktop invariato.
  const hasAnyIva = piste.some(([, cats]) => Object.values(cats).some((v) => v.iva > 0));
  return (
    <div className="rounded-lg border bg-muted/20 p-2 sm:p-3" data-testid={`${testIdPrefix}-categorie-canvass`}>
       <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
        Categorie canvass
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
        {piste.map(([pista, cats]) => {
          const iva = ivaByPista[pista] || 0;
          return (
            <div key={pista} className="min-w-0">
               <div className="flex items-center gap-1.5 text-sm font-semibold mb-1">
                {PISTA_ICONS[pista]}
                <span>{pistaLabels[pista]}</span>
                {iva > 0 && (
                   <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    · {iva} IVA
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {Object.entries(cats)
                  .sort(([, a], [, b]) => b.pezzi - a.pezzi)
                  .map(([nome, v]) => (
                     <div
                       key={nome}
                       className="flex items-center justify-between gap-2 text-sm min-h-7"
                       data-testid={`${testIdPrefix}-cat-row-${pista}-${nome}`}
                     >
                      <span className="truncate text-muted-foreground">{nome}</span>
                      <span className="flex shrink-0 items-center whitespace-nowrap font-semibold tabular-nums">
                        <span
                          className="min-w-8 text-right sm:min-w-0"
                          data-testid={`${testIdPrefix}-cat-count-${pista}-${nome}`}
                        >
                          {v.pezzi}
                        </span>
                        {hasAnyIva && (
                          v.iva > 0 ? (
                            <span
                              className="ml-1 min-w-[3.75rem] text-right font-medium text-indigo-600 dark:text-indigo-400 sm:min-w-0"
                              data-testid={`${testIdPrefix}-cat-iva-${pista}-${nome}`}
                            >
                              ({v.iva} IVA)
                            </span>
                          ) : (
                            <span className="ml-1 min-w-[3.75rem] sm:ml-0 sm:min-w-0" aria-hidden="true" />
                          )
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function SalePistaBadges({
  classification,
  pistaLabels = PISTA_CANVASS_LABELS,
  hideLegacyIva = false,
}: {
  classification?: SaleClassification;
  pistaLabels?: Record<PistaCanvass, string>;
  hideLegacyIva?: boolean;
}) {
  if (!classification) return <span className="text-xs text-muted-foreground">-</span>;

  const pistaBadges = (Object.entries(classification.countByPista) as [PistaCanvass, number][])
    .filter(([pista, c]) => c > 0 && !(hideLegacyIva && pista === "iva"))
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="flex flex-wrap gap-1">
      {pistaBadges.map(([pista, count]) => (
        <Badge
          key={pista}
           className={PISTA_CANVASS_COLORS[pista] + " text-xs px-2 py-0.5 gap-0.5"}
        >
          {PISTA_ICONS[pista]}
          {pistaLabels[pista]}
          {count > 1 && <span className="ml-0.5 font-bold">x{count}</span>}
        </Badge>
      ))}
      {classification.countByType.prodotti > 0 && (
         <Badge className={TYPE_COLORS.prodotti + " text-xs px-2 py-0.5"}>
          Prod. {classification.countByType.prodotti > 1 ? `x${classification.countByType.prodotti}` : ""}
        </Badge>
      )}
      {classification.countByType.servizi > 0 && (
         <Badge className={TYPE_COLORS.servizi + " text-xs px-2 py-0.5"}>
          Serv. {classification.countByType.servizi > 1 ? `x${classification.countByType.servizi}` : ""}
        </Badge>
      )}
    </div>
  );
}

function SaleDetailDialog({
  sale,
  classification,
  canvassIndex,
  isVfModel = false,
  kpiRules,
  pistaLabels = PISTA_CANVASS_LABELS,
  onClose,
}: {
  sale: BisuiteSale | null;
  classification?: SaleClassification;
  canvassIndex?: ReturnType<typeof buildCanvassIndex> | null;
  isVfModel?: boolean;
  kpiRules?: CanvassKpiRule[] | null;
  pistaLabels?: Record<PistaCanvass, string>;
  onClose: () => void;
}) {
  if (!sale) return null;

  const raw = sale.rawData || {};
  // Task #462 — mostra sempre ENTRAMBE le attribuzioni quando disponibili,
  // così l'utente può verificare origine e destinazione della vendita.
  const pdvOrigine = extractPdvOrigine(raw);
  const pdvDestinazione = extractPdvDestinazione(raw);
  const articoli = raw.articoli || [];
  const pagamento = raw.pagamento || {};
  const cliente = raw.cliente || {};

  const formatCurrency = (val: string | number) => {
    const num = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(num)) return "€ 0,00";
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(num);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "-";
    try {
      return format(new Date(dateStr), "dd/MM/yyyy HH:mm", { locale: it });
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={!!sale} onOpenChange={() => onClose()}>
      <ResponsiveDialogContent className="sm:max-w-6xl sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Vendita #{sale.bisuiteId}
            <Badge variant="outline" className="ml-2">
              {sale.stato}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InfoBlock
              icon={<Calendar className="h-4 w-4" />}
              label="Data Vendita"
              value={formatDate(sale.dataVendita)}
            />
            <InfoBlock
              icon={<Store className="h-4 w-4" />}
              label="Negozio (origine)"
              value={pdvOrigine?.nomeNegozio || pdvOrigine?.codicePos || sale.nomeNegozio || "-"}
              sub={pdvOrigine?.codicePos || undefined}
            />
            {pdvDestinazione && (
              <InfoBlock
                icon={<Store className="h-4 w-4" />}
                label="PDV Destinazione"
                value={pdvDestinazione.nomeNegozio || pdvDestinazione.codicePos || "-"}
                sub={pdvDestinazione.codicePos || undefined}
              />
            )}
            <InfoBlock
              icon={<User className="h-4 w-4" />}
              label="Addetto"
              value={sale.nomeAddetto || "-"}
            />
            <InfoBlock
              icon={<Euro className="h-4 w-4" />}
              label="Totale"
              value={formatCurrency(sale.totale || "0")}
              highlight
            />
          </div>

          {classification && (
            <div className="flex flex-wrap gap-2">
              <SalePistaBadges classification={classification} pistaLabels={pistaLabels} hideLegacyIva={isVfModel} />
            </div>
          )}

          {cliente.nominativo && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Cliente
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Nome</span>
                    <p className="font-medium">{cliente.nominativo}</p>
                  </div>
                  {cliente.codiceFiscale && (
                    <div>
                      <span className="text-muted-foreground text-xs">CF</span>
                      <p className="font-mono text-xs">{cliente.codiceFiscale}</p>
                    </div>
                  )}
                  {cliente.tel1 && (
                    <div>
                      <span className="text-muted-foreground text-xs">Tel</span>
                      <p>{cliente.tel1}</p>
                    </div>
                  )}
                  {cliente.email && (
                    <div>
                      <span className="text-muted-foreground text-xs">Email</span>
                      <p className="text-xs">{cliente.email}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {articoli.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Articoli ({articoli.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-3">
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrizione</TableHead>
                      <TableHead className="hidden sm:table-cell">Categoria</TableHead>
                      <TableHead className="hidden md:table-cell">Tipologia</TableHead>
                      <TableHead>Pista</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Canone</TableHead>
                      <TableHead className="text-right">Prezzo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {articoli.map((art: any, idx: number) => {
                      const cls = classifyArticle(art, canvassIndex, kpiRules);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-sm font-medium">
                            <div>
                              {art.descrizione || art.codice || "-"}
                              {art.marca && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  ({art.marca})
                                </span>
                              )}
                            </div>
                            {(() => {
                              const impScont = parseFloat(art.dettaglio?.importoScontrino || "0") || 0;
                              const impFin = parseFloat(art.dettaglio?.importoFinanziato || "0") || 0;
                              const impCre = parseFloat(art.dettaglio?.importoCredito || "0") || 0;
                              const prezzo = parseFloat(art.dettaglio?.prezzo || "0") || 0;
                              const flag = art.dettaglio?.scontrino;
                              const isScontrinato = flag === 1 || flag === "1" || flag === true;
                              const importoMostrato = impScont > 0 ? impScont : prezzo;
                              const badges: { key: string; label: string; cls: string }[] = [];
                              if (isScontrinato) {
                                badges.push({ key: "s", label: `Scontrinato ${formatCurrency(importoMostrato)}`, cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" });
                              } else if (importoMostrato > 0) {
                                badges.push({ key: "fs", label: `Fuori scontrino ${formatCurrency(importoMostrato)}`, cls: "bg-rose-500/10 text-rose-700 border-rose-500/20" });
                              }
                              if (impFin > 0) badges.push({ key: "f", label: `Finanziato ${formatCurrency(impFin)}`, cls: "bg-purple-500/10 text-purple-700 border-purple-500/20" });
                              if (impCre > 0) badges.push({ key: "c", label: `Credito/VAR ${formatCurrency(impCre)}`, cls: "bg-amber-500/10 text-amber-700 border-amber-500/20" });
                              if (badges.length === 0) return null;
                              return (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {badges.map(b => (
                                    <Badge key={b.key} variant="outline" className={`${b.cls} text-[10px] font-normal`} data-testid={`art-incasso-${b.key}-${idx}`}>
                                      {b.label}
                                    </Badge>
                                  ))}
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {cls ? (
                              <Badge className={cls.pista ? PISTA_CANVASS_COLORS[cls.pista] : TYPE_COLORS[cls.type] + " text-xs"}>
                                {art.categoria?.nome || "-"}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                {art.categoria?.nome || "-"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs hidden md:table-cell">
                            {art.tipologia?.nome || "-"}
                          </TableCell>
                          <TableCell>
                            {cls?.pista ? (
                              <Badge className={PISTA_CANVASS_COLORS[cls.pista] + " text-[10px] gap-0.5"}>
                                {PISTA_ICONS[cls.pista]}
                                {pistaLabels[cls.pista]}
                              </Badge>
                            ) : cls ? (
                              <Badge className={TYPE_COLORS[cls.type] + " text-[10px]"}>
                                {TYPE_LABELS[cls.type]}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm hidden sm:table-cell">
                            {art.dettaglio?.canone &&
                            art.dettaglio.canone !== "0" &&
                            art.dettaglio.canone !== "0.00"
                              ? `${formatCurrency(art.dettaglio.canone)}/mese`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatCurrency(art.dettaglio?.prezzo || "0")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>

                {articoli.some(
                  (a: any) =>
                    a.dettaglio?.domandeRisposte &&
                    a.dettaglio.domandeRisposte.length > 0
                ) && (
                  <details className="mt-3">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Domande / Risposte per articolo
                    </summary>
                    <div className="mt-2 space-y-2">
                      {articoli
                        .filter(
                          (a: any) =>
                            a.dettaglio?.domandeRisposte?.length > 0
                        )
                        .map((art: any, idx: number) => (
                          <div
                            key={idx}
                            className="bg-muted/30 rounded p-2 text-xs"
                          >
                            <p className="font-medium mb-1">
                              {art.descrizione}
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                              {art.dettaglio.domandeRisposte.map(
                                (qr: any, qIdx: number) => (
                                  <div key={qIdx}>
                                    <span className="text-muted-foreground">
                                      {qr.domandaTesto}:
                                    </span>{" "}
                                    <span
                                      className={
                                        qr.risposta === "SI"
                                          ? "text-green-600 font-medium"
                                          : ""
                                      }
                                    >
                                      {qr.risposta}
                                    </span>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          )}

          {pagamento && Object.keys(pagamento).filter(k => k !== "id").length > 0 && (() => {
            const saleIncasso = computeIncassoTotals([sale]);
            const fmtC = (val: number) => {
              if (isNaN(val)) return "€ 0,00";
              return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(val);
            };
            return (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    Modalità di Incasso
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <IncassoBadges totals={saleIncasso} formatter={fmtC} compact />
                </CardContent>
              </Card>
            );
          })()}

          {pagamento && Object.keys(pagamento).filter(k => k !== "id").length > 0 && (
            <details>
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Dettaglio Pagamento (raw)
              </summary>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-muted/30 rounded p-3">
                {Object.entries(pagamento)
                  .filter(([k]) => k !== "id")
                  .map(([key, val]) => (
                    <div key={key}>
                      <span className="text-muted-foreground">{key}:</span>{" "}
                      <span className="font-medium">
                        {formatCurrency(val as string)}
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </div>
      </ResponsiveDialogContent>
    </Dialog>
  );
}

function InfoBlock({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p
        className={`text-sm font-medium ${highlight ? "text-green-600" : ""}`}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs text-muted-foreground font-mono">{sub}</p>
      )}
    </div>
  );
}

/** Accumula un articolo canvass nel breakdown categorie per pista. */
function accumulaCategoriaCanvass(
  target: CategorieByPista,
  ivaByPista: Partial<Record<PistaCanvass, number>>,
  art: { pista?: PistaCanvass; categoriaNome: string; tipologiaNome: string; descrizione: string },
) {
  if (!art.pista) return;
  const iva = isPezzoIva(art);
  if (iva) ivaByPista[art.pista] = (ivaByPista[art.pista] || 0) + 1;
  const nome = (art.categoriaNome || art.tipologiaNome || art.descrizione || "N/D").toUpperCase().trim() || "N/D";
  if (!target[art.pista]) target[art.pista] = {};
  const perPista = target[art.pista]!;
  if (!perPista[nome]) perPista[nome] = { pezzi: 0, iva: 0 };
  perPista[nome].pezzi++;
  if (iva) perPista[nome].iva++;
}
