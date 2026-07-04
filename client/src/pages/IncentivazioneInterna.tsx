import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { AppNavbar } from "@/components/AppNavbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  buildEmps, fmtV, normalizeConfig, parseValenzeAoa, defaultConfig, sortEmps,
  type IncentivazioneConfig, type Section, type Track, type LiveAddetto,
  type ValenzaRow, type CalendarInfo, type Employee, type Semaforo,
  type IncSortKey, type IncSortDir,
} from "@shared/incentivazione";
import {
  Upload, Settings, Unlock, Lock, Trash2, Plus, RefreshCw, AlertCircle, FileDown,
  ArrowDown, ArrowUp,
} from "lucide-react";
import { exportIncentivazionePdf, exportIncentivazioneExcel, exportIncentivazioneHtml } from "@/lib/incentivazioneExport";

interface DashboardResp {
  month: number;
  year: number;
  config: IncentivazioneConfig;
  calendar: CalendarInfo;
  valenze: Record<string, { fileName: string; uploadedAt: string | null; rows: ValenzaRow[] }>;
  live: LiveAddetto[];
  lastBisuiteSync: string | null;
}

const MONTHS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

function fmtSyncDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const SEM_COLOR: Record<Semaforo, string> = {
  g: "hsl(142 71% 45%)",
  a: "hsl(38 92% 50%)",
  r: "hsl(0 84% 60%)",
  u: "hsl(215 16% 70%)",
};

