import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiUrl } from "@/lib/basePath";
import { useLocation } from "wouter";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShoppingCart,
  Store,
  Search,
  Filter,
  Package,
  User,
  Calendar,
  ChevronRight,
  Euro,
  TrendingUp,
  Loader2,
  BarChart3,
  Smartphone,
  Wifi,
  Users,
  Shield,
  Lock,
  Zap,
  Tag,
  Wrench,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  Banknote,
  CreditCard,
  Landmark,
  FileText,
  Wallet,
  Download,
} from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { AppNavbar } from "@/components/AppNavbar";
import {
  type ArticleType,
  type PistaCanvass,
  type SaleClassification,
  classifySaleArticles,
  classifyCategory,
  PISTA_CANVASS_LABELS,
  PISTA_CANVASS_COLORS,
  TYPE_LABELS,
  TYPE_COLORS,
} from "@/lib/bisuiteClassification";

interface BisuiteSale {
  id: string;
  organizationId: string;
  bisuiteId: number;
  dataVendita: string | null;
  codicePos: string | null;
  nomeNegozio: string | null;
  ragioneSociale: string | null;
  nomeAddetto: string | null;
  nomeCliente: string | null;
  totale: string | null;
  stato: string | null;
  categorieArticoli: string | null;
  rawData: any;
  fetchedAt: string | null;
}

interface PdvSummary {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  totaleVendite: number;
  totaleImporto: number;
  countByType: Record<ArticleType, number>;
  amountByType: Record<ArticleType, number>;
  countByPista: Partial<Record<PistaCanvass, number>>;
  amountByPista: Partial<Record<PistaCanvass, number>>;
  vendite: BisuiteSale[];
}

const PISTA_ICONS: Record<PistaCanvass, React.ReactNode> = {
  mobile: <Smartphone className="h-3.5 w-3.5" />,
  fisso: <Wifi className="h-3.5 w-3.5" />,
  cb: <Users className="h-3.5 w-3.5" />,
  assicurazioni: <Shield className="h-3.5 w-3.5" />,
  protecta: <Lock className="h-3.5 w-3.5" />,
  energia: <Zap className="h-3.5 w-3.5" />,
};

interface IncassoTotals {
  contanti: number;
  pos: number;
  finanziato: number;
  var: number;
  nonScontrinato: number;
  nonScontrinatoPos: number;
  bonifici: number;
  assegni: number;
  buoni: number;
  coupon: number;
  altriPagamenti: number;
}

function computeIncassoTotals(salesList: BisuiteSale[]): IncassoTotals {
  const t: IncassoTotals = {
    contanti: 0, pos: 0, finanziato: 0, var: 0, nonScontrinato: 0, nonScontrinatoPos: 0,
    bonifici: 0, assegni: 0, buoni: 0, coupon: 0, altriPagamenti: 0,
  };
  for (const sale of salesList) {
    const pag = sale.rawData?.pagamento;
    if (pag) {
      t.contanti += parseFloat(pag.contanti || "0") || 0;
      t.pos += parseFloat(pag.pagamentiElettronici || "0") || 0;
      t.nonScontrinato += parseFloat(pag.nonScontrinato || "0") || 0;
      t.nonScontrinatoPos += parseFloat(pag.nonScontrinatoPos || "0") || 0;
      t.bonifici += parseFloat(pag.bonifici || "0") || 0;
      t.assegni += parseFloat(pag.assegni || "0") || 0;
      t.buoni += parseFloat(pag.buoni || "0") || 0;
      t.coupon += parseFloat(pag.coupon || "0") || 0;
      t.altriPagamenti += parseFloat(pag.altriPagamenti || "0") || 0;
    }
    const articoli = sale.rawData?.articoli;
    if (Array.isArray(articoli)) {
      for (const art of articoli) {
        const det = art?.dettaglio;
        if (!det) continue;
        const impFinanziato = parseFloat(det.importoFinanziato || "0") || 0;
        const impCredito = parseFloat(det.importoCredito || "0") || 0;
        if (impFinanziato > 0) t.finanziato += impFinanziato;
        if (impCredito > 0) t.var += impCredito;
      }
    }
  }
  return t;
}

const INCASSO_ITEMS_CONFIG: { key: keyof IncassoTotals; label: string; icon: string; color: string }[] = [
  { key: "contanti", label: "Contanti", icon: "banknote", color: "text-green-600" },
  { key: "pos", label: "POS", icon: "creditcard", color: "text-blue-600" },
  { key: "finanziato", label: "Finanziato", icon: "landmark", color: "text-purple-600" },
  { key: "var", label: "VAR", icon: "filetext", color: "text-amber-600" },
  { key: "nonScontrinato", label: "Non scont. Cont.", icon: "banknote", color: "text-red-600" },
  { key: "nonScontrinatoPos", label: "Non scont. POS", icon: "creditcard", color: "text-rose-600" },
  { key: "bonifici", label: "Bonifici", icon: "landmark", color: "text-teal-600" },
  { key: "assegni", label: "Assegni", icon: "filetext", color: "text-slate-600" },
  { key: "buoni", label: "Buoni", icon: "wallet", color: "text-orange-600" },
  { key: "coupon", label: "Coupon", icon: "tag", color: "text-pink-600" },
  { key: "altriPagamenti", label: "Altri Pag.", icon: "wallet", color: "text-gray-600" },
];

const INCASSO_ICON_MAP: Record<string, React.ReactNode> = {
  banknote: <Banknote className="h-3.5 w-3.5" />,
  creditcard: <CreditCard className="h-3.5 w-3.5" />,
  landmark: <Landmark className="h-3.5 w-3.5" />,
  filetext: <FileText className="h-3.5 w-3.5" />,
  wallet: <Wallet className="h-3.5 w-3.5" />,
  tag: <Tag className="h-3.5 w-3.5" />,
};

function IncassoBadges({ totals, formatter, compact }: { totals: IncassoTotals; formatter: (v: number) => string; compact?: boolean }) {
  const active = INCASSO_ITEMS_CONFIG.filter(i => totals[i.key] > 0);
  if (active.length === 0) return null;
  return (
    <div className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2 sm:gap-3"}`}>
      {active.map(item => (
        <div key={item.key} className={`flex items-center gap-1 ${compact ? "bg-muted/40 rounded px-1.5 py-0.5" : "bg-muted/50 rounded-lg px-2.5 py-1.5"}`} data-testid={`incasso-${item.key}`}>
          <span className={item.color}>{INCASSO_ICON_MAP[item.icon]}</span>
          <span className={`${compact ? "text-[10px]" : "text-xs"} text-muted-foreground`}>{item.label}</span>
          <span className={`${compact ? "text-[10px]" : "text-xs"} font-semibold ${item.color}`}>{formatter(totals[item.key])}</span>
        </div>
      ))}
    </div>
  );
}

