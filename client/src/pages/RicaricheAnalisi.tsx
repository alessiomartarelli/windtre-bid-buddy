import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNavbar } from "@/components/AppNavbar";
import { apiUrl } from "@/lib/basePath";
import { currentRechargePeriod } from "@/lib/ricarichePeriod";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, CircleDollarSign, CloudUpload, Download, FileSpreadsheet, Filter, History, LoaderCircle, RefreshCw, Search, Signal, Trash2, X } from "lucide-react";
import { rechargeReportOverlapsPeriod } from "@shared/ricaricheAnalysis";
import * as XLSX from "xlsx";

type Report = { id: string; fileName: string; uploadedAt: string; rowCount: number; periodFrom: string | null; periodTo: string | null; declaredPeriodFrom: string | null; declaredPeriodTo: string | null };
type Row = { id: string; date: string; phone: string | null; temporaryPhone: string | null; amount: number | string | null; customer: string | null; supplier: string | null; transactionId: string | null; rechargeType: string | null; pdv: string | null; saleId: string | null; bisuiteAmount: number | string | null; difference: number | string | null; status: string };
type Provider = "vodafone_fastweb" | "windtre";
type Payload = {
  provider: Provider | null;
  allowedProviders: Provider[];
  reports: Report[];
  activeReportId: string | null;
  rows: Row[];
  pdvs: { key: string; label: string }[];
  apiPeriod: { from: string; to: string } | null;
  apiPage: number;
  apiPageSize: number;
  apiHasMore: boolean;
  apiRechargeCount: number;
  apiRechargeAmount: number | string;
};
const EMPTY: Payload = { provider: null, allowedProviders: [], reports: [], activeReportId: null, rows: [], pdvs: [], apiPeriod: null, apiPage: 0, apiPageSize: 100, apiHasMore: false, apiRechargeCount: 0, apiRechargeAmount: 0 };
type LoadOptions = { silent?: boolean; reportId?: string; provider?: Provider; page?: number; from?: string; to?: string };
const PROVIDER_LABEL: Record<Provider, string> = { vodafone_fastweb: "Vodafone / Fastweb", windtre: "WindTre" };
const STATUSES = ["VERIFICATO", "INCONGRUENZA IMPORTO", "NON PRESENTE SU BISUITE", "NON PRESENTE SU FILE", "FUORI PERIODO", "RICEVUTA VIA API"];
const money = (v: number | string | null | undefined) => { if (v === null || v === undefined || v === "") return "—"; const n = Number(v); return Number.isFinite(n) ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n) : "—"; };
const dateLabel = (v: string | null | undefined) => v ? new Intl.DateTimeFormat("it-IT", { timeZone: "UTC" }).format(new Date(v)) : "—";
const duplicateSummary = (count: number, rawIds: unknown) => {
  const ids = Array.isArray(rawIds)
    ? Array.from(new Set(rawIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)))
    : [];
  const shownIds = ids.slice(0, 3);
  const idsLabel = shownIds.length
    ? ` ID: ${shownIds.join(", ")}${ids.length > shownIds.length ? `, +${ids.length - shownIds.length} altri` : ""}.`
    : "";
  return `${count} ${count === 1 ? "transazione già caricata ignorata." : "transazioni già caricate ignorate."}${idsLabel}`;
};
const exportRows = (rows: Row[], hasProviderReport: boolean) => rows.map(r => hasProviderReport
  ? ({ PDV: r.pdv ?? "", Data: dateLabel(r.date), "ID vendita": r.saleId ?? "", "ID transazione provider": r.transactionId ?? "", Cliente: r.customer ?? "", Fornitore: r.supplier ?? "", "Tipo ricarica": r.rechargeType ?? "", "Importo fornitore": r.amount ?? "", "Importo BiSuite": r.bisuiteAmount ?? "", Differenza: r.difference ?? "", Telefono: r.phone ?? r.temporaryPhone ?? "", Stato: r.status })
  : ({ PDV: r.pdv ?? "", Data: dateLabel(r.date), "ID vendita": r.saleId ?? "", Cliente: r.customer ?? "", Fonte: "BiSuite API", Categoria: r.rechargeType ?? "RICARICHE", "Importo ricarica": r.bisuiteAmount ?? "", Telefono: r.phone ?? "", Stato: r.status }));

