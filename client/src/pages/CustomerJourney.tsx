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
  Smartphone, Router, Zap, ShieldCheck, Phone, ShieldPlus,
  type LucideIcon,
} from "lucide-react";
import {
  CJ_DRIVER_LABELS, CJ_DRIVER_ORDER, CJ_ITEM_STATE_LABELS,
} from "@shared/customerJourney";
import { CJ_ITEM_STATES } from "@shared/schema";
import type { CustomerJourney, CustomerJourneyItem, CjItemState, CjDriver } from "@shared/schema";

const CJ_DRIVER_ICONS: Record<CjDriver, LucideIcon> = {
  mobile: Smartphone,
  fisso: Router,
  energia: Zap,
  assicurazioni: ShieldCheck,
  telefono: Phone,
  protetti: ShieldPlus,
};

interface DriverSummary {
  driver: string;
  activated: boolean;
  count: number;
}

type JourneyListItem = CustomerJourney & { drivers: DriverSummary[] };

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
  stornato: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30",
  riaccreditato: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
};

function journeyTitle(j: CustomerJourney): string {
  if (j.customerType === "azienda") return j.ragioneSociale || j.nominativo || j.customerKey;
  const full = [j.nome, j.cognome].filter(Boolean).join(" ").trim();
  return full || j.nominativo || j.customerKey;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("it-IT");
}

export default function CustomerJourneyPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"tutti" | "privato" | "azienda">("tutti");
  const [triggerDateInput, setTriggerDateInput] = useState<string>("");

  const isAdmin = ["super_admin", "admin"].includes(profile?.role || "");

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
            </div>

            {journeysQuery.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
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
                {filtered.map((j) => {
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
                              <span className="truncate" data-testid={`text-journey-name-${j.id}`}>
                                {journeyTitle(j)}
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
                statePending={stateMutation.isPending}
                gettonePending={gettoneMutation.isPending}
                detailsPending={detailsMutation.isPending}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function JourneyDetailView({
  detail, onSetState, onSetGettone, onSaveDetails, statePending, gettonePending, detailsPending,
}: {
  detail: JourneyDetail;
  onSetState: (id: string, state: CjItemState) => void;
  onSetGettone: (id: string, confirmed: boolean) => void;
  onSaveDetails: (id: string, details: ItemDetailsPayload) => void;
  statePending: boolean;
  gettonePending: boolean;
  detailsPending: boolean;
}) {
  const { journey, items, drivers } = detail;
  const driverMap = new Map(drivers.map((d) => [d.driver, d]));
  const [editItem, setEditItem] = useState<CustomerJourneyItem | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {journey.customerType === "azienda" ? (
              <Building2 className="h-5 w-5 text-primary" />
            ) : (
              <User className="h-5 w-5 text-primary" />
            )}
            {journeyTitle(journey)}
          </CardTitle>
          <CardDescription>
            {journey.customerType === "azienda" ? "P.IVA" : "CF"}: {journey.customerKey}
            {journey.telefono ? ` · Tel: ${journey.telefono}` : ""}
            {journey.codiceCliente ? ` · Cod. cliente: ${journey.codiceCliente}` : ""}
            {` · Aperta il ${fmtDate(journey.openedAt)}`}
          </CardDescription>
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
                    <TableHead>RATA</TableHead>
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
                        {it.rata ? `€ ${it.rata}` : "—"}
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
            <Label htmlFor="edit-rata">RATA (€)</Label>
            <Input
              id="edit-rata"
              value={rata}
              onChange={(e) => setRata(e.target.value)}
              placeholder="Importo rata"
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
