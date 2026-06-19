import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { AppNavbar } from "@/components/AppNavbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Route as RouteIcon, RefreshCw, ArrowLeft, CheckCircle2, Circle,
  Search, User, Building2, Loader2, Coins,
} from "lucide-react";
import {
  CJ_DRIVER_LABELS, CJ_DRIVER_ORDER, CJ_ITEM_STATE_LABELS,
} from "@shared/customerJourney";
import { CJ_ITEM_STATES } from "@shared/schema";
import type { CustomerJourney, CustomerJourneyItem, CjItemState } from "@shared/schema";

interface DriverSummary {
  driver: string;
  activated: boolean;
  count: number;
}

interface JourneyDetail {
  journey: CustomerJourney;
  items: CustomerJourneyItem[];
  drivers: DriverSummary[];
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

  const isAdmin = ["super_admin", "admin"].includes(profile?.role || "");

  const journeysQuery = useQuery<CustomerJourney[]>({
    queryKey: ["/api/customer-journeys"],
  });

  const detailQuery = useQuery<JourneyDetail>({
    queryKey: ["/api/customer-journeys", selectedId],
    enabled: !!selectedId,
  });

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

  const journeys = journeysQuery.data ?? [];
  const filtered = journeys.filter((j) => {
    if (!search.trim()) return true;
    const hay = [
      journeyTitle(j), j.customerKey, j.telefono, j.codiceCliente,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(search.toLowerCase().trim());
  });

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
                <p className="text-sm text-muted-foreground">
                  Cross-sell sui clienti da nuova attivazione mobile (dal 01/07/2026).
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

            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca cliente, CF/P.IVA, telefono…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-journey"
              />
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
                    Le journey si aprono dalle nuove attivazioni mobile dal 01/07/2026.
                    {isAdmin && " Usa “Rigenera da BiSuite” per elaborare le vendite."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((j) => (
                  <Card
                    key={j.id}
                    className="cursor-pointer hover-elevate transition-all"
                    onClick={() => setSelectedId(j.id)}
                    data-testid={`card-journey-${j.id}`}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        {j.customerType === "azienda" ? (
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate" data-testid={`text-journey-name-${j.id}`}>
                          {journeyTitle(j)}
                        </span>
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {j.customerKey} · aperta il {fmtDate(j.openedAt)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Badge variant="outline" className="text-xs">
                        {j.status === "aperta" ? "Aperta" : "Chiusa"}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
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
                statePending={stateMutation.isPending}
                gettonePending={gettoneMutation.isPending}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function JourneyDetailView({
  detail, onSetState, onSetGettone, statePending, gettonePending,
}: {
  detail: JourneyDetail;
  onSetState: (id: string, state: CjItemState) => void;
  onSetGettone: (id: string, confirmed: boolean) => void;
  statePending: boolean;
  gettonePending: boolean;
}) {
  const { journey, items, drivers } = detail;
  const driverMap = new Map(drivers.map((d) => [d.driver, d]));

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
                  <span className="text-xs font-medium leading-tight">
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
                    <TableHead>Inserito</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="text-center">Gettone</TableHead>
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
                        {fmtDate(it.dataInserimento)}
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
