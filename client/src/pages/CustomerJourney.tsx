import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  Route as RouteIcon, RefreshCw, ArrowLeft, CheckCircle2, Circle,
  Search, User, Building2, Loader2, Coins, Pencil,
  FileText, FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";
import {
  CJ_DRIVER_LABELS, CJ_DRIVER_ORDER, CJ_ITEM_STATE_LABELS,
} from "@shared/customerJourney";
import { CJ_ITEM_STATES } from "@shared/schema";
import type { CustomerJourney, CustomerJourneyItem, CjItemState, CjDriver } from "@shared/schema";
import { CJ_DRIVER_ICONS, CJ_DRIVER_COLORS } from "@/lib/customerJourneyIcons";
import {
  exportJourneyPdf, exportJourneyExcel,
  exportJourneyListPdf, exportJourneyListExcel,
} from "@/lib/customerJourneyExport";

interface DriverSummary {
  driver: string;
  activated: boolean;
  count: number;
}

type JourneyListItem = CustomerJourney & { drivers: DriverSummary[]; valore?: number };

type SortKey = "data" | "nome" | "completamento" | "valore";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  data: "Data apertura",
  nome: "Nome cliente",
  completamento: "% completamento",
  valore: "Valore cliente",
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

function fmtEuro(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  return v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export default function CustomerJourneyPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"tutti" | "privato" | "azienda">("tutti");
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

  const configQuery = useQuery<CjConfig>({
    queryKey: ["/api/customer-journey-config"],
    enabled: isAdmin,
  });

  useEffect(() => {
    if (configQuery.data?.triggerDate) {
      setTriggerDateInput(configQuery.data.triggerDate);
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
        title: "Data aggiornata",
        description: "Rigenera da BiSuite per applicare la nuova data.",
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

  const journeys = journeysQuery.data ?? [];
  const filtered = journeys.filter((j) => {
    if (typeFilter !== "tutti" && j.customerType !== typeFilter) return false;
    if (!search.trim()) return true;
    const hay = [
      journeyTitle(j), j.customerKey, j.telefono, j.codiceCliente,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(search.toLowerCase().trim());
  });
  const countPrivato = journeys.filter((j) => j.customerType === "privato").length;
  const countAzienda = journeys.filter((j) => j.customerType === "azienda").length;

  const journeyPct = (j: JourneyListItem): number => {
    const total = CJ_DRIVER_ORDER.length;
    const active = CJ_DRIVER_ORDER.filter(
      (d) => j.drivers?.find((s) => s.driver === d)?.activated,
    ).length;
    return total > 0 ? active / total : 0;
  };

  const sorted = [...filtered].sort((a, b) => {
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
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const listFilterLabel = (() => {
    const parts: string[] = [];
    if (typeFilter === "privato") parts.push("Solo privati");
    else if (typeFilter === "azienda") parts.push("Solo business");
    if (search.trim()) parts.push(`Ricerca: "${search.trim()}"`);
    parts.push(`Ordine: ${SORT_LABELS[sortKey]} ${sortDir === "asc" ? "↑" : "↓"}`);
    return parts.join(" · ");
  })();

  const handleExportListPdf = async () => {
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
  };

  const handleExportListExcel = () => {
    try {
      exportJourneyListExcel({ journeys: sorted, filterLabel: listFilterLabel });
    } catch (err) {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Export Excel fallito",
        variant: "destructive",
      });
    }
  };

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
                    da questa data. Dopo la modifica, usa “Rigenera da BiSuite” per applicarla.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="cj-trigger-date">Data di apertura journey</Label>
                      <Input
                        id="cj-trigger-date"
                        type="date"
                        value={triggerDateInput}
                        onChange={(e) => setTriggerDateInput(e.target.value)}
                        className="w-full sm:w-48"
                        data-testid="input-trigger-date"
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => triggerDateInput && configMutation.mutate(triggerDateInput)}
                      disabled={
                        configMutation.isPending ||
                        !triggerDateInput ||
                        triggerDateInput === configQuery.data?.triggerDate
                      }
                      data-testid="button-save-trigger-date"
                    >
                      {configMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      Salva data
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

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative w-full sm:max-w-md">
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
              <div className="flex items-center gap-1.5 sm:ml-auto">
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
            </div>

            {journeysQuery.isLoading ? (
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sorted.map((j) => {
                  const drivers = CJ_DRIVER_ORDER.map((d) => ({
                    driver: d,
                    activated: j.drivers?.find((s) => s.driver === d)?.activated ?? false,
                  }));
                  const activeCount = drivers.filter((d) => d.activated).length;
                  const total = drivers.length;
                  const pct = Math.round((activeCount / total) * 100);
                  return (
                      <Card
                        key={j.id}
                        className="cursor-pointer hover-elevate transition-all flex flex-col"
                        onClick={() => setSelectedId(j.id)}
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
                            <Badge
                              variant="outline"
                              className={`text-xs shrink-0 ${j.status === "aperta" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
                              data-testid={`badge-status-${j.id}`}
                            >
                              {j.status === "aperta" ? "Aperta" : "Chiusa"}
                            </Badge>
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
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => setSelectedId(null)}
              className="-ml-2"
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Tutte le journey
            </Button>

            {detailQuery.isLoading || !detailQuery.data ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <JourneyDetailView
                detail={detailQuery.data}
                onSetState={(id, state) => stateMutation.mutate({ id, state })}
                onSetGettone={(id, confirmed) => gettoneMutation.mutate({ id, confirmed })}
                onSaveDetails={(id, details) => detailsMutation.mutate({ id, details })}
                onSaveRagioneSociale={(id, ragioneSociale) => ragioneSocialeMutation.mutate({ id, ragioneSociale })}
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

// === Grafico di tracciamento temporale (Task #185) ===
// Stati di un item "non più validi": vengono mostrati attenuati nella timeline.
const CJ_FADED_STATES = new Set<CjItemState>(["ko", "stornato", "annullato"]);

const MESI_IT_SHORT = [
  "Gen", "Feb", "Mar", "Apr", "Mag", "Giu",
  "Lug", "Ago", "Set", "Ott", "Nov", "Dic",
];

function toDateOrNull(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date;
}

// Data dell'evento di un item: data attivazione, fallback data inserimento.
function itemEventDate(it: CustomerJourneyItem): Date | null {
  return toDateOrNull(it.dataAttivazione) ?? toDateOrNull(it.dataInserimento);
}

// Indice mese assoluto (anno*12 + mese) per ordinare/diffare i mesi.
function monthIndex(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth();
}

function monthIndexLabel(mi: number): string {
  const y = Math.floor(mi / 12);
  const m = ((mi % 12) + 12) % 12;
  return `${MESI_IT_SHORT[m]} ${y}`;
}

// Negozio (PDV) di un item: destinazione, fallback origine, fallback "N/D".
function itemNegozio(it: CustomerJourneyItem): string {
  return it.pdvDestinazione || it.pdvOrigine || "N/D";
}

function CustomerJourneyTimeline({
  journey, items,
}: {
  journey: CustomerJourney;
  items: CustomerJourneyItem[];
}) {
  const withDate = items
    .map((it) => ({ it, date: itemEventDate(it) }))
    .filter((d): d is { it: CustomerJourneyItem; date: Date } => d.date !== null);

  // T0 = mese di apertura journey; fallback alla prima attivazione mobile, poi
  // al primo evento in assoluto.
  const t0Date =
    toDateOrNull(journey.openedAt) ??
    withDate
      .filter((d) => d.it.driver === "mobile")
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0]?.date ??
    [...withDate].sort((a, b) => a.date.getTime() - b.date.getTime())[0]?.date ??
    null;

  if (!t0Date || withDate.length === 0) {
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

  const t0mi = monthIndex(t0Date);
  const t6mi = t0mi + 6;
  const eventMis = withDate.map((d) => monthIndex(d.date));
  const startMi = Math.min(t0mi, ...eventMis);
  const endMi = Math.max(t6mi, ...eventMis);
  const months: number[] = [];
  for (let mi = startMi; mi <= endMi; mi++) months.push(mi);

  // Item che ha aperto la journey (T0): match sui riferimenti BiSuite del
  // trigger, fallback alla prima attivazione mobile per data.
  const t0ItemId = (() => {
    const byTrigger = items.find(
      (it) =>
        (journey.triggerSaleId && it.bisuiteSaleId === journey.triggerSaleId) ||
        (journey.triggerBisuiteId != null && it.bisuiteId === journey.triggerBisuiteId),
    );
    if (byTrigger) return byTrigger.id;
    const firstMobile = withDate
      .filter((d) => d.it.driver === "mobile")
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
    if (firstMobile) return firstMobile.it.id;
    // Fallback: nessun trigger né mobile ⇒ marca il primo evento in assoluto.
    const firstEvent = [...withDate].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    )[0];
    return firstEvent?.it.id;
  })();

  // Una riga per contratto, ordinata per data evento.
  const rows = [...withDate].sort((a, b) => a.date.getTime() - b.date.getTime());

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
                const color = CJ_DRIVER_COLORS[it.driver as CjDriver] ?? "#6B7280";
                const faded = CJ_FADED_STATES.has(it.state as CjItemState);
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
  const negozioMap = new Map<string, CustomerJourneyItem[]>();
  for (const it of items) {
    const key = itemNegozio(it);
    const arr = negozioMap.get(key);
    if (arr) arr.push(it);
    else negozioMap.set(key, [it]);
  }
  const negozi = Array.from(negozioMap.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );
  const attivati = drivers.filter((d) => d.activated).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                            >
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: CJ_DRIVER_COLORS[d] }}
                              />
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
    </div>
  );
}

function JourneyDetailView({
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
