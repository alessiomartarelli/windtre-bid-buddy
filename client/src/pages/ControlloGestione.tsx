import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import * as XLSX from "xlsx";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/basePath";
import { AppNavbar } from "@/components/AppNavbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Wallet, Plus, Pencil, Trash2, Loader2, Building2, Tag, Truck, Store, Download,
  TrendingUp, FileText, Paperclip,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import type {
  CdgRagioneSociale, CdgCategoria, CdgFornitore, CdgPdv, CdgSpesa,
} from "@shared/schema";

const fmtEur = (v: number) =>
  v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

const fmtDateIt = (s: string | null | undefined) => {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

const monthLabel = (yyyymm: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return yyyymm;
  const months = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
  return `${months[+m[2] - 1]} ${m[1]}`;
};

const currentMonthYYYYMM = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const last12Months = (): string[] => {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
};

const METODI_PAGAMENTO = [
  "Bonifico", "Contanti", "POS", "Assegno", "Carta credito", "RID/SDD", "Altro",
];

const parseImporto = (s: CdgSpesa["importo"]): number => parseFloat(s as unknown as string) || 0;

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Errore lettura file"));
    fr.onload = () => {
      const s = String(fr.result || "");
      const idx = s.indexOf(",");
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    fr.readAsDataURL(file);
  });
}

async function apiJson<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(url), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data?.error || `Errore ${res.status}`);
  return data as T;
}

type TabKey = "dashboard" | "spese" | "anagrafiche";

type UnifiedRagioneSociale = {
  nome: string;
  origine: "pdv" | "manuale";
  id?: string;
  partitaIva?: string | null;
  note?: string | null;
};

