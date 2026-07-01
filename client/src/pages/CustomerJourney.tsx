import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect, memo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { AppNavbar } from "@/components/AppNavbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Route as RouteIcon, RefreshCw, ArrowLeft, ArrowRight, CheckCircle2, Circle,
  Search, User, Building2, Loader2, Coins, Pencil,
  FileText, FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown,
  LayoutGrid, BarChart3, Store, Users, TrendingUp, Wallet, Calendar,
  ChevronRight, ChevronDown,
} from "lucide-react";
import {
  CJ_DRIVER_LABELS, CJ_DRIVER_ORDER, CJ_ITEM_STATE_LABELS, CJ_ACTIVE_STATES,
  aggregateReport, matchesCjFilters,
  CJ_GETTONE_TABLE, CJ_MAX_PISTE,
  buildGettoneJourneys, filterGettoneByDate, filterGettoneByInsertDate,
  aggregateGettone, gettoneTotals,
  crossSellPercentuali, gettoneDetailByKey,
} from "@shared/customerJourney";
import { CJ_ITEM_STATES } from "@shared/schema";
import type { CustomerJourney, CustomerJourneyItem, CjItemState, CjDriver } from "@shared/schema";
import type {
  CjReportRow, CjReportGroup, CjListFilters,
  CjGettoneGroup, CjGettoneTotals, CjGettoneJourney, CjGettoneDetailRow,
} from "@shared/customerJourney";
import { CJ_DRIVER_ICONS, CJ_DRIVER_COLORS } from "@/lib/customerJourneyIcons";
import {
  computeTimeline, groupByNegozio, cjDriverColor, isFadedState,
  monthIndex, monthIndexLabel, itemNegozio,
  computeItemValidity, CJ_VALIDITY_LABELS, CJ_VALIDITY_REASONS,
  cjDaysToT6, cjT6Deadline, cjScadenzaSortValue, cjScadenzaInfo,
  cjOpenedFromTriggerDate,
  type CjScadenzaTone,
} from "@/lib/customerJourneyTimeline";
import {
  exportJourneyPdf, exportJourneyExcel,
  exportJourneyListPdf, exportJourneyListExcel,
} from "@/lib/customerJourneyExport";

interface DriverSummary {
  driver: string;
  activated: boolean;
  count: number;
}

type JourneyListItem = CustomerJourney & {
  drivers: DriverSummary[];
  valore?: number;
  pdvs?: string[];
  addetti?: string[];
  states?: string[];
};

type SortKey = "data" | "nome" | "completamento" | "valore" | "scadenza";
type SortDir = "asc" | "desc";

type CjView = "schede" | "report";
type ReportDim = "negozio" | "addetto" | "cliente";
type ReportTab = "analisi" | "dettaglio";
type GettoneDim = "negozio" | "addetto";

const SORT_LABELS: Record<SortKey, string> = {
  data: "Data apertura",
  nome: "Nome cliente",
  completamento: "% completamento",
  valore: "Valore cliente",
  scadenza: "In scadenza (T6)",
};

interface ItemDetailsPayload {
  dataAttivazione: string | null;
  pdvDestinazione: string | null;
  imei: string | null;
  rata: string | null;
}

interface JourneyDetail {
  journey: CustomerJourney;
  items: CustomerJourneyItem[];
  drivers: DriverSummary[];
}

interface CjConfig {
  triggerDate: string;
  defaultTriggerDate: string;
}

const STATE_VARIANTS: Record<string, string> = {
  inserito: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  in_lavorazione: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  attivato: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  ko: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  pagato: "bg-green-600/15 text-green-700 dark:text-green-300 border-green-600/30",
  annullato: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  stornato: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30",
  riaccreditato: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
};

// Referente / persona fisica del cliente (Nome Cognome, fallback nominativo).
function journeyReferente(j: CustomerJourney): string {
  const full = [j.nome, j.cognome].filter(Boolean).join(" ").trim();
  return full || j.nominativo || "";
}

function journeyTitle(j: CustomerJourney): string {
  if (j.customerType === "azienda") {
    return j.ragioneSociale || journeyReferente(j) || j.customerKey;
  }
  return journeyReferente(j) || j.customerKey;
}

// Riga secondaria "in secondo piano": per i business, quando il titolo è la
// ragione sociale, mostra il referente amministrativo. Vuoto altrimenti
// (così non si duplica il titolo).
function journeySubtitle(j: CustomerJourney): string {
  if (j.customerType !== "azienda" || !j.ragioneSociale) return "";
  const ref = journeyReferente(j);
  return ref && ref !== j.ragioneSociale ? ref : "";
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("it-IT");
}

// Formatta una data usando le sue componenti UTC: serve per le date "ancorate"
// in UTC (es. la scadenza T6 = fine mese alle 23:59:59.999 UTC) così la
// localizzazione italiana (UTC+1/+2) non le faccia rotolare al giorno dopo.
function fmtDateUTC(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("it-IT", { timeZone: "UTC" });
}

function fmtEuro(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  return v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
}

// Percentuale di completamento driver di una scheda (driver attivati / totale).
// Funzione pura a livello di modulo: usata dall'ordinamento della lista schede.
function journeyPct(j: JourneyListItem): number {
  const total = CJ_DRIVER_ORDER.length;
  const active = CJ_DRIVER_ORDER.filter(
    (d) => j.drivers?.find((s) => s.driver === d)?.activated,
  ).length;
  return total > 0 ? active / total : 0;
}

// Numero di piste cross-sell (driver NON-mobile) attive di una scheda. Una
// journey è "chiusa" quando arriva a CJ_MAX_PISTE. Usata dall'ordinamento
// "In scadenza" per dare priorità alle journey ancora aperte.
function journeyPisteAttive(j: JourneyListItem): number {
  return CJ_DRIVER_ORDER.filter(
    (d) => d !== "mobile" && j.drivers?.find((s) => s.driver === d)?.activated,
  ).length;
}

const REPORT_DIM_LABEL: Record<ReportDim, string> = {
  negozio: "Negozio",
  addetto: "Addetto",
  cliente: "Cliente / Ragione sociale",
};

// Default vuoti a riferimento stabile: usarli al posto di `?? []` evita di
// generare un nuovo array a ogni render quando la query non ha ancora dati,
// così i useMemo a valle non si invalidano inutilmente.
const EMPTY_JOURNEYS: JourneyListItem[] = [];
const EMPTY_REPORT_ROWS: CjReportRow[] = [];

// Sotto-viste memoizzate: si ri-renderizzano solo quando cambiano le loro
// props (riferimenti stabili grazie ai useMemo/useCallback nel componente
// pagina), così l'apertura di una scheda o la digitazione nei filtri non le
// ricalcola inutilmente. Le dichiarazioni `*Impl` sono hoisted.
const ReportView = memo(ReportViewImpl);
const AnalisiView = memo(AnalisiViewImpl);
const JourneyDetailView = memo(JourneyDetailViewImpl);

// Numero di colonne della griglia schede in base alla larghezza viewport,
// allineato ai breakpoint Tailwind usati nel layout (md=768, lg=1024).
function colsForWidth(w: number): number {
  if (w >= 1024) return 3;
  if (w >= 768) return 2;
  return 1;
}