export default function RicaricheAnalisi() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [query, setQuery] = useState("");
  const [initialPeriod] = useState(currentRechargePeriod);
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);
  const [declaredFrom, setDeclaredFrom] = useState("");
  const [declaredTo, setDeclaredTo] = useState("");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [pdv, setPdv] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<{ key: keyof Row; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async ({ silent = false, reportId, provider: requestedProvider, page = 0, from: requestedFrom, to: requestedTo }: LoadOptions = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (requestedProvider) params.set("provider", requestedProvider);
      if (reportId) params.set("reportId", reportId);
      if (!reportId) {
        const defaultPeriod = currentRechargePeriod();
        params.set("from", requestedFrom ?? defaultPeriod.from);
        params.set("to", requestedTo ?? defaultPeriod.to);
        params.set("page", String(page));
      }
      const queryString = params.toString();
      const query = queryString ? `?${queryString}` : "";
      const res = await fetch(apiUrl(`/api/ricariche-analysis${query}`), { credentials: "include" });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.message || "Impossibile caricare i report."); }
      const json = await res.json();
      setData({
        ...EMPTY,
        ...json,
        allowedProviders: json.allowedProviders || [],
        reports: json.reports || [],
        rows: json.rows || [],
        pdvs: json.pdvs || [],
        apiPeriod: json.apiPeriod || null,
        apiPage: json.apiPage ?? 0,
        apiPageSize: json.apiPageSize ?? EMPTY.apiPageSize,
        apiHasMore: json.apiHasMore ?? false,
        apiRechargeCount: json.apiRechargeCount ?? 0,
        apiRechargeAmount: json.apiRechargeAmount ?? 0,
      });
      if (json.apiPeriod) {
        setFrom(json.apiPeriod.from);
        setTo(json.apiPeriod.to);
      } else if (json.activeReportId) {
        setFrom("");
        setTo("");
      }
      const selectedReport = (json.reports || []).find((report: Report) => report.id === json.activeReportId);
      setDeclaredFrom(selectedReport?.declaredPeriodFrom || selectedReport?.periodFrom?.slice(0, 10) || "");
      setDeclaredTo(selectedReport?.declaredPeriodTo || selectedReport?.periodTo?.slice(0, 10) || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Errore di connessione."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onFile = async (file?: File) => {
    if (!file) return;
    if (!data.provider) { toast({ title: "Provider non disponibile", description: "Aggiorna la pagina e riprova.", variant: "destructive" }); return; }
    if (!/\.(xlsx|xls)$/i.test(file.name)) { toast({ title: "Formato non supportato", description: "Seleziona un file Excel .xlsx o .xls.", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = () => reject(new Error("Lettura del file non riuscita.")); reader.readAsDataURL(file); });
      const res = await fetch(apiUrl("/api/ricariche-analysis/upload"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: data.provider, fileName: file.name, workbookBase64: base64 }) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const skipped = Number(body.duplicatesSkipped) || 0;
        toast({
          title: "Nessuna nuova transazione",
          description: duplicateSummary(skipped, body.skippedTransactionIds),
        });
        await load({ silent: true, provider: data.provider });
        return;
      }
      if (!res.ok) throw new Error(body.message || "Caricamento non riuscito.");
      const skipped = Number(body.duplicatesSkipped) || 0;
      toast({
        title: "Report acquisito",
        description: skipped
          ? `${body.rowCount ?? 0} nuove transazioni importate; ${duplicateSummary(skipped, body.skippedTransactionIds)}`
          : `${body.rowCount ?? 0} righe elaborate.`,
      });
      await load({ silent: true, provider: data.provider });
    } catch (e) { toast({ title: "Errore di caricamento", description: e instanceof Error ? e.message : "Riprova tra poco.", variant: "destructive" }); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const deleteReport = async (report: Report) => {
    if (!data.provider || !window.confirm(`Eliminare definitivamente il report “${report.fileName}”? Le righe contenute non saranno più disponibili.`)) return;
    setDeletingReportId(report.id);
    try {
      const res = await fetch(apiUrl(`/api/ricariche-analysis/${encodeURIComponent(report.id)}`), {
        method: "DELETE",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Eliminazione non riuscita.");
      toast({ title: "Report eliminato", description: "Il file e le sue righe sono stati rimossi dall’analisi." });
      await load({ silent: true, provider: data.provider });
    } catch (e) {
      toast({ title: "Errore di eliminazione", description: e instanceof Error ? e.message : "Riprova tra poco.", variant: "destructive" });
    } finally {
      setDeletingReportId(null);
    }
  };

  const saveDeclaredPeriod = async (clear = false) => {
    if (!activeReport || !data.provider) return;
    const periodFrom = clear ? null : declaredFrom;
    const periodTo = clear ? null : declaredTo;
    if ((periodFrom === null) !== (periodTo === null) || (periodFrom && periodTo && periodFrom > periodTo)) {
      toast({ title: "Periodo non valido", description: "Inserisci entrambe le date e verifica che la data iniziale non sia successiva a quella finale.", variant: "destructive" });
      return;
    }
    setSavingPeriod(true);
    try {
      const res = await fetch(apiUrl(`/api/ricariche-analysis/${encodeURIComponent(activeReport.id)}/period`), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: data.provider,
          declaredPeriodFrom: periodFrom || null,
          declaredPeriodTo: periodTo || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Periodo non salvato.");
      toast({ title: clear ? "Conferma rimossa" : "Periodo confermato", description: clear ? "Il confronto inverso è sospeso finché il periodo non viene confermato." : "Le date sono state salvate e applicate al confronto." });
      await load({ silent: true, reportId: activeReport.id, provider: data.provider });
    } catch (e) {
      toast({ title: "Errore nel periodo", description: e instanceof Error ? e.message : "Riprova tra poco.", variant: "destructive" });
    } finally {
      setSavingPeriod(false);
    }
  };

  const activeReport = data.reports.find(r => r.id === data.activeReportId);
  const visibleReports = useMemo(
    () => data.reports.filter(report => rechargeReportOverlapsPeriod(report, from, to)),
    [data.reports, from, to],
  );
  const canDeleteReports = profile?.role === "admin" || profile?.role === "super_admin";
  const suppliers = useMemo(() => [...new Set(data.rows.map(r => r.supplier).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "it")), [data.rows]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("it");
    const filterFrom = from;
    const filterTo = to;
    return data.rows.filter(r => {
      const d = r.date ? new Date(r.date).toISOString().slice(0, 10) : "";
      const text = [r.customer, r.phone, r.temporaryPhone, r.saleId, r.transactionId, r.rechargeType, r.amount, r.bisuiteAmount, r.difference, r.pdv].join(" ").toLocaleLowerCase("it");
      return (!filterFrom || d >= filterFrom) && (!filterTo || d <= filterTo) && (pdv === "all" || r.pdv === pdv) && (supplier === "all" || r.supplier === supplier) && (status === "all" || r.status === status) && (!q || text.includes(q));
    }).sort((a, b) => { const av = a[sort.key] ?? ""; const bv = b[sort.key] ?? ""; const an = Number(av), bn = Number(bv); const cmp = Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== "" ? an - bn : String(av).localeCompare(String(bv), "it", { numeric: true }); return sort.dir === "asc" ? cmp : -cmp; });
  }, [data.rows, data.apiPeriod, activeReport, from, to, pdv, supplier, status, query, sort]);
  const totalAmount = filtered.reduce((sum, r) => sum + (Number(activeReport ? r.amount : r.bisuiteAmount) || 0), 0);
  const totalBisuiteAmount = filtered.reduce((sum, r) => sum + (Number(r.bisuiteAmount) || 0), 0);
  const mismatches = activeReport ? filtered.filter(r => r.status !== "VERIFICATO" && r.status !== "FUORI PERIODO").length : 0;
  const apiPeriodChanged = !activeReport && (!!data.apiPeriod && (from !== data.apiPeriod.from || to !== data.apiPeriod.to));
  const defaultPeriod = currentRechargePeriod();
  const activeFilters = [activeReport ? from : from !== defaultPeriod.from ? "changed" : "", activeReport ? to : to !== defaultPeriod.to ? "changed" : "", pdv !== "all" ? pdv : "", supplier !== "all" ? supplier : "", status !== "all" ? status : "", query].filter(Boolean).length;
  const reset = () => {
    if (activeReport) {
      setFrom("");
      setTo("");
    } else {
      const period = currentRechargePeriod();
      setFrom(period.from);
      setTo(period.to);
      if (data.apiPeriod && (data.apiPeriod.from !== period.from || data.apiPeriod.to !== period.to)) {
        void load({ provider: data.provider ?? undefined, ...period, page: 0 });
      }
    }
    setPdv("all");
    setSupplier("all");
    setStatus("all");
    setQuery("");
  };
  const currentApiPeriod = !activeReport && data.apiPeriod
    ? { from: data.apiPeriod.from, to: data.apiPeriod.to }
    : {};
  const currentApiPage = !activeReport ? data.apiPage : 0;
  const applyApiPeriod = () => {
    if (!from || !to || from > to) {
      toast({ title: "Periodo non valido", description: "Inserisci entrambe le date e verifica che la data iniziale non sia successiva a quella finale.", variant: "destructive" });
      return;
    }
    void load({ provider: data.provider ?? undefined, from, to, page: 0 });
  };
  const doExport = (kind: "csv" | "xlsx") => {
    if (!filtered.length) { toast({ title: "Nessun dato da esportare", description: "Modifica i filtri e riprova." }); return; }
     const out = exportRows(filtered, !!activeReport);
    if (kind === "csv") {
      const keys = Object.keys(out[0]);
      const csv = [keys.join(";"), ...out.map(r => keys.map(k => { const v = String((r as Record<string, unknown>)[k] ?? "").replace(/"/g, '""'); return /[;"\n]/.test(v) ? `"${v}"` : v; }).join(";"))].join("\n");
      const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "analisi-ricariche.csv"; a.click(); URL.revokeObjectURL(url);
    } else { const ws = XLSX.utils.json_to_sheet(out); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Ricariche"); XLSX.writeFile(wb, "analisi-ricariche.xlsx"); }
  };
  const sortBy = (key: keyof Row) => setSort(prev => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));
  const columns: { label: string; key: keyof Row; cls?: string }[] = [{ label: "PDV", key: "pdv" }, { label: "Data", key: "date" }, { label: "ID vendita", key: "saleId" }, { label: "Cliente", key: "customer" }, { label: "Fornitore", key: "supplier" }, { label: "Importo provider", key: "amount" }, { label: "BiSuite", key: "bisuiteAmount" }, { label: "Differenza", key: "difference" }, { label: "Telefono", key: "phone" }, { label: "Stato", key: "status" }];
  const providerLabel = data.provider ? PROVIDER_LABEL[data.provider] : "provider";
  const periodConfirmed = !!activeReport?.declaredPeriodFrom && !!activeReport?.declaredPeriodTo;
  const outsidePeriodRows = data.rows.filter(r => r.status === "FUORI PERIODO");
  const outsidePeriodAmount = outsidePeriodRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  return <div className="min-h-[100dvh] bg-[#f3f6f5] text-[#172e32]">
    <AppNavbar title="Analisi ricariche" />
    <main className="mx-auto max-w-[1600px] px-4 pb-12 pt-6 sm:px-6 lg:px-9">
      <header className="mb-6 flex flex-col justify-between gap-5 border-b border-[#d7e2df] pb-6 md:flex-row md:items-end">
        <div><div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.19em] text-[#168277]"><Signal className="h-3.5 w-3.5" /> Controllo operativo / Ricariche</div><h1 className="font-display text-3xl font-semibold tracking-[-.04em] sm:text-[38px]">Analisi ricariche</h1><p className="mt-1.5 max-w-2xl text-sm text-[#687c7e]">{activeReport ? `Confronta il report ${providerLabel} con le vendite registrate in BiSuite.` : "Le ricariche delle vendite già ricevute via API da BiSuite sono mostrate qui. Carica un report provider per confrontarle."}</p></div>
        <div className="flex flex-wrap items-center gap-2">{data.allowedProviders.length > 1 && <Select value={data.provider ?? undefined} onValueChange={value => void load({ provider: value as Provider, ...currentApiPeriod })}><SelectTrigger className="w-[190px] border-[#cbd9d6] bg-[#fbfcfa] text-xs"><SelectValue placeholder="Seleziona provider" /></SelectTrigger><SelectContent>{data.allowedProviders.map(p => <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>)}</SelectContent></Select>}<Button variant="outline" onClick={() => void load({ provider: data.provider ?? undefined, ...currentApiPeriod })} disabled={loading} className="border-[#cbd9d6] bg-[#fbfcfa] text-[#385456]"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Aggiorna</Button><Button onClick={() => inputRef.current?.click()} disabled={uploading || !data.provider} className="bg-[#11796f] text-white hover:bg-[#0d655e]"><CloudUpload className="mr-2 h-4 w-4" />{uploading ? "Caricamento…" : "Carica report"}</Button><input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls" onChange={e => void onFile(e.target.files?.[0])} /></div>
      </header>

      {activeReport && <section data-testid="declared-period-editor" className={`mb-5 rounded-xl border p-4 ${outsidePeriodRows.length ? "border-[#e2c894] bg-[#fff8e8]" : periodConfirmed ? "border-[#cbded4] bg-[#f2f8f4]" : "border-[#e4c89b] bg-[#fff8e8]"}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-[#354d4d]">Periodo completo del report</h2>
            {!periodConfirmed
              ? <p className="mt-1 text-xs leading-relaxed text-[#81622f]">Periodo non confermato. Le date rilevate ({dateLabel(activeReport.periodFrom)} – {dateLabel(activeReport.periodTo)}) sono solo i limiti delle righe presenti: il report potrebbe coprire parzialmente quei giorni. Finché non confermi, non vengono mostrate vendite BiSuite “NON PRESENTE SU FILE”.</p>
              : <p className="mt-1 text-xs leading-relaxed text-[#526e62]">Periodo dichiarato: <strong>{dateLabel(activeReport.declaredPeriodFrom)} – {dateLabel(activeReport.declaredPeriodTo)}</strong>. Le vendite BiSuite vengono confrontate solo in questi giorni, estremi inclusi.</p>}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-[.1em] text-[#718386]">Dal</span><Input data-testid="report-period-from" type="date" value={declaredFrom} onChange={e => setDeclaredFrom(e.target.value)} className="h-9 w-[150px] border-[#d6e0dd] bg-white text-xs" /></label>
            <label className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-[.1em] text-[#718386]">Al</span><Input data-testid="report-period-to" type="date" value={declaredTo} onChange={e => setDeclaredTo(e.target.value)} className="h-9 w-[150px] border-[#d6e0dd] bg-white text-xs" /></label>
            <Button size="sm" onClick={() => void saveDeclaredPeriod()} disabled={savingPeriod || !declaredFrom || !declaredTo} className="h-9 bg-[#11796f] text-white hover:bg-[#0d655e]">{savingPeriod ? "Salvataggio…" : periodConfirmed ? "Aggiorna periodo" : "Conferma periodo"}</Button>
            {periodConfirmed && <Button variant="outline" size="sm" onClick={() => void saveDeclaredPeriod(true)} disabled={savingPeriod} className="h-9 border-[#cbd9d6] bg-white text-xs">Rimuovi conferma</Button>}
          </div>
        </div>
        {!!outsidePeriodRows.length && <div className="mt-3 rounded-lg border border-[#e1c486] bg-white/70 px-3 py-2.5 text-xs leading-relaxed text-[#765c2b]">
          <strong>{outsidePeriodRows.length} righe fuori periodo, per {money(outsidePeriodAmount)}</strong> — restano nel report originale ma non entrano nel confronto. Verifica se i giorni aggiuntivi sono stati inclusi solo parzialmente; non estendere il periodo senza confermare la copertura completa.
        </div>}
      </section>}

      <section data-testid="recharge-summaries" className={`mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 ${activeReport ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {activeReport ? (
          <div data-testid="recharge-count" className="rounded-xl border border-[#d5e1dd] bg-[#fbfcfa] p-4 shadow-[0_2px_8px_rgba(31,65,66,.035)]">
            <div className="text-[11px] font-bold uppercase tracking-[.13em] text-[#718386]">Ricariche mostrate</div>
            <div className="mt-2 font-display text-3xl font-semibold tabular-nums">{new Intl.NumberFormat("it-IT").format(filtered.length)}</div>
            <div className="mt-1 text-xs text-[#789092]">transazioni del report con i filtri attivi</div>
          </div>
        ) : (
          <>
            <div data-testid="recharge-total-period" className="rounded-xl border border-[#d5e1dd] bg-[#fbfcfa] p-4 shadow-[0_2px_8px_rgba(31,65,66,.035)]">
              <div className="text-[11px] font-bold uppercase tracking-[.13em] text-[#718386]">Totale ricariche nel periodo</div>
              <div data-testid="recharge-period-count" className="mt-2 font-display text-3xl font-semibold tabular-nums">{new Intl.NumberFormat("it-IT").format(data.apiRechargeCount)}</div>
              <div className="mt-1 text-xs text-[#789092]">Importo totale: <strong data-testid="recharge-period-amount" className="font-semibold text-[#385456]">{money(data.apiRechargeAmount)}</strong></div>
              <div className="mt-1 text-[10px] text-[#8a9a9b]">intero periodo, prima dei filtri della pagina</div>
            </div>
            <div data-testid="recharge-count" className="rounded-xl border border-[#d5e1dd] bg-[#fbfcfa] p-4 shadow-[0_2px_8px_rgba(31,65,66,.035)]">
              <div className="text-[11px] font-bold uppercase tracking-[.13em] text-[#718386]">Ricariche mostrate</div>
              <div className="mt-2 font-display text-3xl font-semibold tabular-nums">{new Intl.NumberFormat("it-IT").format(filtered.length)}</div>
              <div className="mt-1 text-xs text-[#789092]">Importo delle ricariche mostrate: <strong data-testid="recharge-visible-amount" className="font-semibold text-[#385456]">{money(totalAmount)}</strong></div>
              <div className="mt-1 text-[10px] text-[#8a9a9b]">pagina corrente dopo i filtri</div>
            </div>
          </>
        )}
        {activeReport && <div className="rounded-xl border border-[#d5e1dd] bg-[#fbfcfa] p-4 shadow-[0_2px_8px_rgba(31,65,66,.035)]"><div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[.13em] text-[#718386]">Totale BiSuite <CircleDollarSign className="h-4 w-4 text-[#168277]" /></div><div className="mt-2 font-display text-3xl font-semibold tabular-nums">{money(totalBisuiteAmount)}</div><div className="mt-1 text-xs text-[#789092]">importo delle righe filtrate</div></div>}
        {activeReport && <div className="rounded-xl border border-[#d5e1dd] bg-[#fbfcfa] p-4 shadow-[0_2px_8px_rgba(31,65,66,.035)]"><div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[.13em] text-[#718386]">Totale provider <CircleDollarSign className="h-4 w-4 text-[#168277]" /></div><div className="mt-2 font-display text-3xl font-semibold tabular-nums">{money(totalAmount)}</div><div className="mt-1 text-xs text-[#789092]">importo delle righe filtrate</div></div>}
        <div className="rounded-xl border border-[#d5e1dd] bg-[#fbfcfa] p-4 shadow-[0_2px_8px_rgba(31,65,66,.035)]"><div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[.13em] text-[#718386]">{activeReport ? "Da verificare" : "Report provider"} <AlertCircle className="h-4 w-4 text-[#c77b3e]" /></div><div className="mt-2 font-display text-3xl font-semibold tabular-nums">{activeReport ? new Intl.NumberFormat("it-IT").format(mismatches) : "—"}</div><div className="mt-1 text-xs text-[#789092]">{activeReport ? "incongruenze o movimenti mancanti" : "caricalo per avviare il confronto"}</div></div>
      </section>

      <section className="mb-5">
        <div className={`relative overflow-hidden rounded-xl border border-dashed p-5 transition-colors ${drag ? "border-[#168277] bg-[#e5f2ef]" : "border-[#bdd1cc] bg-[#e9f1ee]"}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files?.[0]); }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#d4e8e2] text-[#11796f]"><FileSpreadsheet className="h-5 w-5" /></div><div><div className="text-sm font-semibold">Nuovo report {providerLabel}</div><p className="mt-0.5 text-xs text-[#687f80]">Trascina qui il file Excel oppure selezionalo dal dispositivo. Le vendite BiSuite ricevute via API sono già visibili nella tabella.</p></div></div><Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading || !data.provider} className="shrink-0 border-[#b8cfca] bg-[#f8fbf8] text-[#25645e]">Seleziona file <ChevronDown className="ml-2 h-3.5 w-3.5 -rotate-90" /></Button></div>
          {uploading && <div className="mt-4 flex items-center gap-2 text-xs font-medium text-[#11796f]"><LoaderCircle className="h-4 w-4 animate-spin" /> Elaborazione e riconciliazione in corso…</div>}
        </div>
      </section>

      <section className="mb-5 overflow-hidden rounded-xl border border-[#d7e2df] bg-[#fbfcfa] shadow-[0_2px_10px_rgba(31,65,66,.035)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4ebe8] px-4 py-3"><div className="flex items-center gap-2"><Filter className="h-4 w-4 text-[#168277]" /><h2 className="text-sm font-semibold">Filtri di ricerca</h2>{activeFilters > 0 && <span className="rounded-full bg-[#e1f0ec] px-2 py-0.5 text-[10px] font-bold text-[#16776e]">{activeFilters} attivi</span>}</div>{activeFilters > 0 && <button className="inline-flex items-center gap-1 text-xs font-medium text-[#688083] hover:text-[#11796f]" onClick={reset}><X className="h-3.5 w-3.5" /> Azzera filtri</button>}</div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#789092]">Dal</span><Input data-testid="recharge-filter-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 border-[#d6e0dd] bg-white text-xs" /></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#789092]">Al</span><Input data-testid="recharge-filter-to" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 border-[#d6e0dd] bg-white text-xs" /></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#789092]">Punto vendita</span><Select value={pdv} onValueChange={setPdv}><SelectTrigger className="h-9 border-[#d6e0dd] bg-white text-xs"><SelectValue placeholder="Tutti i PDV" /></SelectTrigger><SelectContent><SelectItem value="all">Tutti i PDV</SelectItem>{data.pdvs.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#789092]">{activeReport ? "Fornitore" : "Fonte"}</span><Select value={supplier} onValueChange={setSupplier}><SelectTrigger className="h-9 border-[#d6e0dd] bg-white text-xs"><SelectValue placeholder="Tutti" /></SelectTrigger><SelectContent><SelectItem value="all">Tutti</SelectItem>{suppliers.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#789092]">Esito</span><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 border-[#d6e0dd] bg-white text-xs"><SelectValue placeholder="Tutti gli esiti" /></SelectTrigger><SelectContent><SelectItem value="all">Tutti gli esiti</SelectItem>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-[#789092]">Cliente, importo, telefono</span><div className="relative"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8ba09f]" /><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cerca…" className="h-9 border-[#d6e0dd] bg-white pl-8 text-xs" /></div></label>
        </div>
        {!activeReport && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8eeeb] px-4 py-3">
          <p className="text-[11px] text-[#718587]">L’intervallo viene caricato dal server; filtri ed export operano sulla pagina caricata.</p>
          <Button size="sm" onClick={applyApiPeriod} disabled={loading || !apiPeriodChanged} className="bg-[#11796f] text-xs text-white hover:bg-[#0d655e]">Applica periodo</Button>
        </div>}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#d7e2df] bg-[#fbfcfa] shadow-[0_2px_10px_rgba(31,65,66,.035)]">
        <div className="flex flex-col justify-between gap-3 border-b border-[#e4ebe8] px-4 py-3 sm:flex-row sm:items-center"><div className="flex min-w-0 items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e5efec] text-[#168277]"><History className="h-4 w-4" /></div><div className="min-w-0"><h2 className="text-sm font-semibold">{activeReport ? "Riconciliazione" : "Ricariche da vendite BiSuite"}</h2><p className="truncate text-[11px] text-[#819294]">{activeReport ? `${activeReport.fileName} · caricato ${dateLabel(activeReport.uploadedAt)}` : "Vendite registrate per il tenant tramite API"}</p></div></div><div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => doExport("csv")} className="h-8 border-[#d6e0dd] bg-white text-xs"><Download className="mr-1.5 h-3.5 w-3.5" /> CSV</Button><Button variant="outline" size="sm" onClick={() => doExport("xlsx")} className="h-8 border-[#d6e0dd] bg-white text-xs"><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Excel</Button></div></div>
        {!!data.reports.length && <div className="flex gap-2 overflow-x-auto border-b border-[#e8eeeb] px-4 py-2.5">
          {visibleReports.map(r => <div key={r.id} className={`flex min-w-[220px] max-w-[300px] items-center rounded-lg border transition-colors ${r.id === data.activeReportId ? "border-[#9bc8bd] bg-[#edf6f2]" : "border-[#e0e8e5] bg-white hover:border-[#b8d3ca]"}`}>
            <button onClick={() => { void load({ silent: true, reportId: r.id, provider: data.provider ?? undefined }); }} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#24877b]" />
              <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold">{r.fileName}</span><span className="mt-0.5 block text-[10px] text-[#849596]">{new Intl.NumberFormat("it-IT").format(r.rowCount)} righe · {dateLabel(r.uploadedAt)}</span></span>
              {r.id === data.activeReportId && <Check className="h-4 w-4 shrink-0 text-[#168277]" />}
            </button>
            {canDeleteReports && <button
              type="button"
              aria-label={`Elimina report ${r.fileName}`}
              title="Elimina report"
              disabled={deletingReportId === r.id}
              onClick={() => void deleteReport(r)}
              className="mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#879796] transition-colors hover:bg-[#fbefeb] hover:text-[#a54d3b] disabled:opacity-50"
            ><Trash2 className="h-4 w-4" /></button>}
          </div>)}
          {!visibleReports.length && <p className="py-2 text-xs text-[#718587]">Nessun report caricato nel periodo selezionato.</p>}
        </div>}
        {error ? (
          <div className="m-4 flex items-start gap-3 rounded-lg border border-[#e8c9c0] bg-[#fbefeb] p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#b45c47]" />
            <div className="flex-1"><div className="text-sm font-semibold text-[#743e32]">Dati non disponibili</div><p className="mt-1 text-xs text-[#8c6359]">{error}</p></div>
            <Button variant="outline" size="sm" onClick={() => void load({ provider: data.provider ?? undefined, ...currentApiPeriod, page: currentApiPage })} className="border-[#ddbbb0] bg-transparent text-[#804d41]">Riprova</Button>
          </div>
        ) : loading ? (
          <div className="space-y-3 p-5"><div className="h-4 w-44 animate-pulse rounded bg-[#e6eeeb]" /><div className="h-10 animate-pulse rounded bg-[#edf2f0]" /><div className="h-10 animate-pulse rounded bg-[#edf2f0]" /><div className="h-10 animate-pulse rounded bg-[#edf2f0]" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[230px] flex-col items-center justify-center px-6 py-10 text-center">
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#eaf2ef] text-[#43887d]"><FileSpreadsheet className="h-5 w-5" /></div>
            <h3 className="text-sm font-semibold">{data.rows.length ? "Nessun risultato con questi filtri" : activeReport ? "Nessuna riconciliazione disponibile" : "Nessuna ricarica API disponibile"}</h3>
            <p className="mt-1.5 max-w-md text-xs text-[#778b8c]">{data.rows.length
              ? "Prova ad allargare il periodo o a rimuovere alcuni filtri."
              : activeReport
                ? `Carica un report ${providerLabel} per avviare il confronto con BiSuite.`
                : "Non risultano vendite con articoli RICARICHE salvate per questo tenant. Verifica la sincronizzazione BiSuite oppure carica un report provider."}</p>
            {data.rows.length > 0
              ? <Button variant="outline" size="sm" className="mt-4 border-[#cfddda]" onClick={reset}>Azzera filtri</Button>
              : <Button size="sm" className="mt-4 bg-[#11796f] hover:bg-[#0d655e]" disabled={!data.provider} onClick={() => inputRef.current?.click()}><CloudUpload className="mr-2 h-4 w-4" />Carica report</Button>}
          </div>
        ) : activeReport ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1210px] border-collapse text-left">
              <thead className="bg-[#f2f6f4]"><tr>{columns.map(c => <th key={c.key} className="whitespace-nowrap border-b border-[#dfe8e4] px-3 py-2.5 text-[9px] font-bold uppercase tracking-[.11em] text-[#718587]"><button onClick={() => sortBy(c.key)} className="inline-flex items-center gap-1 transition-colors hover:text-[#11796f]">{c.label}{sort.key === c.key ? sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowDown className="h-3 w-3 opacity-20" />}</button></th>)}</tr></thead>
              <tbody className="divide-y divide-[#edf1ef]">{filtered.map((r, i) => {
                const tone = r.status === "VERIFICATO" ? "ok" : r.status === "INCONGRUENZA IMPORTO" || r.status === "FUORI PERIODO" ? "warn" : "bad";
                return <tr key={r.id || `${r.date}-${r.transactionId}-${i}`} className={`group transition-colors ${r.status === "FUORI PERIODO" ? "bg-[#fffaf0] hover:bg-[#fff5df]" : "hover:bg-[#f2f8f5]"}`}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-[#314d4f]">{r.pdv || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[#52696b]">{dateLabel(r.date)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[#496164]">{r.saleId || "—"}</td>
                  <td className="max-w-[180px] truncate px-3 py-2.5 text-xs font-medium text-[#304a4c]" title={r.customer || ""}>{r.customer || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#52696b]">{r.supplier || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[#344e50]">{money(r.amount)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[#344e50]">{money(r.bisuiteAmount)}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs font-semibold tabular-nums ${Number(r.difference) === 0 ? "text-[#67827e]" : "text-[#b45d45]"}`}>{money(r.difference)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[#607577]">{r.phone || r.temporaryPhone || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold tracking-[.045em] ${tone === "ok" ? "bg-[#e2f2e9] text-[#23704f]" : tone === "warn" ? "bg-[#fbf0dc] text-[#9b6924]" : "bg-[#f8e8e3] text-[#a54d3b]"}`}><span className={`h-1.5 w-1.5 rounded-full ${tone === "ok" ? "bg-[#46966d]" : tone === "warn" ? "bg-[#ca9339]" : "bg-[#c66a53]"}`} />{r.status}</span></td>
                </tr>;
              })}</tbody>
            </table>
            <div className="flex items-center justify-between border-t border-[#e8eeeb] px-4 py-2.5 text-[10px] text-[#829394]"><span>{new Intl.NumberFormat("it-IT").format(filtered.length)} transazioni mostrate · provider: {money(totalAmount)} · BiSuite: {money(totalBisuiteAmount)}</span><span>Differenza = BiSuite − provider</span></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] border-collapse text-left">
              <thead className="bg-[#f2f6f4]"><tr>
                {([
                  { label: "PDV", key: "pdv" }, { label: "Data", key: "date" },
                  { label: "ID vendita", key: "saleId" }, { label: "Cliente", key: "customer" },
                  { label: "Fonte", key: "supplier" }, { label: "Categoria", key: "rechargeType" },
                  { label: "Importo ricarica", key: "bisuiteAmount" }, { label: "Telefono", key: "phone" },
                  { label: "Stato", key: "status" },
                ] as { label: string; key: keyof Row }[]).map(c => <th key={c.key} className="whitespace-nowrap border-b border-[#dfe8e4] px-3 py-2.5 text-[9px] font-bold uppercase tracking-[.11em] text-[#718587]">
                  <button onClick={() => sortBy(c.key)} className="inline-flex items-center gap-1 transition-colors hover:text-[#11796f]">{c.label}{sort.key === c.key ? sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowDown className="h-3 w-3 opacity-20" />}</button>
                </th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#edf1ef]">{filtered.map((r, i) => <tr key={r.id || `${r.date}-${r.saleId}-${i}`} className="group transition-colors hover:bg-[#f2f8f5]">
                <td className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-[#314d4f]">{r.pdv || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[#52696b]">{dateLabel(r.date)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[#496164]">{r.saleId || "—"}</td>
                <td className="max-w-[180px] truncate px-3 py-2.5 text-xs font-medium text-[#304a4c]" title={r.customer || ""}>{r.customer || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#52696b]">{r.supplier || "BiSuite API"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#52696b]">{r.rechargeType || "RICARICHE"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[#344e50]">{money(r.bisuiteAmount)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[#607577]">{r.phone || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#e4eefb] px-2 py-1 text-[9px] font-bold tracking-[.045em] text-[#315f91]"><span className="h-1.5 w-1.5 rounded-full bg-[#5d89bd]" />{r.status}</span></td>
              </tr>)}</tbody>
            </table>
            <div className="flex items-center justify-between border-t border-[#e8eeeb] px-4 py-2.5 text-[10px] text-[#829394]"><span>{new Intl.NumberFormat("it-IT").format(filtered.length)} ricariche mostrate in pagina · importo: {money(totalAmount)}</span><span>Importi e telefoni letti dagli articoli RICARICHE in BiSuite</span></div>
          </div>
        )}
        {!activeReport && data.apiPeriod && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8eeeb] px-4 py-3">
          <span className="text-[10px] text-[#829394]">
            Pagina {data.apiPage + 1} · periodo {dateLabel(data.apiPeriod.from)} – {dateLabel(data.apiPeriod.to)} · export limitato ai risultati filtrati di questa pagina
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={loading || data.apiPage === 0} onClick={() => void load({
              provider: data.provider ?? undefined,
              from: data.apiPeriod!.from,
              to: data.apiPeriod!.to,
              page: data.apiPage - 1,
            })}>Precedente</Button>
            <Button variant="outline" size="sm" disabled={loading || !data.apiHasMore} onClick={() => void load({
              provider: data.provider ?? undefined,
              from: data.apiPeriod!.from,
              to: data.apiPeriod!.to,
              page: data.apiPage + 1,
            })}>Successiva</Button>
          </div>
        </div>}
      </section>
      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#8a9a9b]"><span>Report salvati <strong className="font-semibold text-[#61797a]">{data.reports.length}</strong>{activeReport ? ` · periodo ${periodConfirmed ? "dichiarato" : "rilevato"} ${dateLabel(periodConfirmed ? activeReport.declaredPeriodFrom : activeReport.periodFrom)} – ${dateLabel(periodConfirmed ? activeReport.declaredPeriodTo : activeReport.periodTo)}` : ""}</span><span>Esportazione limitata ai risultati filtrati</span></footer>
    </main>
  </div>;
}
