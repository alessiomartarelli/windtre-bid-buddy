import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Wallet, Plus, Pencil, Trash2, Loader2, Building2, Tag, Truck, Store, Download,
  TrendingUp, Calendar, FileText, Paperclip,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
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

const PIE_COLORS = [
  "#f97316", "#3b82f6", "#10b981", "#a855f7", "#ef4444", "#eab308",
  "#06b6d4", "#ec4899", "#84cc16", "#6366f1", "#f59e0b", "#14b8a6",
];

const METODI_PAGAMENTO = [
  "Bonifico", "Contanti", "POS", "Assegno", "Carta credito", "RID/SDD", "Altro",
];

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

async function apiJson(method: string, url: string, body?: unknown) {
  const res = await fetch(apiUrl(url), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Errore ${res.status}`);
  return data;
}

type TabKey = "dashboard" | "spese" | "anagrafiche";

export default function ControlloGestione() {
  const { profile, loading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isAuthorized = !!profile && ["admin", "super_admin"].includes(profile.role);
  const orgId = profile?.organizationId || "";

  const [tab, setTab] = useState<TabKey>("dashboard");
  const [filterRs, setFilterRs] = useState<string>("all");
  const [filterCompetenza, setFilterCompetenza] = useState<string>(""); // YYYY-MM o ""
  const [filterCategoria, setFilterCategoria] = useState<string>("all");

  useEffect(() => {
    if (!loading && profile && !isAuthorized) {
      toast({ title: "Accesso non autorizzato", variant: "destructive" });
      setLocation("/");
    }
  }, [loading, profile, isAuthorized, toast, setLocation]);

  // Queries
  const ragioniSocialiQ = useQuery<CdgRagioneSociale[]>({
    queryKey: ["/api/cdg/ragioni-sociali"],
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
      return apiJson("GET", `/api/cdg/spese?${p}`);
    },
    enabled: !!orgId && isAuthorized,
  });
  const speseAll = speseQ.data || [];

  const spese = useMemo(() => {
    if (filterCategoria === "all") return speseAll;
    return speseAll.filter(s => s.categoriaId === filterCategoria);
  }, [speseAll, filterCategoria]);

  // Lookup helpers
  const catById = useMemo(() => new Map(categorie.map(c => [c.id, c])), [categorie]);
  const fornById = useMemo(() => new Map(fornitori.map(f => [f.id, f])), [fornitori]);
  const pdvById = useMemo(() => new Map(pdvList.map(p => [p.id, p])), [pdvList]);

  // KPI / chart data
  const kpi = useMemo(() => {
    let totale = 0;
    const byCat = new Map<string, number>();
    const byMese = new Map<string, { competenza: number; cassa: number }>();
    const meseAttuale = currentMonthYYYYMM();
    let totaleMeseCorrente = 0;
    for (const s of spese) {
      const imp = parseFloat(s.importo as unknown as string) || 0;
      totale += imp;
      const catNome = (s.categoriaId && catById.get(s.categoriaId)?.nome) || "— Senza categoria —";
      byCat.set(catNome, (byCat.get(catNome) || 0) + imp);
      const mPag = (s.dataPagamento || "").slice(0, 7);
      const mComp = s.meseCompetenza || mPag;
      if (mComp === meseAttuale) totaleMeseCorrente += imp;
      const allMonths = Array.from(new Set<string>([mPag, mComp]));
      for (const m of allMonths) {
        if (!m) continue;
        const cur = byMese.get(m) || { competenza: 0, cassa: 0 };
        if (m === mComp) cur.competenza += imp;
        if (m === mPag) cur.cassa += imp;
        byMese.set(m, cur);
      }
    }
    const catData = Array.from(byCat.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const meseData = Array.from(byMese.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mese, v]) => ({ mese: monthLabel(mese), meseRaw: mese, ...v }));
    return { totale, totaleMeseCorrente, catData, meseData, count: spese.length };
  }, [spese, catById]);

  // Mutations - delete spesa
  const deleteSpesaMut = useMutation({
    mutationFn: (id: string) => apiJson("DELETE", `/api/cdg/spese/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      toast({ title: "Spesa eliminata" });
    },
    onError: (e: Error) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  // Spesa form dialog state
  const [spesaDialog, setSpesaDialog] = useState<{ open: boolean; editing?: CdgSpesa }>({ open: false });

  const exportCsv = () => {
    const lines: string[] = [];
    const cols = [
      "Data Pagamento", "Mese Competenza", "Ragione Sociale", "Categoria",
      "Fornitore", "PDV", "Descrizione", "Metodo", "Importo", "Note", "Allegato",
    ];
    lines.push(cols.join(";"));
    const escape = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    for (const s of spese) {
      const cat = (s.categoriaId && catById.get(s.categoriaId)?.nome) || "";
      const forn = (s.fornitoreId && fornById.get(s.fornitoreId)?.nome) || "";
      const pdv = (s.pdvId && pdvById.get(s.pdvId)?.nome) || "";
      const imp = (parseFloat(s.importo as unknown as string) || 0).toFixed(2).replace(".", ",");
      lines.push([
        fmtDateIt(s.dataPagamento), s.meseCompetenza, s.ragioneSociale, cat, forn, pdv,
        s.descrizione, s.metodoPagamento || "", imp, s.note || "", s.allegatoNome || "",
      ].map(escape).join(";"));
    }
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `controllo_gestione_${filterCompetenza || "tutto"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Incentive W3" />
      <div className="container mx-auto px-3 sm:px-6 py-6 space-y-6">
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

        {/* Filtri globali */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Ragione Sociale</Label>
                <Select value={filterRs} onValueChange={setFilterRs}>
                  <SelectTrigger data-testid="select-filter-rs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutte</SelectItem>
                    {ragioniSociali.map(rs => (
                      <SelectItem key={rs.id} value={rs.nome}>{rs.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Mese di competenza</Label>
                <Input
                  type="month"
                  value={filterCompetenza}
                  onChange={(e) => setFilterCompetenza(e.target.value)}
                  data-testid="input-filter-competenza"
                />
              </div>
              <div>
                <Label className="text-xs">Categoria</Label>
                <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                  <SelectTrigger data-testid="select-filter-categoria"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutte</SelectItem>
                    {categorie
                      .filter(c => filterRs === "all" || c.ragioneSociale === filterRs)
                      .map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setFilterRs("all"); setFilterCompetenza(""); setFilterCategoria("all"); }} data-testid="button-reset-filters">
                  Reset
                </Button>
                <Button variant="outline" size="sm" onClick={exportCsv} data-testid="button-export-csv">
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="dashboard" data-testid="tab-dashboard"><TrendingUp className="h-4 w-4 mr-1" />Dashboard</TabsTrigger>
            <TabsTrigger value="spese" data-testid="tab-spese"><FileText className="h-4 w-4 mr-1" />Spese</TabsTrigger>
            <TabsTrigger value="anagrafiche" data-testid="tab-anagrafiche"><Building2 className="h-4 w-4 mr-1" />Anagrafiche</TabsTrigger>
          </TabsList>

          {/* === DASHBOARD === */}
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Totale spese (filtrato)</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold" data-testid="kpi-totale">{fmtEur(kpi.totale)}</div><p className="text-xs text-muted-foreground mt-1">{kpi.count} voci</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Mese corrente (competenza)</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold" data-testid="kpi-mese-corrente">{fmtEur(kpi.totaleMeseCorrente)}</div><p className="text-xs text-muted-foreground mt-1">{monthLabel(currentMonthYYYYMM())}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Categorie utilizzate</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold" data-testid="kpi-categorie">{kpi.catData.length}</div><p className="text-xs text-muted-foreground mt-1">Distribuzione spese</p></CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Spese per categoria</CardTitle></CardHeader>
                <CardContent>
                  {kpi.catData.length === 0 ? (
                    <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">Nessuna spesa nel periodo selezionato</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie data={kpi.catData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e) => `${e.name}: ${fmtEur(e.value as number)}`}>
                          {kpi.catData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => fmtEur(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Cassa vs Competenza per mese</CardTitle></CardHeader>
                <CardContent>
                  {kpi.meseData.length === 0 ? (
                    <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">Nessun dato</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={kpi.meseData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="mese" />
                        <YAxis tickFormatter={(v) => `€ ${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v: number) => fmtEur(v)} />
                        <Legend />
                        <Bar dataKey="cassa" fill="#3b82f6" name="Pagato (cassa)" />
                        <Bar dataKey="competenza" fill="#f97316" name="Competenza" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* === SPESE === */}
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
                    {ragioniSociali.length === 0 ? "Crea prima una Ragione Sociale nella tab Anagrafiche." : "Nessuna spesa registrata. Clicca \"Nuova spesa\" per iniziare."}
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
                            <TableCell className="text-right font-mono">{fmtEur(parseFloat(s.importo as unknown as string) || 0)}</TableCell>
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
                                      <AlertDialogDescription>{s.descrizione} — {fmtEur(parseFloat(s.importo as unknown as string) || 0)}</AlertDialogDescription>
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

          {/* === ANAGRAFICHE === */}
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
      </div>

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
  ragioniSociali: CdgRagioneSociale[];
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
  const [importo, setImporto] = useState<string>(editing ? String(editing.importo) : "");
  const [dataPagamento, setDataPagamento] = useState<string>(editing?.dataPagamento || todayYMD());
  const [meseCompetenza, setMeseCompetenza] = useState<string>(editing?.meseCompetenza || currentMonthYYYYMM());
  const [metodoPagamento, setMetodoPagamento] = useState<string>(editing?.metodoPagamento || "");
  const [note, setNote] = useState<string>(editing?.note || "");
  const [file, setFile] = useState<File | null>(null);
  const [removeAllegato, setRemoveAllegato] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);

  const catFiltrate = categorie.filter(c => c.ragioneSociale === rs);
  const fornFiltrati = fornitori.filter(f => f.ragioneSociale === rs);
  const pdvFiltrati = pdvList.filter(p => p.ragioneSociale === rs);

  // Reset RS-scoped selections quando cambia rs
  useEffect(() => {
    if (categoriaId && !catFiltrate.find(c => c.id === categoriaId)) setCategoriaId("");
    if (fornitoreId && !fornFiltrati.find(f => f.id === fornitoreId)) setFornitoreId("");
    if (pdvId && !pdvFiltrati.find(p => p.id === pdvId)) setPdvId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs]);

  const handleSubmit = async () => {
    if (!rs) { toast({ title: "Ragione Sociale obbligatoria", variant: "destructive" }); return; }
    if (!descrizione.trim()) { toast({ title: "Descrizione obbligatoria", variant: "destructive" }); return; }
    const impNum = parseFloat(importo.replace(",", "."));
    if (!isFinite(impNum) || impNum <= 0) { toast({ title: "Importo non valido", variant: "destructive" }); return; }
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
        importo: impNum.toFixed(2),
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
      if (editing && removeAllegato && !file) {
        body.removeAllegato = true;
      }
      if (editing) {
        await apiJson("PUT", `/api/cdg/spese/${editing.id}`, body);
      } else {
        await apiJson("POST", `/api/cdg/spese`, body);
      }
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifica spesa" : "Nuova spesa"}</DialogTitle>
          <DialogDescription>Inserisci dati spesa, doppia data pagamento + competenza.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
          <div className="md:col-span-2">
            <Label>Ragione Sociale *</Label>
            <Select value={rs} onValueChange={setRs}>
              <SelectTrigger data-testid="select-spesa-rs"><SelectValue placeholder="Seleziona..." /></SelectTrigger>
              <SelectContent>
                {ragioniSociali.map(r => <SelectItem key={r.id} value={r.nome}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            {ragioniSociali.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Nessuna RS — creane una in Anagrafiche.</p>
            )}
          </div>

          <div>
            <Label>Categoria</Label>
            <Select value={categoriaId || "__none__"} onValueChange={(v) => setCategoriaId(v === "__none__" ? "" : v)}>
              <SelectTrigger data-testid="select-spesa-categoria"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nessuna —</SelectItem>
                {catFiltrate.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Fornitore</Label>
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
            <Label>Importo (€) *</Label>
            <Input type="text" inputMode="decimal" value={importo} onChange={(e) => setImporto(e.target.value)} placeholder="0,00" data-testid="input-spesa-importo" />
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
            <Label>Allegato (PDF, max 8MB)</Label>
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
  );
}

// ============ Anagrafiche: Ragioni Sociali ============
function RagioniSocialiCard({ ragioniSociali }: { ragioniSociali: CdgRagioneSociale[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CdgRagioneSociale | null>(null);
  const [nome, setNome] = useState("");
  const [partitaIva, setPartitaIva] = useState("");
  const [note, setNote] = useState("");

  const reset = () => { setEditing(null); setNome(""); setPartitaIva(""); setNote(""); };

  const openNew = () => { reset(); setOpen(true); };
  const openEdit = (rs: CdgRagioneSociale) => {
    setEditing(rs); setNome(rs.nome); setPartitaIva(rs.partitaIva || ""); setNote(rs.note || ""); setOpen(true);
  };

  const save = async () => {
    if (!nome.trim()) { toast({ title: "Nome obbligatorio", variant: "destructive" }); return; }
    try {
      const body = { nome: nome.trim(), partitaIva: partitaIva.trim() || null, note: note.trim() || null };
      if (editing) await apiJson("PUT", `/api/cdg/ragioni-sociali/${editing.id}`, body);
      else await apiJson("POST", `/api/cdg/ragioni-sociali`, body);
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali"] });
      toast({ title: "Salvato" });
      setOpen(false);
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    }
  };

  const del = async (rs: CdgRagioneSociale) => {
    try {
      await apiJson("DELETE", `/api/cdg/ragioni-sociali/${rs.id}`);
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali"] });
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
              {ragioniSociali.map(rs => (
                <TableRow key={rs.id} data-testid={`row-rs-${rs.id}`}>
                  <TableCell className="font-medium">{rs.nome}</TableCell>
                  <TableCell>{rs.partitaIva || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate">{rs.note || ""}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(rs)} data-testid={`button-edit-rs-${rs.id}`}><Pencil className="h-4 w-4" /></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" data-testid={`button-delete-rs-${rs.id}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Eliminare {rs.nome}?</AlertDialogTitle>
                          <AlertDialogDescription>Verranno eliminate anche tutte le anagrafiche (categorie, fornitori, PDV) e le spese collegate a questa Ragione Sociale.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annulla</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del(rs)}>Elimina</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
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

// ============ Anagrafiche RS-scoped (categorie / fornitori / PDV) ============
function AnagraficheRsScopedCard({
  ragioniSociali, categorie, fornitori, pdvList,
}: {
  ragioniSociali: CdgRagioneSociale[];
  categorie: CdgCategoria[];
  fornitori: CdgFornitore[];
  pdvList: CdgPdv[];
}) {
  const [selectedRs, setSelectedRs] = useState<string>(ragioniSociali[0]?.nome || "");

  useEffect(() => {
    if (!selectedRs && ragioniSociali[0]) setSelectedRs(ragioniSociali[0].nome);
  }, [ragioniSociali, selectedRs]);

  if (ragioniSociali.length === 0) {
    return (
      <Card><CardContent className="py-6 text-sm text-muted-foreground text-center">Crea prima una Ragione Sociale per gestire categorie, fornitori e PDV.</CardContent></Card>
    );
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
                {ragioniSociali.map(rs => <SelectItem key={rs.id} value={rs.nome}>{rs.nome}</SelectItem>)}
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