function useResponsiveColumns(): number {
  const [cols, setCols] = useState(() =>
    typeof window === "undefined" ? 3 : colsForWidth(window.innerWidth),
  );
  useEffect(() => {
    const onResize = () => setCols(colsForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

// Offset assoluto (dal top del documento) di un elemento, ricalcolato al resize
// e ad ogni layout: serve come `scrollMargin` per i window virtualizer, così la
// finestra virtuale è ancorata alla posizione reale della lista/tabella anche
// quando i controlli sopra cambiano altezza (filtri, banner, ecc.).
function useDocumentOffset<T extends HTMLElement>(ref: React.RefObject<T>): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (el) setOffset(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  return offset;
}

// Classi Tailwind per tono scadenza T6 (bordo+testo), condivise fra card lista
// e scheda di dettaglio così i colori restano allineati.
const CJ_SCADENZA_TONE_CLASS: Record<CjScadenzaTone, string> = {
  red: "border-red-500/40 text-red-600 dark:text-red-400",
  amber: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  emerald: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
};
// Anello di evidenza per le card urgenti (da contattare) nella griglia.
const CJ_SCADENZA_RING_CLASS: Record<CjScadenzaTone, string> = {
  red: "ring-1 ring-red-500/50",
  amber: "ring-1 ring-amber-500/50",
  emerald: "",
};

// Card singola di una scheda cliente, memoizzata: con la virtualizzazione si
// montano/smontano molte card durante lo scroll, quindi evitiamo di
// ri-renderizzare quelle invariate (onSelect è stabile via useCallback).
const JourneyCard = memo(function JourneyCard({
  j,
  onSelect,
}: {
  j: JourneyListItem;
  onSelect: (id: string) => void;
}) {
  const drivers = CJ_DRIVER_ORDER.map((d) => ({
    driver: d,
    activated: j.drivers?.find((s) => s.driver === d)?.activated ?? false,
  }));
  const activeCount = drivers.filter((d) => d.activated).length;
  const total = drivers.length;
  const pct = Math.round((activeCount / total) * 100);
  // Scadenza T6: badge sempre visibile per le journey ancora "aperte" (verde se
  // c'è tempo), con anello di evidenza SOLO quando è urgente (scaduta, oggi o
  // entro 30 giorni) → così si notano subito i clienti in scadenza da
  // contattare senza nascondere l'informazione sugli altri.
  const scadenza =
    j.status === "aperta" ? cjScadenzaInfo(cjDaysToT6(j.openedAt)) : null;
  const scadenzaUrgente = scadenza?.urgent ? scadenza : null;
  return (
    <Card
      className={`cursor-pointer hover-elevate transition-all flex flex-col ${scadenzaUrgente ? CJ_SCADENZA_RING_CLASS[scadenzaUrgente.tone] : ""}`}
      onClick={() => onSelect(j.id)}
      data-testid={`card-journey-${j.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2 min-w-0">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${j.customerType === "azienda" ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300" : "bg-sky-500/15 text-sky-600 dark:text-sky-300"}`}>
              {j.customerType === "azienda" ? (
                <Building2 className="h-4 w-4" />
              ) : (
                <User className="h-4 w-4" />
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate" data-testid={`text-journey-name-${j.id}`}>
                {journeyTitle(j)}
              </span>
              {journeySubtitle(j) && (
                <span
                  className="truncate text-xs font-normal text-muted-foreground"
                  data-testid={`text-journey-referente-${j.id}`}
                >
                  {journeySubtitle(j)}
                </span>
              )}
            </span>
          </CardTitle>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge
              variant="outline"
              className={`text-xs ${j.status === "aperta" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
              data-testid={`badge-status-${j.id}`}
            >
              {j.status === "aperta" ? "Aperta" : "Chiusa"}
            </Badge>
            {scadenza && (
              <Badge
                variant="outline"
                className={`text-xs ${CJ_SCADENZA_TONE_CLASS[scadenza.tone]}`}
                data-testid={`badge-scadenza-${j.id}`}
                title={
                  scadenza.urgent
                    ? "Cliente in scadenza da contattare (T6)"
                    : "Scadenza per completare il cross-sell (T6)"
                }
              >
                <Calendar className="h-3 w-3 mr-1" />
                {scadenza.label}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription className="text-xs">
          {j.customerKey} · aperta il {fmtDate(j.openedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Driver attivati</span>
          <span className="font-semibold tabular-nums" data-testid={`text-driver-count-${j.id}`}>
            {activeCount}/{total}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Valore cliente</span>
          <span className="font-semibold tabular-nums" data-testid={`text-valore-${j.id}`}>
            {fmtEuro(j.valore)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {drivers.map((d) => (
            <div
              key={d.driver}
              className={`flex items-center gap-1 rounded-md border px-1.5 py-1 ${d.activated ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-dashed border-border bg-muted/30 text-muted-foreground"}`}
              data-testid={`card-driver-${d.driver}-${j.id}`}
              title={`${CJ_DRIVER_LABELS[d.driver]}: ${d.activated ? "attivato" : "attivabile"}`}
            >
              {d.activated ? (
                <CheckCircle2 className="h-3 w-3 shrink-0" />
              ) : (
                <Circle className="h-3 w-3 shrink-0 opacity-50" />
              )}
              {(() => {
                const Icon = CJ_DRIVER_ICONS[d.driver as CjDriver];
                return Icon ? <Icon className="h-3 w-3 shrink-0" /> : null;
              })()}
              <span className="truncate text-[10px] font-medium leading-tight">
                {CJ_DRIVER_LABELS[d.driver]}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
});

// Griglia schede virtualizzata sullo scroll della finestra: renderizza solo le
// righe (di `cols` card) visibili + overscan, così migliaia di schede non
// montano migliaia di nodi DOM tutti insieme. Le altezze variabili (sottotitolo
// referente) sono misurate via `measureElement`.
function VirtualJourneyGrid({
  journeys,
  onSelect,
}: {
  journeys: JourneyListItem[];
  onSelect: (id: string) => void;
}) {
  const cols = useResponsiveColumns();
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useDocumentOffset(parentRef);
  const rowCount = Math.ceil(journeys.length / cols);
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => 236,
    overscan: 3,
    scrollMargin,
  });
  return (
    <div
      ref={parentRef}
      style={{ position: "relative", height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((vr) => {
        const start = vr.index * cols;
        const rowItems = journeys.slice(start, start + cols);
        return (
          <div
            key={vr.key}
            data-index={vr.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vr.start - scrollMargin}px)`,
            }}
          >
            <div
              className="grid gap-3 pb-3"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {rowItems.map((j) => (
                <JourneyCard key={j.id} j={j} onSelect={onSelect} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CustomerJourneyPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<CjView>("schede");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"tutti" | "privato" | "azienda">("tutti");
  const [pdvFilter, setPdvFilter] = useState<string>("tutti");
  const [addettoFilter, setAddettoFilter] = useState<string>("tutti");
  const [stateFilter, setStateFilter] = useState<string>("tutti");
  const [reportDim, setReportDim] = useState<ReportDim>("negozio");
  const [reportTab, setReportTab] = useState<ReportTab>("analisi");
  const [gettoneDim, setGettoneDim] = useState<GettoneDim>("negozio");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [saturation, setSaturation] = useState<number>(100);
  const [extraProdotti, setExtraProdotti] = useState<number>(CJ_MAX_PISTE);
  const [sortKey, setSortKey] = useState<SortKey>("data");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [triggerDateInput, setTriggerDateInput] = useState<string>("");

  const isAdmin = ["super_admin", "admin"].includes(profile?.role || "");
  const [listPdfPending, setListPdfPending] = useState(false);

  const journeysQuery = useQuery<JourneyListItem[]>({
    queryKey: ["/api/customer-journeys"],
  });

  const detailQuery = useQuery<JourneyDetail>({
    queryKey: ["/api/customer-journeys", selectedId],
    enabled: !!selectedId,
  });

  const reportQuery = useQuery<CjReportRow[]>({
    queryKey: ["/api/customer-journeys/report"],
    enabled: !selectedId && view === "report",
  });

  // Caricata per TUTTI i ruoli (non solo admin): il floor dell'Analisi gettoni
  // alla data trigger deve valere anche per gli operatori, altrimenti vedrebbero
  // SIM antecedenti al cutover. La modifica del valore resta admin-only (PUT).
  const configQuery = useQuery<CjConfig>({
    queryKey: ["/api/customer-journey-config"],
  });

  useEffect(() => {
    if (configQuery.data?.triggerDate) {
      // L'input <type="month"> vuole "YYYY-MM"; la config è salvata come
      // data completa "YYYY-MM-DD" (primo del mese), quindi tronchiamo.
      setTriggerDateInput(configQuery.data.triggerDate.slice(0, 7));
    }
  }, [configQuery.data?.triggerDate]);

  const triggerDateLabel = configQuery.data?.triggerDate
    ? fmtDate(configQuery.data.triggerDate)
    : "";

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/customer-journeys/reconcile");
      return res.json();
    },
    onSuccess: (data: { journeys?: number; items?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys/report"] });
      toast({
        title: "Rigenerazione completata",
        description: `${data?.journeys ?? 0} journey, ${data?.items ?? 0} contratti elaborati.`,
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Rigenerazione fallita",
        variant: "destructive",
      });
    },
  });

  const configMutation = useMutation({
    mutationFn: async (triggerDate: string) => {
      const res = await apiRequest("PUT", "/api/customer-journey-config", { triggerDate });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journey-config"] });
      toast({
        title: "Mese aggiornato",
        description: "Rigenera da BiSuite per applicare il nuovo mese.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Salvataggio data fallito",
        variant: "destructive",
      });
    },
  });

  const stateMutation = useMutation({
    mutationFn: async ({ id, state }: { id: string; state: CjItemState }) => {
      const res = await apiRequest("PATCH", `/api/customer-journey-items/${id}/state`, { state });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys/report"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Aggiornamento stato fallito",
        variant: "destructive",
      });
    },
  });

  const gettoneMutation = useMutation({
    mutationFn: async ({ id, confirmed }: { id: string; confirmed: boolean }) => {
      const res = await apiRequest("PATCH", `/api/customer-journey-items/${id}/gettone`, { confirmed });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys", selectedId] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Conferma gettone fallita",
        variant: "destructive",
      });
    },
  });

  const detailsMutation = useMutation({
    mutationFn: async ({ id, details }: { id: string; details: ItemDetailsPayload }) => {
      const res = await apiRequest("PATCH", `/api/customer-journey-items/${id}/details`, details);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys", selectedId] });
      toast({ title: "Dettagli aggiornati" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Aggiornamento dettagli fallito",
        variant: "destructive",
      });
    },
  });

  const ragioneSocialeMutation = useMutation({
    mutationFn: async ({ id, ragioneSociale }: { id: string; ragioneSociale: string | null }) => {
      const res = await apiRequest("PATCH", `/api/customer-journeys/${id}/ragione-sociale`, { ragioneSociale });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-journeys"] });
      toast({ title: "Ragione sociale aggiornata" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Aggiornamento ragione sociale fallito",
        variant: "destructive",
      });
    },
  });

  const allJourneys = journeysQuery.data ?? EMPTY_JOURNEYS;
  const reportRows = reportQuery.data ?? EMPTY_REPORT_ROWS;

  // Mostra SOLO le journey aperte a partire dalla data configurata: le journey
  // residue di mesi precedenti (dati storici anteriori all'ultimo cambio della
  // "Data di apertura journey") restano nascoste, coerentemente con "le journey
  // si aprono da questa data". Il floor è la mezzanotte della data configurata.
  const triggerDate = configQuery.data?.triggerDate;
  const journeys = useMemo(
    () => allJourneys.filter((j) => cjOpenedFromTriggerDate(j.openedAt, triggerDate)),
    [allJourneys, triggerDate],
  );

  // Opzioni dei filtri Negozio/Operatore/Stato: unione dei valori distinti
  // presenti nelle schede (facet) e nelle righe report, così entrambe le viste
  // condividono lo stesso menù.
  const pdvOptions = useMemo(() => {
    const s = new Set<string>();
    for (const j of journeys) for (const p of j.pdvs ?? []) if (p) s.add(p);
    for (const r of reportRows) if (r.pdv) s.add(r.pdv);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "it"));
  }, [journeys, reportRows]);
  const addettoOptions = useMemo(() => {
    const s = new Set<string>();
    for (const j of journeys) for (const a of j.addetti ?? []) if (a) s.add(a);
    for (const r of reportRows) if (r.addetto) s.add(r.addetto);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "it"));
  }, [journeys, reportRows]);
  const stateOptions = useMemo(() => {
    const s = new Set<string>();
    for (const j of journeys) for (const st of j.states ?? []) if (st) s.add(st);
    for (const r of reportRows) if (r.state) s.add(r.state);
    return CJ_ITEM_STATES.filter((st) => s.has(st));
  }, [journeys, reportRows]);

  const activeFilters: CjListFilters = useMemo(() => ({
    typeFilter, pdvFilter, addettoFilter, stateFilter, search,
  }), [typeFilter, pdvFilter, addettoFilter, stateFilter, search]);

  // Lista schede: una journey espone gli array di facet (PDV/addetti/stati)
  // raccolti fra i suoi item.
  const filtered = useMemo(() => journeys.filter((j) => matchesCjFilters({
    customerType: j.customerType,
    pdvs: j.pdvs ?? [],
    addetti: j.addetti ?? [],
    states: j.states ?? [],
    searchHay: [
      journeyTitle(j), j.customerKey, j.telefono, j.codiceCliente,
    ].filter(Boolean).join(" "),
  }, activeFilters)), [journeys, activeFilters]);
  const countPrivato = useMemo(
    () => journeys.filter((j) => j.customerType === "privato").length,
    [journeys],
  );
  const countAzienda = useMemo(
    () => journeys.filter((j) => j.customerType === "azienda").length,
    [journeys],
  );

  // Righe report filtrate con gli stessi filtri della lista schede: una riga
  // item-level ha un singolo PDV/addetto/stato (wrappati in array).
  const reportFiltered = useMemo(() => reportRows.filter((r) => matchesCjFilters({
    customerType: r.customerType,
    pdvs: r.pdv ? [r.pdv] : [],
    addetti: r.addetto ? [r.addetto] : [],
    states: r.state ? [r.state] : [],
    searchHay: [r.cliente, r.customerKey, r.addetto, r.pdv].filter(Boolean).join(" "),
  }, activeFilters)), [reportRows, activeFilters]);

  const reportGroups = useMemo(() => aggregateReport(reportFiltered, (r) => {
    if (reportDim === "negozio") {
      return { key: r.pdv || "—", label: r.pdv || "Senza negozio" };
    }
    if (reportDim === "addetto") {
      return { key: r.addetto || "—", label: r.addetto || "Senza addetto" };
    }
    return { key: r.journeyId, label: r.cliente || r.customerKey };
  }), [reportFiltered, reportDim]);

  const reportTotals = useMemo(() => reportFiltered.reduce(
    (acc, r) => {
      acc.contratti += 1;
      acc.valore += r.valore;
      acc.journeys.add(r.journeyId);
      if (CJ_ACTIVE_STATES.has(r.state)) acc.attivati += 1;
      return acc;
    },
    { contratti: 0, valore: 0, attivati: 0, journeys: new Set<string>() },
  ), [reportFiltered]);
  // Totali in forma serializzabile per ReportView (riferimento stabile per memo).
  const reportTotalsView = useMemo(() => ({
    clienti: reportTotals.journeys.size,
    contratti: reportTotals.contratti,
    attivati: reportTotals.attivati,
    valore: reportTotals.valore,
  }), [reportTotals]);

  // Analisi gettoni/fatturato (Task #192): dalle stesse righe filtrate
  // costruiamo una journey per cliente, la filtriamo per coorte (data
  // attivazione SIM) e aggreghiamo i gettoni maturati + il potenziale non
  // espresso alla saturazione scelta.
  // Coorte gettoni: (1) pavimento per data di ATTIVAZIONE SIM = la data
  // Customer Journey impostata in config (mostriamo solo le SIM fatte da quella
  // data in poi); (2) filtro a intervallo dell'utente per data di INSERIMENTO.
  const gettoneJourneys = useMemo(() => {
    const all = buildGettoneJourneys(reportFiltered);
    const floored = configQuery.data?.triggerDate
      ? filterGettoneByDate(all, configQuery.data.triggerDate, null)
      : all;
    return filterGettoneByInsertDate(floored, dateFrom || null, dateTo || null);
  }, [reportFiltered, configQuery.data?.triggerDate, dateFrom, dateTo]);
  const gettoneTot = useMemo(
    () => gettoneTotals(gettoneJourneys, saturation, extraProdotti),
    [gettoneJourneys, saturation, extraProdotti],
  );
  const gettoneKeyFn = useCallback(
    (j: CjGettoneJourney) =>
      gettoneDim === "negozio" ? (j.pdv || "—") : (j.addetto || "—"),
    [gettoneDim],
  );
  const gettoneGroups = useMemo(() => aggregateGettone(
    gettoneJourneys,
    (j) => ({
      key: gettoneKeyFn(j),
      label: gettoneDim === "negozio"
        ? (j.pdv || "Senza negozio")
        : (j.addetto || "Senza addetto"),
    }),
    saturation,
    extraProdotti,
  ), [gettoneJourneys, gettoneKeyFn, gettoneDim, saturation, extraProdotti]);
  // Dettaglio per gruppo (clienti/SIM con % saturazione) per la riga espandibile.
  const gettoneDetail = useMemo(
    () => gettoneDetailByKey(gettoneJourneys, gettoneKeyFn),
    [gettoneJourneys, gettoneKeyFn],
  );

  const hasActiveFilters =
    typeFilter !== "tutti" || pdvFilter !== "tutti" ||
    addettoFilter !== "tutti" || stateFilter !== "tutti" || !!search.trim();

  const resetFilters = useCallback(() => {
    setTypeFilter("tutti");
    setPdvFilter("tutti");
    setAddettoFilter("tutti");
    setStateFilter("tutti");
    setSearch("");
  }, []);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "data":
        cmp = new Date(a.openedAt ?? 0).getTime() - new Date(b.openedAt ?? 0).getTime();
        break;
      case "nome":
        cmp = journeyTitle(a).localeCompare(journeyTitle(b), "it", { sensitivity: "base" });
        break;
      case "completamento":
        cmp = journeyPct(a) - journeyPct(b);
        break;
      case "valore":
        cmp = (a.valore ?? 0) - (b.valore ?? 0);
        break;
      case "scadenza": {
        const va = cjScadenzaSortValue({
          openedAt: a.openedAt, pisteAttive: journeyPisteAttive(a), maxPiste: CJ_MAX_PISTE,
        });
        const vb = cjScadenzaSortValue({
          openedAt: b.openedAt, pisteAttive: journeyPisteAttive(b), maxPiste: CJ_MAX_PISTE,
        });
        // Guard Infinity - Infinity = NaN (journey sature/senza data/scadute).
        cmp = va === vb ? 0 : va - vb;
        break;
      }
    }
    return sortDir === "asc" ? cmp : -cmp;
  }), [filtered, sortKey, sortDir]);

  // Indice della scheda aperta nell'elenco ordinato/filtrato: serve per la
  // navigazione precedente/successiva senza chiudere la scheda (Task #215).
  const selectedIndex = useMemo(
    () => (selectedId ? sorted.findIndex((j) => j.id === selectedId) : -1),
    [sorted, selectedId],
  );
  const goToOffset = useCallback(
    (delta: number) => {
      if (selectedIndex < 0) return;
      const next = selectedIndex + delta;
      if (next < 0 || next >= sorted.length) return;
      setSelectedId(sorted[next].id);
    },
    [selectedIndex, sorted],
  );

  // Frecce sinistra/destra per scorrere le schede. Ignora gli eventi mentre si
  // digita in un campo o un dialog è aperto, così non si naviga per sbaglio.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t?.isContentEditable ||
        t?.closest('[role="dialog"]')
      ) {
        return;
      }
      e.preventDefault();
      goToOffset(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, goToOffset]);

  const listFilterLabel = useMemo(() => {
    const parts: string[] = [];
    if (typeFilter === "privato") parts.push("Solo privati");
    else if (typeFilter === "azienda") parts.push("Solo business");
    if (search.trim()) parts.push(`Ricerca: "${search.trim()}"`);
    parts.push(`Ordine: ${SORT_LABELS[sortKey]} ${sortDir === "asc" ? "↑" : "↓"}`);
    return parts.join(" · ");
  }, [typeFilter, search, sortKey, sortDir]);

  const handleExportListPdf = useCallback(async () => {
    setListPdfPending(true);
    try {
      await exportJourneyListPdf({ journeys: sorted, filterLabel: listFilterLabel });
    } catch (err) {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Export PDF fallito",
        variant: "destructive",
      });
    } finally {
      setListPdfPending(false);
    }
  }, [sorted, listFilterLabel, toast]);

  const handleExportListExcel = useCallback(() => {
    try {
      exportJourneyListExcel({ journeys: sorted, filterLabel: listFilterLabel });
    } catch (err) {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Export Excel fallito",
        variant: "destructive",
      });
    }
  }, [sorted, listFilterLabel, toast]);

  // Callback stabili per JourneyDetailView: le funzioni mutate di react-query
  // hanno identità stabile, quindi questi handler non cambiano fra i render e
  // rendono efficace il React.memo sulla scheda di dettaglio.
  const handleSetState = useCallback(
    (id: string, state: CjItemState) => stateMutation.mutate({ id, state }),
    [stateMutation],
  );
  const handleSetGettone = useCallback(
    (id: string, confirmed: boolean) => gettoneMutation.mutate({ id, confirmed }),
    [gettoneMutation],
  );
  const handleSaveDetails = useCallback(
    (id: string, details: ItemDetailsPayload) => detailsMutation.mutate({ id, details }),
    [detailsMutation],
  );
  const handleSaveRagioneSociale = useCallback(
    (id: string, ragioneSociale: string | null) =>
      ragioneSocialeMutation.mutate({ id, ragioneSociale }),
    [ragioneSocialeMutation],
  );

  return (
    <div className="min-h-screen">
      <AppNavbar title="Customer Journey" />
      <main className="container mx-auto px-3 sm:px-6 py-6 space-y-6">
        {!selectedId ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <RouteIcon className="h-5 w-5 text-primary" />
                  Customer Journey
                </h2>
                <p className="text-sm text-muted-foreground" data-testid="text-trigger-date-desc">
                  Cross-sell sui clienti da nuova attivazione mobile
                  {triggerDateLabel ? ` (dal ${triggerDateLabel}).` : "."}
                </p>
              </div>
              {isAdmin && (
                <Button
                  onClick={() => reconcileMutation.mutate()}
                  disabled={reconcileMutation.isPending}
                  data-testid="button-reconcile"
                >
                  {reconcileMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Rigenera da BiSuite
                </Button>
              )}
            </div>

            {isAdmin && (
              <Card data-testid="card-cj-config">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Configurazione modulo</CardTitle>
                  <CardDescription>
                    Le customer journey si aprono dalle nuove attivazioni mobile a partire
                    da questo mese. Dopo la modifica, usa “Rigenera da BiSuite” per applicarla.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="cj-trigger-date">Mese di apertura journey</Label>
                      <Input
                        id="cj-trigger-date"
                        type="month"
                        value={triggerDateInput}
                        onChange={(e) => setTriggerDateInput(e.target.value)}
                        className="w-full sm:w-48"
                        data-testid="input-trigger-date"
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => triggerDateInput && configMutation.mutate(`${triggerDateInput}-01`)}
                      disabled={
                        configMutation.isPending ||
                        !triggerDateInput ||
                        triggerDateInput === configQuery.data?.triggerDate?.slice(0, 7)
                      }
                      data-testid="button-save-trigger-date"
                    >
                      {configMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      Salva mese
                    </Button>
                    {configQuery.data?.defaultTriggerDate &&
                      configQuery.data.triggerDate !== configQuery.data.defaultTriggerDate && (
                        <Button
                          variant="ghost"
                          onClick={() => configMutation.mutate(configQuery.data!.defaultTriggerDate)}
                          disabled={configMutation.isPending}
                          data-testid="button-reset-trigger-date"
                        >
                          Ripristina default ({fmtDate(configQuery.data.defaultTriggerDate)})
                        </Button>
                      )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Navigazione interna: Schede clienti vs Reportistica (Task #187) */}
            <div className="flex items-center gap-1 border-b border-border">
              <button
                type="button"
                onClick={() => setView("schede")}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${view === "schede" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                data-testid="tab-schede"
              >
                <LayoutGrid className="h-4 w-4" />
                Schede clienti
              </button>
              <button
                type="button"
                onClick={() => setView("report")}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${view === "report" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                data-testid="tab-report"
              >
                <BarChart3 className="h-4 w-4" />
                Reportistica
              </button>
            </div>

            {/* Filtri condivisi tra le due viste */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca cliente, CF/P.IVA, telefono…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-journey"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant={typeFilter === "tutti" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTypeFilter("tutti")}
                  data-testid="button-filter-tutti"
                >
                  Tutti
                  <Badge variant="secondary" className="ml-2">{journeys.length}</Badge>
                </Button>
                <Button
                  variant={typeFilter === "privato" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTypeFilter("privato")}
                  data-testid="button-filter-privato"
                >
                  <User className="h-4 w-4 mr-1.5" />
                  Privati
                  <Badge variant="secondary" className="ml-2">{countPrivato}</Badge>
                </Button>
                <Button
                  variant={typeFilter === "azienda" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTypeFilter("azienda")}
                  data-testid="button-filter-azienda"
                >
                  <Building2 className="h-4 w-4 mr-1.5" />
                  Business
                  <Badge variant="secondary" className="ml-2">{countAzienda}</Badge>
                </Button>
              </div>
              <Select value={pdvFilter} onValueChange={setPdvFilter}>
                <SelectTrigger className="w-full sm:w-[180px] h-9" data-testid="select-filter-negozio">
                  <Store className="h-4 w-4 mr-1.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Negozio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tutti" data-testid="option-negozio-tutti">Tutti i negozi</SelectItem>
                  {pdvOptions.map((p) => (
                    <SelectItem key={p} value={p} data-testid={`option-negozio-${p}`}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={addettoFilter} onValueChange={setAddettoFilter}>
                <SelectTrigger className="w-full sm:w-[180px] h-9" data-testid="select-filter-operatore">
                  <Users className="h-4 w-4 mr-1.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Operatore" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tutti" data-testid="option-operatore-tutti">Tutti gli operatori</SelectItem>
                  {addettoOptions.map((a) => (
                    <SelectItem key={a} value={a} data-testid={`option-operatore-${a}`}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="w-full sm:w-[170px] h-9" data-testid="select-filter-stato">
                  <SelectValue placeholder="Stato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tutti" data-testid="option-stato-tutti">Tutti gli stati</SelectItem>
                  {stateOptions.map((st) => (
                    <SelectItem key={st} value={st} data-testid={`option-stato-${st}`}>
                      {CJ_ITEM_STATE_LABELS[st]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  data-testid="button-reset-filters"
                >
                  Azzera filtri
                </Button>
              )}
            </div>

            {/* Controlli specifici della vista Schede: ordinamento + export */}
            {view === "schede" && (
              <div className="flex items-center gap-1.5 sm:justify-end">
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger className="w-[170px] h-9" data-testid="select-sort-key">
                    <ArrowUpDown className="h-4 w-4 mr-1.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <SelectItem key={k} value={k} data-testid={`option-sort-${k}`}>
                        {SORT_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  title={sortDir === "asc" ? "Crescente" : "Decrescente"}
                  aria-label={sortDir === "asc" ? "Ordine crescente" : "Ordine decrescente"}
                  data-testid="button-sort-dir"
                >
                  {sortDir === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportListPdf}
                  disabled={listPdfPending || sorted.length === 0}
                  data-testid="button-export-list-pdf"
                >
                  {listPdfPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4 mr-2" />
                  )}
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportListExcel}
                  disabled={sorted.length === 0}
                  data-testid="button-export-list-excel"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Excel
                </Button>
              </div>
            )}

            {view === "report" ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={reportTab === "analisi" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setReportTab("analisi")}
                    data-testid="button-report-tab-analisi"
                  >
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Analisi gettoni
                  </Button>
                  <Button
                    variant={reportTab === "dettaglio" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setReportTab("dettaglio")}
                    data-testid="button-report-tab-dettaglio"
                  >
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Dettaglio
                  </Button>
                </div>
                {reportTab === "analisi" ? (
                  <AnalisiView
                    isLoading={reportQuery.isLoading}
                    totals={gettoneTot}
                    groups={gettoneGroups}
                    detail={gettoneDetail}
                    dim={gettoneDim}
                    onDimChange={setGettoneDim}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onDateFromChange={setDateFrom}
                    onDateToChange={setDateTo}
                    saturation={saturation}
                    onSaturationChange={setSaturation}
                    extraProdotti={extraProdotti}
                    onExtraProdottiChange={setExtraProdotti}
                    onOpenJourney={setSelectedId}
                  />
                ) : (
                  <ReportView
                    isLoading={reportQuery.isLoading}
                    groups={reportGroups}
                    totals={reportTotalsView}
                    dim={reportDim}
                    onDimChange={setReportDim}
                    dimLabel={REPORT_DIM_LABEL}
                  />
                )}
              </div>
            ) : journeysQuery.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : sorted.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <RouteIcon className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">Nessuna customer journey</p>
                  <p className="text-sm mt-1">
                    Le journey si aprono dalle nuove attivazioni mobile
                    {triggerDateLabel ? ` dal ${triggerDateLabel}.` : "."}
                    {isAdmin && " Usa “Rigenera da BiSuite” per elaborare le vendite."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <VirtualJourneyGrid journeys={sorted} onSelect={setSelectedId} />
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Button
                variant="ghost"
                onClick={() => setSelectedId(null)}
                className="-ml-2"
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Tutte le journey
              </Button>
              <div className="flex items-center gap-1.5">
                {selectedIndex >= 0 && (
                  <span
                    className="text-xs text-muted-foreground tabular-nums"
                    data-testid="text-journey-position"
                  >
                    {selectedIndex + 1} / {sorted.length}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToOffset(-1)}
                  disabled={selectedIndex <= 0}
                  title="Scheda precedente (←)"
                  data-testid="button-journey-prev"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToOffset(1)}
                  disabled={selectedIndex < 0 || selectedIndex >= sorted.length - 1}
                  title="Scheda successiva (→)"
                  data-testid="button-journey-next"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {detailQuery.isLoading || !detailQuery.data ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <JourneyDetailView
                detail={detailQuery.data}
                onSetState={handleSetState}
                onSetGettone={handleSetGettone}
                onSaveDetails={handleSaveDetails}
                onSaveRagioneSociale={handleSaveRagioneSociale}
                statePending={stateMutation.isPending}
                gettonePending={gettoneMutation.isPending}
                detailsPending={detailsMutation.isPending}
                ragioneSocialePending={ragioneSocialeMutation.isPending}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Riga singola della tabella Dettaglio, estratta per essere riusata sia nel
// rendering normale sia in quello virtualizzato.
function ReportRow({ g }: { g: CjReportGroup }) {
  return (
    <TableRow data-testid={`row-report-${g.key}`}>
      <TableCell className="font-medium" data-testid={`text-report-label-${g.key}`}>
        {g.label}
      </TableCell>
      <TableCell className="text-right tabular-nums" data-testid={`text-report-clienti-${g.key}`}>
        {g.clienti}
      </TableCell>
      <TableCell className="text-right tabular-nums" data-testid={`text-report-contratti-${g.key}`}>
        {g.contratti}
      </TableCell>
      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400" data-testid={`text-report-attivati-${g.key}`}>
        {g.attivati}
      </TableCell>
      <TableCell className="text-right tabular-nums font-semibold" data-testid={`text-report-valore-${g.key}`}>
        {fmtEuro(g.valore)}
      </TableCell>
    </TableRow>
  );
}

// Oltre questa soglia (tipicamente la dimensione "Cliente", una riga per
// journey) la tabella Dettaglio viene virtualizzata. Sotto soglia si renderizza
// normalmente, così le viste piccole (negozio/addetto) restano identiche.
const REPORT_VIRTUALIZE_THRESHOLD = 150;
const REPORT_ROW_HEIGHT = 49;

// Corpo tabella Dettaglio virtualizzato sullo scroll della finestra: solo le
// righe visibili (+ overscan) sono montate; due righe spacer in alto e in basso
// preservano l'altezza/scrollbar. Le righe sono a riga singola, quindi basta
// un'altezza stimata fissa (niente measureElement).
function VirtualReportRows({ groups }: { groups: CjReportGroup[] }) {
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const scrollMargin = useDocumentOffset(sentinelRef);
  const virtualizer = useWindowVirtualizer({
    count: groups.length,
    estimateSize: () => REPORT_ROW_HEIGHT,
    overscan: 10,
    scrollMargin,
  });
  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = items.length ? items[0].start - scrollMargin : 0;
  const paddingBottom = items.length
    ? totalSize - items[items.length - 1].end + scrollMargin
    : 0;
  return (
    <>
      {/* sentinella a altezza 0 in cima: misura il top reale del corpo tabella */}
      <tr ref={sentinelRef} aria-hidden style={{ height: 0 }}>
        <td style={{ padding: 0, border: 0 }} colSpan={5} />
      </tr>
      {paddingTop > 0 && (
        <tr aria-hidden>
          <td style={{ height: paddingTop, padding: 0, border: 0 }} colSpan={5} />
        </tr>
      )}
      {items.map((vi) => (
        <ReportRow key={groups[vi.index].key} g={groups[vi.index]} />
      ))}
      {paddingBottom > 0 && (
        <tr aria-hidden>
          <td style={{ height: paddingBottom, padding: 0, border: 0 }} colSpan={5} />
        </tr>
      )}
    </>
  );
}

// === Vista Reportistica (Task #187) ===
// Tabella aggregata delle journey lungo una dimensione selezionabile
// (negozio / addetto / cliente). I dati sono già filtrati e isolati per
// operatore lato server; qui si fa solo il rendering.
function ReportViewImpl({
  isLoading,
  groups,
  totals,
  dim,
  onDimChange,
  dimLabel,
}: {
  isLoading: boolean;
  groups: CjReportGroup[];
  totals: { clienti: number; contratti: number; attivati: number; valore: number };
  dim: ReportDim;
  onDimChange: (d: ReportDim) => void;
  dimLabel: Record<ReportDim, string>;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dims: ReportDim[] = ["negozio", "addetto", "cliente"];

  return (
    <div className="space-y-4">
      {/* Card di riepilogo totali */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card data-testid="card-report-total-clienti">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Clienti</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="text-report-total-clienti">
              {totals.clienti}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-report-total-contratti">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Contratti</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="text-report-total-contratti">
              {totals.contratti}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-report-total-attivati">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Contratti attivi</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="text-report-total-attivati">
              {totals.attivati}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-report-total-valore">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Valore totale</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="text-report-total-valore">
              {fmtEuro(totals.valore)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Selettore dimensione di aggregazione */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground mr-1">Raggruppa per:</span>
        {dims.map((d) => (
          <Button
            key={d}
            variant={dim === d ? "default" : "outline"}
            size="sm"
            onClick={() => onDimChange(d)}
            data-testid={`button-report-dim-${d}`}
          >
            {dimLabel[d]}
          </Button>
        ))}
      </div>

      {/* Tabella aggregata */}
      <Card>
        <CardContent className="p-0">
          {groups.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">Nessun dato da mostrare</p>
              <p className="text-sm mt-1">Modifica i filtri o rigenera le journey da BiSuite.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dimLabel[dim]}</TableHead>
                  <TableHead className="text-right">Clienti</TableHead>
                  <TableHead className="text-right">Contratti</TableHead>
                  <TableHead className="text-right">Attivi</TableHead>
                  <TableHead className="text-right">Valore</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.length > REPORT_VIRTUALIZE_THRESHOLD ? (
                  <VirtualReportRows groups={groups} />
                ) : (
                  groups.map((g) => <ReportRow key={g.key} g={g} />)
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// === Analisi gettoni e fatturato cross-sell (Task #192) ===
// Prima sotto-vista della Reportistica: cruscotto gettoni guidato dal filtro
// per data di attivazione SIM (coorte). La logica pura vive in
// `@shared/customerJourney` ed è coperta da test (`cj-report-tests`).
function AnalisiViewImpl({
  isLoading,
  totals,
  groups,
  detail,
  dim,
  onDimChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  saturation,
  onSaturationChange,
  extraProdotti,
  onExtraProdottiChange,
  onOpenJourney,
}: {
  isLoading: boolean;
  totals: CjGettoneTotals;
  groups: CjGettoneGroup[];
  detail: Map<string, CjGettoneDetailRow[]>;
  dim: GettoneDim;
  onDimChange: (d: GettoneDim) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  saturation: number;
  onSaturationChange: (v: number) => void;
  extraProdotti: number;
  onExtraProdottiChange: (v: number) => void;
  onOpenJourney: (journeyId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dims: GettoneDim[] = ["negozio", "addetto"];
  const dimLabel: Record<GettoneDim, string> = { negozio: "Negozio", addetto: "Addetto" };
  const satOptions = [25, 50, 75, 100];
  const prodOptions = Array.from({ length: CJ_MAX_PISTE }, (_, i) => i + 1);
  const { conPct, senzaPct } = crossSellPercentuali(totals.clienti, totals.conProdotti);

  return (
    <div className="space-y-4">
      {/* Filtro per data attivazione SIM + saturazione attesa */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" /> Inserimento SIM dal
            </Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="w-[170px]"
              data-testid="input-gettone-date-from"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">al</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className="w-[170px]"
              data-testid="input-gettone-date-to"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Saturazione attesa</Label>
            <Select
              value={String(saturation)}
              onValueChange={(v) => onSaturationChange(Number(v))}
            >
              <SelectTrigger className="w-[130px]" data-testid="select-gettone-saturation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {satOptions.map((s) => (
                  <SelectItem key={s} value={String(s)}>{s}%</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Prodotti in più / cliente</Label>
            <Select
              value={String(extraProdotti)}
              onValueChange={(v) => onExtraProdottiChange(Number(v))}
            >
              <SelectTrigger className="w-[130px]" data-testid="select-gettone-prodotti">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {prodOptions.map((p) => (
                  <SelectItem key={p} value={String(p)} data-testid={`option-gettone-prodotti-${p}`}>+{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(saturation !== 100 || extraProdotti !== CJ_MAX_PISTE) && (
            <div className="space-y-1 flex flex-col justify-end">
              <Label className="text-xs text-muted-foreground">&nbsp;</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { onSaturationChange(100); onExtraProdottiChange(CJ_MAX_PISTE); }}
                data-testid="button-gettone-reset-scenario"
              >
                Azzera scenario
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground basis-full" data-testid="text-gettone-scenario">
            {saturation === 100 && extraProdotti === CJ_MAX_PISTE
              ? `Scenario base: potenziale pieno residuo (tutti i clienti fino a ${CJ_MAX_PISTE} piste).`
              : `Scenario: il ${saturation}% dei clienti attiva +${extraProdotti} ${extraProdotti === 1 ? "prodotto" : "prodotti"} (fino a ${CJ_MAX_PISTE} piste).`}
            {" "}Il potenziale stimato si aggiorna di conseguenza.
          </p>
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onDateFromChange(""); onDateToChange(""); }}
              data-testid="button-gettone-reset-date"
            >
              Azzera date
            </Button>
          )}
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <Card data-testid="card-gettone-sim">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RouteIcon className="h-3.5 w-3.5" /> SIM attivate
            </p>
            <p className="text-2xl font-bold tabular-nums" data-testid="text-gettone-sim">
              {totals.simAttivate}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-gettone-clienti">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Coins className="h-3.5 w-3.5" /> Clienti con SIM attiva
            </p>
            <p className="text-2xl font-bold tabular-nums" data-testid="text-gettone-clienti">
              {totals.clienti}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-gettone-crosssell">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> Clienti +prodotti
            </p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="text-gettone-conpct">
              {fmtPct(conPct)}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-gettone-senzapct">
              senza +prodotti {fmtPct(senzaPct)}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-gettone-fatturato">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Wallet className="h-3.5 w-3.5" /> Fatturato maturato
            </p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="text-gettone-fatturato">
              {fmtEuro(totals.fatturato)}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-gettone-potenziale">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> Potenziale non espresso
            </p>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400" data-testid="text-gettone-potenziale">
              {fmtEuro(totals.potenziale)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Selettore dimensione di aggregazione */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground mr-1">Raggruppa per:</span>
        {dims.map((d) => (
          <Button
            key={d}
            variant={dim === d ? "default" : "outline"}
            size="sm"
            onClick={() => onDimChange(d)}
            data-testid={`button-gettone-dim-${d}`}
          >
            {dimLabel[d]}
          </Button>
        ))}
      </div>

      {/* Tabella aggregata gettoni */}
      <Card>
        <CardContent className="p-0">
          {groups.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">Nessun dato da mostrare</p>
              <p className="text-sm mt-1">Modifica i filtri o l'intervallo di date.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>{dimLabel[dim]}</TableHead>
                  <TableHead className="text-right">SIM</TableHead>
                  <TableHead className="text-right">Clienti</TableHead>
                  <TableHead className="text-right">+prodotti</TableHead>
                  <TableHead className="text-right">Fatturato</TableHead>
                  <TableHead className="text-right">Potenziale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => {
                  const isOpen = expanded === g.key;
                  const rows = detail.get(g.key) ?? [];
                  return (
                  <Fragment key={g.key}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : g.key)}
                      data-testid={`row-gettone-${g.key}`}
                    >
                      <TableCell className="pr-0 text-muted-foreground">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-gettone-label-${g.key}`}>
                        {g.label}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid={`text-gettone-sim-${g.key}`}>
                        {g.simAttivate}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid={`text-gettone-clienti-${g.key}`}>
                        {g.clienti}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid={`text-gettone-conprodotti-${g.key}`}>
                        {g.conProdotti}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400" data-testid={`text-gettone-fatturato-${g.key}`}>
                        {fmtEuro(g.fatturato)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400" data-testid={`text-gettone-potenziale-${g.key}`}>
                        {fmtEuro(g.potenziale)}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow data-testid={`row-gettone-detail-${g.key}`}>
                        <TableCell colSpan={7} className="bg-muted/40 p-0">
                          <div className="px-4 py-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2">
                              {g.clienti} {g.clienti === 1 ? "cliente attivo" : "clienti attivi"} nella CJ ·
                              {" "}saturazione cross-sell per SIM
                            </p>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Cliente</TableHead>
                                  <TableHead className="text-right">SIM attive</TableHead>
                                  <TableHead className="text-right">Piste attive</TableHead>
                                  <TableHead className="text-right">% saturazione</TableHead>
                                  <TableHead className="text-right">Fatturato</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rows.map((r) => (
                                  <TableRow key={r.journeyId} data-testid={`row-gettone-sim-${r.journeyId}`}>
                                    <TableCell className="font-medium">
                                      <button
                                        type="button"
                                        className="text-left text-primary hover:underline"
                                        onClick={() => onOpenJourney(r.journeyId)}
                                        data-testid={`button-gettone-open-${r.journeyId}`}
                                      >
                                        <span data-testid={`text-gettone-sim-cliente-${r.journeyId}`}>
                                          {r.cliente || "Senza nominativo"}
                                        </span>
                                      </button>
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {r.simAttive}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {r.pisteAttive}/{CJ_MAX_PISTE}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums font-semibold" data-testid={`text-gettone-sim-saturazione-${r.journeyId}`}>
                                      {fmtPct(r.saturazionePct)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                                      {fmtEuro(r.fatturato)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Legenda scaglioni gettone */}
      <p className="text-xs text-muted-foreground">
        Scaglioni gettone per nº piste cross-sell attive (oltre la SIM):{" "}
        {CJ_GETTONE_TABLE.map((g, i) => i === 0 ? null : `${i}=${g}€`)
          .filter(Boolean)
          .join(" · ")}
        . Saturazione completa = {CJ_MAX_PISTE} piste ({fmtEuro(CJ_GETTONE_TABLE[CJ_MAX_PISTE])}).
      </p>
    </div>
  );
}

// === Grafico di tracciamento temporale (Task #185) ===
// La logica pura (asse mesi, rilevamento T0, raggruppamento PDV) vive in
// `@/lib/customerJourneyTimeline` ed è coperta da test (Task #186).

function CustomerJourneyTimeline({
  journey, items,
}: {
  journey: CustomerJourney;
  items: CustomerJourneyItem[];
}) {
  const model = computeTimeline(journey, items);

  if (model.empty) {
    return (
      <Card data-testid="card-timeline">
        <CardHeader>
          <CardTitle className="text-base">Tracciamento temporale</CardTitle>
        </CardHeader>
        <CardContent>
          <p
            className="text-sm text-muted-foreground py-6 text-center"
            data-testid="text-timeline-empty"
          >
            Nessun contratto con una data disponibile: il grafico temporale
            sarà visibile quando i contratti avranno una data di
            inserimento o attivazione.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { t0mi, months, t0ItemId, rows } = model;
  const validity = computeItemValidity(model, journey);

  return (
    <Card data-testid="card-timeline">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="text-base">Tracciamento temporale</CardTitle>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5" data-testid="timeline-legend">
            {CJ_DRIVER_ORDER.map((driver) => (
              <span key={driver} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CJ_DRIVER_COLORS[driver] }}
                />
                {CJ_DRIVER_LABELS[driver]}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="border-collapse w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-2 border-b border-border min-w-[220px]">
                  Contratto
                </th>
                {months.map((mi) => {
                  const rel = mi - t0mi;
                  const isWindow = rel >= 0 && rel <= 6;
                  return (
                    <th
                      key={mi}
                      className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-2 border-b border-border min-w-[64px]"
                      data-testid={`timeline-col-${mi}`}
                    >
                      <div>{monthIndexLabel(mi)}</div>
                      {isWindow && (
                        <div className="text-primary font-bold mt-0.5">T{rel}</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ it, date }) => {
                const color = cjDriverColor(it.driver, CJ_DRIVER_COLORS);
                const faded = isFadedState(it.state);
                const isT0 = it.id === t0ItemId;
                const eventMi = monthIndex(date);
                const stateLabel = CJ_ITEM_STATE_LABELS[it.state as CjItemState] || it.state;
                const driverLabel = CJ_DRIVER_LABELS[it.driver as CjDriver] || it.driver;
                const tooltip = [
                  driverLabel,
                  it.descrizione || it.tipologia || it.categoria,
                  it.codiceContratto ? `Contratto ${it.codiceContratto}` : null,
                  `Negozio: ${itemNegozio(it)}`,
                  it.addetto ? `Addetto: ${it.addetto}` : null,
                  `Data: ${fmtDate(date)}`,
                  `Stato: ${stateLabel}`,
                ]
                  .filter(Boolean)
                  .join("\n");
                return (
                  <tr key={it.id} data-testid={`timeline-row-${it.id}`}>
                    <td className="px-4 py-2 border-b border-border/60 align-middle">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color, opacity: faded ? 0.4 : 1 }}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate max-w-[200px]" title={it.descrizione || ""}>
                            {driverLabel}
                            {isT0 && (
                              <span className="ml-1.5 text-[9px] font-bold text-primary align-middle">
                                T0
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                            {it.descrizione || it.tipologia || it.categoria || "—"}
                          </div>
                          <div className="text-[10px] text-muted-foreground/80 truncate max-w-[200px]">
                            {itemNegozio(it)}
                            {it.codiceContratto ? ` · ${it.codiceContratto}` : ""}
                          </div>
                          {it.addetto && (
                            <div
                              className="text-[10px] text-muted-foreground/80 truncate max-w-[200px]"
                              title={it.addetto}
                              data-testid={`timeline-addetto-${it.id}`}
                            >
                              Addetto: {it.addetto}
                            </div>
                          )}
                          {(() => {
                            const v = validity.get(it.id);
                            if (!v) return null;
                            const cls =
                              v.kind === "valida"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : v.kind === "attivante"
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "bg-muted text-muted-foreground";
                            return (
                              <span
                                className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold ${cls}`}
                                title={CJ_VALIDITY_REASONS[v.kind]}
                                data-testid={`timeline-validity-${it.id}`}
                                data-validity={v.kind}
                              >
                                {CJ_VALIDITY_LABELS[v.kind]}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </td>
                    {months.map((mi) => (
                      <td
                        key={mi}
                        className="px-2 py-2 border-b border-border/60 text-center align-middle"
                      >
                        {mi === eventMi ? (
                          <span
                            className="inline-flex items-center justify-center"
                            title={tooltip}
                            data-testid={`timeline-dot-${it.id}`}
                          >
                            <span
                              className={`inline-block h-4 w-4 border-2 ${isT0 ? "rounded-sm ring-2 ring-amber-400/70" : "rounded-full border-black/20"}`}
                              style={{
                                backgroundColor: color,
                                opacity: faded ? 0.4 : 1,
                                borderColor: isT0 ? "rgba(251,191,36,0.8)" : undefined,
                              }}
                            />
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function JourneyBreakdown({
  journey, items, drivers,
}: {
  journey: CustomerJourney;
  items: CustomerJourneyItem[];
  drivers: DriverSummary[];
}) {
  // Raggruppamento per negozio (PDV).
  const negozi = groupByNegozio(items);
  const attivati = drivers.filter((d) => d.activated).length;
  const isAzienda = journey.customerType === "azienda";

  return (
    <div className={`grid grid-cols-1 gap-6 ${isAzienda ? "lg:grid-cols-2" : ""}`}>
      <Card data-testid="card-dettaglio-negozio">
        <CardHeader>
          <CardTitle className="text-base">Dettaglio per negozio</CardTitle>
          <CardDescription>Contratti raggruppati per punto vendita.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {negozi.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-6 text-center">
              Nessun contratto da raggruppare.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Negozio</TableHead>
                  <TableHead className="text-center">Contratti</TableHead>
                  <TableHead>Driver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {negozi.map(([negozio, negItems]) => {
                  const uniqueDrivers = CJ_DRIVER_ORDER.filter((d) =>
                    negItems.some((it) => it.driver === d),
                  );
                  // Driver mancanti (cross-sell non ancora attivati in questo
                  // negozio): mostrati in grigio/tratteggiato accanto a quelli
                  // attivi, così l'operatore vede subito cosa resta da vendere.
                  const missingDrivers = CJ_DRIVER_ORDER.filter(
                    (d) => !uniqueDrivers.includes(d),
                  );
                  return (
                    <TableRow key={negozio} data-testid={`row-negozio-${negozio}`}>
                      <TableCell className="font-medium text-sm">{negozio}</TableCell>
                      <TableCell className="text-center text-sm" data-testid={`text-negozio-count-${negozio}`}>
                        {negItems.length}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {uniqueDrivers.map((d) => (
                            <span
                              key={d}
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
                              style={{ borderColor: CJ_DRIVER_COLORS[d] }}
                              data-testid={`badge-driver-attivo-${negozio}-${d}`}
                            >
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: CJ_DRIVER_COLORS[d] }}
                              />
                              {CJ_DRIVER_LABELS[d]}
                            </span>
                          ))}
                          {missingDrivers.map((d) => (
                            <span
                              key={d}
                              className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[10px] text-muted-foreground/60"
                              title={`${CJ_DRIVER_LABELS[d]}: mancante`}
                              data-testid={`badge-driver-mancante-${negozio}-${d}`}
                            >
                              <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
                              {CJ_DRIVER_LABELS[d]}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAzienda && (
      <Card data-testid="card-dettaglio-ragione-sociale">
        <CardHeader>
          <CardTitle className="text-base">Dettaglio per ragione sociale</CardTitle>
          <CardDescription>Anagrafica del cliente e totali della journey.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {journey.customerType === "azienda" ? "Ragione sociale" : "Cliente"}
              </dt>
              <dd className="font-medium" data-testid="text-rs-titolo">
                {journeyTitle(journey)}
              </dd>
            </div>
            {journeySubtitle(journey) && (
              <div>
                <dt className="text-xs text-muted-foreground">Referente</dt>
                <dd className="font-medium" data-testid="text-rs-referente">
                  {journeySubtitle(journey)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">
                {journey.customerType === "azienda" ? "P.IVA" : "CF"}
              </dt>
              <dd className="font-mono text-xs" data-testid="text-rs-key">
                {journey.customerKey}
              </dd>
            </div>
            {journey.codiceCliente && (
              <div>
                <dt className="text-xs text-muted-foreground">Cod. cliente</dt>
                <dd className="font-medium" data-testid="text-rs-codice">
                  {journey.codiceCliente}
                </dd>
              </div>
            )}
            {journey.telefono && (
              <div>
                <dt className="text-xs text-muted-foreground">Telefono</dt>
                <dd className="font-medium" data-testid="text-rs-telefono">
                  {journey.telefono}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">Contratti</dt>
              <dd className="font-medium" data-testid="text-rs-contratti">
                {items.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Driver attivati</dt>
              <dd className="font-medium" data-testid="text-rs-attivati">
                {attivati} / {drivers.length}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      )}
    </div>
  );
}

function JourneyDetailViewImpl({
  detail, onSetState, onSetGettone, onSaveDetails, onSaveRagioneSociale, statePending, gettonePending, detailsPending, ragioneSocialePending,
}: {
  detail: JourneyDetail;
  onSetState: (id: string, state: CjItemState) => void;
  onSetGettone: (id: string, confirmed: boolean) => void;
  onSaveDetails: (id: string, details: ItemDetailsPayload) => void;
  onSaveRagioneSociale: (id: string, ragioneSociale: string | null) => void;
  statePending: boolean;
  gettonePending: boolean;
  detailsPending: boolean;
  ragioneSocialePending: boolean;
}) {
  const { journey, items, drivers } = detail;
  const driverMap = new Map(drivers.map((d) => [d.driver, d]));
  // Scadenza T6: giorni residui per chiudere il cross-sell (fine mese di T6).
  const daysToT6 = cjDaysToT6(journey.openedAt);
  const t6Deadline = cjT6Deadline(journey.openedAt);
  const scadenzaInfo = cjScadenzaInfo(daysToT6);
  const [editItem, setEditItem] = useState<CustomerJourneyItem | null>(null);
  const { toast } = useToast();
  const [pdfPending, setPdfPending] = useState(false);
  const [editRagioneSociale, setEditRagioneSociale] = useState(false);
  const [ragioneSocialeDraft, setRagioneSocialeDraft] = useState(journey.ragioneSociale ?? "");

  const handleExportPdf = async () => {
    setPdfPending(true);
    try {
      await exportJourneyPdf({ journey, items, drivers });
    } catch (err) {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Export PDF fallito",
        variant: "destructive",
      });
    } finally {
      setPdfPending(false);
    }
  };

  const handleExportExcel = () => {
    try {
      exportJourneyExcel({ journey, items, drivers });
    } catch (err) {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Export Excel fallito",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                {journey.customerType === "azienda" ? (
                  <Building2 className="h-5 w-5 text-primary" />
                ) : (
                  <User className="h-5 w-5 text-primary" />
                )}
                <span data-testid="text-detail-title">{journeyTitle(journey)}</span>
              </CardTitle>
              {journeySubtitle(journey) && (
                <p
                  className="mt-0.5 text-sm text-muted-foreground"
                  data-testid="text-detail-referente"
                >
                  Referente: {journeySubtitle(journey)}
                </p>
              )}
              <CardDescription>
                {journey.customerType === "azienda" ? "P.IVA" : "CF"}: {journey.customerKey}
                {journey.telefono ? ` · Tel: ${journey.telefono}` : ""}
                {journey.codiceCliente ? ` · Cod. cliente: ${journey.codiceCliente}` : ""}
                {` · Aperta il ${fmtDate(journey.openedAt)}`}
              </CardDescription>
              {scadenzaInfo != null && (
                <div className="mt-2">
                  <Badge
                    variant="outline"
                    className={CJ_SCADENZA_TONE_CLASS[scadenzaInfo.tone]}
                    data-testid="badge-scadenza-t6"
                  >
                    <Calendar className="h-3.5 w-3.5 mr-1.5" />
                    {scadenzaInfo.label}
                    {t6Deadline ? ` · T6 ${fmtDateUTC(t6Deadline)}` : ""}
                  </Badge>
                </div>
              )}
              {journey.customerType === "azienda" && (
                <div className="mt-3">
                  {editRagioneSociale ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={ragioneSocialeDraft}
                        onChange={(e) => setRagioneSocialeDraft(e.target.value)}
                        placeholder="Ragione sociale"
                        className="h-8 w-64 max-w-full"
                        data-testid="input-ragione-sociale"
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          onSaveRagioneSociale(journey.id, ragioneSocialeDraft.trim() || null);
                          setEditRagioneSociale(false);
                        }}
                        disabled={ragioneSocialePending}
                        data-testid="button-save-ragione-sociale"
                      >
                        {ragioneSocialePending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Salva"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRagioneSocialeDraft(journey.ragioneSociale ?? "");
                          setEditRagioneSociale(false);
                        }}
                        data-testid="button-cancel-ragione-sociale"
                      >
                        Annulla
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRagioneSocialeDraft(journey.ragioneSociale ?? "");
                        setEditRagioneSociale(true);
                      }}
                      data-testid="button-edit-ragione-sociale"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-2" />
                      {journey.ragioneSociale ? "Modifica ragione sociale" : "Aggiungi ragione sociale"}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPdf}
                disabled={pdfPending}
                data-testid="button-export-pdf"
              >
                {pdfPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                data-testid="button-export-excel"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Driver</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {CJ_DRIVER_ORDER.map((driver) => {
            const summary = driverMap.get(driver);
            const activated = summary?.activated ?? false;
            return (
              <Card
                key={driver}
                className={activated ? "border-emerald-500/40" : "border-dashed opacity-80"}
                data-testid={`driver-${driver}`}
              >
                <CardContent className="p-3 flex flex-col items-center text-center gap-1.5">
                  {activated ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                  ) : (
                    <Circle className="h-6 w-6 text-muted-foreground/40" />
                  )}
                  <span className="flex items-center gap-1.5 text-xs font-medium leading-tight">
                    {(() => {
                      const Icon = CJ_DRIVER_ICONS[driver];
                      return Icon ? (
                        <Icon className={`h-4 w-4 shrink-0 ${activated ? "text-emerald-500" : "text-muted-foreground"}`} />
                      ) : null;
                    })()}
                    {CJ_DRIVER_LABELS[driver]}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {activated ? "Attivato" : "Attivabile"}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <CustomerJourneyTimeline journey={journey} items={items} />

      <JourneyBreakdown journey={journey} items={items} drivers={drivers} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contratti ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-8 text-center">
              Nessun contratto associato a questa journey.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Contratto</TableHead>
                    <TableHead>Addetto</TableHead>
                    <TableHead>PDV</TableHead>
                    <TableHead>IMEI</TableHead>
                    <TableHead>RATA/CANONE</TableHead>
                    <TableHead>Inserito</TableHead>
                    <TableHead>Attivato</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="text-center">Gettone</TableHead>
                    <TableHead className="text-center">Modifica</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id} data-testid={`row-item-${it.id}`}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {CJ_DRIVER_LABELS[it.driver as keyof typeof CJ_DRIVER_LABELS] || it.driver}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <span className="block truncate" title={it.descrizione || ""}>
                          {it.descrizione || it.tipologia || it.categoria || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {it.codiceContratto || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {it.addetto || "—"}
                      </TableCell>
                      <TableCell className="max-w-[160px] text-xs">
                        <span className="block truncate" title={it.pdvDestinazione || it.pdvOrigine || ""}>
                          {it.pdvDestinazione || it.pdvOrigine || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs" data-testid={`text-imei-${it.id}`}>
                        {it.imei || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs" data-testid={`text-rata-${it.id}`}>
                        {it.rata ? `€ ${it.rata}` : it.canone && it.driver !== "telefono" ? `€ ${it.canone}` : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {fmtDate(it.dataInserimento)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs" data-testid={`text-attivazione-${it.id}`}>
                        {fmtDate(it.dataAttivazione)}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={it.state}
                          onValueChange={(v) => onSetState(it.id, v as CjItemState)}
                          disabled={statePending}
                        >
                          <SelectTrigger
                            className={`h-8 w-[150px] text-xs border ${STATE_VARIANTS[it.state] || ""}`}
                            data-testid={`select-state-${it.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CJ_ITEM_STATES.map((s) => (
                              <SelectItem key={s} value={s} className="text-xs">
                                {CJ_ITEM_STATE_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant={it.gettoneConfirmed ? "default" : "outline"}
                          size="sm"
                          className="h-8"
                          disabled={gettonePending}
                          onClick={() => onSetGettone(it.id, !it.gettoneConfirmed)}
                          data-testid={`button-gettone-${it.id}`}
                        >
                          <Coins className="h-3.5 w-3.5 mr-1" />
                          {it.gettoneConfirmed ? "Confermato" : "Conferma"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditItem(it)}
                          data-testid={`button-edit-details-${it.id}`}
                          title="Modifica dettagli"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editItem && (
        <ItemDetailsDialog
          key={editItem.id}
          item={editItem}
          pending={detailsPending}
          onClose={() => setEditItem(null)}
          onSave={(details) => {
            onSaveDetails(editItem.id, details);
            setEditItem(null);
          }}
        />
      )}
    </div>
  );
}

function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ItemDetailsDialog({
  item, pending, onClose, onSave,
}: {
  item: CustomerJourneyItem;
  pending: boolean;
  onClose: () => void;
  onSave: (details: ItemDetailsPayload) => void;
}) {
  const [dataAttivazione, setDataAttivazione] = useState(toDateInput(item.dataAttivazione));
  const [pdvDestinazione, setPdvDestinazione] = useState(item.pdvDestinazione || "");
  const [imei, setImei] = useState(item.imei || "");
  const [rata, setRata] = useState(item.rata || "");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="dialog-edit-details">
        <DialogHeader>
          <DialogTitle>Modifica dettagli contratto</DialogTitle>
          <DialogDescription>
            Compila i campi non forniti da BiSuite. Una volta salvati, la
            rigenerazione automatica non li sovrascrive.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-data-attivazione">Data attivazione</Label>
            <Input
              id="edit-data-attivazione"
              type="date"
              value={dataAttivazione}
              onChange={(e) => setDataAttivazione(e.target.value)}
              data-testid="input-data-attivazione"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-pdv-destinazione">PDV destinazione</Label>
            <Input
              id="edit-pdv-destinazione"
              value={pdvDestinazione}
              onChange={(e) => setPdvDestinazione(e.target.value)}
              placeholder="Punto vendita di destinazione"
              data-testid="input-pdv-destinazione"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-imei">IMEI</Label>
            <Input
              id="edit-imei"
              value={imei}
              onChange={(e) => setImei(e.target.value)}
              placeholder="IMEI del telefono"
              data-testid="input-imei"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-rata">RATA/CANONE (€)</Label>
            <Input
              id="edit-rata"
              value={rata}
              onChange={(e) => setRata(e.target.value)}
              placeholder="Importo rata o canone"
              inputMode="decimal"
              data-testid="input-rata"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending} data-testid="button-cancel-details">
            Annulla
          </Button>
          <Button
            onClick={() =>
              onSave({
                dataAttivazione: dataAttivazione || null,
                pdvDestinazione: pdvDestinazione.trim() || null,
                imei: imei.trim() || null,
                rata: rata.trim() || null,
              })
            }
            disabled={pending}
            data-testid="button-save-details"
          >
            {pending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
