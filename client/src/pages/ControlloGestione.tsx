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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Wallet, Plus, Pencil, Trash2, Loader2, Building2, Tag, Truck, Store, Download,
  TrendingUp, FileText, Paperclip, ExternalLink, Info,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import type {
  CdgRagioneSociale, CdgCategoria, CdgFornitore, CdgSpesa, CdgPdvManuale,
} from "@shared/schema";

// PDV unificati: ereditati (origine="config", read-only) + manuali
// (origine="manuale", CRUD locale al CdG).
type PdvFromConfig = {
  codice: string;
  nome: string;
  ragioneSociale: string;
  origine?: "config" | "manuale";
  id?: string;
  indirizzo?: string | null;
  note?: string | null;
};

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
  const [dashboardAnno, setDashboardAnno] = useState<number>(new Date().getFullYear());
  const [annoMeseSel, setAnnoMeseSel] = useState<number>(new Date().getMonth() + 1);
  const [annoVista, setAnnoVista] = useState<"competenza" | "cassa">("competenza");
  const [speseSort, setSpeseSort] = useState<{ key: "dataPagamento" | "meseCompetenza" | "importo"; dir: "asc" | "desc" }>({ key: "dataPagamento", dir: "desc" });
  const [rsSelezionata, setRsSelezionata] = useState<string | null>(null);

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

  // PDV ereditati da org_config.puntiVendita (read-only). Senza filtro `rs`
  // ritorna tutti i PDV dell'organizzazione, gestiti in Amministrazione.
  const pdvQ = useQuery<PdvFromConfig[]>({
    queryKey: ["/api/cdg/pdv-by-rs", "all"],
    queryFn: () => apiJson<PdvFromConfig[]>("GET", `/api/cdg/pdv-by-rs`),
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
      // Filtro PDV per codice. Tutte le spese referenziano il PDV via
      // pdvCodice (= organization_config.puntiVendita.codicePos).
      if (filterPdv !== "all" && (s.pdvCodice || "") !== filterPdv) return false;
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
  const pdvByCodice = useMemo(() => new Map(pdvList.map(p => [p.codice, p])), [pdvList]);

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

  // === Dashboard ANNUALE ===
  // Spese aggregate per i 12 mesi dell'anno selezionato (cassa + competenza),
  // più breakdown per categoria del mese selezionato all'interno dell'anno.
  const dashboardAnnuale = useMemo(() => {
    const meseLabels = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
    const perMese: { mese: string; meseNum: number; cassa: number; competenza: number; conteggio: number }[] =
      Array.from({ length: 12 }, (_, i) => ({ mese: meseLabels[i], meseNum: i + 1, cassa: 0, competenza: 0, conteggio: 0 }));
    const ymTarget = `${dashboardAnno}-${String(annoMeseSel).padStart(2, "0")}`;
    const catTotMese = new Map<string, number>();
    let totCassaAnno = 0;
    let totCompAnno = 0;
    for (const s of spese) {
      const imp = parseImporto(s.importo);
      const mPag = (s.dataPagamento || "").slice(0, 7);
      const mComp = s.meseCompetenza || mPag;
      const [pY, pM] = mPag.split("-").map(Number);
      const [cY, cM] = mComp.split("-").map(Number);
      if (pY === dashboardAnno && pM >= 1 && pM <= 12) {
        perMese[pM - 1].cassa += imp;
        totCassaAnno += imp;
      }
      if (cY === dashboardAnno && cM >= 1 && cM <= 12) {
        perMese[cM - 1].competenza += imp;
        perMese[cM - 1].conteggio += 1;
        totCompAnno += imp;
      }
      const matchPie = annoVista === "competenza" ? (mComp === ymTarget) : (mPag === ymTarget);
      if (matchPie) {
        const catNome = (s.categoriaId && catById.get(s.categoriaId)?.nome) || "— Senza categoria —";
        catTotMese.set(catNome, (catTotMese.get(catNome) || 0) + imp);
      }
    }
    const pieData = Array.from(catTotMese.entries())
      .map(([categoria, importo]) => ({ categoria, importo }))
      .sort((a, b) => b.importo - a.importo);
    const totaleMeseSel = pieData.reduce((s, r) => s + r.importo, 0);
    return { perMese, pieData, totaleMeseSel, totCassaAnno, totCompAnno };
  }, [spese, dashboardAnno, annoMeseSel, annoVista, catById]);

  // === Dashboard per Ragione Sociale + drill-down PDV ===
  // Aggregati sull'anno selezionato (`dashboardAnno`) e sulla vista
  // selezionata (competenza vs cassa). Cliccando una RS si apre il dettaglio
  // PDV (con tabella + grafico).
  const dashboardRs = useMemo(() => {
    const rsTot = new Map<string, { rs: string; importo: number; conteggio: number }>();
    const pdvTot = new Map<string, { codice: string; nome: string; importo: number; conteggio: number }>();
    const pdvSpese: { id: string; data: string; meseComp: string; categoria: string; descrizione: string; importo: number; pdvCodice: string | null }[] = [];
    for (const s of spese) {
      const imp = parseImporto(s.importo);
      const mPag = (s.dataPagamento || "").slice(0, 7);
      const mComp = s.meseCompetenza || mPag;
      const ym = annoVista === "competenza" ? mComp : mPag;
      const [yy] = ym.split("-").map(Number);
      if (yy !== dashboardAnno) continue;
      const cur = rsTot.get(s.ragioneSociale) || { rs: s.ragioneSociale, importo: 0, conteggio: 0 };
      cur.importo += imp; cur.conteggio += 1;
      rsTot.set(s.ragioneSociale, cur);
      if (rsSelezionata && s.ragioneSociale === rsSelezionata) {
        const pdvKey = s.pdvCodice || "__nessuno__";
        const pdvNome = s.pdvCodice ? (pdvByCodice.get(s.pdvCodice)?.nome || `${s.pdvCodice} (?)`) : "— Senza PDV —";
        const pcur = pdvTot.get(pdvKey) || { codice: pdvKey, nome: pdvNome, importo: 0, conteggio: 0 };
        pcur.importo += imp; pcur.conteggio += 1;
        pdvTot.set(pdvKey, pcur);
        pdvSpese.push({
          id: s.id,
          data: s.dataPagamento,
          meseComp: s.meseCompetenza,
          categoria: (s.categoriaId && catById.get(s.categoriaId)?.nome) || "—",
          descrizione: s.descrizione,
          importo: imp,
          pdvCodice: s.pdvCodice,
        });
      }
    }
    const rsBar = Array.from(rsTot.values()).sort((a, b) => b.importo - a.importo);
    const pdvBar = Array.from(pdvTot.values()).sort((a, b) => b.importo - a.importo);
    pdvSpese.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const totaleRs = rsBar.reduce((s, r) => s + r.importo, 0);
    const totalePdv = pdvBar.reduce((s, r) => s + r.importo, 0);
    return { rsBar, pdvBar, pdvSpese, totaleRs, totalePdv };
  }, [spese, dashboardAnno, annoVista, rsSelezionata, catById, pdvByCodice]);

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
        "PDV": (s.pdvCodice && pdvByCodice.get(s.pdvCodice)?.nome) || "",
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
                    {categorie.filter(c => filterRs === "all" || (c.ragioniSociali || []).includes(filterRs)).map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Fornitore</Label>
                <Select value={filterFornitore} onValueChange={setFilterFornitore}>
                  <SelectTrigger data-testid="select-filter-fornitore"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutti</SelectItem>
                    {fornitori.filter(f => filterRs === "all" || (f.ragioniSociali || []).includes(filterRs)).map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">PDV</Label>
                <Select value={filterPdv} onValueChange={setFilterPdv}>
                  <SelectTrigger data-testid="select-filter-pdv"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutti</SelectItem>
                    {pdvList.filter(p => filterRs === "all" || p.ragioneSociale === filterRs).map(p => <SelectItem key={p.codice} value={p.codice}>{p.nome}</SelectItem>)}
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

            {/* === Dashboard ANNUALE === */}
            <Card className="border-orange-200 dark:border-orange-900/40">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="text-base">Spese annuali — anno {dashboardAnno}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Totale competenza anno: <strong>{fmtEur(dashboardAnnuale.totCompAnno)}</strong> · Totale cassa anno: <strong>{fmtEur(dashboardAnnuale.totCassaAnno)}</strong>
                    </p>
                  </div>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <Label className="text-xs">Vista</Label>
                      <div className="flex rounded-md border overflow-hidden h-9" data-testid="toggle-anno-vista">
                        <button
                          type="button"
                          onClick={() => setAnnoVista("competenza")}
                          className={`px-3 text-xs font-medium ${annoVista === "competenza" ? "bg-orange-500 text-white" : "bg-background hover:bg-muted"}`}
                          data-testid="btn-vista-competenza"
                        >Competenza</button>
                        <button
                          type="button"
                          onClick={() => setAnnoVista("cassa")}
                          className={`px-3 text-xs font-medium border-l ${annoVista === "cassa" ? "bg-blue-500 text-white" : "bg-background hover:bg-muted"}`}
                          data-testid="btn-vista-cassa"
                        >Cassa</button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Anno</Label>
                      <Select value={String(dashboardAnno)} onValueChange={(v) => setDashboardAnno(Number(v))}>
                        <SelectTrigger className="w-[110px]" data-testid="select-dashboard-anno"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map(y => (
                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Mese (per torta)</Label>
                      <Select value={String(annoMeseSel)} onValueChange={(v) => setAnnoMeseSel(Number(v))}>
                        <SelectTrigger className="w-[140px]" data-testid="select-dashboard-mese-anno"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"].map((m, i) => (
                            <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2">
                    <p className="text-sm font-medium mb-2">
                      Istogramma mensile {dashboardAnno} — {annoVista === "competenza" ? "Competenza" : "Cassa"}
                    </p>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={dashboardAnnuale.perMese} onClick={(e: any) => {
                        const idx = e?.activeTooltipIndex;
                        if (typeof idx === "number") setAnnoMeseSel(idx + 1);
                      }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="mese" />
                        <YAxis tickFormatter={(v) => `€ ${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v: number) => fmtEur(v)} />
                        <Legend />
                        {annoVista === "competenza" ? (
                          <Bar dataKey="competenza" fill="#f97316" name="Competenza" />
                        ) : (
                          <Bar dataKey="cassa" fill="#3b82f6" name="Cassa" />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-muted-foreground mt-1">Suggerimento: clicca una barra per cambiare il mese della torta.</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">
                      Torta categorie — {["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"][annoMeseSel - 1]} {dashboardAnno} ({annoVista})
                    </p>
                    {dashboardAnnuale.pieData.length === 0 ? (
                      <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm border rounded-md">
                        Nessuna spesa nel mese
                      </div>
                    ) : (
                      <>
                        <ResponsiveContainer width="100%" height={260}>
                          <PieChart>
                            <Pie
                              data={dashboardAnnuale.pieData}
                              dataKey="importo"
                              nameKey="categoria"
                              cx="50%"
                              cy="50%"
                              outerRadius={90}
                              innerRadius={45}
                              label={(e: any) => {
                                const pct = dashboardAnnuale.totaleMeseSel > 0
                                  ? Math.round((e.importo / dashboardAnnuale.totaleMeseSel) * 100)
                                  : 0;
                                return pct >= 6 ? `${pct}%` : "";
                              }}
                              labelLine={false}
                            >
                              {dashboardAnnuale.pieData.map((_, i) => (
                                <Cell key={i} fill={["#f97316", "#3b82f6", "#10b981", "#a855f7", "#ef4444", "#eab308", "#06b6d4", "#ec4899", "#84cc16", "#6366f1", "#14b8a6", "#f59e0b"][i % 12]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => fmtEur(v)} />
                          </PieChart>
                        </ResponsiveContainer>
                        <p className="text-xs text-center text-muted-foreground mt-1">
                          Totale: <strong>{fmtEur(dashboardAnnuale.totaleMeseSel)}</strong>
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {dashboardAnnuale.pieData.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                    {dashboardAnnuale.pieData.map((r, i) => (
                      <div key={r.categoria} className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-sm" style={{ background: ["#f97316", "#3b82f6", "#10b981", "#a855f7", "#ef4444", "#eab308", "#06b6d4", "#ec4899", "#84cc16", "#6366f1", "#14b8a6", "#f59e0b"][i % 12] }} />
                        <span className="truncate flex-1" title={r.categoria}>{r.categoria}</span>
                        <span className="font-mono">{fmtEur(r.importo)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* === Dashboard per Ragione Sociale + drill-down PDV === */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="text-base">
                      Spese per Ragione Sociale — anno {dashboardAnno} ({annoVista})
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Totale: <strong>{fmtEur(dashboardRs.totaleRs)}</strong> · {dashboardRs.rsBar.length} RS · clicca una barra per il dettaglio PDV
                    </p>
                  </div>
                  {rsSelezionata && (
                    <Button variant="outline" size="sm" onClick={() => setRsSelezionata(null)} data-testid="btn-clear-rs">
                      Chiudi dettaglio PDV
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {dashboardRs.rsBar.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                    Nessuna spesa nell'anno selezionato.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(220, dashboardRs.rsBar.length * 38)}>
                    <BarChart
                      data={dashboardRs.rsBar}
                      layout="vertical"
                      margin={{ left: 24 }}
                      onClick={(e: any) => {
                        const idx = e?.activeTooltipIndex;
                        if (typeof idx === "number") {
                          const rs = dashboardRs.rsBar[idx]?.rs;
                          if (rs) setRsSelezionata(rs === rsSelezionata ? null : rs);
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `€ ${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="rs" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => fmtEur(v)} />
                      <Bar dataKey="importo" name="Importo">
                        {dashboardRs.rsBar.map((r, i) => (
                          <Cell key={i} fill={r.rs === rsSelezionata ? "#1e40af" : (annoVista === "competenza" ? "#f97316" : "#3b82f6")} cursor="pointer" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}

                {rsSelezionata && (
                  <div className="mt-6 border-t pt-4 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold">Dettaglio PDV — {rsSelezionata}</h3>
                      <p className="text-xs text-muted-foreground">
                        Totale: <strong>{fmtEur(dashboardRs.totalePdv)}</strong> · {dashboardRs.pdvBar.length} PDV · {dashboardRs.pdvSpese.length} spese
                      </p>
                    </div>

                    {dashboardRs.pdvBar.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nessun PDV per questa RS nell'anno selezionato.</p>
                    ) : (
                      <>
                        <ResponsiveContainer width="100%" height={Math.max(180, dashboardRs.pdvBar.length * 34)}>
                          <BarChart data={dashboardRs.pdvBar} layout="vertical" margin={{ left: 24 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" tickFormatter={(v) => `€ ${(v / 1000).toFixed(0)}k`} />
                            <YAxis type="category" dataKey="nome" width={180} tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(v: number) => fmtEur(v)} />
                            <Bar dataKey="importo" fill={annoVista === "competenza" ? "#f97316" : "#3b82f6"} name="Importo" />
                          </BarChart>
                        </ResponsiveContainer>

                        <div className="rounded-md border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>PDV</TableHead>
                                <TableHead className="text-right">N. spese</TableHead>
                                <TableHead className="text-right">Totale</TableHead>
                                <TableHead className="text-right">% sul totale RS</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {dashboardRs.pdvBar.map((p) => (
                                <TableRow key={p.codice} data-testid={`row-pdv-detail-${p.codice}`}>
                                  <TableCell className="font-medium">{p.nome}</TableCell>
                                  <TableCell className="text-right">{p.conteggio}</TableCell>
                                  <TableCell className="text-right font-mono">{fmtEur(p.importo)}</TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {dashboardRs.totalePdv > 0 ? `${((p.importo / dashboardRs.totalePdv) * 100).toFixed(1)}%` : "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

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
                        <TableHead>
                          <button
                            type="button"
                            className="flex items-center gap-1 hover:text-foreground"
                            onClick={() => setSpeseSort(s => ({ key: "dataPagamento", dir: s.key === "dataPagamento" && s.dir === "desc" ? "asc" : "desc" }))}
                            data-testid="sort-data-pag"
                          >
                            Data pag. {speseSort.key === "dataPagamento" ? (speseSort.dir === "desc" ? "▼" : "▲") : "↕"}
                          </button>
                        </TableHead>
                        <TableHead>
                          <button
                            type="button"
                            className="flex items-center gap-1 hover:text-foreground"
                            onClick={() => setSpeseSort(s => ({ key: "meseCompetenza", dir: s.key === "meseCompetenza" && s.dir === "desc" ? "asc" : "desc" }))}
                            data-testid="sort-comp"
                          >
                            Comp. {speseSort.key === "meseCompetenza" ? (speseSort.dir === "desc" ? "▼" : "▲") : "↕"}
                          </button>
                        </TableHead>
                        <TableHead>RS</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Fornitore</TableHead>
                        <TableHead>PDV</TableHead>
                        <TableHead>Descrizione</TableHead>
                        <TableHead>Metodo</TableHead>
                        <TableHead className="text-right">
                          <button
                            type="button"
                            className="flex items-center gap-1 hover:text-foreground ml-auto"
                            onClick={() => setSpeseSort(s => ({ key: "importo", dir: s.key === "importo" && s.dir === "desc" ? "asc" : "desc" }))}
                            data-testid="sort-importo"
                          >
                            Importo {speseSort.key === "importo" ? (speseSort.dir === "desc" ? "▼" : "▲") : "↕"}
                          </button>
                        </TableHead>
                        <TableHead></TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...spese].sort((a, b) => {
                        const dir = speseSort.dir === "asc" ? 1 : -1;
                        if (speseSort.key === "importo") {
                          return (parseImporto(a.importo) - parseImporto(b.importo)) * dir;
                        }
                        const va = (a[speseSort.key] || "") as string;
                        const vb = (b[speseSort.key] || "") as string;
                        return va.localeCompare(vb) * dir;
                      }).map(s => {
                        const cat = s.categoriaId ? catById.get(s.categoriaId) : null;
                        const forn = s.fornitoreId ? fornById.get(s.fornitoreId) : null;
                        // Fallback: se pdvCodice esiste ma non è risolvibile in
                        // puntiVendita (legacy non rimappato), mostra comunque
                        // il codice grezzo invece di "—" silenzioso.
                        const pdv = s.pdvCodice ? pdvByCodice.get(s.pdvCodice) : null;
                        const pdvLabel = pdv ? pdv.nome : (s.pdvCodice ? `${s.pdvCodice} (?)` : "—");
                        return (
                          <TableRow key={s.id} data-testid={`row-spesa-${s.id}`}>
                            <TableCell>{fmtDateIt(s.dataPagamento)}</TableCell>
                            <TableCell><Badge variant="outline">{monthLabel(s.meseCompetenza)}</Badge></TableCell>
                            <TableCell className="text-xs">{s.ragioneSociale}</TableCell>
                            <TableCell>{cat?.nome || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell>{forn?.nome || <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell>{pdv ? pdv.nome : (s.pdvCodice ? <span className="text-amber-600" title="PDV legacy non risolvibile in puntiVendita">{pdvLabel}</span> : <span className="text-muted-foreground">—</span>)}</TableCell>
                            <TableCell className="max-w-[220px] truncate" title={s.descrizione}>
                              <div className="flex items-center gap-1">
                                <span className="truncate">{s.descrizione}</span>
                                {s.ricorrente && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] px-1 py-0"
                                    title={s.dataFineRicorrenza ? `Ricorrenza fino a ${fmtDateIt(s.dataFineRicorrenza)}` : "Ricorrente"}
                                    data-testid={`badge-ricorrente-${s.id}`}
                                  >
                                    ↻
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
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
  pdvList: PdvFromConfig[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [rs, setRs] = useState<string>(editing?.ragioneSociale || ragioniSociali[0]?.nome || "");
  const [categoriaId, setCategoriaId] = useState<string>(editing?.categoriaId || "");
  const [fornitoreId, setFornitoreId] = useState<string>(editing?.fornitoreId || "");
  const [pdvCodice, setPdvCodice] = useState<string>(editing?.pdvCodice || "");
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
  const [ricorrente, setRicorrente] = useState<boolean>(!!editing?.ricorrente);
  const [periodicita, setPeriodicita] = useState<"mensile" | "annuale">(
    (editing?.periodicita as "mensile" | "annuale") || "mensile"
  );
  const [cashFlowOffsetMesi, setCashFlowOffsetMesi] = useState<number>(
    Number(editing?.cashFlowOffsetMesi ?? 0)
  );
  const [dataInizioRicorrenza, setDataInizioRicorrenza] = useState<string>(editing?.dataInizioRicorrenza || editing?.dataPagamento || "");
  const [dataFineRicorrenza, setDataFineRicorrenza] = useState<string>(editing?.dataFineRicorrenza || "");
  const [submitting, setSubmitting] = useState(false);

  const [quickAdd, setQuickAdd] = useState<{ kind: "categoria" | "fornitore"; nome: string } | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);

  const catFiltrate = categorie.filter(c => (c.ragioniSociali || []).includes(rs));
  const fornFiltrati = fornitori.filter(f => (f.ragioniSociali || []).includes(rs));
  const pdvFiltrati = pdvList.filter(p => p.ragioneSociale === rs);

  useEffect(() => {
    if (categoriaId && !catFiltrate.find(c => c.id === categoriaId)) setCategoriaId("");
    if (fornitoreId && !fornFiltrati.find(f => f.id === fornitoreId)) setFornitoreId("");
    if (pdvCodice && !pdvFiltrati.find(p => p.codice === pdvCodice)) setPdvCodice("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs]);

  const handleQuickAdd = async () => {
    if (!quickAdd || !quickAdd.nome.trim()) return;
    if (!rs) { toast({ title: "Seleziona prima una Ragione Sociale", variant: "destructive" }); return; }
    setQuickSaving(true);
    try {
      // Multi-RS: la nuova voce nasce con la sola RS corrente. L'utente potrà
      // poi associarla ad altre RS dalla tab Anagrafiche.
      const body = { ragioniSociali: [rs], nome: quickAdd.nome.trim() };
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
        pdvCodice: pdvCodice || null,
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
      body.ricorrente = !!ricorrente;
      body.cashFlowOffsetMesi = cashFlowOffsetMesi;
      body.periodicita = ricorrente ? periodicita : null;
      body.dataInizioRicorrenza = ricorrente && dataInizioRicorrenza ? dataInizioRicorrenza : null;
      body.dataFineRicorrenza = ricorrente && dataFineRicorrenza ? dataFineRicorrenza : null;
      if (ricorrente) {
        if (!dataInizioRicorrenza || !dataFineRicorrenza) {
          toast({ title: "Imposta data inizio e data fine ricorrenza", variant: "destructive" });
          setSubmitting(false);
          return;
        }
        if (dataFineRicorrenza < dataInizioRicorrenza) {
          toast({ title: "La data fine deve essere >= della data inizio", variant: "destructive" });
          setSubmitting(false);
          return;
        }
        // Quando ricorrente, la master parte da data inizio: forziamo anche
        // qui per coerenza (il backend ricalcolerà comunque).
        body.dataPagamento = dataInizioRicorrenza;
        body.meseCompetenza = dataInizioRicorrenza.slice(0, 7);
      }
      let resp: any;
      if (editing) resp = await apiJson("PUT", `/api/cdg/spese/${editing.id}`, body);
      else resp = await apiJson<{ ricorrenzaGenerati?: number }>("POST", `/api/cdg/spese`, body);
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      const generati = (resp as any)?.ricorrenzaGenerati || 0;
      toast({
        title: editing ? "Spesa aggiornata" : "Spesa creata",
        description: !editing && generati > 0 ? `+${generati} occorrenze mensili generate fino a ${dataFineRicorrenza}` : undefined,
      });
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
              <Select value={pdvCodice || "__none__"} onValueChange={(v) => setPdvCodice(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="select-spesa-pdv"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nessuno —</SelectItem>
                  {pdvFiltrati.map(p => <SelectItem key={p.codice} value={p.codice}>{p.nome} ({p.codice})</SelectItem>)}
                </SelectContent>
              </Select>
              {rs && pdvFiltrati.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">Nessun PDV configurato per questa RS. Gestiscili in Amministrazione.</p>
              )}
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

            <div className="md:col-span-2 rounded-md border p-3 space-y-3">
              <div>
                <Label className="text-sm">Tipo spesa</Label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setRicorrente(false)}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${!ricorrente ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
                    data-testid="btn-tipo-una-tantum"
                  >
                    Una tantum
                  </button>
                  <button
                    type="button"
                    onClick={() => setRicorrente(true)}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${ricorrente ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
                    data-testid="btn-tipo-ricorrente"
                  >
                    Ricorrente
                  </button>
                </div>
              </div>

              {ricorrente && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label>Periodicità *</Label>
                      <Select value={periodicita} onValueChange={(v) => setPeriodicita(v as "mensile" | "annuale")}>
                        <SelectTrigger data-testid="select-spesa-periodicita"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mensile">Mensile</SelectItem>
                          <SelectItem value="annuale">Annuale</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Data inizio *</Label>
                      <Input
                        type="date"
                        value={dataInizioRicorrenza}
                        onChange={(e) => setDataInizioRicorrenza(e.target.value)}
                        data-testid="input-spesa-data-inizio-ricorrenza"
                      />
                    </div>
                    <div>
                      <Label>Data fine *</Label>
                      <Input
                        type="date"
                        value={dataFineRicorrenza}
                        min={dataInizioRicorrenza || undefined}
                        onChange={(e) => setDataFineRicorrenza(e.target.value)}
                        data-testid="input-spesa-data-fine-ricorrenza"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <Label>Sfasamento cassa vs competenza</Label>
                <Select value={String(cashFlowOffsetMesi)} onValueChange={(v) => setCashFlowOffsetMesi(Number(v))}>
                  <SelectTrigger className="w-full md:w-[260px]" data-testid="select-spesa-cashflow-offset"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">M (stesso mese)</SelectItem>
                    <SelectItem value="1">M+1 (mese successivo)</SelectItem>
                    <SelectItem value="2">M+2 (due mesi dopo)</SelectItem>
                    <SelectItem value="3">M+3 (tre mesi dopo)</SelectItem>
                  </SelectContent>
                </Select>
                {ricorrente && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Per ogni occorrenza la data pagamento sarà calcolata come (mese competenza + {cashFlowOffsetMesi} mesi).
                  </p>
                )}
              </div>

              {ricorrente && !editing && (
                <p className="text-xs text-muted-foreground">
                  Verranno create copie indipendenti {periodicita === "annuale" ? "annue" : "mensili"} tra data inizio e data fine (incluse).
                  L'allegato non viene duplicato.
                </p>
              )}
              {ricorrente && editing && (
                <p className="text-xs text-amber-600">
                  In modifica i flag aggiornano solo questa riga: le occorrenze già create restano invariate.
                </p>
              )}
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
              <DialogDescription>La voce verrà creata associata a "{rs}". Potrai associarla ad altre Ragioni Sociali dalla tab Anagrafiche.</DialogDescription>
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
      if (editing && editing.origine === "pdv") {
        await apiJson("PUT", `/api/cdg/ragioni-sociali/inherited/${encodeURIComponent(editing.nome)}`, body);
      } else if (editing && editing.id) {
        await apiJson("PUT", `/api/cdg/ragioni-sociali/${editing.id}`, body);
      } else {
        await apiJson("POST", `/api/cdg/ragioni-sociali`, body);
      }
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali/unified"] });
      // Il rename RS propaga il nuovo nome a categorie/fornitori/pdv/spese:
      // invalida le cache per evitare UI stale dopo l'aggiornamento.
      qc.invalidateQueries({ queryKey: ["/api/cdg/categorie"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/fornitori"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/pdv-by-rs"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      toast({ title: "Salvato" });
      setOpen(false);
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    }
  };

  const del = async (rs: UnifiedRagioneSociale) => {
    try {
      if (rs.origine === "pdv") {
        await apiJson("DELETE", `/api/cdg/ragioni-sociali/inherited/${encodeURIComponent(rs.nome)}`);
      } else if (rs.id) {
        await apiJson("DELETE", `/api/cdg/ragioni-sociali/${rs.id}`);
      } else { return; }
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali/unified"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/categorie"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/fornitori"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/pdv-by-rs"] });
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
                    <Button size="icon" variant="ghost" onClick={() => openEdit(rs)} data-testid={`button-edit-rs-${rowKey}`}><Pencil className="h-4 w-4" /></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" data-testid={`button-delete-rs-${rowKey}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Eliminare {rs.nome}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {fromPdv ? (
                              <>
                                <strong>Attenzione:</strong> "{rs.nome}" è ereditata dalla Gestione Organizzazione. L'eliminazione rimuoverà <strong>tutti i Punti Vendita</strong> collegati a questa Ragione Sociale anche dalla Gestione Organizzazione, oltre alle spese, ai PDV manuali e all'associazione con categorie/fornitori per questa RS.
                              </>
                            ) : (
                              <>Verranno eliminate tutte le spese collegate. Categorie e fornitori condivisi con altre Ragioni Sociali NON vengono cancellati: viene rimossa solo l'associazione a "{rs.nome}". Le voci associate solo a questa RS vengono eliminate.</>
                            )}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annulla</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del(rs)}>Elimina</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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

// Anagrafiche multi-RS:
// - Categorie e Fornitori sono riutilizzabili su più Ragioni Sociali (multi-select).
// - PDV sono ereditati read-only da organization_config.puntiVendita
//   (gestione in Amministrazione → Gestione Organizzazione).
function AnagraficheRsScopedCard({
  ragioniSociali, categorie, fornitori, pdvList,
}: {
  ragioniSociali: UnifiedRagioneSociale[];
  categorie: CdgCategoria[];
  fornitori: CdgFornitore[];
  pdvList: PdvFromConfig[];
}) {
  const [, setLocation] = useLocation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Anagrafiche</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="categorie">
          <TabsList>
            <TabsTrigger value="categorie" data-testid="tab-anag-categorie"><Tag className="h-4 w-4 mr-1" />Categorie</TabsTrigger>
            <TabsTrigger value="fornitori" data-testid="tab-anag-fornitori"><Truck className="h-4 w-4 mr-1" />Fornitori</TabsTrigger>
            <TabsTrigger value="pdv" data-testid="tab-anag-pdv"><Store className="h-4 w-4 mr-1" />PDV</TabsTrigger>
          </TabsList>
          <TabsContent value="categorie">
            <MultiRsAnagraficaCrud
              base="categorie"
              ragioniSociali={ragioniSociali}
              items={categorie}
              fields={[
                { key: "nome", label: "Nome", required: true },
                { key: "colore", label: "Colore (HEX)", placeholder: "#3b82f6" },
              ]}
              testidPrefix="cat"
            />
          </TabsContent>
          <TabsContent value="fornitori">
            <MultiRsAnagraficaCrud
              base="fornitori"
              ragioniSociali={ragioniSociali}
              items={fornitori}
              fields={[
                { key: "nome", label: "Nome", required: true },
                { key: "partitaIva", label: "P.IVA / CF" },
                { key: "note", label: "Note", textarea: true },
              ]}
              testidPrefix="forn"
            />
          </TabsContent>
          <TabsContent value="pdv">
            <PdvCrudView pdvList={pdvList} ragioniSociali={ragioniSociali} onGoToAdmin={() => setLocation("/admin")} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface FieldDef { key: string; label: string; required?: boolean; placeholder?: string; textarea?: boolean }

// CRUD multi-RS per categorie/fornitori. Una voce ha una lista di RS (min 1)
// ed è visibile/utilizzabile in tutte le RS associate.
function MultiRsAnagraficaCrud<T extends { id: string; nome: string; ragioniSociali: string[] | null } & Record<string, unknown>>({
  base, ragioniSociali, items, fields, testidPrefix,
}: {
  base: string;
  ragioniSociali: UnifiedRagioneSociale[];
  items: T[];
  fields: FieldDef[];
  testidPrefix: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedRs, setSelectedRs] = useState<string[]>([]);
  const [filterRs, setFilterRs] = useState<string>("all");

  const openNew = () => {
    setEditing(null);
    setValues({});
    // Default: nessuna RS pre-selezionata; obbligatorio sceglierne almeno una.
    setSelectedRs([]);
    setOpen(true);
  };
  const openEdit = (it: T) => {
    setEditing(it);
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = (it[f.key] as string | null | undefined) || "";
    setValues(v);
    setSelectedRs(Array.isArray(it.ragioniSociali) ? [...it.ragioniSociali] : []);
    setOpen(true);
  };

  const toggleRs = (nome: string, checked: boolean) => {
    setSelectedRs(prev => checked ? Array.from(new Set([...prev, nome])) : prev.filter(n => n !== nome));
  };

  const save = async () => {
    for (const f of fields) {
      if (f.required && !(values[f.key] || "").trim()) {
        toast({ title: `${f.label} obbligatorio`, variant: "destructive" });
        return;
      }
    }
    if (selectedRs.length === 0) {
      toast({ title: "Seleziona almeno una Ragione Sociale", variant: "destructive" });
      return;
    }
    const body: Record<string, unknown> = { ragioniSociali: selectedRs };
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
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      toast({ title: "Eliminata" });
    } catch (e) {
      toast({ title: "Errore", description: (e as Error).message, variant: "destructive" });
    }
  };

  // Conteggio impatto cancellazione: caricato lazy quando l'utente apre il dialog.
  const [usageById, setUsageById] = useState<Record<string, { speseCount: number; ragioniSocialiUsate: string[] } | "loading" | "error">>({});
  const loadUsage = async (id: string) => {
    setUsageById(prev => ({ ...prev, [id]: "loading" }));
    try {
      const u = await apiJson<{ speseCount: number; ragioniSocialiUsate: string[] }>("GET", `/api/cdg/${base}/${id}/usage`);
      setUsageById(prev => ({ ...prev, [id]: u }));
    } catch {
      setUsageById(prev => ({ ...prev, [id]: "error" }));
    }
  };

  const filtered = filterRs === "all"
    ? items
    : items.filter(it => (it.ragioniSociali || []).includes(filterRs));

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Filtra per RS:</Label>
          <Select value={filterRs} onValueChange={setFilterRs}>
            <SelectTrigger className="w-[260px]" data-testid={`select-filter-${testidPrefix}-rs`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte</SelectItem>
              {ragioniSociali.map(rs => <SelectItem key={`${rs.origine}-${rs.nome}`} value={rs.nome}>{rs.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={openNew} disabled={ragioniSociali.length === 0} data-testid={`button-new-${testidPrefix}`}>
          <Plus className="h-4 w-4 mr-1" />Nuovo
        </Button>
      </div>
      {ragioniSociali.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Crea prima una Ragione Sociale (manuale o da PDV).</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nessuna voce.</p>
      ) : (
        <Table>
          <TableHeader><TableRow>
            {fields.map(f => <TableHead key={f.key}>{f.label}</TableHead>)}
            <TableHead>Ragioni Sociali</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map(it => (
              <TableRow key={it.id} data-testid={`row-${testidPrefix}-${it.id}`}>
                {fields.map(f => <TableCell key={f.key}>{(it[f.key] as string) || "—"}</TableCell>)}
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(it.ragioniSociali || []).map(rs => (
                      <Badge key={rs} variant="secondary" className="text-[10px]" data-testid={`badge-${testidPrefix}-rs-${it.id}-${rs}`}>{rs}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(it)} data-testid={`button-edit-${testidPrefix}-${it.id}`}><Pencil className="h-4 w-4" /></Button>
                  <AlertDialog onOpenChange={(o) => { if (o) loadUsage(it.id); }}>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-${testidPrefix}-${it.id}`}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Eliminare {it.nome}?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-2">
                            <p>La voce verrà rimossa da tutte le Ragioni Sociali associate.</p>
                            {(() => {
                              const u = usageById[it.id];
                              if (u === "loading") return <p className="text-xs text-muted-foreground" data-testid={`text-usage-loading-${testidPrefix}-${it.id}`}>Verifico utilizzo…</p>;
                              if (u === "error") return <p className="text-xs text-destructive">Impossibile verificare l'utilizzo.</p>;
                              if (!u) return null;
                              if (u.speseCount === 0) {
                                return <p className="text-xs text-muted-foreground" data-testid={`text-usage-${testidPrefix}-${it.id}`}>Non è usata in nessuna spesa.</p>;
                              }
                              return (
                                <p className="text-xs text-amber-700 dark:text-amber-400" data-testid={`text-usage-${testidPrefix}-${it.id}`}>
                                  Usata in <strong>{u.speseCount}</strong> {u.speseCount === 1 ? "spesa" : "spese"}
                                  {u.ragioniSocialiUsate.length > 0 ? <> su {u.ragioniSocialiUsate.length} {u.ragioniSocialiUsate.length === 1 ? "Ragione Sociale" : "Ragioni Sociali"} ({u.ragioniSocialiUsate.join(", ")})</> : null}.
                                  {" "}Le spese verranno mantenute ma il riferimento sarà azzerato.
                                </p>
                              );
                            })()}
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annulla</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del(it)} data-testid={`button-confirm-delete-${testidPrefix}-${it.id}`}>Elimina</AlertDialogAction>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica" : "Nuovo"}</DialogTitle>
            <DialogDescription>Seleziona una o più Ragioni Sociali a cui associare la voce.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {fields.map(f => (
              <div key={f.key}>
                <Label>{f.label}{f.required ? " *" : ""}</Label>
                {f.textarea ? (
                  <Textarea value={values[f.key] || ""} onChange={(e) => setValues(v => ({ ...v, [f.key]: e.target.value }))} rows={2} data-testid={`input-${testidPrefix}-${f.key}`} />
                ) : (
                  <Input value={values[f.key] || ""} onChange={(e) => setValues(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} data-testid={`input-${testidPrefix}-${f.key}`} />
                )}
              </div>
            ))}
            <div>
              <Label>Ragioni Sociali *</Label>
              <div className="rounded-md border p-2 max-h-48 overflow-y-auto space-y-1" data-testid={`rs-multiselect-${testidPrefix}`}>
                {ragioniSociali.map(rs => {
                  const checked = selectedRs.includes(rs.nome);
                  return (
                    <label key={`${rs.origine}-${rs.nome}`} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-muted cursor-pointer text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleRs(rs.nome, v === true)}
                        data-testid={`checkbox-${testidPrefix}-rs-${rs.nome}`}
                      />
                      <span className="flex-1">{rs.nome}</span>
                      {rs.origine === "pdv" && <Badge variant="outline" className="text-[10px]">da PDV</Badge>}
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{selectedRs.length} selezionata/e</p>
            </div>
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

// PDV: vista mista. Inherited (origine="config") sono read-only e gestiti in
// Amministrazione → Gestione Organizzazione. Manuali (origine="manuale") sono
// CRUD locali alla CdG e referenziati dalle spese via pdvCodice.
function PdvCrudView({
  pdvList, ragioniSociali, onGoToAdmin,
}: {
  pdvList: PdvFromConfig[];
  ragioniSociali: UnifiedRagioneSociale[];
  onGoToAdmin: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PdvFromConfig | null>(null);
  const [confirmDel, setConfirmDel] = useState<PdvFromConfig | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, PdvFromConfig[]>();
    for (const p of pdvList) {
      const key = p.ragioneSociale || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "it"));
  }, [pdvList]);

  const counts = useMemo(() => {
    let cfg = 0, man = 0;
    for (const p of pdvList) (p.origine === "manuale" ? man++ : cfg++);
    return { cfg, man };
  }, [pdvList]);

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ["/api/cdg/pdv-by-rs"] });
    // Le modifiche su PDV ereditati possono propagare rename su cdg_spese.
    qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
  };

  const del = async (p: PdvFromConfig) => {
    try {
      if (p.origine === "manuale" && p.id) {
        await apiJson("DELETE", `/api/cdg/pdv-manuali/${p.id}`);
      } else if (p.origine === "config") {
        const qs = `?rs=${encodeURIComponent(p.ragioneSociale)}&codice=${encodeURIComponent(p.codice)}`;
        await apiJson("DELETE", `/api/cdg/pdv-inherited${qs}`);
      } else {
        return;
      }
      toast({ title: "PDV eliminato" });
      onSaved();
      qc.invalidateQueries({ queryKey: ["/api/cdg/ragioni-sociali/unified"] });
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
    setConfirmDel(null);
  };

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1">
          <p>I PDV ereditati (badge <strong>da config</strong>) provengono dalla Gestione Organizzazione e sono di sola lettura. I PDV <strong>manuali</strong> sono creati qui e usati solo per imputare spese in Controllo di Gestione.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Totale: <strong>{pdvList.length}</strong> ({counts.cfg} ereditati + {counts.man} manuali) su <strong>{ragioniSociali.length}</strong> RS.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} data-testid="button-add-pdv-manuale">
            <Plus className="h-4 w-4 mr-1" /> Nuovo PDV
          </Button>
          <Button size="sm" variant="outline" onClick={onGoToAdmin} data-testid="button-go-admin-pdv">
            <ExternalLink className="h-4 w-4 mr-1" /> Gestisci ereditati
          </Button>
        </div>
      </div>
      {pdvList.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nessun PDV configurato.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([rs, items]) => (
            <div key={rs} className="rounded-md border" data-testid={`pdv-group-${rs}`}>
              <div className="px-3 py-2 bg-muted/50 border-b font-medium text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4" /> {rs}
                <Badge variant="outline" className="ml-auto">{items.length}</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Codice</TableHead>
                    <TableHead>Origine</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(p => {
                    const isManual = p.origine === "manuale";
                    return (
                      <TableRow key={`${p.origine}-${p.codice}`} data-testid={`row-pdv-${p.codice}`}>
                        <TableCell>{p.nome}</TableCell>
                        <TableCell className="font-mono text-xs">{p.codice}</TableCell>
                        <TableCell>
                          {isManual
                            ? <Badge variant="secondary" data-testid={`badge-pdv-origine-manuale-${p.codice}`}>manuale</Badge>
                            : <Badge variant="outline" data-testid={`badge-pdv-origine-config-${p.codice}`}>da config</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => { setEditing(p); setDialogOpen(true); }} data-testid={`button-edit-pdv-${p.codice}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDel(p)} data-testid={`button-delete-pdv-${p.codice}`}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}

      <PdvManualeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editing={editing}
        ragioniSociali={ragioniSociali}
        onSaved={onSaved}
      />

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare il PDV?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDel?.origine === "config" ? (
                <>
                  <strong>Attenzione:</strong> stai eliminando il PDV ereditato <strong>{confirmDel?.nome}</strong> ({confirmDel?.codice}) anche dalla Gestione Organizzazione. Le spese collegate manterranno il codice salvato ma il PDV non sarà più selezionabile.
                </>
              ) : (
                <>Stai per eliminare il PDV manuale <strong>{confirmDel?.nome}</strong> ({confirmDel?.codice}). Le spese che lo riferiscono manterranno il codice salvato ma il PDV non sarà più selezionabile.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-pdv">Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDel && del(confirmDel)} data-testid="button-confirm-delete-pdv">Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PdvManualeDialog({
  open, onClose, editing, ragioniSociali, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: PdvFromConfig | null;
  ragioniSociali: UnifiedRagioneSociale[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isInherited = editing?.origine === "config";
  const isEdit = !!editing && (isInherited || !!editing.id);
  const [rs, setRs] = useState<string>(editing?.ragioneSociale || ragioniSociali[0]?.nome || "");
  const [codice, setCodice] = useState<string>(editing?.codice || "");
  const [nome, setNome] = useState<string>(editing?.nome || "");
  const [indirizzo, setIndirizzo] = useState<string>(editing?.indirizzo || "");
  const [note, setNote] = useState<string>(editing?.note || "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setRs(editing?.ragioneSociale || ragioniSociali[0]?.nome || "");
      setCodice(editing?.codice || "");
      setNome(editing?.nome || "");
      setIndirizzo(editing?.indirizzo || "");
      setNote(editing?.note || "");
    }
  }, [open, editing, ragioniSociali]);

  const save = async () => {
    if (!rs.trim() || !codice.trim() || !nome.trim()) {
      toast({ title: "Compila Ragione Sociale, Codice e Nome", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && isInherited && editing) {
        // PDV ereditato: write-through su organization_config.puntiVendita.
        // Indirizzo/Note non vivono in config, vengono ignorati.
        const body: Record<string, string> = {
          ragioneSociale: editing.ragioneSociale,
          codice: editing.codice,
        };
        if (rs.trim() !== editing.ragioneSociale) body.newRagioneSociale = rs.trim();
        if (codice.trim() !== editing.codice) body.newCodice = codice.trim();
        if (nome.trim() !== editing.nome) body.newNome = nome.trim();
        await apiJson("PUT", `/api/cdg/pdv-inherited`, body);
        toast({ title: "PDV aggiornato" });
      } else {
        const body = {
          ragioneSociale: rs.trim(),
          codice: codice.trim(),
          nome: nome.trim(),
          indirizzo: indirizzo.trim() || null,
          note: note.trim() || null,
        };
        if (isEdit && editing?.id) {
          await apiJson<CdgPdvManuale>("PUT", `/api/cdg/pdv-manuali/${editing.id}`, body);
          toast({ title: "PDV aggiornato" });
        } else {
          await apiJson<CdgPdvManuale>("POST", `/api/cdg/pdv-manuali`, body);
          toast({ title: "PDV creato" });
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? (isInherited ? "Modifica PDV ereditato" : "Modifica PDV") : "Nuovo PDV manuale"}</DialogTitle>
          <DialogDescription>
            {isInherited
              ? "Le modifiche scrivono direttamente sulla Gestione Organizzazione (puntiVendita). Indirizzo e Note non sono memorizzati per i PDV ereditati."
              : isEdit ? "Aggiorna i dati del punto vendita manuale." : "Crea un PDV manuale visibile solo nel Controllo di Gestione."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Ragione Sociale *</Label>
            <Select value={rs} onValueChange={setRs}>
              <SelectTrigger data-testid="select-pdv-manuale-rs"><SelectValue placeholder="Seleziona RS" /></SelectTrigger>
              <SelectContent>
                {ragioniSociali.map(r => (
                  <SelectItem key={r.nome} value={r.nome}>{r.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Codice *</Label>
              <Input value={codice} onChange={(e) => setCodice(e.target.value)} placeholder="es. PDV001" data-testid="input-pdv-manuale-codice" />
            </div>
            <div>
              <Label>Nome *</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="es. Negozio Centro" data-testid="input-pdv-manuale-nome" />
            </div>
          </div>
          {!isInherited && (
            <>
              <div>
                <Label>Indirizzo</Label>
                <Input value={indirizzo} onChange={(e) => setIndirizzo(e.target.value)} data-testid="input-pdv-manuale-indirizzo" />
              </div>
              <div>
                <Label>Note</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} data-testid="input-pdv-manuale-note" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-pdv-manuale">Annulla</Button>
          <Button onClick={save} disabled={submitting} data-testid="button-save-pdv-manuale">
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
