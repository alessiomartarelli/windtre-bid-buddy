import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  AlertTriangle, ArrowDownToLine, CalendarDays, ChevronDown, ChevronRight,
  CircleHelp, RefreshCw, Search, Store, Users, Wallet,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildCjCohortModel, summarizeCjCohort } from "@shared/customerJourneyCohorts";
import type { CjCohortData, CjCohortEvent } from "@shared/customerJourneyCohorts";
import { buildCjProgression } from "@shared/customerJourneyProgression";
import CohortProgression from "./CohortProgression";

interface CohortReportProps {
  triggerDate?: string;
  onOpenJourney: (id: string) => void;
}

const ALL = "tutti";
const euro = (v: number) => v.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const monthName = (m: string) => {
  const [year, month] = m.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};
const eventIdentity = (e: CjCohortEvent) => `${e.kind}-${e.itemId}-${e.month}-${e.source}`;

export default function CohortReport({ triggerDate, onOpenJourney }: CohortReportProps) {
  const query = useQuery<CjCohortData>({
    queryKey: ["/api/customer-journeys/report-cohorts"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/customer-journeys/report-cohorts");
      return res.json();
    },
    staleTime: 60_000,
  });
  const [cohortMonth, setCohortMonth] = useState(ALL);
  const defaultCohortChosen = useRef(false);
  const [observationMonth, setObservationMonth] = useState(ALL);
  const [shop, setShop] = useState(ALL);
  const [customerType, setCustomerType] = useState(ALL);
  const [search, setSearch] = useState("");
  const [attribution, setAttribution] = useState<"opener" | "seller">("opener");
  const [employee, setEmployee] = useState(ALL);
  const [purchasedOnly, setPurchasedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [cohortClientMembership, setCohortClientMembership] = useState<"active" | "inactive">("active");

  const data = query.data;
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const model = useMemo(() => buildCjCohortModel(rows, triggerDate), [rows, triggerDate]);
  const typeByJourney = useMemo(() => new Map(rows.map(r => [r.journeyId, r.customerType])), [rows]);
  const cohortMonths = useMemo(() => [...new Set(model.customers.map(c => c.cohort))].sort(), [model.customers]);
  const historicalCohortMonths = useMemo(() => cohortMonths.filter(month => month <= new Date().toISOString().slice(0, 7)), [cohortMonths]);
  useEffect(() => {
    if (!defaultCohortChosen.current && historicalCohortMonths.length > 0) {
      defaultCohortChosen.current = true;
      setCohortMonth(historicalCohortMonths[0]);
    }
  }, [cohortMonth, historicalCohortMonths]);
  const observationMonths = useMemo(() => [...new Set(model.events.map(e => e.month))].sort().reverse(), [model.events]);
  const shops = useMemo(() => [...new Set([...model.customers.map(c => c.pdv), ...model.events.map(e => e.pdv)].filter(Boolean))].sort((a, b) => a.localeCompare(b, "it")), [model]);
  const employees = useMemo(() => [...new Set(attribution === "opener" ? model.customers.map(c => c.opener) : model.events.map(e => e.seller))].filter(Boolean).sort((a, b) => a.localeCompare(b, "it")), [attribution, model]);

  const scoped = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase("it");
    let customers = model.customers.filter(c =>
      (cohortMonth === ALL || c.cohort === cohortMonth) &&
      (shop === ALL || c.pdv === shop) &&
      (customerType === ALL || typeByJourney.get(c.journeyId) === customerType) &&
      (attribution !== "opener" || employee === ALL || c.opener === employee) &&
      (!searchText || `${c.cliente} ${c.journeyId} ${c.opener} ${c.pdv}`.toLocaleLowerCase("it").includes(searchText)),
    );
    const clientIds = new Set(customers.map(c => c.journeyId));
    let events = model.events.filter(e =>
      clientIds.has(e.journeyId) &&
      (observationMonth === ALL || e.month === observationMonth) &&
      (attribution !== "seller" || employee === ALL || e.seller === employee),
    );
    return { customers, events };
  }, [model, cohortMonth, observationMonth, shop, customerType, typeByJourney, attribution, employee, search]);

  const progression = useMemo(() => {
    const customerIds = new Set(scoped.customers.map(customer => customer.journeyId));
    return buildCjProgression(rows.filter(row => customerIds.has(row.journeyId)), scoped.customers);
  }, [rows, scoped.customers]);

  const summary = useMemo(() => summarizeCjCohort(scoped.customers, scoped.events), [scoped.customers, scoped.events]);
  const employeeComparison = useMemo(() => {
    const searchText = search.trim().toLocaleLowerCase("it");
    const baseCustomers = model.customers.filter(c =>
      (cohortMonth === ALL || c.cohort === cohortMonth) &&
      (shop === ALL || c.pdv === shop) &&
      (customerType === ALL || typeByJourney.get(c.journeyId) === customerType) &&
      (!searchText || `${c.cliente} ${c.journeyId} ${c.opener} ${c.pdv}`.toLocaleLowerCase("it").includes(searchText)),
    );
    const baseIds = new Set(baseCustomers.map(c => c.journeyId));
    const baseEvents = model.events.filter(e =>
      baseIds.has(e.journeyId) &&
      (observationMonth === ALL || e.month === observationMonth),
    );
    const names = [...new Set(attribution === "opener" ? baseCustomers.map(c => c.opener) : baseEvents.map(e => e.seller))]
      .filter(Boolean).sort((a, b) => a.localeCompare(b, "it"));
    return names.map(name => {
      const clients = attribution === "opener" ? baseCustomers.filter(c => c.opener === name) : baseCustomers;
      const ids = new Set(clients.map(c => c.journeyId));
      const events = baseEvents.filter(e => ids.has(e.journeyId) && (attribution === "opener" ? true : e.seller === name));
      return { name, ...summarizeCjCohort(clients, events) };
    });
  }, [model, cohortMonth, observationMonth, shop, customerType, typeByJourney, attribution, search]);
  const monthly = useMemo(() => {
    const months = [...new Set(scoped.events.map(e => e.month))].sort();
    return months.map(month => {
      const events = scoped.events.filter(e => e.month === month);
      const totals = summarizeCjCohort(scoped.customers, events);
      return { month, ...totals };
    });
  }, [scoped.customers, scoped.events]);
  const inverse = useMemo(() => {
    const cohorts = [...new Set(scoped.customers.map(c => c.cohort))].sort();
    return cohorts.map(cohort => {
      const customers = scoped.customers.filter(c => c.cohort === cohort);
      const ids = new Set(customers.map(c => c.journeyId));
      const events = scoped.events.filter(e => ids.has(e.journeyId));
      return { cohort, ...summarizeCjCohort(customers, events) };
    });
  }, [scoped.customers, scoped.events]);
  const customersWithEvents = useMemo(() => {
    const eventsByClient = new Map<string, CjCohortEvent[]>();
    scoped.events.forEach(e => eventsByClient.set(e.journeyId, [...(eventsByClient.get(e.journeyId) ?? []), e]));
    return scoped.customers
      .map(customer => ({ customer, events: eventsByClient.get(customer.journeyId) ?? [] }))
      .filter(({ customer, events }) => !purchasedOnly || events.some(e => e.kind === "vendita" && e.active))
      .sort((a, b) => a.customer.cliente.localeCompare(b.customer.cliente, "it"));
  }, [scoped.customers, scoped.events, purchasedOnly]);
  const activeCohortClients = useMemo(
    () => customersWithEvents.filter(({ customer }) => customer.mobileActive),
    [customersWithEvents],
  );
  const inactiveCohortClients = useMemo(
    () => customersWithEvents.filter(({ customer }) => !customer.mobileActive),
    [customersWithEvents],
  );
  const selectedCohortClients = cohortClientMembership === "active" ? activeCohortClients : inactiveCohortClients;

  const exportWorkbook = () => {
    const workbook = XLSX.utils.book_new();
    const evolutionRows: Array<Record<string, string | number>> = [
      ...[0, 1, 2, 3, 4, ...(progression.months.some(row => (row.bins[5] ?? 0) > 0) ? [5] : [])].map(bin => ({
        "Prodotti aggiuntivi oltre alla SIM": bin === 5 ? "5 o più prodotti" : `${bin} ${bin === 1 ? "prodotto" : "prodotti"}`,
        ...Object.fromEntries(progression.months.map(row => [
          row.isPartial ? `Al ${new Date().toLocaleDateString("it-IT")}` : `Fine ${monthName(row.month)}`,
          row.bins[bin] ?? 0,
        ])),
      })),
      ...[
        { label: "Clienti con almeno 1 prodotto", value: (row: typeof progression.months[number]) => row.withProducts },
        { label: "% dei clienti", value: (row: typeof progression.months[number]) => `${row.percentage.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` },
      ].map(({ label, value }) => ({
        "Prodotti aggiuntivi oltre alla SIM": label,
        ...Object.fromEntries(progression.months.map(row => [
          row.isPartial ? `Al ${new Date().toLocaleDateString("it-IT")}` : `Fine ${monthName(row.month)}`,
          value(row),
        ])),
      })),
    ];
    const evolutionSheet = XLSX.utils.json_to_sheet(evolutionRows);
    evolutionSheet["!cols"] = [{ wch: 36 }, ...progression.months.map(() => ({ wch: 23 }))];
    XLSX.utils.book_append_sheet(workbook, evolutionSheet, "Evoluzione clienti");
    const summaryRows = [
      { Indicatore: "Clienti analizzati (denominatore)", Valore: summary.clients },
      { Indicatore: "Clienti con riacquisto valido", Valore: summary.repurchased },
      { Indicatore: "Tasso riacquisto", Valore: `${summary.percentage.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%` },
      { Indicatore: "Clienti avanzati", Valore: summary.advanced },
      { Indicatore: "Vendite valide", Valore: summary.sales },
      { Indicatore: "Nuove piste", Valore: summary.newPiste },
      { Indicatore: "Bonus generato", Valore: summary.generated },
      { Indicatore: "Bonus mensile confermato", Valore: summary.confirmed },
      { Indicatore: "Bonus presunto (separato)", Valore: summary.presumed },
      { Indicatore: "Portafoglio bonus pendente (stock)", Valore: summary.pending },
      { Indicatore: "Bonus generato non allocato per data mancante", Valore: scoped.customers.reduce((total, customer) => total + customer.unallocatedGenerated, 0) },
      { Indicatore: "Saldo riconosciuto non allocabile storicamente", Valore: scoped.customers.reduce((s, c) => s + c.unallocatedConfirmed, 0) },
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Riepilogo");
    const clean = (r: Record<string, unknown>[]) => r.map(({ clients, repurchased, advanced, percentage, sales, newPiste, generated, confirmed, presumed, pending, ...rest }) => ({
      ...rest, clienti: clients, riacquisti: repurchased, avanzati: advanced, percentuale: percentage, vendite: sales, nuove_piste: newPiste, generato: generated, confermato: confirmed, presunto: presumed, stock_pendente: pending,
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(clean(monthly as unknown as Record<string, unknown>[])), "Mesi osservati");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(clean(inverse as unknown as Record<string, unknown>[])), "Clienti per mese acquisizione");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(clean(employeeComparison as unknown as Record<string, unknown>[])), "Confronto addetti");
    const customerExportRows = (clients: typeof customersWithEvents) => clients.map(({ customer }) => ({
      Cliente: customer.cliente, Journey: customer.journeyId, "Mese di acquisizione": customer.cohort, Apertura: customer.opener,
      Negozio: customer.pdv, "SIM attiva": customer.mobileActive ? "Sì" : "No",
      "Bonus generato totale": customer.generated, "Riconosciuto totale incl. presunto": customer.confirmed,
      "Generato non allocato (data mancante)": customer.unallocatedGenerated,
      "Saldo riconosciuto senza mese ricostruibile": customer.unallocatedConfirmed,
      "Tipo cliente": typeByJourney.get(customer.journeyId) ?? "",
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(customerExportRows(activeCohortClients)), "Clienti attivi");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(customerExportRows(inactiveCohortClients)), "Non più qualificati");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(scoped.events.map(e => ({
      Cliente: e.cliente, Journey: e.journeyId, "Mese di acquisizione": e.cohort, Mese: e.month, Tipo: e.kind,
      Prodotto: e.product, Venditore: e.seller, Apertura: e.opener, Negozio: e.pdv,
      Fonte: e.source, Attivo: e.active ? "Sì" : "No", "Nuova pista": e.newPista ? "Sì" : "No",
      Generato: e.generated, Confermato: e.confirmed,
    }))), "Eventi");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      { Diagnostica: "Vendite senza mese d'inserimento", Valore: model.undatedSales },
      { Diagnostica: "Bonus generato non allocato per data mancante", Valore: model.unallocatedGenerated },
      { Diagnostica: "Saldo riconosciuto non allocabile storicamente", Valore: model.unallocatedConfirmed },
      { Diagnostica: "Storici economici incompleti", Valore: model.incompleteHistories },
      { Diagnostica: "Upload legacy", Valore: data?.legacyUploads ?? 0 },
      { Diagnostica: "Elementi ambigui", Valore: data?.ambiguousItems ?? 0 },
      { Diagnostica: "Report limitato al perimetro autorizzato", Valore: data?.operatorScoped ? "Sì" : "No" },
    ]), "Diagnostica");
    const progressionMonths = cohortMonth === ALL ? [] : progression.months.map(row => ({
      Mese: row.month, "Denominatore fisso": row.clients, "Clienti con SIM valide oggi": row.activeClients,
      "Clienti non più qualificati": row.inactiveClients, "Clienti con almeno una pista": row.withProducts,
      "Percentuale su denominatore": row.percentage, "0 piste": row.bins[0], "1 pista": row.bins[1],
      "2 piste": row.bins[2], "3 piste": row.bins[3], "4 piste": row.bins[4], "5 o più piste": row.bins[5],
      "Delta 0 piste": row.deltas?.[0] ?? "", "Delta 1 pista": row.deltas?.[1] ?? "",
      "Delta 2 piste": row.deltas?.[2] ?? "", "Delta 3 piste": row.deltas?.[3] ?? "",
      "Delta 4 piste": row.deltas?.[4] ?? "", "Delta 5 o più piste": row.deltas?.[5] ?? "",
      "Prima pista": row.firstProduct, "Da una a due o più": row.fromOneToMore,
      "Clienti avanzati": row.advanced, "SIM cadute nel mese": row.droppedSims, "Mese parziale": row.isPartial ? "Sì" : "No",
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(progressionMonths), "Progressione clienti");
    const droppedSheet = progression.dropped.map(sim => ({
      Cliente: sim.cliente, Journey: sim.journeyId, "Mese di acquisizione": sim.cohort, Negozio: sim.pdv,
      Venditore: sim.seller, "Contratto SIM": sim.contract, Prodotto: sim.product, Stato: sim.state,
      "Stato economico": sim.economicState ?? "", "Mese perdita": sim.month ?? "",
      Fonte: sim.source, "Cliente uscito da CJ": sim.exited ? "Sì" : "No", "SIM caduta oggi": sim.currentlyDropped ? "Sì" : "No",
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(droppedSheet), "SIM cadute oggi");
    const fallsSheet = progression.falls.map(sim => ({
      Cliente: sim.cliente, Journey: sim.journeyId, "Mese di acquisizione": sim.cohort, Negozio: sim.pdv,
      Venditore: sim.seller, "Contratto SIM": sim.contract, Prodotto: sim.product, "Mese perdita": sim.month ?? "",
      Fonte: sim.source, "Stato SIM oggi": sim.currentlyDropped ? "Caduta" : "Recuperata",
      "Cliente uscito da CJ": sim.exited ? "Sì" : "No",
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(fallsSheet), "Cadute documentate");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(progression.exitedCustomers.map(customer => ({
      Cliente: customer.cliente, Journey: customer.journeyId, "Mese di acquisizione": customer.cohort, Negozio: customer.pdv,
      "Addetto apertura": customer.opener, "SIM valide oggi": "No",
    }))), "Usciti da CJ");
    XLSX.writeFile(workbook, `evoluzione_clienti_${cohortMonth === ALL ? "tutti" : cohortMonth}.xlsx`);
  };

  const toggleExpanded = (id: string) => setExpanded(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  const selectClass = "h-9 w-full sm:w-auto sm:min-w-[170px]";

  if (query.isLoading) return <div className="space-y-4" aria-label="Caricamento evoluzione clienti">
    <div className="h-24 animate-pulse rounded-xl bg-muted/70" /><div className="h-12 animate-pulse rounded-xl bg-muted/50" /><div className="h-64 animate-pulse rounded-xl bg-muted/50" />
  </div>;
  if (query.isError) return <Card className="border-destructive/30"><CardContent className="flex flex-col items-start gap-3 py-8 sm:flex-row sm:items-center">
    <AlertTriangle className="h-5 w-5 text-destructive" /><div className="flex-1"><h3 className="font-semibold">Report non disponibile</h3><p className="text-sm text-muted-foreground">Non è stato possibile caricare l’evoluzione dei clienti.</p></div>
    <Button variant="outline" onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Riprova</Button>
  </CardContent></Card>;
  if (!data || model.customers.length === 0) return <Card><CardContent className="py-12 text-center">
    <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">Nessun gruppo clienti disponibile</h3>
    <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">Non risultano journey con SIM mobile eleggibile nel periodo T0–T6 {triggerDate ? `dal mese ${triggerDate.slice(0, 7)}` : ""}.</p>
    <Button variant="outline" className="mt-4" onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Aggiorna</Button>
  </CardContent></Card>;

  const kpis = [
    { label: "Clienti analizzati", value: summary.clients.toLocaleString("it-IT"), note: "Denominatore: journey eleggibili, incluse inattive", icon: Users, tone: "text-primary" },
    { label: "Riacquisto valido", value: `${summary.repurchased} · ${summary.percentage.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`, note: `${summary.repurchased} clienti / ${summary.clients} clienti analizzati`, icon: CalendarDays, tone: "text-emerald-700 dark:text-emerald-300" },
    { label: "Clienti avanzati", value: summary.advanced.toLocaleString("it-IT"), note: "Almeno una nuova pista valida", icon: ChevronRight, tone: "text-indigo-700 dark:text-indigo-300" },
    { label: "Vendite · nuove piste", value: `${summary.sales} · ${summary.newPiste}`, note: "Vendite valide / piste distinte aggiunte", icon: Store, tone: "text-foreground" },
    { label: "Bonus generato", value: euro(summary.generated), note: "Marginale sulle nuove piste, non commissione addetto", icon: Wallet, tone: "text-foreground" },
    { label: "Confermato · presunto", value: `${euro(summary.confirmed)} · ${euro(summary.presumed)}`, note: "Il presunto resta separato dal confermato", icon: CircleHelp, tone: "text-foreground" },
    { label: "Portafoglio pendente", value: euro(summary.pending), note: "Stock attuale del gruppo clienti, non attribuito al venditore né al mese", icon: Wallet, tone: "text-amber-700 dark:text-amber-300" },
  ];

  return <div className="space-y-5" data-testid="cohort-report">
    <section className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="max-w-3xl">
          <div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-primary/30 bg-primary/5">STORICO COMMERCIALE</Badge><span className="text-xs text-muted-foreground">Confronto mensile · finestra solare T0–T6</span></div>
          <h2 className="text-2xl font-semibold tracking-tight">Evoluzione clienti</h2>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-56">
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="primary-cohort-month">Mese di acquisizione</label>
            <Select value={cohortMonth} onValueChange={setCohortMonth}>
              <SelectTrigger id="primary-cohort-month" className="w-full" data-testid="select-cohort-month"><SelectValue placeholder="Seleziona mese di acquisizione" /></SelectTrigger>
              <SelectContent>
                {cohortMonth === ALL && <SelectItem value={ALL}>Seleziona mese di acquisizione</SelectItem>}
                {cohortMonths.map(m => <SelectItem key={m} value={m}>{monthName(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />Aggiorna</Button>
          <Button onClick={exportWorkbook} disabled={!scoped.customers.length} data-testid="export"><ArrowDownToLine className="mr-2 h-4 w-4" />Esporta Excel</Button>
        </div>
      </div>
    </section>

    {data.operatorScoped && <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">Perimetro operatore: sono visibili solo gli elementi autorizzati; il report è parziale.</p>}
    <CohortProgression progression={progression} cohortSelected={cohortMonth !== ALL} cohortMonth={cohortMonth === ALL ? "" : cohortMonth} onOpenJourney={onOpenJourney} />
    <details className="group rounded-xl border border-border bg-card" data-testid="cohort-advanced-details">
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold hover:bg-muted/30">
        <span className="inline-flex items-center gap-2"><span className="transition-transform group-open:rotate-90">›</span> Dettagli e filtri avanzati</span>
      </summary>
      <div className="space-y-5 border-t border-border p-3 sm:p-5">
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />Filtri dell’evoluzione clienti</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div><label className="mb-1 block text-xs text-muted-foreground">Mese osservazione</label><Select value={observationMonth} onValueChange={setObservationMonth}><SelectTrigger className={selectClass} data-testid="observation-month"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Tutti i mesi</SelectItem>{observationMonths.map(m => <SelectItem key={m} value={m}>{monthName(m)}</SelectItem>)}</SelectContent></Select></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Negozio apertura</label><Select value={shop} onValueChange={setShop}><SelectTrigger className={selectClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Tutti i negozi</SelectItem>{shops.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Tipo cliente</label><Select value={customerType} onValueChange={setCustomerType}><SelectTrigger className={selectClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Tutti i tipi</SelectItem><SelectItem value="privato">Privato</SelectItem><SelectItem value="azienda">Azienda</SelectItem></SelectContent></Select></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Attribuzione addetto</label><Select value={attribution} onValueChange={v => { setAttribution(v as "opener" | "seller"); setEmployee(ALL); }}><SelectTrigger className={selectClass} data-testid="attribution-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="opener">Apertura journey</SelectItem><SelectItem value="seller">Venditore evento</SelectItem></SelectContent></Select></div>
        <div><label className="mb-1 block text-xs text-muted-foreground">{attribution === "opener" ? "Addetto apertura" : "Venditore"}</label><Select value={employee} onValueChange={setEmployee}><SelectTrigger className={selectClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Tutti gli addetti</SelectItem>{employees.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca cliente o journey…" className="pl-9" /></div>
        <Button variant={purchasedOnly ? "default" : "outline"} size="sm" onClick={() => setPurchasedOnly(v => !v)} aria-pressed={purchasedOnly}>{purchasedOnly ? "Solo con acquisti" : "Mostra anche senza acquisti"}</Button>
        <span className="text-xs text-muted-foreground sm:ml-auto">Apertura: tutti gli eventi dei clienti. Venditore: solo contributi degli eventi attribuiti.</span>
      </div>
    </section>

    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="summary">
      {kpis.map(({ label, value, note, icon: Icon, tone }) => <Card key={label} className="border-border/80"><CardContent className="flex min-h-[112px] gap-3 p-4">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 ${tone}`}><Icon className="h-4 w-4" /></div>
        <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className={`mt-1 truncate text-xl font-semibold tabular-nums ${tone}`}>{value}</p><p className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p></div>
      </CardContent></Card>)}
    </section>

    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />Metodo, qualità e perimetro dello storico</h3>
      <ul className="mt-2 grid gap-1.5 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
        <li>Gli stock commerciali sono ricalcolati sugli stati validi oggi, non sono fotografie storiche di chiusura mensile; il denominatore include journey inattive ma eleggibili.</li>
        <li>La finestra commerciale è solare T0–T6. Le competenze DRMS usano il mese di competenza, mai la data di caricamento.</li>
        <li>Una perdita mensile usa solo la competenza DRMS o una decisione manuale esplicita. Date non ricostruibili restano separate; mai dedotte da data di aggiornamento.</li>
        <li>Per la progressione, il mese di osservazione e il filtro venditore evento non cambiano il gruppo clienti né la sequenza delle vendite.</li>
        <li>Una pista ripetuta genera zero bonus marginale. Gli euro esposti non sono commissioni individuali.</li>
        <li>Presunto e confermato sono separati. Storici manuali mancanti, upload legacy e abbinamenti ambigui sono incompleti: non vengono inferiti.</li>
        <li>{model.undatedSales} vendite prive di mese d’inserimento non sono collocate nelle tabelle mensili.</li>
        <li>{model.incompleteHistories} storici economici incompleti; {data.legacyUploads} upload legacy e {data.ambiguousItems} elementi ambigui da riconciliare.</li>
        {data.operatorScoped && <li className="font-semibold text-amber-800 dark:text-amber-200 sm:col-span-2">Perimetro operatore: sono visibili solo gli elementi autorizzati, quindi il report è parziale.</li>}
      </ul>
    </section>
    {model.unallocatedGenerated > 0 && <section className="rounded-xl border-2 border-amber-500/50 bg-amber-500/10 p-4 sm:p-5" data-testid="cohort-unallocated-warning">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div><h3 className="font-semibold text-amber-900 dark:text-amber-100">Bonus generato senza data: {euro(model.unallocatedGenerated)} non ripartibile per mese o venditore</h3>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/80">Le vendite qualificanti senza data d’inserimento mantengono il bonus generato nel portafoglio cliente, ma la cronologia della pista non è ricostruibile: l’importo non è attribuito a un mese o a un addetto e non viene inventata una sequenza. Vendite senza data: {model.undatedSales}. Dettaglio completo nell’esportazione, scheda Diagnostica.</p>
        </div>
      </div>
    </section>}
    {model.customers.some(c => c.unallocatedConfirmed !== 0) && <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4" data-testid="cohort-economic-gap">
      <h3 className="text-sm font-semibold">Riconoscimenti non interamente collocabili nello storico</h3>
      <p className="mt-1 text-xs text-muted-foreground">Il saldo attuale dei clienti differisce dai movimenti ricostruibili di {euro(model.unallocatedConfirmed)}.
        Per questi clienti mancano eventi economici databili: nessun mese viene inventato. Il portafoglio pendente usa il saldo attuale;
        le tabelle mensili mostrano solo movimenti documentati. Gli scostamenti per cliente sono nell’export.</p>
    </section>}

    {scoped.customers.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Nessun cliente corrisponde ai filtri selezionati. Modifica i filtri per consultare il gruppo clienti.</CardContent></Card>}
    {scoped.customers.length > 0 && <>
      <CohortTable title="Andamento per mese osservato" caption="Scomposizione mensile del gruppo clienti selezionato. Il mese osservato può essere una vendita (inserimento) o una competenza economica." rows={monthly.map(r => ({ key: r.month, label: monthName(r.month), ...r }))} showPending={false} />
      <CohortTable title="Confronto per mese di acquisizione" caption="Per ogni mese di apertura: contributi osservati nel periodo filtrato, non troncati dai filtri generali. Lo stock pendente è attuale, non un flusso." rows={inverse.map(r => ({ key: r.cohort, label: monthName(r.cohort), ...r }))} />
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <h3 className="font-semibold">Confronto addetti · {attribution === "opener" ? "apertura journey" : "vendita evento"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{attribution === "opener"
            ? "Ogni addetto include tutti gli eventi dei clienti delle proprie aperture; il denominatore è il numero dei suoi clienti eleggibili."
            : "Sono conteggiati solo gli eventi venduti dall'addetto. Per confronti omogenei, ogni percentuale usa come denominatore l'intero gruppo clienti eleggibile filtrato, non i soli clienti a cui ha venduto."}</p>
        </div>
        {employeeComparison.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nessun contributo addetto per i filtri correnti.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground"><tr>{["Addetto", "Clienti base", "Riacquisti / %", "Avanzati", "Vendite", "Nuove piste", "Generato", "Confermato", "Presunto"].map(h => <th key={h} className="whitespace-nowrap px-3 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{employeeComparison.map(row => <tr key={row.name} className={`border-t border-border ${employee === row.name ? "bg-primary/5" : ""}`}><td className="px-3 py-3 font-medium">{row.name}{employee === row.name ? " · selezionato" : ""}</td><td className="px-3 py-3 tabular-nums">{row.clients}</td><td className="px-3 py-3 tabular-nums">{row.repurchased} / {row.percentage.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</td><td className="px-3 py-3 tabular-nums">{row.advanced}</td><td className="px-3 py-3 tabular-nums">{row.sales}</td><td className="px-3 py-3 tabular-nums">{row.newPiste}</td><td className="px-3 py-3 tabular-nums">{euro(row.generated)}</td><td className="px-3 py-3 tabular-nums">{euro(row.confirmed)}</td><td className="px-3 py-3 tabular-nums">{euro(row.presumed)}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold">Clienti del gruppo selezionato</h3><p className="text-xs text-muted-foreground">Elenco separato per qualificazione attuale · inclusi quelli senza riacquisti validi</p></div><Badge variant="outline">Denominatore {summary.clients}</Badge></div>
        <div className="space-y-3 p-3 sm:p-4">
          <div role="tablist" aria-label="Stato dei clienti del gruppo selezionato" className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/35 p-1 sm:inline-flex">
            <button type="button" role="tab" id="cohort-clients-active" aria-selected={cohortClientMembership === "active"} aria-controls="cohort-clients-panel" tabIndex={cohortClientMembership === "active" ? 0 : -1} onClick={() => setCohortClientMembership("active")} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setCohortClientMembership("inactive"); document.getElementById("cohort-clients-inactive")?.focus(); } }} data-testid="cohort-clients-active" className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${cohortClientMembership === "active" ? "bg-indigo-600 text-white shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}>
              Attivi in CJ <Badge variant="secondary" className={cohortClientMembership === "active" ? "bg-white/20 text-white" : ""}>{activeCohortClients.length}</Badge>
            </button>
            <button type="button" role="tab" id="cohort-clients-inactive" aria-selected={cohortClientMembership === "inactive"} aria-controls="cohort-clients-panel" tabIndex={cohortClientMembership === "inactive" ? 0 : -1} onClick={() => setCohortClientMembership("inactive")} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setCohortClientMembership("active"); document.getElementById("cohort-clients-active")?.focus(); } }} data-testid="cohort-clients-inactive" className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${cohortClientMembership === "inactive" ? "bg-amber-600 text-white shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}>
              Non più qualificati <Badge variant="secondary" className={cohortClientMembership === "inactive" ? "bg-white/20 text-white" : ""}>{inactiveCohortClients.length}</Badge>
            </button>
          </div>
          <p className={`text-xs leading-relaxed ${cohortClientMembership === "inactive" ? "text-amber-800 dark:text-amber-200" : "text-muted-foreground"}`}>
            {cohortClientMembership === "inactive"
              ? "Nessuna SIM attiva eleggibile oggi. Una perdita DRMS o manuale può rendere il cliente non qualificato se non resta una SIM attiva alternativa. Le SIM annullate nelle vendite sono escluse a monte da entrambe le schede."
              : "Almeno una SIM attiva eleggibile oggi. Le SIM annullate nelle vendite sono escluse a monte da entrambe le schede."}
          </p>
        </div>
        <div role="tabpanel" id="cohort-clients-panel" aria-labelledby={cohortClientMembership === "active" ? "cohort-clients-active" : "cohort-clients-inactive"} data-testid="cohort-clients-panel" className="divide-y divide-border border-t border-border">
          {selectedCohortClients.length === 0 ? <div className="px-4 py-10 text-center">
            <Users className={`mx-auto mb-2 h-7 w-7 ${cohortClientMembership === "inactive" ? "text-amber-600/70" : "text-indigo-600/70"}`} />
            <p className="text-sm font-medium">{cohortClientMembership === "inactive" ? "Nessun cliente non più qualificato" : "Nessun cliente attivo"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Nessun cliente corrisponde ai filtri e alla selezione di acquisto correnti.</p>
          </div> : selectedCohortClients.map(({ customer, events }) => {
            const isExpanded = expanded.includes(customer.journeyId);
            return <div key={customer.journeyId}>
              <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:px-4">
                <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => toggleExpanded(customer.journeyId)} data-testid="client-expand" aria-expanded={isExpanded}>
                  {isExpanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{customer.cliente}</span><span className="mt-0.5 block text-xs text-muted-foreground">{monthName(customer.cohort)} · {customer.opener} · {customer.pdv} · {events.filter(e => e.kind === "vendita" && e.active).length} acquisti osservati</span></span>
                </button>
                <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
                  <Badge variant="outline">{customer.mobileActive ? "SIM attiva" : "SIM inattiva"}</Badge>
                  {events.length === 0 && <Badge variant="secondary">Nessun evento</Badge>}
                  <span className="min-w-[110px] text-right text-xs tabular-nums text-muted-foreground">Generato {euro(customer.generated)}</span>
                  <Button variant="outline" size="sm" onClick={() => onOpenJourney(customer.journeyId)}>Apri journey</Button>
                </div>
              </div>
              {isExpanded && <div className="border-t border-border bg-muted/20 px-3 py-3 sm:px-8" data-testid={`cohort-client-details-${customer.journeyId}`}>
                {events.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Nessun evento nel periodo e nei filtri selezionati. Il cliente resta nel denominatore.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="text-muted-foreground"><tr>{["Mese", "Tipo evento", "Prodotto", "Venditore", "Apertura", "Negozio", "Fonte", "Pista nuova", "Generato", "Riconosciuto"].map(h => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>{events.map(e => <tr key={eventIdentity(e)} className="border-t border-border/70"><td className="px-2 py-2">{monthName(e.month)}</td><td className="px-2 py-2 capitalize">{e.kind}</td><td className="px-2 py-2">{e.product}</td><td className="px-2 py-2">{e.seller}</td><td className="px-2 py-2">{e.opener}</td><td className="px-2 py-2">{e.pdv}</td><td className="px-2 py-2">{e.source || "—"}</td><td className="px-2 py-2">{e.newPista ? "Sì" : "—"}</td><td className="px-2 py-2 tabular-nums">{e.generated ? euro(e.generated) : "—"}</td><td className="px-2 py-2 tabular-nums">{e.confirmed ? euro(e.confirmed) : "—"}</td></tr>)}</tbody>
                </table></div>}
              </div>}
            </div>;
          })}
        </div>
      </section>
    </>}
      </div>
    </details>
  </div>;
}

function CohortTable({ title, caption, rows, showPending = true }: { title: string; caption: string; showPending?: boolean; rows: Array<{ key: string; label: string; clients: number; repurchased: number; advanced: number; percentage: number; sales: number; newPiste: number; generated: number; confirmed: number; presumed: number; pending: number }> }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="border-b border-border p-4"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{caption}</p></div>
    {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nessun dato nel mese selezionato.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs">
      <thead className="bg-muted/40 text-muted-foreground"><tr>{["Periodo", "Clienti*", "Riacquisti / %", "Avanzati", "Vendite", "Nuove piste", "Generato", "Confermato", "Presunto", ...(showPending ? ["Stock pendente"] : [])].map(x => <th key={x} className="whitespace-nowrap px-3 py-3 font-medium">{x}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.key} className="border-t border-border"><td className="whitespace-nowrap px-3 py-3 font-medium capitalize">{r.label}</td><td className="px-3 py-3 tabular-nums">{r.clients}</td><td className="px-3 py-3 tabular-nums">{r.repurchased} · {r.percentage.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%</td><td className="px-3 py-3 tabular-nums">{r.advanced}</td><td className="px-3 py-3 tabular-nums">{r.sales}</td><td className="px-3 py-3 tabular-nums">{r.newPiste}</td><td className="px-3 py-3 tabular-nums">{euro(r.generated)}</td><td className="px-3 py-3 tabular-nums">{euro(r.confirmed)}</td><td className="px-3 py-3 tabular-nums">{euro(r.presumed)}</td>{showPending && <td className="px-3 py-3 tabular-nums">{euro(r.pending)}</td>}</tr>)}</tbody>
    </table></div>}
    <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">* Denominatore: clienti eleggibili del gruppo nel perimetro mostrato, incluse le SIM inattive. {showPending ? "Lo stock pendente è riferito al portafoglio e non è un flusso mensile." : "Lo stock pendente non è un indicatore mensile."}</p>
  </section>;
}