function getDefaultDates() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  };
}

export default function VenditeBiSuite() {
  const { profile } = useAuth();
  const [, setLocation] = useLocation();
  const defaults = getDefaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPdv, setSelectedPdv] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<BisuiteSale | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPista, setFilterPista] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"vendite" | "addetti">("vendite");
  const [selectedAddetto, setSelectedAddetto] = useState<string | null>(null);

  const orgId = profile?.organizationId || "";
  const queryClient = useQueryClient();
  const [fetchResult, setFetchResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: credStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/bisuite-credentials-status"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/bisuite-credentials-status"), { credentials: "include" });
      if (!res.ok) return { configured: false };
      return res.json();
    },
    enabled: !!orgId,
  });

  const fetchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/bisuite-fetch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ start_date: fromDate, end_date: toDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore durante l'importazione");
      return data;
    },
    onSuccess: (data) => {
      setFetchResult({ success: true, message: data.message || `Importate ${data.count} vendite` });
      queryClient.invalidateQueries({ queryKey: ["/api/bisuite-sales"] });
      setTimeout(() => setFetchResult(null), 5000);
    },
    onError: (error: Error) => {
      setFetchResult({ success: false, message: error.message });
      setTimeout(() => setFetchResult(null), 8000);
    },
  });

  const { data, isLoading } = useQuery<{ sales: BisuiteSale[]; count: number }>({
    queryKey: ["/api/bisuite-sales", orgId, fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgId) params.set("organization_id", orgId);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const res = await fetch(apiUrl(`/api/bisuite-sales?${params.toString()}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Errore nel caricamento vendite");
      return res.json();
    },
    enabled: !!orgId,
  });

  const sales = data?.sales || [];

  const saleClassifications = useMemo(() => {
    const map = new Map<string, SaleClassification>();
    sales.forEach((s) => {
      map.set(s.id, classifySaleArticles(s.rawData));
    });
    return map;
  }, [sales]);

  const globalCounts = useMemo(() => {
    const byType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
    const amtByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
    const byPista: Partial<Record<PistaCanvass, number>> = {};
    const amtByPista: Partial<Record<PistaCanvass, number>> = {};
    let totalArticles = 0;
    const prodottiByCategory: Record<string, { pezzi: number; importo: number }> = {};
    const serviziByLabel: Record<string, { pezzi: number; importo: number }> = {};

    saleClassifications.forEach((sc) => {
      byType.canvass += sc.countByType.canvass;
      byType.prodotti += sc.countByType.prodotti;
      byType.servizi += sc.countByType.servizi;
      amtByType.canvass += sc.amountByType.canvass;
      amtByType.prodotti += sc.amountByType.prodotti;
      amtByType.servizi += sc.amountByType.servizi;
      totalArticles += sc.articles.length;

      for (const art of sc.articles) {
        if (art.type === 'prodotti' && art.categoriaNome) {
          const key = art.categoriaNome.toUpperCase();
          if (!prodottiByCategory[key]) prodottiByCategory[key] = { pezzi: 0, importo: 0 };
          prodottiByCategory[key].pezzi++;
          prodottiByCategory[key].importo += art.prezzo;
        }
        if (art.type === 'servizi' && art.descrizione) {
          if (!serviziByLabel[art.descrizione]) serviziByLabel[art.descrizione] = { pezzi: 0, importo: 0 };
          serviziByLabel[art.descrizione].pezzi++;
          serviziByLabel[art.descrizione].importo += art.prezzo;
        }
      }

      for (const [p, c] of Object.entries(sc.countByPista) as [PistaCanvass, number][]) {
        byPista[p] = (byPista[p] || 0) + c;
      }
      for (const [p, a] of Object.entries(sc.amountByPista) as [PistaCanvass, number][]) {
        amtByPista[p] = (amtByPista[p] || 0) + a;
      }
    });

    return { byType, amtByType, byPista, amtByPista, totalArticles, prodottiByCategory, serviziByLabel };
  }, [saleClassifications]);

  const pdvSummaries = useMemo(() => {
    const map: Record<string, PdvSummary> = {};
    sales.forEach((sale) => {
      const code = sale.codicePos || "N/D";
      if (!map[code]) {
        map[code] = {
          codicePos: code,
          nomeNegozio: sale.nomeNegozio || code,
          ragioneSociale: sale.ragioneSociale || "",
          totaleVendite: 0,
          totaleImporto: 0,
          countByType: { canvass: 0, prodotti: 0, servizi: 0 },
          amountByType: { canvass: 0, prodotti: 0, servizi: 0 },
          countByPista: {},
          amountByPista: {},
          vendite: [],
        };
      }
      map[code].totaleVendite++;
      map[code].totaleImporto += parseFloat(sale.totale || "0") || 0;
      map[code].vendite.push(sale);

      const sc = saleClassifications.get(sale.id);
      if (sc) {
        map[code].countByType.canvass += sc.countByType.canvass;
        map[code].countByType.prodotti += sc.countByType.prodotti;
        map[code].countByType.servizi += sc.countByType.servizi;
        map[code].amountByType.canvass += sc.amountByType.canvass;
        map[code].amountByType.prodotti += sc.amountByType.prodotti;
        map[code].amountByType.servizi += sc.amountByType.servizi;
        for (const [p, c] of Object.entries(sc.countByPista) as [PistaCanvass, number][]) {
          map[code].countByPista[p] = (map[code].countByPista[p] || 0) + c;
        }
        for (const [p, a] of Object.entries(sc.amountByPista) as [PistaCanvass, number][]) {
          map[code].amountByPista[p] = (map[code].amountByPista[p] || 0) + a;
        }
      }
    });
    return Object.values(map).sort((a, b) => b.totaleVendite - a.totaleVendite);
  }, [sales, saleClassifications]);

  const filteredSales = useMemo(() => {
    let filtered = selectedPdv
      ? sales.filter((s) => (s.codicePos || "N/D") === selectedPdv)
      : sales;

    if (filterType !== "all") {
      filtered = filtered.filter((s) => {
        const sc = saleClassifications.get(s.id);
        if (!sc) return false;
        return sc.countByType[filterType as ArticleType] > 0;
      });
    }

    if (filterPista !== "all") {
      filtered = filtered.filter((s) => {
        const sc = saleClassifications.get(s.id);
        if (!sc) return false;
        return (sc.countByPista[filterPista as PistaCanvass] || 0) > 0;
      });
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          (s.nomeCliente || "").toLowerCase().includes(term) ||
          (s.nomeAddetto || "").toLowerCase().includes(term) ||
          (s.codicePos || "").toLowerCase().includes(term) ||
          (s.nomeNegozio || "").toLowerCase().includes(term) ||
          (s.categorieArticoli || "").toLowerCase().includes(term) ||
          String(s.bisuiteId).includes(term)
      );
    }

    return filtered;
  }, [sales, selectedPdv, filterType, filterPista, searchTerm, saleClassifications]);

  const totaleImporto = sales.reduce(
    (sum, s) => sum + (parseFloat(s.totale || "0") || 0),
    0
  );

  const incassoTotals = useMemo(() => {
    const source = selectedPdv ? sales.filter(s => (s.codicePos || "N/D") === selectedPdv) : sales;
    return computeIncassoTotals(source);
  }, [sales, selectedPdv]);

  const incassoByPdv = useMemo(() => {
    const map = new Map<string, IncassoTotals>();
    const grouped = new Map<string, BisuiteSale[]>();
    for (const sale of sales) {
      const code = sale.codicePos || "N/D";
      if (!grouped.has(code)) grouped.set(code, []);
      grouped.get(code)!.push(sale);
    }
    for (const [code, pdvSales] of grouped) {
      map.set(code, computeIncassoTotals(pdvSales));
    }
    return map;
  }, [sales]);

  const rsSummaries = useMemo(() => {
    const map = new Map<string, { ragioneSociale: string; vendite: BisuiteSale[]; totaleImporto: number; pdvCodes: Set<string> }>();
    for (const sale of sales) {
      const rs = sale.ragioneSociale || "N/D";
      if (!map.has(rs)) map.set(rs, { ragioneSociale: rs, vendite: [], totaleImporto: 0, pdvCodes: new Set() });
      const entry = map.get(rs)!;
      entry.vendite.push(sale);
      entry.totaleImporto += parseFloat(sale.totale || "0") || 0;
      entry.pdvCodes.add(sale.codicePos || "N/D");
    }
    return Array.from(map.values()).sort((a, b) => b.vendite.length - a.vendite.length);
  }, [sales]);

  const addettoSummaries = useMemo(() => {
    const map = new Map<string, { nomeAddetto: string; vendite: BisuiteSale[]; totaleImporto: number; pdvCodes: Set<string> }>();
    for (const sale of sales) {
      const addetto = sale.nomeAddetto || "N/D";
      if (!map.has(addetto)) map.set(addetto, { nomeAddetto: addetto, vendite: [], totaleImporto: 0, pdvCodes: new Set() });
      const entry = map.get(addetto)!;
      entry.vendite.push(sale);
      entry.totaleImporto += parseFloat(sale.totale || "0") || 0;
      entry.pdvCodes.add(sale.codicePos || "N/D");
    }
    return Array.from(map.values()).sort((a, b) => b.vendite.length - a.vendite.length);
  }, [sales]);

  const allDomande = useMemo(() => {
    const set = new Set<string>();
    for (const sale of sales) {
      const articoli: any[] = sale.rawData?.articoli || [];
      for (const art of articoli) {
        const qas: any[] = art.dettaglio?.domandeRisposte || [];
        for (const qa of qas) {
          if (qa.domandaTesto) set.add(qa.domandaTesto);
        }
      }
    }
    return Array.from(set).sort();
  }, [sales]);

  const buildSaleRow = useCallback((sale: BisuiteSale) => {
    const raw = sale.rawData || {};
    const articoli: any[] = raw.articoli || [];
    const cliente = raw.cliente || {};
    const canvassArts = articoli.filter((a: any) => {
      const cls = classifyCategory((a.categoria?.nome || '').trim());
      return cls?.type === 'canvass';
    });
    const prodottiArts = articoli.filter((a: any) => {
      const cls = classifyCategory((a.categoria?.nome || '').trim());
      return cls?.type === 'prodotti' || cls?.type === 'servizi';
    });
    const domandeMap: Record<string, string> = {};
    for (const art of articoli) {
      const qas: any[] = art.dettaglio?.domandeRisposte || [];
      for (const qa of qas) {
        if (qa.domandaTesto && qa.risposta) {
          domandeMap[qa.domandaTesto] = qa.risposta;
        }
      }
    }
    return {
      catCanvass: [...new Set(canvassArts.map((a: any) => (a.categoria?.nome || '').trim()).filter(Boolean))].join(', '),
      tipCanvass: [...new Set(canvassArts.map((a: any) => (a.tipologia?.nome || '').trim()).filter(Boolean))].join(', '),
      descCanvass: canvassArts.map((a: any) => (a.descrizione || '').trim()).filter(Boolean).join(', '),
      catProdotto: [...new Set(prodottiArts.map((a: any) => (a.categoria?.nome || '').trim()).filter(Boolean))].join(', '),
      tipProdotto: [...new Set(prodottiArts.map((a: any) => (a.tipologia?.nome || '').trim()).filter(Boolean))].join(', '),
      descProdotto: prodottiArts.map((a: any) => (a.descrizione || '').trim()).filter(Boolean).join(', '),
      domandeMap,
      codiceContratto: String(raw.codiceEsterno || raw.id || ''),
      cf: cliente.codiceFiscale || '',
      piva: cliente.piva || '',
      nomeCliente: sale.nomeCliente || cliente.nominativo || '',
    };
  }, []);

  const exportExcelDettaglio = useCallback(() => {
    const rows: Record<string, any>[] = [];
    for (const sale of sales) {
      const r = buildSaleRow(sale);
      const row: Record<string, any> = {
        'Addetto': sale.nomeAddetto || '-',
        'Data': sale.dataVendita ? format(new Date(sale.dataVendita), "dd/MM/yyyy", { locale: it }) : '-',
        'Negozio': sale.nomeNegozio || '-',
        'Cod. POS': sale.codicePos || '-',
        'Stato': sale.stato || '-',
        'Cat. Canvass': r.catCanvass || '-',
        'Tip. Canvass': r.tipCanvass || '-',
        'Desc. Canvass': r.descCanvass || '-',
        'Cat. Prodotto': r.catProdotto || '-',
        'Tip. Prodotto': r.tipProdotto || '-',
        'Desc. Prodotto': r.descProdotto || '-',
      };
      for (const d of allDomande) {
        row[d] = r.domandeMap[d] || '';
      }
      row['Cod. Contratto'] = r.codiceContratto || '-';
      row['CF'] = r.cf || '-';
      row['P.IVA'] = r.piva || '-';
      row['Cliente'] = r.nomeCliente || '-';
      row['Importo'] = parseFloat(sale.totale || '0') || 0;
      rows.push(row);
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendite Dettaglio');
    XLSX.writeFile(wb, `vendite_dettaglio_${fromDate}_${toDate}.xlsx`);
  }, [sales, allDomande, buildSaleRow, fromDate, toDate]);

  const exportExcelPerAddetto = useCallback(() => {
    const rows: Record<string, any>[] = [];
    for (const addetto of addettoSummaries) {
      const row: Record<string, any> = {
        'Addetto': addetto.nomeAddetto,
        'N. Vendite': addetto.vendite.length,
        'Importo Totale': addetto.totaleImporto,
        'N. PDV': addetto.pdvCodes.size,
        'PDV': Array.from(addetto.pdvCodes).join(', '),
      };
      const canvassCounts: Record<string, number> = {};
      const prodottiCounts: Record<string, number> = {};
      const domandeSi: Record<string, number> = {};
      for (const sale of addetto.vendite) {
        const articoli: any[] = sale.rawData?.articoli || [];
        for (const art of articoli) {
          const catName = (art.categoria?.nome || '').trim();
          const cls = classifyCategory(catName);
          if (cls?.type === 'canvass') canvassCounts[catName] = (canvassCounts[catName] || 0) + 1;
          if (cls?.type === 'prodotti' || cls?.type === 'servizi') prodottiCounts[catName] = (prodottiCounts[catName] || 0) + 1;
          const qas: any[] = art.dettaglio?.domandeRisposte || [];
          for (const qa of qas) {
            if (qa.domandaTesto && qa.risposta?.toUpperCase() === 'SI') {
              domandeSi[qa.domandaTesto] = (domandeSi[qa.domandaTesto] || 0) + 1;
            }
          }
        }
      }
      row['Categorie Canvass'] = Object.entries(canvassCounts).map(([k, v]) => `${k} (${v})`).join(', ');
      row['Categorie Prodotto'] = Object.entries(prodottiCounts).map(([k, v]) => `${k} (${v})`).join(', ');
      for (const d of allDomande) {
        row[`SI: ${d}`] = domandeSi[d] || 0;
      }
      rows.push(row);
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Riepilogo Addetti');
    XLSX.writeFile(wb, `vendite_per_addetto_${fromDate}_${toDate}.xlsx`);
  }, [addettoSummaries, allDomande, fromDate, toDate]);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(val);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return format(new Date(dateStr), "dd/MM/yyyy", { locale: it });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Incentive W3" />

      <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {fetchResult && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${fetchResult.success ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {fetchResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            {fetchResult.message}
          </div>
        )}

        <div className="flex flex-wrap gap-2 sm:gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Da</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-[130px] sm:w-40"
              data-testid="input-from-date"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">A</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-[130px] sm:w-40"
              data-testid="input-to-date"
            />
          </div>
          {credStatus?.configured ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchMutation.mutate()}
              disabled={fetchMutation.isPending}
              data-testid="button-fetch-bisuite"
            >
              {fetchMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1.5" />
              )}
              {fetchMutation.isPending ? "Importazione..." : "Aggiorna Vendite"}
            </Button>
          ) : credStatus && !credStatus.configured ? (
            <div className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Credenziali BiSuite non configurate</span>
            </div>
          ) : null}
          <div className="space-y-1 flex-1 min-w-[150px] sm:min-w-[200px]">
            <Label className="text-xs">Cerca</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cliente, addetto, negozio, categoria..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
          </div>
          <div className="space-y-1 min-w-[120px] sm:min-w-[160px]">
            <Label className="text-xs">Tipo</Label>
            <Select value={filterType} onValueChange={(v) => { setFilterType(v); if (v !== 'canvass') setFilterPista('all'); }}>
              <SelectTrigger data-testid="select-tipo">
                <SelectValue placeholder="Tutti" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="all">Tutti i tipi</SelectItem>
                <SelectItem value="canvass">Canvass</SelectItem>
                <SelectItem value="prodotti">Prodotti</SelectItem>
                <SelectItem value="servizi">Servizi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(filterType === "canvass" || filterType === "all") && (
            <div className="space-y-1 min-w-[130px] sm:min-w-[180px]">
              <Label className="text-xs">Pista</Label>
              <Select value={filterPista} onValueChange={setFilterPista}>
                <SelectTrigger data-testid="select-pista">
                  <SelectValue placeholder="Tutte" />
                </SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  <SelectItem value="all">Tutte le piste</SelectItem>
                  {(Object.keys(PISTA_CANVASS_LABELS) as PistaCanvass[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PISTA_CANVASS_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedPdv && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedPdv(null)}
              data-testid="button-clear-pdv"
            >
              <Filter className="h-4 w-4 mr-1" />
              Rimuovi filtro PDV
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
              <Card>
                <CardContent className="p-3 sm:p-4 text-center">
                  <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5 mx-auto mb-1 text-primary" />
                  <p className="text-lg sm:text-2xl font-bold" data-testid="text-total-sales">
                    {sales.length}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Vendite Totali</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 sm:p-4 text-center">
                  <Euro className="h-4 w-4 sm:h-5 sm:w-5 mx-auto mb-1 text-green-500" />
                  <p
                    className="text-sm sm:text-2xl font-bold text-green-600"
                    data-testid="text-total-amount"
                  >
                    {formatCurrency(totaleImporto)}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Importo Totale</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 sm:p-4 text-center">
                  <Store className="h-4 w-4 sm:h-5 sm:w-5 mx-auto mb-1 text-blue-500" />
                  <p className="text-lg sm:text-2xl font-bold" data-testid="text-total-pdv">
                    {pdvSummaries.length}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Punti Vendita</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 sm:p-4 text-center">
                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 mx-auto mb-1 text-orange-500" />
                  <p className="text-sm sm:text-2xl font-bold" data-testid="text-avg-sale">
                    {sales.length > 0
                      ? formatCurrency(totaleImporto / sales.length)
                      : "€ 0"}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Media per Vendita</p>
                </CardContent>
              </Card>
            </div>

            {sales.length > 0 && (
              <Card>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Wallet className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">Modalità di Incasso{selectedPdv ? ` - ${pdvSummaries.find(p => p.codicePos === selectedPdv)?.nomeNegozio || selectedPdv}` : ""}</span>
                  </div>
                  <IncassoBadges totals={incassoTotals} formatter={formatCurrency} />
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
              <Card className="border-l-4 border-l-orange-500">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-orange-600" />
                      <span className="font-semibold text-sm">Canvass</span>
                    </div>
                    <Badge className={TYPE_COLORS.canvass + " text-sm font-bold"}>
                      {globalCounts.byType.canvass}
                    </Badge>
                  </div>
                  <p className="text-xs text-green-600 font-medium mb-3">{formatCurrency(globalCounts.amtByType.canvass)}</p>
                  <div className="space-y-1.5">
                    {(Object.entries(globalCounts.byPista) as [PistaCanvass, number][])
                      .sort(([, a], [, b]) => b - a)
                      .map(([pista, count]) => (
                        <div key={pista} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            {PISTA_ICONS[pista]}
                            <span>{PISTA_CANVASS_LABELS[pista]}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">{formatCurrency(globalCounts.amtByPista[pista] || 0)}</span>
                            <Badge variant="outline" className={PISTA_CANVASS_COLORS[pista] + " text-[10px]"}>
                              {count}
                            </Badge>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-slate-400">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-slate-600" />
                      <span className="font-semibold text-sm">Prodotti</span>
                    </div>
                    <Badge className={TYPE_COLORS.prodotti + " text-sm font-bold"}>
                      {globalCounts.byType.prodotti}
                    </Badge>
                  </div>
                  <p className="text-xs text-green-600 font-medium mb-2">{formatCurrency(globalCounts.amtByType.prodotti)}</p>
                  <div className="space-y-1">
                    {Object.entries(globalCounts.prodottiByCategory)
                      .sort(([, a], [, b]) => b.pezzi - a.pezzi)
                      .map(([cat, { pezzi, importo }]) => (
                        <div key={cat} className="flex items-center justify-between text-xs">
                          <span className="truncate mr-2 text-muted-foreground">{cat}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {importo > 0 && <span className="text-[10px] text-green-600">{formatCurrency(importo)}</span>}
                            <Badge variant="outline" className="text-[10px]">{pezzi}</Badge>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-cyan-500">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-cyan-600" />
                      <span className="font-semibold text-sm">Servizi</span>
                    </div>
                    <Badge className={TYPE_COLORS.servizi + " text-sm font-bold"}>
                      {globalCounts.byType.servizi}
                    </Badge>
                  </div>
                  <p className="text-xs text-green-600 font-medium mb-2">{formatCurrency(globalCounts.amtByType.servizi)}</p>
                  <div className="space-y-1">
                    {Object.entries(globalCounts.serviziByLabel)
                      .sort(([, a], [, b]) => b.pezzi - a.pezzi)
                      .map(([label, { pezzi, importo }]) => (
                        <div key={label} className="flex items-center justify-between text-xs">
                          <span className="truncate mr-2 text-muted-foreground">{label}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {importo > 0 && <span className="text-[10px] text-green-600">{formatCurrency(importo)}</span>}
                            <Badge variant="outline" className="text-[10px]">{pezzi}</Badge>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {!selectedPdv && rsSummaries.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-5 w-5 text-primary" />
                    Riepilogo per Ragione Sociale
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="multiple" className="space-y-2">
                    {rsSummaries.map((rs) => {
                      const rsIncasso = computeIncassoTotals(rs.vendite);
                      return (
                        <AccordionItem key={rs.ragioneSociale} value={rs.ragioneSociale} className="border rounded-lg px-2 sm:px-4">
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full pr-4 gap-1 sm:gap-2">
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                <div className="h-8 w-8 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
                                  <Users className="h-4 w-4 text-violet-600" />
                                </div>
                                <div className="text-left min-w-0">
                                  <div className="font-semibold text-sm truncate">{rs.ragioneSociale}</div>
                                  <div className="text-xs text-muted-foreground">{rs.pdvCodes.size} PDV</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 sm:gap-3 pl-10 sm:pl-0">
                                <Badge variant="outline" className="text-xs shrink-0">{rs.vendite.length} vendite</Badge>
                                <Badge className="text-xs bg-green-500/10 text-green-600 border-green-500/20 shrink-0">{formatCurrency(rs.totaleImporto)}</Badge>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-2 pb-2">
                              <IncassoBadges totals={rsIncasso} formatter={formatCurrency} compact />
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </CardContent>
              </Card>
            )}

            {!selectedPdv && (
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === "vendite" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { setViewMode("vendite"); setSelectedAddetto(null); }}
                  data-testid="button-view-vendite"
                >
                  <Store className="h-3.5 w-3.5 mr-1" />
                  Per PDV
                </Button>
                <Button
                  variant={viewMode === "addetti" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { setViewMode("addetti"); setSelectedPdv(null); }}
                  data-testid="button-view-addetti"
                >
                  <User className="h-3.5 w-3.5 mr-1" />
                  Per Addetto ({addettoSummaries.length})
                </Button>
              </div>
            )}

            {!selectedPdv && viewMode === "addetti" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between w-full">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <User className="h-5 w-5 text-primary" />
                      Riepilogo per Addetto
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={exportExcelDettaglio} data-testid="button-export-dettaglio-header">
                        <Download className="h-4 w-4 mr-1" /> Dettaglio
                      </Button>
                      <Button variant="outline" size="sm" onClick={exportExcelPerAddetto} data-testid="button-export-per-addetto-header">
                        <Download className="h-4 w-4 mr-1" /> Per Addetto
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {addettoSummaries.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">Nessun addetto trovato</p>
                  ) : selectedAddetto ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <User className="h-4 w-4 text-blue-600" />
                          </div>
                          <div>
                            <div className="font-semibold text-sm">{selectedAddetto}</div>
                            <div className="text-xs text-muted-foreground">
                              {addettoSummaries.find(a => a.nomeAddetto === selectedAddetto)?.vendite.length || 0} vendite ·{" "}
                              {formatCurrency(addettoSummaries.find(a => a.nomeAddetto === selectedAddetto)?.totaleImporto || 0)}
                            </div>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setSelectedAddetto(null)} data-testid="button-back-addetti">
                          <X className="h-4 w-4 mr-1" /> Torna alla lista
                        </Button>
                      </div>
                      <div className="overflow-x-auto -mx-2 sm:mx-0">
                        <ScrollArea className="h-[500px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[90px] sticky left-0 bg-background z-10">Data</TableHead>
                                <TableHead>Negozio</TableHead>
                                <TableHead>Stato</TableHead>
                                <TableHead>Cat. Canvass</TableHead>
                                <TableHead>Tip. Canvass</TableHead>
                                <TableHead>Desc. Canvass</TableHead>
                                <TableHead>Cat. Prodotto</TableHead>
                                <TableHead>Tip. Prodotto</TableHead>
                                <TableHead>Desc. Prodotto</TableHead>
                                {allDomande.map((d) => (
                                  <TableHead key={d} className="whitespace-nowrap text-[10px] max-w-[120px]" title={d}>{d.length > 20 ? d.slice(0, 20) + '…' : d}</TableHead>
                                ))}
                                <TableHead>Cod. Contratto</TableHead>
                                <TableHead>CF / P.IVA</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead className="text-right">Importo</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(addettoSummaries.find(a => a.nomeAddetto === selectedAddetto)?.vendite || []).map((sale) => {
                                const r = buildSaleRow(sale);
                                const cfPiva = [r.cf, r.piva].filter(Boolean).join(' / ');
                                return (
                                  <TableRow
                                    key={sale.id}
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => setSelectedSale(sale)}
                                    data-testid={`row-addetto-sale-${sale.bisuiteId}`}
                                  >
                                    <TableCell className="text-xs whitespace-nowrap sticky left-0 bg-background z-10">{formatDate(sale.dataVendita)}</TableCell>
                                    <TableCell>
                                      <div className="text-sm font-medium">{sale.nomeNegozio || '-'}</div>
                                      <div className="text-[10px] text-muted-foreground font-mono">{sale.codicePos || '-'}</div>
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className="text-[10px]">{sale.stato || '-'}</Badge>
                                    </TableCell>
                                    <TableCell className="text-xs max-w-[110px] truncate" title={r.catCanvass}>{r.catCanvass || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[110px] truncate" title={r.tipCanvass}>{r.tipCanvass || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[130px] truncate" title={r.descCanvass}>{r.descCanvass || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[110px] truncate" title={r.catProdotto}>{r.catProdotto || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[110px] truncate" title={r.tipProdotto}>{r.tipProdotto || '-'}</TableCell>
                                    <TableCell className="text-xs max-w-[130px] truncate" title={r.descProdotto}>{r.descProdotto || '-'}</TableCell>
                                    {allDomande.map((d) => (
                                      <TableCell key={d} className="text-xs text-center whitespace-nowrap">
                                        {r.domandeMap[d] ? (
                                          <Badge variant={r.domandeMap[d].toUpperCase() === 'SI' ? 'default' : 'outline'} className="text-[9px]">
                                            {r.domandeMap[d]}
                                          </Badge>
                                        ) : '-'}
                                      </TableCell>
                                    ))}
                                    <TableCell className="text-xs font-mono">{r.codiceContratto || '-'}</TableCell>
                                    <TableCell className="text-xs font-mono max-w-[130px] truncate" title={cfPiva}>{cfPiva || '-'}</TableCell>
                                    <TableCell className="text-sm">{r.nomeCliente || '-'}</TableCell>
                                    <TableCell className="text-right font-medium">{formatCurrency(parseFloat(sale.totale || '0') || 0)}</TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </div>
                    </div>
                  ) : (
                    <Accordion type="multiple" className="space-y-2">
                      {addettoSummaries.map((addetto) => (
                        <AccordionItem key={addetto.nomeAddetto} value={addetto.nomeAddetto} className="border rounded-lg px-2 sm:px-4">
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full pr-4 gap-1 sm:gap-2">
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                                  <User className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="text-left min-w-0">
                                  <div className="font-semibold text-sm truncate">{addetto.nomeAddetto}</div>
                                  <div className="text-xs text-muted-foreground">{addetto.pdvCodes.size} PDV</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 sm:gap-3 pl-10 sm:pl-0">
                                <Badge variant="outline" className="text-xs shrink-0">{addetto.vendite.length} vendite</Badge>
                                <Badge className="text-xs bg-green-500/10 text-green-600 border-green-500/20 shrink-0">{formatCurrency(addetto.totaleImporto)}</Badge>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pb-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedAddetto(addetto.nomeAddetto)}
                                data-testid={`button-view-addetto-${addetto.nomeAddetto}`}
                              >
                                Vedi dettaglio vendite
                                <ChevronRight className="h-4 w-4 ml-1" />
                              </Button>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </CardContent>
              </Card>
            )}

            {!selectedPdv && viewMode === "vendite" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Riepilogo per Punto Vendita
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {pdvSummaries.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      Nessuna vendita importata. Vai nel pannello Super Admin per
                      importare le vendite da BiSuite.
                    </p>
                  ) : (
                    <Accordion type="multiple" className="space-y-2">
                      {pdvSummaries.map((pdv) => (
                        <AccordionItem
                          key={pdv.codicePos}
                          value={pdv.codicePos}
                          className="border rounded-lg px-2 sm:px-4"
                        >
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full pr-4 gap-1 sm:gap-2">
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                  <Store className="h-4 w-4 text-primary" />
                                </div>
                                <div className="text-left min-w-0">
                                  <div className="font-semibold text-sm truncate">
                                    {pdv.nomeNegozio}
                                  </div>
                                  <div className="text-xs text-muted-foreground font-mono truncate">
                                    {pdv.codicePos}
                                    {pdv.ragioneSociale && (
                                      <span className="ml-2 font-sans">
                                        · {pdv.ragioneSociale}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 sm:gap-3 pl-10 sm:pl-0">
                                <Badge variant="outline" className="text-xs shrink-0">
                                  {pdv.totaleVendite} vendite
                                </Badge>
                                <Badge className="text-xs bg-green-500/10 text-green-600 border-green-500/20 shrink-0">
                                  {formatCurrency(pdv.totaleImporto)}
                                </Badge>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pb-2">
                              <div className="flex flex-wrap gap-2">
                                {(Object.entries(pdv.countByPista) as [PistaCanvass, number][])
                                  .filter(([, c]) => c > 0)
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([pista, count]) => (
                                    <Badge
                                      key={pista}
                                      className={PISTA_CANVASS_COLORS[pista] + " text-xs gap-1"}
                                    >
                                      {PISTA_ICONS[pista]}
                                      {PISTA_CANVASS_LABELS[pista]}: {count}
                                      <span className="text-[10px] opacity-75">({formatCurrency(pdv.amountByPista[pista] || 0)})</span>
                                    </Badge>
                                  ))}
                                {pdv.countByType.prodotti > 0 && (
                                  <Badge className={TYPE_COLORS.prodotti + " text-xs"}>
                                    Prodotti: {pdv.countByType.prodotti}
                                    <span className="text-[10px] opacity-75 ml-1">({formatCurrency(pdv.amountByType.prodotti)})</span>
                                  </Badge>
                                )}
                                {pdv.countByType.servizi > 0 && (
                                  <Badge className={TYPE_COLORS.servizi + " text-xs"}>
                                    Servizi: {pdv.countByType.servizi}
                                    <span className="text-[10px] opacity-75 ml-1">({formatCurrency(pdv.amountByType.servizi)})</span>
                                  </Badge>
                                )}
                              </div>
                              {(() => {
                                const pdvInc = incassoByPdv.get(pdv.codicePos);
                                if (!pdvInc) return null;
                                return (
                                  <div className="mt-1">
                                    <IncassoBadges totals={pdvInc} formatter={formatCurrency} compact />
                                  </div>
                                );
                              })()}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedPdv(pdv.codicePos)}
                                data-testid={`button-view-pdv-${pdv.codicePos}`}
                              >
                                Vedi tutte le vendite
                                <ChevronRight className="h-4 w-4 ml-1" />
                              </Button>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-5 w-5 text-primary" />
                  {selectedPdv
                    ? `Vendite - ${pdvSummaries.find((p) => p.codicePos === selectedPdv)?.nomeNegozio || selectedPdv}`
                    : "Tutte le Vendite"}
                  <Badge variant="outline" className="ml-2 text-xs">
                    {filteredSales.length} record
                  </Badge>
                  {selectedPdv && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 ml-auto"
                      onClick={() => setSelectedPdv(null)}
                      data-testid="button-close-pdv-filter"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredSales.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Nessuna vendita trovata per i filtri selezionati
                  </p>
                ) : (
                  <div className="overflow-x-auto -mx-2 sm:mx-0">
                  <ScrollArea className="h-[500px]">
                    <Table className="min-w-[500px] sm:min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[80px] sm:w-[100px]">Data</TableHead>
                          <TableHead>Negozio</TableHead>
                          <TableHead className="hidden md:table-cell">Addetto</TableHead>
                          <TableHead className="hidden lg:table-cell">Cliente</TableHead>
                          <TableHead>Pista / Tipo</TableHead>
                          <TableHead className="hidden sm:table-cell">Stato</TableHead>
                          <TableHead className="text-right">Importo</TableHead>
                          <TableHead className="w-[40px] sm:w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSales.map((sale) => {
                          const sc = saleClassifications.get(sale.id);
                          return (
                            <TableRow
                              key={sale.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => setSelectedSale(sale)}
                              data-testid={`row-sale-${sale.bisuiteId}`}
                            >
                              <TableCell className="text-xs whitespace-nowrap">
                                {formatDate(sale.dataVendita)}
                              </TableCell>
                              <TableCell>
                                <div className="text-sm font-medium">
                                  {sale.nomeNegozio || "-"}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {sale.codicePos || "-"}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm hidden md:table-cell">
                                {sale.nomeAddetto || "-"}
                              </TableCell>
                              <TableCell className="text-sm hidden lg:table-cell">
                                {sale.nomeCliente || "-"}
                              </TableCell>
                              <TableCell>
                                <SalePistaBadges classification={sc} />
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                <Badge
                                  variant={
                                    sale.stato === "FINALIZZATA IN CASSA"
                                      ? "default"
                                      : "outline"
                                  }
                                  className="text-[10px]"
                                >
                                  {sale.stato || "-"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(
                                  parseFloat(sale.totale || "0") || 0
                                )}
                              </TableCell>
                              <TableCell>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <SaleDetailDialog
        sale={selectedSale}
        classification={selectedSale ? saleClassifications.get(selectedSale.id) : undefined}
        onClose={() => setSelectedSale(null)}
      />
    </div>
  );
}

function SalePistaBadges({ classification }: { classification?: SaleClassification }) {
  if (!classification) return <span className="text-xs text-muted-foreground">-</span>;

  const pistaBadges = (Object.entries(classification.countByPista) as [PistaCanvass, number][])
    .filter(([, c]) => c > 0)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="flex flex-wrap gap-1">
      {pistaBadges.map(([pista, count]) => (
        <Badge
          key={pista}
          className={PISTA_CANVASS_COLORS[pista] + " text-[10px] px-1.5 py-0 gap-0.5"}
        >
          {PISTA_ICONS[pista]}
          {PISTA_CANVASS_LABELS[pista]}
          {count > 1 && <span className="ml-0.5 font-bold">x{count}</span>}
        </Badge>
      ))}
      {classification.countByType.prodotti > 0 && (
        <Badge className={TYPE_COLORS.prodotti + " text-[10px] px-1.5 py-0"}>
          Prod. {classification.countByType.prodotti > 1 ? `x${classification.countByType.prodotti}` : ""}
        </Badge>
      )}
      {classification.countByType.servizi > 0 && (
        <Badge className={TYPE_COLORS.servizi + " text-[10px] px-1.5 py-0"}>
          Serv. {classification.countByType.servizi > 1 ? `x${classification.countByType.servizi}` : ""}
        </Badge>
      )}
    </div>
  );
}

function SaleDetailDialog({
  sale,
  classification,
  onClose,
}: {
  sale: BisuiteSale | null;
  classification?: SaleClassification;
  onClose: () => void;
}) {
  if (!sale) return null;

  const raw = sale.rawData || {};
  const articoli = raw.articoli || [];
  const pagamento = raw.pagamento || {};
  const cliente = raw.cliente || {};

  const formatCurrency = (val: string | number) => {
    const num = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(num)) return "€ 0,00";
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(num);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "-";
    try {
      return format(new Date(dateStr), "dd/MM/yyyy HH:mm", { locale: it });
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={!!sale} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-6xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Vendita #{sale.bisuiteId}
            <Badge variant="outline" className="ml-2">
              {sale.stato}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InfoBlock
              icon={<Calendar className="h-4 w-4" />}
              label="Data Vendita"
              value={formatDate(sale.dataVendita)}
            />
            <InfoBlock
              icon={<Store className="h-4 w-4" />}
              label="Negozio"
              value={sale.nomeNegozio || "-"}
              sub={sale.codicePos || undefined}
            />
            <InfoBlock
              icon={<User className="h-4 w-4" />}
              label="Addetto"
              value={sale.nomeAddetto || "-"}
            />
            <InfoBlock
              icon={<Euro className="h-4 w-4" />}
              label="Totale"
              value={formatCurrency(sale.totale || "0")}
              highlight
            />
          </div>

          {classification && (
            <div className="flex flex-wrap gap-2">
              <SalePistaBadges classification={classification} />
            </div>
          )}

          {cliente.nominativo && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Cliente
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Nome</span>
                    <p className="font-medium">{cliente.nominativo}</p>
                  </div>
                  {cliente.codiceFiscale && (
                    <div>
                      <span className="text-muted-foreground text-xs">CF</span>
                      <p className="font-mono text-xs">{cliente.codiceFiscale}</p>
                    </div>
                  )}
                  {cliente.tel1 && (
                    <div>
                      <span className="text-muted-foreground text-xs">Tel</span>
                      <p>{cliente.tel1}</p>
                    </div>
                  )}
                  {cliente.email && (
                    <div>
                      <span className="text-muted-foreground text-xs">Email</span>
                      <p className="text-xs">{cliente.email}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {articoli.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Articoli ({articoli.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-3">
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrizione</TableHead>
                      <TableHead className="hidden sm:table-cell">Categoria</TableHead>
                      <TableHead className="hidden md:table-cell">Tipologia</TableHead>
                      <TableHead>Pista</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Canone</TableHead>
                      <TableHead className="text-right">Prezzo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {articoli.map((art: any, idx: number) => {
                      const catNome = (art.categoria?.nome || '').trim();
                      const cls = classifyCategory(catNome);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-sm font-medium">
                            {art.descrizione || art.codice || "-"}
                            {art.marca && (
                              <span className="text-xs text-muted-foreground ml-1">
                                ({art.marca})
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {cls ? (
                              <Badge className={cls.pista ? PISTA_CANVASS_COLORS[cls.pista] : TYPE_COLORS[cls.type] + " text-xs"}>
                                {art.categoria?.nome || "-"}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                {art.categoria?.nome || "-"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs hidden md:table-cell">
                            {art.tipologia?.nome || "-"}
                          </TableCell>
                          <TableCell>
                            {cls?.pista ? (
                              <Badge className={PISTA_CANVASS_COLORS[cls.pista] + " text-[10px] gap-0.5"}>
                                {PISTA_ICONS[cls.pista]}
                                {PISTA_CANVASS_LABELS[cls.pista]}
                              </Badge>
                            ) : cls ? (
                              <Badge className={TYPE_COLORS[cls.type] + " text-[10px]"}>
                                {TYPE_LABELS[cls.type]}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm hidden sm:table-cell">
                            {art.dettaglio?.canone &&
                            art.dettaglio.canone !== "0" &&
                            art.dettaglio.canone !== "0.00"
                              ? `${formatCurrency(art.dettaglio.canone)}/mese`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatCurrency(art.dettaglio?.prezzo || "0")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>

                {articoli.some(
                  (a: any) =>
                    a.dettaglio?.domandeRisposte &&
                    a.dettaglio.domandeRisposte.length > 0
                ) && (
                  <details className="mt-3">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Domande / Risposte per articolo
                    </summary>
                    <div className="mt-2 space-y-2">
                      {articoli
                        .filter(
                          (a: any) =>
                            a.dettaglio?.domandeRisposte?.length > 0
                        )
                        .map((art: any, idx: number) => (
                          <div
                            key={idx}
                            className="bg-muted/30 rounded p-2 text-xs"
                          >
                            <p className="font-medium mb-1">
                              {art.descrizione}
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                              {art.dettaglio.domandeRisposte.map(
                                (qr: any, qIdx: number) => (
                                  <div key={qIdx}>
                                    <span className="text-muted-foreground">
                                      {qr.domandaTesto}:
                                    </span>{" "}
                                    <span
                                      className={
                                        qr.risposta === "SI"
                                          ? "text-green-600 font-medium"
                                          : ""
                                      }
                                    >
                                      {qr.risposta}
                                    </span>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          )}

          {pagamento && Object.keys(pagamento).filter(k => k !== "id").length > 0 && (() => {
            const saleIncasso = computeIncassoTotals([sale]);
            const fmtC = (val: number) => {
              if (isNaN(val)) return "€ 0,00";
              return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(val);
            };
            return (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    Modalità di Incasso
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <IncassoBadges totals={saleIncasso} formatter={fmtC} compact />
                </CardContent>
              </Card>
            );
          })()}

          {pagamento && Object.keys(pagamento).filter(k => k !== "id").length > 0 && (
            <details>
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Dettaglio Pagamento (raw)
              </summary>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-muted/30 rounded p-3">
                {Object.entries(pagamento)
                  .filter(([k]) => k !== "id")
                  .map(([key, val]) => (
                    <div key={key}>
                      <span className="text-muted-foreground">{key}:</span>{" "}
                      <span className="font-medium">
                        {formatCurrency(val as string)}
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoBlock({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p
        className={`text-sm font-medium ${highlight ? "text-green-600" : ""}`}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs text-muted-foreground font-mono">{sub}</p>
      )}
    </div>
  );
}