export default function ControlloGestione({ embedded = false }: { embedded?: boolean } = {}) {
  const { profile, loading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isAuthorized = !!profile && ["admin", "super_admin"].includes(profile.role);
  const orgId = profile?.organizationId || "";

  const [tab, setTab] = useState<TabKey>("dashboard");
  const [filterRs, setFilterRs] = useState<string>("all");
  const [filterCompetenza, setFilterCompetenza] = useState<string>("");
  const [filterMesePagamento, setFilterMesePagamento] = useState<string>("");
  const [filterCategoria, setFilterCategoria] = useState<string>("all");
  const [filterFornitore, setFilterFornitore] = useState<string>("all");
  const [filterPdv, setFilterPdv] = useState<string>("all");
  const [filterImportoMin, setFilterImportoMin] = useState<string>("");
  const [filterImportoMax, setFilterImportoMax] = useState<string>("");
  const [dashboardMese, setDashboardMese] = useState<string>(currentMonthYYYYMM());

  useEffect(() => {
    if (!loading && profile && !isAuthorized) {
      toast({ title: "Accesso non autorizzato", variant: "destructive" });
      setLocation("/");
    }
  }, [loading, profile, isAuthorized, toast, setLocation]);

  const ragioniSocialiQ = useQuery<UnifiedRagioneSociale[]>({
    queryKey: ["/api/cdg/ragioni-sociali/unified"],
    enabled: !!orgId && isAuthorized,
  });
  const ragioniSociali = ragioniSocialiQ.data || [];

  const categorieQ = useQuery<CdgCategoria[]>({
    queryKey: ["/api/cdg/categorie"],
    enabled: !!orgId && isAuthorized,
  });
  const categorie = categorieQ.data || [];

  const fornitoriQ = useQuery<CdgFornitore[]>({
    queryKey: ["/api/cdg/fornitori"],
    enabled: !!orgId && isAuthorized,
  });
  const fornitori = fornitoriQ.data || [];

  const pdvQ = useQuery<CdgPdv[]>({
    queryKey: ["/api/cdg/pdv"],
    enabled: !!orgId && isAuthorized,
  });
  const pdvList = pdvQ.data || [];

  const speseQ = useQuery<CdgSpesa[]>({
    queryKey: ["/api/cdg/spese", filterRs, filterCompetenza],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (filterRs !== "all") p.set("rs", filterRs);
      if (filterCompetenza) p.set("competenza", filterCompetenza);
      return apiJson<CdgSpesa[]>("GET", `/api/cdg/spese?${p}`);
    },
    enabled: !!orgId && isAuthorized,
  });
  const speseAll = speseQ.data || [];

  // Filtri client-side aggiuntivi
  const spese = useMemo(() => {
    const min = filterImportoMin.trim() ? parseFloat(filterImportoMin.replace(",", ".")) : null;
    const max = filterImportoMax.trim() ? parseFloat(filterImportoMax.replace(",", ".")) : null;
    return speseAll.filter(s => {
      if (filterCategoria !== "all" && s.categoriaId !== filterCategoria) return false;
      if (filterFornitore !== "all" && s.fornitoreId !== filterFornitore) return false;
      if (filterPdv !== "all" && s.pdvId !== filterPdv) return false;
      if (filterMesePagamento) {
        const mp = (s.dataPagamento || "").slice(0, 7);
        if (mp !== filterMesePagamento) return false;
      }
      const imp = parseImporto(s.importo);
      if (min !== null && isFinite(min) && imp < min) return false;
      if (max !== null && isFinite(max) && imp > max) return false;
      return true;
    });
  }, [speseAll, filterCategoria, filterFornitore, filterPdv, filterMesePagamento, filterImportoMin, filterImportoMax]);

  const catById = useMemo(() => new Map(categorie.map(c => [c.id, c])), [categorie]);
  const fornById = useMemo(() => new Map(fornitori.map(f => [f.id, f])), [fornitori]);
  const pdvById = useMemo(() => new Map(pdvList.map(p => [p.id, p])), [pdvList]);

  // === Dashboard data ===
  // I KPI di mese e il grafico per categoria sono scoped sul mese selezionato
  // (`dashboardMese`); la serie mensile usa gli ultimi 12 mesi; il riepilogo
  // categoria × RS aggrega tutte le spese filtrate.
  const dashboard = useMemo(() => {
    let totaleCassaMese = 0;
    let totaleCompetenzaMese = 0;
    let conteggioMese = 0;
    const months = last12Months();
    const monthSet = new Set(months);
    const byMese = new Map<string, { competenza: number; cassa: number }>();
    months.forEach(m => byMese.set(m, { competenza: 0, cassa: 0 }));

    type CatRsAgg = { categoria: string; rs: string; importo: number; conteggio: number };
    const catRsMap = new Map<string, CatRsAgg>();
    // Categoria del mese selezionato (per il grafico per categoria) — usa la
    // competenza per coerenza con il KPI "Top categoria" e con il significato
    // contabile della dashboard.
    const catTotMese = new Map<string, number>();

    for (const s of spese) {
      const imp = parseImporto(s.importo);
      const mPag = (s.dataPagamento || "").slice(0, 7);
      const mComp = s.meseCompetenza || mPag;
      const inMese = mPag === dashboardMese || mComp === dashboardMese;
      if (mPag === dashboardMese) totaleCassaMese += imp;
      if (mComp === dashboardMese) totaleCompetenzaMese += imp;
      if (inMese) conteggioMese += 1;
      if (monthSet.has(mPag)) byMese.get(mPag)!.cassa += imp;
      if (monthSet.has(mComp)) byMese.get(mComp)!.competenza += imp;

      const catNome = (s.categoriaId && catById.get(s.categoriaId)?.nome) || "— Senza categoria —";

      // Riepilogo cat × RS: tutte le spese filtrate
      const key = `${s.ragioneSociale}|${catNome}`;
      const cur = catRsMap.get(key) || { categoria: catNome, rs: s.ragioneSociale, importo: 0, conteggio: 0 };
      cur.importo += imp; cur.conteggio += 1;
      catRsMap.set(key, cur);

      // Grafico per categoria: solo competenza del mese selezionato
      if (mComp === dashboardMese) {
        catTotMese.set(catNome, (catTotMese.get(catNome) || 0) + imp);
      }
    }

    const categoryBar = Array.from(catTotMese.entries())
      .map(([categoria, importo]) => ({ categoria, importo }))
      .sort((a, b) => b.importo - a.importo);

    const meseSerie = months.map(m => {
      const v = byMese.get(m)!;
      return { mese: monthLabel(m), meseRaw: m, ...v };
    });

    const topCategoria = categoryBar[0];
    const summaryRows = Array.from(catRsMap.values()).sort((a, b) => b.importo - a.importo);

    return {
      totaleCassaMese, totaleCompetenzaMese, conteggioMese,
      // Delta = cassa − competenza (positivo = pagato in anticipo,
      // negativo = costi competenza non ancora pagati).
      delta: totaleCassaMese - totaleCompetenzaMese,
      topCategoria,
      categoryBar,
      meseSerie,
      summaryRows,
    };
  }, [spese, dashboardMese, catById]);

  const deleteSpesaMut = useMutation({
    mutationFn: (id: string) => apiJson("DELETE", `/api/cdg/spese/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      toast({ title: "Spesa eliminata" });
    },
    onError: (e: Error) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  const [spesaDialog, setSpesaDialog] = useState<{ open: boolean; editing?: CdgSpesa }>({ open: false });

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    const rows = spese.map(s => {
      const totale = parseImporto(s.importo);
      const imponibile = s.imponibile != null ? parseFloat(s.imponibile as unknown as string) : totale;
      const aliquota = s.aliquotaIva != null ? parseFloat(s.aliquotaIva as unknown as string) : 0;
      const iva = s.iva != null ? parseFloat(s.iva as unknown as string) : 0;
      return {
        "Data Pagamento": fmtDateIt(s.dataPagamento),
        "Mese Competenza": s.meseCompetenza,
        "Ragione Sociale": s.ragioneSociale,
        "Categoria": (s.categoriaId && catById.get(s.categoriaId)?.nome) || "",
        "Fornitore": (s.fornitoreId && fornById.get(s.fornitoreId)?.nome) || "",
        "PDV": (s.pdvId && pdvById.get(s.pdvId)?.nome) || "",
        "Descrizione": s.descrizione,
        "Metodo Pagamento": s.metodoPagamento || "",
        "Imponibile": imponibile,
        "Aliquota IVA (%)": aliquota,
        "IVA": iva,
        "Totale": totale,
        "Importo": totale,
        "Note": s.note || "",
        "Allegato": s.allegatoNome || "",
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Spese");

    const summary = dashboard.summaryRows.map(r => ({
      "Categoria": r.categoria,
      "Ragione Sociale": r.rs,
      "Numero spese": r.conteggio,
      "Totale": r.importo,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Riepilogo");

    const monthly = dashboard.meseSerie.map(m => ({
      "Mese": m.mese, "Cassa": m.cassa, "Competenza": m.competenza,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthly), "Andamento mensile");

    XLSX.writeFile(wb, `controllo_gestione_${filterCompetenza || filterMesePagamento || "tutto"}.xlsx`);
  };

  if (loading || !isAuthorized) {
    return (
      <div className={embedded ? "flex items-center justify-center py-12" : "min-h-screen flex items-center justify-center"}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const inner = (
    <>
        {!embedded && (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-sm">
                <Wallet className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Controllo di Gestione</h1>
                <p className="text-sm text-muted-foreground">Spese mensili (cassa + competenza), anagrafiche per Ragione Sociale</p>
              </div>
            </div>
          </div>
        )}

        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <div>
                <Label className="text-xs">Ragione Sociale</Label>
                <Select value={filterRs} onValueChange={setFilterRs}>
                  <SelectTrigger data-testid="select-filter-rs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutte</SelectItem>
                    {ragioniSociali.map(rs => <SelectItem key={`${rs.origine}-${rs.nome}`} value={rs.nome}>{rs.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Competenza</Label>
                <Input type="month" value={filterCompetenza} onChange={(e) => setFilterCompetenza(e.target.value)} data-testid="input-filter-competenza" />
              </div>
              <div>
                <Label className="text-xs">Mese pagamento</Label>
                <Input type="month" value={filterMesePagamento} onChange={(e) => setFilterMesePagamento(e.target.value)} data-testid="input-filter-pagamento" />
              </div>
              <div>
                <Label className="text-xs">Categoria</Label>
                <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                  <SelectTrigger data-testid="select-filter-categoria"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutte</SelectItem>
                    {categorie.filter(c => filterRs === "all" || c.ragioneSociale === filterRs).map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Fornitore</Label>
                <Select value={filterFornitore} onValueChange={setFilterFornitore}>
                  <SelectTrigger data-testid="select-filter-fornitore"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutti</SelectItem>
                    {fornitori.filter(f => filterRs === "all" || f.ragioneSociale === filterRs).map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">PDV</Label>
                <Select value={filterPdv} onValueChange={setFilterPdv}>
                  <SelectTrigger data-testid="select-filter-pdv"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutti</SelectItem>
                    {pdvList.filter(p => filterRs === "all" || p.ragioneSociale === filterRs).map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Importo (min - max)</Label>
                <div className="flex gap-1">
                  <Input type="text" inputMode="decimal" value={filterImportoMin} onChange={(e) => setFilterImportoMin(e.target.value)} placeholder="min" data-testid="input-filter-min" />
                  <Input type="text" inputMode="decimal" value={filterImportoMax} onChange={(e) => setFilterImportoMax(e.target.value)} placeholder="max" data-testid="input-filter-max" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => {
                setFilterRs("all"); setFilterCompetenza(""); setFilterMesePagamento("");
                setFilterCategoria("all"); setFilterFornitore("all"); setFilterPdv("all");
                setFilterImportoMin(""); setFilterImportoMax("");
              }} data-testid="button-reset-filters">Reset</Button>
              <Button variant="outline" size="sm" onClick={exportXlsx} data-testid="button-export-xlsx">
                <Download className="h-4 w-4 mr-1" /> Excel
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="dashboard" data-testid="tab-dashboard"><TrendingUp className="h-4 w-4 mr-1" />Dashboard</TabsTrigger>
            <TabsTrigger value="spese" data-testid="tab-spese"><FileText className="h-4 w-4 mr-1" />Spese</TabsTrigger>
            <TabsTrigger value="anagrafiche" data-testid="tab-anagrafiche"><Building2 className="h-4 w-4 mr-1" />Anagrafiche</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-4">
            <div className="flex items-end gap-3">
              <div>
                <Label className="text-xs">Mese di riferimento (KPI)</Label>
                <Input type="month" value={dashboardMese} onChange={(e) => setDashboardMese(e.target.value)} className="w-[180px]" data-testid="input-dashboard-mese" />
              </div>
              <p className="text-xs text-muted-foreground pb-2">I KPI sono calcolati sul mese selezionato (sui dati attualmente filtrati).</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Totale cassa ({monthLabel(dashboardMese)})</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold" data-testid="kpi-cassa">{fmtEur(dashboard.totaleCassaMese)}</div><p className="text-xs text-muted-foreground mt-1">Pagato nel mese</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Totale competenza ({monthLabel(dashboardMese)})</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold" data-testid="kpi-competenza">{fmtEur(dashboard.totaleCompetenzaMese)}</div><p className="text-xs text-muted-foreground mt-1">Costo di competenza</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Delta cassa − competenza</CardTitle></CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${dashboard.delta >= 0 ? "text-green-600" : "text-orange-600"}`} data-testid="kpi-delta">
                    {dashboard.delta >= 0 ? "+" : ""}{fmtEur(dashboard.delta)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{dashboard.delta >= 0 ? "Pagato in anticipo" : "Costi non ancora pagati"}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">N. voci ({monthLabel(dashboardMese)})</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="kpi-conteggio">{dashboard.conteggioMese}</div>
                  <p className="text-xs text-muted-foreground mt-1">Spese pagate o di competenza nel mese</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Top categoria ({monthLabel(dashboardMese)})</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.topCategoria ? (
                    <>
                      <div className="text-lg font-bold truncate" data-testid="kpi-top-categoria">{dashboard.topCategoria.categoria}</div>
                      <p className="text-xs text-muted-foreground mt-1">{fmtEur(dashboard.topCategoria.importo)}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Spese per categoria — competenza {monthLabel(dashboardMese)}</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.categoryBar.length === 0 ? (
                    <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">Nessuna spesa nel mese</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={dashboard.categoryBar} layout="vertical" margin={{ left: 24 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(v) => `€ ${(v / 1000).toFixed(0)}k`} />
                        <YAxis type="category" dataKey="categoria" width={140} />
                        <Tooltip formatter={(v: number) => fmtEur(v)} />
                        <Bar dataKey="importo" fill="#f97316" name="Importo" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Cassa vs Competenza (ultimi 12 mesi)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dashboard.meseSerie}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="mese" />
                      <YAxis tickFormatter={(v) => `€ ${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => fmtEur(v)} />
                      <Legend />
                      <Bar dataKey="cassa" fill="#3b82f6" name="Pagato (cassa)" />
                      <Bar dataKey="competenza" fill="#f97316" name="Competenza" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Riepilogo per categoria × Ragione Sociale</CardTitle></CardHeader>
              <CardContent>
                {dashboard.summaryRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">Nessun dato.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Ragione Sociale</TableHead>
                        <TableHead className="text-right">Numero spese</TableHead>
                        <TableHead className="text-right">Totale</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboard.summaryRows.map((r, i) => (
                        <TableRow key={i} data-testid={`row-summary-${i}`}>
                          <TableCell className="font-medium">{r.categoria}</TableCell>
                          <TableCell className="text-xs">{r.rs}</TableCell>
                          <TableCell className="text-right">{r.conteggio}</TableCell>
                          <TableCell className="text-right font-mono">{fmtEur(r.importo)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="spese" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Elenco spese ({spese.length})</CardTitle>
                <Button onClick={() => setSpesaDialog({ open: true })} data-testid="button-new-spesa">
                  <Plus className="h-4 w-4 mr-1" /> Nuova spesa
                </Button>
              </CardHeader>
              <CardContent>
                {speseQ.isLoading ? (
                  <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : spese.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    {ragioniSociali.length === 0 ? "Crea prima una Ragione Sociale nella tab Anagrafiche." : "Nessuna spesa per i filtri attivi."}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data pag.</TableHead>
                        <TableHead>Comp.</TableHead>
                        <TableHead>RS</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Fornitore</TableHead>
                        <TableHead>PDV</TableHead>
                        <TableHead>Descrizione</TableHead>
                        <TableHead>Metodo</TableHead>
                        <TableHead className="text-right">Importo</TableHead>
                        <TableHead></TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {spese.map(s => {
                        const cat = s.categoriaId ? catById.get(s.categoriaId) : null;
                        const forn = s.fornitoreId ? fornById.get(s.fornitoreId) : null;
                        const pdv = s.pdvId ? pdvById.get(s.pdvId) : null;
                        return (
                          <TableRow key={s.id} data-testid={`row-spesa-${s.id}`}>
                            <TableCell>{fmtDateIt(s.dataPagamento)}</TableCell>
                            <TableCell><Badge variant="outline">{monthLabel(s.meseCompetenza)}</Badge></TableCell>
                            <TableCell className="text-xs">{s.ragioneSociale}</TableCell>
                            <TableCell>{cat?.nome || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell>{forn?.nome || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell>{pdv?.nome || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="max-w-[200px] truncate" title={s.descrizione}>{s.descrizione}</TableCell>
                            <TableCell className="text-xs">{s.metodoPagamento || ""}</TableCell>
                            <TableCell className="text-right font-mono">{fmtEur(parseImporto(s.importo))}</TableCell>
                            <TableCell>
                              {s.allegatoPath && (
                                <a href={apiUrl(`/api/cdg/spese/${s.id}/allegato`)} target="_blank" rel="noreferrer" title={s.allegatoNome || "Allegato"} data-testid={`link-allegato-${s.id}`}>
                                  <Paperclip className="h-4 w-4 text-blue-600" />
                                </a>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={() => setSpesaDialog({ open: true, editing: s })} data-testid={`button-edit-spesa-${s.id}`}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button size="icon" variant="ghost" data-testid={`button-delete-spesa-${s.id}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Eliminare la spesa?</AlertDialogTitle>
                                      <AlertDialogDescription>{s.descrizione} — {fmtEur(parseImporto(s.importo))}</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteSpesaMut.mutate(s.id)}>Elimina</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
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
          </TabsContent>

          <TabsContent value="anagrafiche" className="space-y-4">
            <RagioniSocialiCard ragioniSociali={ragioniSociali} />
            <AnagraficheRsScopedCard
              ragioniSociali={ragioniSociali}
              categorie={categorie}
              fornitori={fornitori}
              pdvList={pdvList}
            />
          </TabsContent>
        </Tabs>

      {spesaDialog.open && (
        <SpesaDialog
          open={spesaDialog.open}
          editing={spesaDialog.editing}
          onClose={() => setSpesaDialog({ open: false })}
          ragioniSociali={ragioniSociali}
          categorie={categorie}
          fornitori={fornitori}
          pdvList={pdvList}
        />
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-6">{inner}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Incentive W3" />
      <div className="container mx-auto px-3 sm:px-6 py-6 space-y-6">
        {inner}
      </div>
    </div>
  );
}

// ============ Spesa Dialog ============
function SpesaDialog({
  open, onClose, editing, ragioniSociali, categorie, fornitori, pdvList,
}: {
  open: boolean;
  onClose: () => void;
  editing?: CdgSpesa;
  ragioniSociali: UnifiedRagioneSociale[];
  categorie: CdgCategoria[];
  fornitori: CdgFornitore[];
  pdvList: CdgPdv[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [rs, setRs] = useState<string>(editing?.ragioneSociale || ragioniSociali[0]?.nome || "");
  const [categoriaId, setCategoriaId] = useState<string>(editing?.categoriaId || "");
  const [fornitoreId, setFornitoreId] = useState<string>(editing?.fornitoreId || "");
  const [pdvId, setPdvId] = useState<string>(editing?.pdvId || "");
  const [descrizione, setDescrizione] = useState<string>(editing?.descrizione || "");
  const initialImponibile = editing?.imponibile != null
    ? String(editing.imponibile)
    : (editing ? String(editing.importo) : "");
  const initialAliquota = editing?.aliquotaIva != null
    ? String(parseFloat(editing.aliquotaIva as unknown as string))
    : "22";
  const ALIQUOTA_PRESETS = ["0", "4", "5", "10", "22"];
  const [imponibile, setImponibile] = useState<string>(initialImponibile);
  const [aliquotaSel, setAliquotaSel] = useState<string>(
    ALIQUOTA_PRESETS.includes(initialAliquota) ? initialAliquota : "custom"
  );
  const [aliquotaCustom, setAliquotaCustom] = useState<string>(
    ALIQUOTA_PRESETS.includes(initialAliquota) ? "" : initialAliquota
  );
  const [dataPagamento, setDataPagamento] = useState<string>(editing?.dataPagamento || todayYMD());
  const [meseCompetenza, setMeseCompetenza] = useState<string>(editing?.meseCompetenza || currentMonthYYYYMM());
  const [metodoPagamento, setMetodoPagamento] = useState<string>(editing?.metodoPagamento || "");
  const [note, setNote] = useState<string>(editing?.note || "");
  const [file, setFile] = useState<File | null>(null);
  const [removeAllegato, setRemoveAllegato] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);

  const [quickAdd, setQuickAdd] = useState<{ kind: "categoria" | "fornitore"; nome: string } | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);

  const catFiltrate = categorie.filter(c => c.ragioneSociale === rs);
  const fornFiltrati = fornitori.filter(f => f.ragioneSociale === rs);
  const pdvFiltrati = pdvList.filter(p => p.ragioneSociale === rs);

  useEffect(() => {
    if (categoriaId && !catFiltrate.find(c => c.id === categoriaId)) setCategoriaId("");
    if (fornitoreId && !fornFiltrati.find(f => f.id === fornitoreId)) setFornitoreId("");
    if (pdvId && !pdvFiltrati.find(p => p.id === pdvId)) setPdvId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs]);

  const handleQuickAdd = async () => {
    if (!quickAdd || !quickAdd.nome.trim()) return;
    if (!rs) { toast({ title: "Seleziona prima una Ragione Sociale", variant: "destructive" }); return; }
    setQuickSaving(true);
    try {
      const body = { ragioneSociale: rs, nome: quickAdd.nome.trim() };
      const base = quickAdd.kind === "categoria" ? "categorie" : "fornitori";
      const created = await apiJson<CdgCategoria | CdgFornitore>("POST", `/api/cdg/${base}`, body);
      qc.invalidateQueries({ queryKey: [`/api/cdg/${base}`] });
      if (quickAdd.kind === "categoria") setCategoriaId(created.id);
      else setFornitoreId(created.id);
      toast({ title: `${quickAdd.kind === "categoria" ? "Categoria" : "Fornitore"} creata` });
      setQuickAdd(null);
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    } finally {
      setQuickSaving(false);
    }
  };

  const aliquotaNum = aliquotaSel === "custom"
    ? parseFloat((aliquotaCustom || "").replace(",", "."))
    : parseFloat(aliquotaSel);
  const imponibileNum = parseFloat((imponibile || "").replace(",", "."));
  const ivaCalc = (isFinite(imponibileNum) && isFinite(aliquotaNum))
    ? Math.round(imponibileNum * aliquotaNum) / 100
    : 0;
  const totaleCalc = (isFinite(imponibileNum) ? imponibileNum : 0) + ivaCalc;

  const handleSubmit = async () => {
    if (!rs) { toast({ title: "Ragione Sociale obbligatoria", variant: "destructive" }); return; }
    if (!descrizione.trim()) { toast({ title: "Descrizione obbligatoria", variant: "destructive" }); return; }
    if (!isFinite(imponibileNum) || imponibileNum <= 0) { toast({ title: "Imponibile non valido", variant: "destructive" }); return; }
    if (!isFinite(aliquotaNum) || aliquotaNum < 0 || aliquotaNum > 100) { toast({ title: "Aliquota IVA non valida", variant: "destructive" }); return; }
    if (!dataPagamento) { toast({ title: "Data pagamento obbligatoria", variant: "destructive" }); return; }
    if (!/^\d{4}-\d{2}$/.test(meseCompetenza)) { toast({ title: "Mese competenza non valido", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        ragioneSociale: rs,
        categoriaId: categoriaId || null,
        fornitoreId: fornitoreId || null,
        pdvId: pdvId || null,
        descrizione: descrizione.trim(),
        imponibile: imponibileNum.toFixed(2),
        aliquotaIva: aliquotaNum.toFixed(2),
        dataPagamento,
        meseCompetenza,
        metodoPagamento: metodoPagamento || null,
        note: note || null,
      };
      if (file) {
        body.allegatoBase64 = await fileToBase64(file);
        body.allegatoNome = file.name;
        body.allegatoMime = file.type || "application/octet-stream";
      }
      if (editing && removeAllegato && !file) body.removeAllegato = true;
      if (editing) await apiJson("PUT", `/api/cdg/spese/${editing.id}`, body);
      else await apiJson("POST", `/api/cdg/spese`, body);
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      toast({ title: editing ? "Spesa aggiornata" : "Spesa creata" });
      onClose();
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica spesa" : "Nuova spesa"}</DialogTitle>
            <DialogDescription>Doppia data: pagamento (cassa) + mese di competenza (accrual).</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
            <div className="md:col-span-2">
              <Label>Ragione Sociale *</Label>
              <Select value={rs} onValueChange={setRs}>
                <SelectTrigger data-testid="select-spesa-rs"><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                <SelectContent>
                  {ragioniSociali.map(r => <SelectItem key={`${r.origine}-${r.nome}`} value={r.nome}>{r.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {ragioniSociali.length === 0 && <p className="text-xs text-amber-600 mt-1">Nessuna RS — creane una in Anagrafiche.</p>}
            </div>

            <div>
              <div className="flex items-center justify-between"><Label>Categoria</Label>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => setQuickAdd({ kind: "categoria", nome: "" })} disabled={!rs} data-testid="button-quick-add-categoria">
                  <Plus className="h-3 w-3 mr-1" /> Crea
                </Button>
              </div>
              <Select value={categoriaId || "__none__"} onValueChange={(v) => setCategoriaId(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="select-spesa-categoria"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nessuna —</SelectItem>
                  {catFiltrate.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between"><Label>Fornitore</Label>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => setQuickAdd({ kind: "fornitore", nome: "" })} disabled={!rs} data-testid="button-quick-add-fornitore">
                  <Plus className="h-3 w-3 mr-1" /> Crea
                </Button>
              </div>
              <Select value={fornitoreId || "__none__"} onValueChange={(v) => setFornitoreId(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="select-spesa-fornitore"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nessuno —</SelectItem>
                  {fornFiltrati.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>PDV</Label>
              <Select value={pdvId || "__none__"} onValueChange={(v) => setPdvId(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="select-spesa-pdv"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nessuno —</SelectItem>
                  {pdvFiltrati.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}{p.codice ? ` (${p.codice})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Metodo pagamento</Label>
              <Select value={metodoPagamento || "__none__"} onValueChange={(v) => setMetodoPagamento(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="select-spesa-metodo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nessuno —</SelectItem>
                  {METODI_PAGAMENTO.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <Label>Descrizione *</Label>
              <Input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} data-testid="input-spesa-descrizione" />
            </div>

            <div>
              <Label>Imponibile (€) *</Label>
              <Input type="text" inputMode="decimal" value={imponibile} onChange={(e) => setImponibile(e.target.value)} placeholder="0,00" data-testid="input-spesa-imponibile" />
            </div>

            <div>
              <Label>Aliquota IVA *</Label>
              <div className="flex gap-2">
                <Select value={aliquotaSel} onValueChange={setAliquotaSel}>
                  <SelectTrigger className="w-[110px]" data-testid="select-spesa-aliquota"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0%</SelectItem>
                    <SelectItem value="4">4%</SelectItem>
                    <SelectItem value="5">5%</SelectItem>
                    <SelectItem value="10">10%</SelectItem>
                    <SelectItem value="22">22%</SelectItem>
                    <SelectItem value="custom">Altro…</SelectItem>
                  </SelectContent>
                </Select>
                {aliquotaSel === "custom" && (
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={aliquotaCustom}
                    onChange={(e) => setAliquotaCustom(e.target.value)}
                    placeholder="es. 7,5"
                    data-testid="input-spesa-aliquota-custom"
                    className="flex-1"
                  />
                )}
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="rounded-md border bg-muted/40 p-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">IVA calcolata</div>
                  <div className="font-mono font-semibold" data-testid="text-spesa-iva-calc">{fmtEur(isFinite(ivaCalc) ? ivaCalc : 0)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Totale</div>
                  <div className="font-mono font-semibold" data-testid="text-spesa-totale-calc">{fmtEur(isFinite(totaleCalc) ? totaleCalc : 0)}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground self-center">
                  Imponibile × ({isFinite(aliquotaNum) ? aliquotaNum : 0}%) = IVA
                </div>
              </div>
            </div>

            <div>
              <Label>Data pagamento *</Label>
              <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} data-testid="input-spesa-data-pagamento" />
            </div>

            <div>
              <Label>Mese competenza *</Label>
              <Input type="month" value={meseCompetenza} onChange={(e) => setMeseCompetenza(e.target.value)} data-testid="input-spesa-competenza" />
            </div>

            <div className="md:col-span-2">
              <Label>Allegato (PDF/img, max 8MB)</Label>
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="input-spesa-allegato" />
              {editing?.allegatoNome && !file && (
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <span className="text-muted-foreground">Allegato attuale: <strong>{editing.allegatoNome}</strong></span>
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={removeAllegato} onChange={(e) => setRemoveAllegato(e.target.checked)} />
                    Rimuovi
                  </label>
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <Label>Note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} data-testid="textarea-spesa-note" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={submitting}>Annulla</Button>
            <Button onClick={handleSubmit} disabled={submitting} data-testid="button-save-spesa">
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {quickAdd && (
        <Dialog open onOpenChange={(v) => { if (!v) setQuickAdd(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Nuova {quickAdd.kind === "categoria" ? "categoria" : "fornitore"} per {rs}</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Label>Nome *</Label>
              <Input
                autoFocus
                value={quickAdd.nome}
                onChange={(e) => setQuickAdd({ ...quickAdd, nome: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") void handleQuickAdd(); }}
                data-testid="input-quick-add-nome"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQuickAdd(null)} disabled={quickSaving}>Annulla</Button>
              <Button onClick={handleQuickAdd} disabled={quickSaving || !quickAdd.nome.trim()} data-testid="button-quick-add-save">
                {quickSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Crea
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ============ Anagrafiche ============
function RagioniSocialiCard({ ragioniSociali }: { ragioniSociali: UnifiedRagioneSociale[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UnifiedRagioneSociale | null>(null);
  const [nome, setNome] = useState("");
  const [partitaIva, setPartitaIva] = useState("");
  const [note, setNote] = useState("");

  const reset = () => { setEditing(null); setNome(""); setPartitaIva(""); setNote(""); };
  const openNew = () => { reset(); setOpen(true); };
  const openEdit = (rs: UnifiedRagioneSociale) => {
    setEditing(rs); setNome(rs.nome); setPartitaIva(rs.partitaIva || ""); setNote(rs.note || ""); setOpen(true);
  };

  const save = async () => {
    if (!nome.trim()) { toast({ title: "Nome obbligatorio", variant: "destructive" }); return; }
    try {
      const body = { nome: nome.trim(), partitaIva: partitaIva.trim() || null, note: note.trim() || null };
      if (editing && editing.id) await apiJson("PUT", `/api/cdg/ragioni-sociali/${editing.id}`, body);
      else await apiJson("POST", `/api/cdg/ragioni-sociali`, body);
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali/unified"] });
      // Il rename RS propaga il nuovo nome a categorie/fornitori/pdv/spese:
      // invalida le cache per evitare UI stale dopo l'aggiornamento.
      qc.invalidateQueries({ queryKey: ["/api/cdg/categorie"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/fornitori"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/pdv"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      toast({ title: "Salvato" });
      setOpen(false);
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    }
  };

  const del = async (rs: UnifiedRagioneSociale) => {
    if (!rs.id) return;
    try {
      await apiJson("DELETE", `/api/cdg/ragioni-sociali/${rs.id}`);
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali/unified"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/categorie"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/fornitori"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/pdv"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      toast({ title: "Eliminata" });
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />Ragioni Sociali</CardTitle>
        <Button size="sm" onClick={openNew} data-testid="button-new-rs"><Plus className="h-4 w-4 mr-1" />Nuova RS</Button>
      </CardHeader>
      <CardContent>
        {ragioniSociali.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nessuna Ragione Sociale. Creane una per iniziare.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>P.IVA</TableHead><TableHead>Note</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {ragioniSociali.map(rs => {
                const fromPdv = rs.origine === "pdv";
                const rowKey = rs.id || `pdv-${rs.nome}`;
                return (
                <TableRow key={rowKey} data-testid={`row-rs-${rowKey}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {rs.nome}
                      {fromPdv && (
                        <Badge variant="secondary" className="text-[10px]" data-testid={`badge-rs-pdv-${rs.nome}`}>da PDV</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{rs.partitaIva || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate">{rs.note || ""}</TableCell>
                  <TableCell className="text-right">
                    {fromPdv ? (
                      <span className="text-xs text-muted-foreground italic pr-2">Solo lettura (gestita nei PDV)</span>
                    ) : (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(rs)} data-testid={`button-edit-rs-${rowKey}`}><Pencil className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" data-testid={`button-delete-rs-${rowKey}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Eliminare {rs.nome}?</AlertDialogTitle>
                              <AlertDialogDescription>Verranno eliminate anche tutte le anagrafiche (categorie, fornitori, PDV) e le spese collegate.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annulla</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del(rs)}>Elimina</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifica RS" : "Nuova Ragione Sociale"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Nome *</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} data-testid="input-rs-nome" /></div>
            <div><Label>Partita IVA</Label><Input value={partitaIva} onChange={(e) => setPartitaIva(e.target.value)} data-testid="input-rs-piva" /></div>
            <div><Label>Note</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={save} data-testid="button-save-rs">Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AnagraficheRsScopedCard({
  ragioniSociali, categorie, fornitori, pdvList,
}: {
  ragioniSociali: UnifiedRagioneSociale[];
  categorie: CdgCategoria[];
  fornitori: CdgFornitore[];
  pdvList: CdgPdv[];
}) {
  const [selectedRs, setSelectedRs] = useState<string>(ragioniSociali[0]?.nome || "");

  useEffect(() => {
    if (!selectedRs && ragioniSociali[0]) setSelectedRs(ragioniSociali[0].nome);
  }, [ragioniSociali, selectedRs]);

  if (ragioniSociali.length === 0) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground text-center">Crea prima una Ragione Sociale per gestire categorie, fornitori e PDV.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">Anagrafiche per Ragione Sociale</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs">RS:</Label>
            <Select value={selectedRs} onValueChange={setSelectedRs}>
              <SelectTrigger className="w-[260px]" data-testid="select-anag-rs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ragioniSociali.map(rs => <SelectItem key={`${rs.origine}-${rs.nome}`} value={rs.nome}>{rs.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="categorie">
          <TabsList>
            <TabsTrigger value="categorie"><Tag className="h-4 w-4 mr-1" />Categorie</TabsTrigger>
            <TabsTrigger value="fornitori"><Truck className="h-4 w-4 mr-1" />Fornitori</TabsTrigger>
            <TabsTrigger value="pdv"><Store className="h-4 w-4 mr-1" />PDV</TabsTrigger>
          </TabsList>
          <TabsContent value="categorie">
            <SimpleAnagraficaCrud
              base="categorie" rs={selectedRs}
              items={categorie.filter(c => c.ragioneSociale === selectedRs)}
              fields={[
                { key: "nome", label: "Nome", required: true },
                { key: "colore", label: "Colore (HEX)", placeholder: "#3b82f6" },
              ]}
              testidPrefix="cat"
            />
          </TabsContent>
          <TabsContent value="fornitori">
            <SimpleAnagraficaCrud
              base="fornitori" rs={selectedRs}
              items={fornitori.filter(f => f.ragioneSociale === selectedRs)}
              fields={[
                { key: "nome", label: "Nome", required: true },
                { key: "partitaIva", label: "P.IVA / CF" },
                { key: "note", label: "Note", textarea: true },
              ]}
              testidPrefix="forn"
            />
          </TabsContent>
          <TabsContent value="pdv">
            <SimpleAnagraficaCrud
              base="pdv" rs={selectedRs}
              items={pdvList.filter(p => p.ragioneSociale === selectedRs)}
              fields={[
                { key: "nome", label: "Nome", required: true },
                { key: "codice", label: "Codice" },
              ]}
              testidPrefix="pdv"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface FieldDef { key: string; label: string; required?: boolean; placeholder?: string; textarea?: boolean }

function SimpleAnagraficaCrud<T extends { id: string; nome: string; ragioneSociale: string } & Record<string, unknown>>({
  base, rs, items, fields, testidPrefix,
}: {
  base: string;
  rs: string;
  items: T[];
  fields: FieldDef[];
  testidPrefix: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const openNew = () => { setEditing(null); setValues({}); setOpen(true); };
  const openEdit = (it: T) => {
    setEditing(it);
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = (it[f.key] as string | null | undefined) || "";
    setValues(v);
    setOpen(true);
  };

  const save = async () => {
    for (const f of fields) {
      if (f.required && !(values[f.key] || "").trim()) {
        toast({ title: `${f.label} obbligatorio`, variant: "destructive" });
        return;
      }
    }
    const body: Record<string, unknown> = { ragioneSociale: rs };
    for (const f of fields) body[f.key] = (values[f.key] || "").trim() || null;
    try {
      if (editing) await apiJson("PUT", `/api/cdg/${base}/${editing.id}`, body);
      else await apiJson("POST", `/api/cdg/${base}`, body);
      qc.invalidateQueries({ queryKey: [`/api/cdg/${base}`] });
      toast({ title: "Salvato" });
      setOpen(false);
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    }
  };

  const del = async (it: T) => {
    try {
      await apiJson("DELETE", `/api/cdg/${base}/${it.id}`);
      qc.invalidateQueries({ queryKey: [`/api/cdg/${base}`] });
      toast({ title: "Eliminata" });
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 pt-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew} data-testid={`button-new-${testidPrefix}`}><Plus className="h-4 w-4 mr-1" />Nuovo</Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nessuna voce.</p>
      ) : (
        <Table>
          <TableHeader><TableRow>{fields.map(f => <TableHead key={f.key}>{f.label}</TableHead>)}<TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(it => (
              <TableRow key={it.id} data-testid={`row-${testidPrefix}-${it.id}`}>
                {fields.map(f => <TableCell key={f.key}>{(it[f.key] as string) || "—"}</TableCell>)}
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(it)} data-testid={`button-edit-${testidPrefix}-${it.id}`}><Pencil className="h-4 w-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-${testidPrefix}-${it.id}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>Eliminare {it.nome}?</AlertDialogTitle></AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annulla</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del(it)}>Elimina</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifica" : "Nuovo"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {fields.map(f => (
              <div key={f.key}>
                <Label>{f.label}{f.required ? " *" : ""}</Label>
                {f.textarea ? (
                  <Textarea value={values[f.key] || ""} onChange={(e) => setValues(v => ({ ...v, [f.key]: e.target.value }))} rows={2} />
                ) : (
                  <Input value={values[f.key] || ""} onChange={(e) => setValues(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} data-testid={`input-${testidPrefix}-${f.key}`} />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={save} data-testid={`button-save-${testidPrefix}`}>Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