const STATUS_PILL: Record<Semaforo, { label: string; cls: string }> = {
  g: { label: "✓ Premio", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  a: { label: "⟳ In proiezione", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  r: { label: "✕ A rischio", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  u: { label: "—", cls: "bg-muted text-muted-foreground" },
};

export default function IncentivazioneInterna() {
  const now = new Date();
  const { profile } = useAuth();
  const { toast } = useToast();
  const isAdmin = ["super_admin", "admin"].includes(profile?.role || "");

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [activeSection, setActiveSection] = useState("ss_w3");
  const [statusFilter, setStatusFilter] = useState<"all" | Semaforo>("all");
  const [unlockOnly, setUnlockOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<IncSortKey>("status");
  const [sortDir, setSortDir] = useState<IncSortDir>("desc");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<DashboardResp>({
    queryKey: ["/api/incentivazione/dashboard", month, year],
  });

  const config: IncentivazioneConfig = useMemo(
    () => (data?.config ? normalizeConfig(data.config, year) : defaultConfig(year)),
    [data?.config, year],
  );
  const sections = config.sections;
  const section = sections.find((s) => s.id === activeSection) || sections[0];

  const calendar = data?.calendar;
  const sectionValenze = data?.valenze?.[section?.id ?? ""];
  const rows: ValenzaRow[] = sectionValenze?.rows ?? [];
  const live: LiveAddetto[] = data?.live ?? [];

  const emps: Employee[] = useMemo(() => {
    if (!section || !calendar || !section.ready) return [];
    return buildEmps(section.tracks, rows, live, calendar);
  }, [section, calendar, rows, live]);

  const counts = useMemo(() => {
    const g = emps.filter((e) => e.status === "g").length;
    const a = emps.filter((e) => e.status === "a").length;
    const r = emps.filter((e) => e.status === "r").length;
    const unlock = emps.filter((e) => e.unlockProjected).length;
    return { g, a, r, unlock };
  }, [emps]);

  // Se il criterio scelto è una pista assente nella sezione corrente (es. dopo
  // un cambio sezione) si ricade su "Stato" per non ordinare per chiave fantasma.
  const effectiveSortKey: IncSortKey = useMemo(() => {
    if (sortKey === "status") return "status";
    return section?.tracks.some((t) => !t.sub && t.id === sortKey) ? sortKey : "status";
  }, [sortKey, section]);

  const filteredEmps = useMemo(() => {
    const f = emps.filter((e) => {
      if (unlockOnly && !e.unlockProjected) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (search.trim() && !e.name.toLowerCase().includes(search.toLowerCase().trim())) return false;
      return true;
    });
    return sortEmps(f, effectiveSortKey, sortDir);
  }, [emps, statusFilter, unlockOnly, search, effectiveSortKey, sortDir]);

  // L'export rispetta l'ordinamento corrente ma resta sull'intero organico
  // (i conteggi di riepilogo si riferiscono a tutti gli addetti).
  const sortedAll = useMemo(
    () => sortEmps(emps, effectiveSortKey, sortDir),
    [emps, effectiveSortKey, sortDir],
  );

  // ── Upload valenze (admin) ──────────────────────────────────────────────
  const saveValenze = useMutation({
    mutationFn: async (payload: { sectionId: string; fileName: string; rows: ValenzaRow[] }) => {
      const res = await apiRequest("POST", "/api/incentivazione/valenze", {
        month, year, ...payload,
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: "Valenze caricate", description: `${r.count} addetti importati.` });
      queryClient.invalidateQueries({ queryKey: ["/api/incentivazione/dashboard", month, year] });
    },
    onError: (e: any) => toast({ title: "Errore", description: String(e.message || e), variant: "destructive" }),
  });

  const deleteValenze = useMutation({
    mutationFn: async (sectionId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/incentivazione/valenze?month=${month}&year=${year}&sectionId=${sectionId}`,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Valenze rimosse" });
      queryClient.invalidateQueries({ queryKey: ["/api/incentivazione/dashboard", month, year] });
    },
    onError: (e: any) => toast({ title: "Errore", description: String(e.message || e), variant: "destructive" }),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = uploadTarget;
    e.target.value = "";
    if (!file || !targetId) return;
    const targetSection = sections.find((s) => s.id === targetId);
    if (!targetSection) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      const parsed = parseValenzeAoa(aoa as unknown[][], targetSection.tracks);
      if (!parsed.length) {
        toast({ title: "Nessun dato", description: "Il file non contiene righe valide.", variant: "destructive" });
        return;
      }
      saveValenze.mutate({ sectionId: targetId, fileName: file.name, rows: parsed });
    } catch (ex: any) {
      toast({ title: "Errore parsing", description: String(ex.message || ex), variant: "destructive" });
    }
  };

  const triggerUpload = (sectionId: string) => {
    setUploadTarget(sectionId);
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Incentivazione interna" />
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={handleFile}
        data-testid="input-file-valenze"
      />

      <div className="container mx-auto px-3 sm:px-6 py-5 space-y-5">
        {/* Header / period selector */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Gare addetto</h2>
            <p className="text-sm text-muted-foreground">
              Valenze piste + Accessori/Servizi live da BiSuite · proiezione e sblocco gara
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
              <SelectTrigger className="w-[140px]" data-testid="select-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
              <SelectTrigger className="w-[100px]" data-testid="select-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            {isAdmin && section && (
              <ConfigEditor
                month={month}
                year={year}
                config={config}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ["/api/incentivazione/dashboard", month, year] })}
              />
            )}
          </div>
        </div>

        {isError && (
          <Card className="p-4 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4" /> Errore nel caricamento dei dati.
          </Card>
        )}

        {/* Section tabs */}
        <Tabs value={activeSection} onValueChange={setActiveSection}>
          <TabsList className="flex-wrap h-auto">
            {sections.map((s) => (
              <TabsTrigger key={s.id} value={s.id} data-testid={`tab-${s.id}`}>
                {s.op} · {s.label}
                {!s.ready && <span className="ml-1 text-[10px] opacity-60">(soon)</span>}
              </TabsTrigger>
            ))}
          </TabsList>

          {sections.map((s) => (
            <TabsContent key={s.id} value={s.id} className="space-y-4 mt-4">
              {!s.ready ? (
                <Card className="p-10 text-center">
                  <div className="text-3xl mb-2">📋</div>
                  <div className="font-semibold">Regolamento non ancora disponibile</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Il piano variabile {s.label} {s.op} sarà configurato appena ricevuto il documento ufficiale.
                  </p>
                </Card>
              ) : isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
                </div>
              ) : (
                <SectionView
                  section={s}
                  calendar={calendar}
                  emps={filteredEmps}
                  exportEmps={sortedAll}
                  counts={counts}
                  totalEmps={emps.length}
                  liveCount={live.length}
                  lastBisuiteSync={data?.lastBisuiteSync ?? null}
                  valenzeInfo={data?.valenze?.[s.id]}
                  isAdmin={isAdmin}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
                  unlockOnly={unlockOnly}
                  setUnlockOnly={setUnlockOnly}
                  search={search}
                  setSearch={setSearch}
                  sortKey={sortKey}
                  setSortKey={setSortKey}
                  sortDir={sortDir}
                  setSortDir={setSortDir}
                  onUpload={() => triggerUpload(s.id)}
                  onDeleteValenze={() => deleteValenze.mutate(s.id)}
                  uploading={saveValenze.isPending}
                  month={month}
                  year={year}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

// ── Section view ────────────────────────────────────────────────────────────
function SectionView(props: {
  section: Section;
  calendar?: CalendarInfo;
  emps: Employee[];
  exportEmps: Employee[];
  counts: { g: number; a: number; r: number; unlock: number };
  totalEmps: number;
  liveCount: number;
  lastBisuiteSync: string | null;
  valenzeInfo?: { fileName: string; uploadedAt: string | null; rows: ValenzaRow[] };
  isAdmin: boolean;
  statusFilter: "all" | Semaforo;
  setStatusFilter: (s: "all" | Semaforo) => void;
  unlockOnly: boolean;
  setUnlockOnly: (b: boolean) => void;
  search: string;
  setSearch: (s: string) => void;
  sortKey: IncSortKey;
  setSortKey: (k: IncSortKey) => void;
  sortDir: IncSortDir;
  setSortDir: (d: IncSortDir) => void;
  onUpload: () => void;
  onDeleteValenze: () => void;
  uploading: boolean;
  month: number;
  year: number;
}) {
  const {
    section, calendar, emps, exportEmps, counts, totalEmps, liveCount, lastBisuiteSync, valenzeInfo, isAdmin,
    statusFilter, setStatusFilter, unlockOnly, setUnlockOnly, search, setSearch,
    sortKey, setSortKey, sortDir, setSortDir,
    onUpload, onDeleteValenze, uploading, month, year,
  } = props;
  const sortTracks = section.tracks.filter((t) => !t.sub);
  const sortDefault = sortKey === "status" && sortDir === "desc";
  const { toast } = useToast();
  const [pdfPending, setPdfPending] = useState(false);

  const handleExportPdf = async () => {
    setPdfPending(true);
    try {
      await exportIncentivazionePdf({ section, emps: exportEmps, calendar, counts, totalEmps, month, year });
    } catch (e: any) {
      toast({ title: "Errore export PDF", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setPdfPending(false);
    }
  };

  const handleExportExcel = () => {
    try {
      exportIncentivazioneExcel({ section, emps: exportEmps, calendar, counts, totalEmps, month, year });
    } catch (e: any) {
      toast({ title: "Errore export Excel", description: String(e?.message || e), variant: "destructive" });
    }
  };

  const handleExportHtml = () => {
    try {
      exportIncentivazioneHtml({ section, emps: exportEmps, calendar, counts, totalEmps, month, year });
    } catch (e: any) {
      toast({ title: "Errore export HTML", description: String(e?.message || e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Calendar bar */}
      {calendar && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <CalItem v={calendar.el} l="Gg. trascorsi" />
            <CalItem v={calendar.rem} l="Gg. rimanenti" />
            <CalItem v={calendar.tot} l="Gg. totali" />
            <CalItem v={`×${calendar.mult ? calendar.mult.toFixed(2) : "—"}`} l="Proiezione" />
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs text-muted-foreground mb-1">
                Avanzamento {calendar.pct}% · giorni lavorativi
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${calendar.pct}%` }} />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Controls: upload + live status */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Valenze piste (Excel)</div>
              {valenzeInfo ? (
                <div className="text-xs text-muted-foreground truncate" data-testid={`text-valenze-${section.id}`}>
                  ✓ {valenzeInfo.fileName} · {valenzeInfo.rows.length} addetti
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Nessun file caricato per il periodo.</div>
              )}
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2 shrink-0">
                {valenzeInfo && (
                  <Button variant="ghost" size="icon" onClick={onDeleteValenze} data-testid={`button-delete-valenze-${section.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button size="sm" onClick={onUpload} disabled={uploading} data-testid={`button-upload-${section.id}`}>
                  <Upload className="h-4 w-4 mr-1" /> {uploading ? "Carico…" : "Carica"}
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm font-semibold">Accessori e Servizi · live da BiSuite</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Aggregati dalle vendite del periodo per addetto. {liveCount} addetti con movimenti.
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1" data-testid="text-bisuite-last-sync">
            <RefreshCw className="h-3 w-3 shrink-0" />
            {lastBisuiteSync
              ? `Ultima sincronizzazione: ${fmtSyncDate(lastBisuiteSync)}`
              : "Nessuna sincronizzazione vendite ancora effettuata."}
          </div>
        </Card>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SummaryCard label="Addetti" value={totalEmps} sub={`Base ${section.base ?? "—"}€`} />
        <SummaryCard label="🟢 Premio" value={counts.g} sub="acquisito" active={statusFilter === "g"} onClick={() => setStatusFilter(statusFilter === "g" ? "all" : "g")} />
        <SummaryCard label="🟡 In proiezione" value={counts.a} sub="raggiungibile" active={statusFilter === "a"} onClick={() => setStatusFilter(statusFilter === "a" ? "all" : "a")} />
        <SummaryCard label="🔴 A rischio" value={counts.r} sub="pista critica" active={statusFilter === "r"} onClick={() => setStatusFilter(statusFilter === "r" ? "all" : "r")} />
        <SummaryCard
          label="🔓 Sblocco gara"
          value={counts.unlock}
          sub="proiettano sblocco"
          active={unlockOnly}
          onClick={() => setUnlockOnly(!unlockOnly)}
          accent
        />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Cerca addetto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="input-search-addetto"
        />
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground hidden sm:inline">Ordina per</span>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as IncSortKey)}>
            <SelectTrigger className="h-9 w-[180px]" data-testid="select-sort-key">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="status" data-testid="option-sort-status">Stato</SelectItem>
              {sortTracks.map((t) => (
                <SelectItem key={t.id} value={t.id} data-testid={`option-sort-${t.id}`}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}
            title={sortDir === "desc" ? "Decrescente" : "Crescente"}
            data-testid="button-sort-dir"
          >
            {sortDir === "desc" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
        {(statusFilter !== "all" || unlockOnly || search || !sortDefault) && (
          <Button variant="ghost" size="sm" data-testid="button-reset-filters" onClick={() => { setStatusFilter("all"); setUnlockOnly(false); setSearch(""); setSortKey("status"); setSortDir("desc"); }}>
            Azzera filtri
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={exportEmps.length === 0 || pdfPending}
          onClick={handleExportPdf}
          data-testid="button-export-pdf"
        >
          <FileDown className="h-4 w-4 mr-1" /> {pdfPending ? "Genero…" : "Esporta PDF"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={exportEmps.length === 0}
          onClick={handleExportExcel}
          data-testid="button-export-excel"
        >
          <FileDown className="h-4 w-4 mr-1" /> Esporta Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={exportEmps.length === 0}
          onClick={handleExportHtml}
          data-testid="button-export-html"
        >
          <FileDown className="h-4 w-4 mr-1" /> Esporta HTML
        </Button>
      </div>

      {/* Employee grid */}
      {emps.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {totalEmps === 0
            ? "Nessun dato. Carica il template valenze per visualizzare gli addetti."
            : "Nessun addetto corrisponde ai filtri."}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {emps.map((e) => <EmployeeCard key={e.name} emp={e} tracks={section.tracks} />)}
        </div>
      )}
    </div>
  );
}

function CalItem({ v, l }: { v: number | string; l: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold tabular-nums">{v}</div>
      <div className="text-[11px] text-muted-foreground">{l}</div>
    </div>
  );
}

function SummaryCard(props: { label: string; value: number; sub?: string; active?: boolean; onClick?: () => void; accent?: boolean }) {
  const { label, value, sub, active, onClick, accent } = props;
  return (
    <Card
      className={`p-3 ${onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""} ${active ? "ring-2 ring-primary" : ""}`}
      onClick={onClick}
      data-testid={`card-summary-${label.replace(/[^a-zA-Z]/g, "").toLowerCase()}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function EmployeeCard({ emp, tracks }: { emp: Employee; tracks: Track[] }) {
  const pill = STATUS_PILL[emp.status];
  return (
    <Card className="p-4 space-y-3" data-testid={`card-addetto-${emp.name}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold truncate">{emp.name}</div>
        <Badge className={pill.cls} variant="secondary">{pill.label}</Badge>
      </div>

      {emp.locks.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
            <Lock className="h-3 w-3" /> Lucchetti bloccanti ({emp.locks.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {emp.locks.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: `${SEM_COLOR[l.sem]}22`, color: SEM_COLOR[l.sem] }}
              >
                {l.sem === "g" ? <Unlock className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                {l.name.replace(/ \(S[0-9]+\).*/, "").replace(/ [—–].*/, "")}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {tracks.filter((t) => !t.sub).map((t) => {
          const td = emp.tds[t.id];
          if (!td) return null;
          const { actual: v, proj: p, sem: s } = td;
          if (v === null) {
            return (
              <div key={t.id} className="text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: SEM_COLOR.u }} />
                    {t.name}
                  </span>
                  <span className="text-muted-foreground">—</span>
                </div>
              </div>
            );
          }
          const pct = Math.min(100, Math.round((v / td.target) * 100));
          return (
            <div key={t.id} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 min-w-0">
                  <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: SEM_COLOR[s] }} />
                  <span className="truncate">{t.name}{t.live && <span className="ml-1 text-[9px] text-orange-500">●live</span>}</span>
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {fmtV(v, t.unit)} → <span style={{ color: SEM_COLOR[s] }}>{fmtV(p, t.unit)}</span> / {fmtV(td.target, t.unit)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                <div className="h-full" style={{ width: `${pct}%`, background: SEM_COLOR[s] }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Admin config editor ─────────────────────────────────────────────────────
function ConfigEditor(props: {
  month: number;
  year: number;
  config: IncentivazioneConfig;
  onSaved: () => void;
}) {
  const { month, year, config, onSaved } = props;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IncentivazioneConfig>(config);
  const [editSection, setEditSection] = useState(config.sections[0]?.id ?? "ss_w3");

  const reset = () => { setDraft(JSON.parse(JSON.stringify(config))); setEditSection(config.sections[0]?.id ?? "ss_w3"); };

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/incentivazione/config", { month, year, config: draft });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Configurazione salvata" });
      setOpen(false);
      onSaved();
    },
    onError: (e: any) => toast({ title: "Errore", description: String(e.message || e), variant: "destructive" }),
  });

  const updateSection = (id: string, patch: Partial<Section>) => {
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => s.id === id ? { ...s, ...patch } : s) }));
  };
  const updateTrack = (sid: string, tid: string, patch: Partial<Track>) => {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => s.id === sid
        ? { ...s, tracks: s.tracks.map((t) => t.id === tid ? { ...t, ...patch } : t) }
        : s),
    }));
  };
  const addTrack = (sid: string) => {
    const newTrack: Track = { id: `track_${Date.now()}`, name: "Nuova pista", target: 1, unit: "pz", isLock: false };
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => s.id === sid ? { ...s, tracks: [...s.tracks, newTrack] } : s) }));
  };
  const removeTrack = (sid: string, tid: string) => {
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => s.id === sid ? { ...s, tracks: s.tracks.filter((t) => t.id !== tid) } : s) }));
  };

  const sec = draft.sections.find((s) => s.id === editSection) || draft.sections[0];

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-config"><Settings className="h-4 w-4 mr-1" /> Configura</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurazione gara · {MONTHS[month - 1]} {year}</DialogTitle>
        </DialogHeader>

        {/* Global cats */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Categorie Accessori (id, separati da virgola)</Label>
            <Input
              value={draft.catAcc.join(",")}
              onChange={(e) => setDraft((d) => ({ ...d, catAcc: parseIds(e.target.value) }))}
              data-testid="input-cat-acc"
            />
          </div>
          <div>
            <Label className="text-xs">Categorie Servizi (id, separati da virgola)</Label>
            <Input
              value={draft.catServ.join(",")}
              onChange={(e) => setDraft((d) => ({ ...d, catServ: parseIds(e.target.value) }))}
              data-testid="input-cat-serv"
            />
          </div>
        </div>

        {/* Section selector */}
        <div className="flex flex-wrap gap-1">
          {draft.sections.map((s) => (
            <Button key={s.id} variant={editSection === s.id ? "secondary" : "ghost"} size="sm" onClick={() => setEditSection(s.id)}>
              {s.op} · {s.label}
            </Button>
          ))}
        </div>

        {sec && (
          <div className="space-y-3 border rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Attiva (ready)</Label>
                <Switch checked={sec.ready} onCheckedChange={(v) => updateSection(sec.id, { ready: v })} data-testid={`switch-ready-${sec.id}`} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Base €</Label>
                <Input
                  type="number"
                  className="w-24 h-8"
                  value={sec.base ?? ""}
                  onChange={(e) => updateSection(sec.id, { base: e.target.value === "" ? null : Number(e.target.value) })}
                  data-testid={`input-base-${sec.id}`}
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => addTrack(sec.id)}><Plus className="h-4 w-4 mr-1" /> Pista</Button>
            </div>

            <div className="space-y-2">
              {sec.tracks.map((t) => (
                <div key={t.id} className="grid grid-cols-12 gap-2 items-center text-xs">
                  <Input className="col-span-4 h-8" value={t.name} onChange={(e) => updateTrack(sec.id, t.id, { name: e.target.value })} placeholder="Nome" />
                  <Input className="col-span-2 h-8" type="number" value={t.target} onChange={(e) => updateTrack(sec.id, t.id, { target: Number(e.target.value) })} placeholder="Target" />
                  <Input className="col-span-1 h-8" value={t.unit} onChange={(e) => updateTrack(sec.id, t.id, { unit: e.target.value })} placeholder="u." />
                  <Input className="col-span-1 h-8" value={t.excelCol ?? ""} onChange={(e) => updateTrack(sec.id, t.id, { excelCol: e.target.value.toUpperCase() || undefined })} placeholder="Col" disabled={t.live} />
                  <label className="col-span-1 flex items-center gap-1" title="Lucchetto bloccante">
                    <Switch checked={t.isLock} onCheckedChange={(v) => updateTrack(sec.id, t.id, { isLock: v })} /> 🔒
                  </label>
                  <label className="col-span-1 flex items-center gap-1" title="Sotto-pista (non conta nello stato)">
                    <Switch checked={!!t.sub} onCheckedChange={(v) => updateTrack(sec.id, t.id, { sub: v })} /> sub
                  </label>
                  <label className="col-span-1 flex items-center gap-1" title="Dato live da BiSuite">
                    <Switch checked={!!t.live} onCheckedChange={(v) => updateTrack(sec.id, t.id, { live: v })} /> live
                  </label>
                  <Button variant="ghost" size="icon" className="col-span-1 h-8 w-8" onClick={() => removeTrack(sec.id, t.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {sec.tracks.length === 0 && <div className="text-xs text-muted-foreground">Nessuna pista. Aggiungine una.</div>}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annulla</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-config">
            {save.isPending ? "Salvo…" : "Salva configurazione"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseIds(s: string): number[] {
  return s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
}
