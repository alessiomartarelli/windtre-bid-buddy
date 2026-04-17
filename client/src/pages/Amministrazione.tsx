import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/basePath";
import { AppNavbar } from "@/components/AppNavbar";
import {
  computeIncassoTotals,
  INCASSO_ITEMS_CONFIG,
  toNum,
  classifyIvaArticolo,
  isArticoloFiscale,
  type IncassoTotals,
  type RawSaleData,
  type ArticoloRaw,
  type IvaCategoria,
} from "@/lib/incassoUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import {
  BookOpen, Receipt, Loader2, Download, Search, AlertTriangle, HelpCircle, FileText,
  Calendar, CalendarDays, Store, Building2,
} from "lucide-react";
import * as XLSX from "xlsx";

type TabKey = "contabile" | "iva";
const TAB_KEYS: TabKey[] = ["contabile", "iva"];
function isTabKey(v: string): v is TabKey {
  return (TAB_KEYS as string[]).includes(v);
}

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
  rawData: RawSaleData | null;
}

const MONTH_LABELS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

function periodToDateRange(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = `${year}-${pad(month)}-01T00:00:00`;
  const last = new Date(year, month, 0);
  const lastStr = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}T23:59:59`;
  return { from: first, to: lastStr };
}

const fmtCurrency = (v: number) =>
  v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

const fmtDate = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("it-IT");
};

interface ContabileRow {
  saleId: string;
  bisuiteId: number;
  data: string | null;
  dataMs: number;
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  nomeAddetto: string;
  nomeCliente: string;
  matricolaFiscale: string;
  totale: number;
  incasso: IncassoTotals;
}

interface IvaRow {
  saleId: string;
  bisuiteId: number;
  data: string | null;
  dataMs: number;
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  nomeCliente: string;
  codiceArticolo: string;
  categoria: string;
  tipologia: string;
  descrizione: string;
  tipo: string;
  /** Aliquota normalizzata (4/5/10/22 se standard, valore esatto se non std). */
  aliquota: number;
  /** Aliquota grezza calcolata dagli importi, prima dello snap. */
  aliquotaCalcolata: number;
  imponibile: number;
  imposta: number;
  lordo: number;
  fiscalCategory: IvaCategoria;
  naturaCode: string | null;
}

const FISCAL_CATEGORY_LABELS: Record<IvaCategoria, string> = {
  standard: "Standard",
  non_standard: "Non standard",
  natura: "Non imponibile",
  da_verificare: "Da verificare",
  fuori_scontrino: "Fuori scontrino",
};

const FISCAL_CATEGORY_BADGE: Record<IvaCategoria, "default" | "secondary" | "destructive" | "outline"> = {
  standard: "default",
  non_standard: "destructive",
  natura: "secondary",
  da_verificare: "destructive",
  fuori_scontrino: "outline",
};

const FISCAL_CATEGORY_SHORT: Record<IvaCategoria, string> = {
  standard: "STD",
  non_standard: "N-STD",
  natura: "N.IMP",
  da_verificare: "VRF",
  fuori_scontrino: "F.SC",
};

function buildContabileRows(sales: BisuiteSale[]): ContabileRow[] {
  return sales.map((s) => {
    const matricolaFiscale =
      s.rawData?.matricolaFiscale ??
      s.rawData?.matricola_fiscale ??
      s.rawData?.matricola ??
      s.rawData?.negozio?.matricolaFiscale ??
      s.rawData?.negozio?.matricola ??
      "";
    const dataMs = s.dataVendita ? new Date(s.dataVendita).getTime() : 0;
    return {
      saleId: s.id,
      bisuiteId: s.bisuiteId,
      data: s.dataVendita,
      dataMs: isNaN(dataMs) ? 0 : dataMs,
      codicePos: s.codicePos || "",
      nomeNegozio: s.nomeNegozio || "",
      ragioneSociale: s.ragioneSociale || "",
      nomeAddetto: s.nomeAddetto || "",
      nomeCliente: s.nomeCliente || "",
      matricolaFiscale: String(matricolaFiscale ?? ""),
      totale: toNum(s.totale),
      incasso: computeIncassoTotals([s]),
    };
  }).sort((a, b) => a.dataMs - b.dataMs || a.bisuiteId - b.bisuiteId);
}

function buildIvaRows(sales: BisuiteSale[]): IvaRow[] {
  const rows: IvaRow[] = [];
  for (const s of sales) {
    const articoli: ArticoloRaw[] = Array.isArray(s.rawData?.articoli) ? s.rawData!.articoli! : [];
    const dataMs = s.dataVendita ? new Date(s.dataVendita).getTime() : 0;
    for (const art of articoli) {
      // Filtro fiscale: solo Prodotti (P) e Servizi (S) producono importi nello scontrino.
      // Gli articoli Canvass (tipo "C": MIA TIED, ENERGIA W3, FIBRA CF, ASSICURAZIONI...)
      // sono procacciamenti / contratti e vengono fatturati a parte: NON entrano nella prima nota IVA.
      if (!isArticoloFiscale(art)) continue;

      const calc = classifyIvaArticolo(art?.dettaglio);

      rows.push({
        saleId: s.id,
        bisuiteId: s.bisuiteId,
        data: s.dataVendita,
        dataMs: isNaN(dataMs) ? 0 : dataMs,
        codicePos: s.codicePos || "",
        nomeNegozio: s.nomeNegozio || "",
        ragioneSociale: s.ragioneSociale || "",
        nomeCliente: s.nomeCliente || "",
        codiceArticolo: String(art?.codiceArticolo ?? art?.codice ?? "").trim(),
        categoria: (art?.categoria?.nome || "").trim(),
        tipologia: (art?.tipologia?.nome || "").trim(),
        descrizione: (art?.descrizione || "").trim(),
        tipo: String(art?.tipo || "").toUpperCase(),
        aliquota: calc.aliquotaNormalizzata,
        aliquotaCalcolata: calc.aliquotaCalcolata,
        imponibile: calc.imponibile,
        imposta: calc.imposta,
        lordo: calc.lordo,
        fiscalCategory: calc.categoria,
        naturaCode: calc.naturaCode,
      });
    }
  }
  return rows.sort((a, b) => a.dataMs - b.dataMs || a.bisuiteId - b.bisuiteId);
}

interface ContabileExportRow {
  Data: string;
  "ID Scontrino": number | string;
  "Codice POS": string;
  "Punto Vendita": string;
  "Ragione Sociale": string;
  "Matricola Fiscale": string;
  Addetto: string;
  Cliente: string;
  Totale: number | string;
  Contanti: number | string;
  POS: number | string;
  Finanziato: number | string;
  "VAR/Credito": number | string;
  "Non Scontr. Cont.": number | string;
  "Non Scontr. POS": number | string;
  Bonifici: number | string;
  Assegni: number | string;
  Buoni: number | string;
  Coupon: number | string;
  "Altri Pagamenti": number | string;
}

interface IvaExportRow {
  Data: string;
  "ID Scontrino": number;
  "Codice POS": string;
  "Punto Vendita": string;
  "Ragione Sociale": string;
  Cliente: string;
  "Codice Articolo": string;
  Categoria: string;
  Tipologia: string;
  Descrizione: string;
  Tipo: string;
  "Categoria Fiscale": string;
  Natura: string;
  "Aliquota %": number | string;
  "Aliquota Calcolata %": number | string;
  Imponibile: number | string;
  Imposta: number | string;
  Lordo: number | string;
}

interface RiepilogoIvaRow {
  Gruppo: string;
  Pezzi: number;
  Imponibile: number | string;
  Imposta: number | string;
  Lordo: number | string;
}

interface RiepilogoPagamentoRow {
  "Metodo Pagamento": string;
  Importo: number;
}

export default function Amministrazione() {
  const { profile, loading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [filterPdv, setFilterPdv] = useState<string>("all");
  const [filterRs, setFilterRs] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabKey>("contabile");
  const [escludiZero, setEscludiZero] = useState<boolean>(false);
  const [ivaCategoryFilter, setIvaCategoryFilter] = useState<IvaCategoria | "all">("all");
  const [selectedRs, setSelectedRs] = useState<string>("all");

  const orgId = profile?.organizationId || "";
  const isAuthorized = !!profile && ["admin", "super_admin"].includes(profile.role);

  useEffect(() => {
    if (!loading && profile && !isAuthorized) {
      toast({
        title: "Accesso non autorizzato",
        description: "Solo amministratori possono accedere alla pagina Amministrazione.",
        variant: "destructive",
      });
      setLocation("/");
    }
  }, [loading, profile, isAuthorized, toast, setLocation]);

  const { from: fromDate, to: toDate } = useMemo(
    () => periodToDateRange(year, month),
    [year, month],
  );

  const { data, isLoading } = useQuery<{ sales: BisuiteSale[]; count: number }>({
    queryKey: ["/api/bisuite-sales", orgId, fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgId) params.set("organization_id", orgId);
      params.set("from", fromDate);
      params.set("to", toDate);
      const res = await fetch(apiUrl(`/api/bisuite-sales?${params.toString()}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Errore nel caricamento vendite");
      return res.json();
    },
    enabled: !!orgId && isAuthorized,
  });

  const sales = data?.sales || [];

  const pdvOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sales) {
      const code = s.codicePos || "N/D";
      if (!map.has(code)) map.set(code, s.nomeNegozio || code);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sales]);

  const rsOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sales) if (s.ragioneSociale) set.add(s.ragioneSociale);
    return Array.from(set).sort();
  }, [sales]);

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur - 2, cur - 1, cur, cur + 1];
  }, []);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (filterPdv !== "all" && (s.codicePos || "N/D") !== filterPdv) return false;
      if (filterRs !== "all" && (s.ragioneSociale || "") !== filterRs) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = [
          s.codicePos, s.nomeNegozio, s.ragioneSociale, s.nomeAddetto, s.nomeCliente,
          String(s.bisuiteId),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [sales, filterPdv, filterRs, search]);

  const contabileRows = useMemo(() => buildContabileRows(filteredSales), [filteredSales]);
  const ivaRowsAll = useMemo(() => buildIvaRows(filteredSales), [filteredSales]);
  const ivaRows = useMemo(() => {
    let rows = ivaRowsAll;
    if (escludiZero) rows = rows.filter((r) => r.fiscalCategory !== "fuori_scontrino");
    if (ivaCategoryFilter !== "all") rows = rows.filter((r) => r.fiscalCategory === ivaCategoryFilter);
    return rows;
  }, [ivaRowsAll, escludiZero, ivaCategoryFilter]);

  const ivaAlerts = useMemo(() => {
    const nonStdSales = new Set<string>();
    const daVerSales = new Set<string>();
    let nonStdLordo = 0;
    let daVerLordo = 0;
    for (const r of ivaRowsAll) {
      if (r.fiscalCategory === "non_standard") {
        nonStdSales.add(r.saleId);
        nonStdLordo += r.lordo;
      } else if (r.fiscalCategory === "da_verificare") {
        daVerSales.add(r.saleId);
        daVerLordo += r.lordo;
      }
    }
    return {
      nonStandard: { scontrini: nonStdSales.size, lordo: nonStdLordo },
      daVerificare: { scontrini: daVerSales.size, lordo: daVerLordo },
    };
  }, [ivaRowsAll]);

  const goToIvaCategory = (cat: IvaCategoria) => {
    setIvaCategoryFilter(cat);
    setTab("iva");
  };

  interface RiepilogoBucket {
    pezzi: number;
    imponibile: number;
    imposta: number;
    lordo: number;
  }

  type IvaRiepilogo = {
    standardArr: Array<{ aliquota: number } & RiepilogoBucket>;
    nonStandardArr: Array<{ aliquota: number } & RiepilogoBucket>;
    naturaArr: Array<{ code: string } & RiepilogoBucket>;
    daVerificare: RiepilogoBucket;
    fuoriScontrino: RiepilogoBucket;
  };

  const computeIvaRiepilogo = (rows: IvaRow[]): IvaRiepilogo => {
    const standard = new Map<number, RiepilogoBucket>();
    const natura = new Map<string, RiepilogoBucket>();
    const nonStandard = new Map<number, RiepilogoBucket>();
    const daVerificare: RiepilogoBucket = { pezzi: 0, imponibile: 0, imposta: 0, lordo: 0 };
    const fuoriScontrino: RiepilogoBucket = { pezzi: 0, imponibile: 0, imposta: 0, lordo: 0 };

    const addTo = (b: RiepilogoBucket, r: IvaRow) => {
      b.pezzi++;
      b.imponibile += r.imponibile;
      b.imposta += r.imposta;
      b.lordo += r.lordo;
    };
    const ensure = <K,>(map: Map<K, RiepilogoBucket>, k: K): RiepilogoBucket => {
      let b = map.get(k);
      if (!b) { b = { pezzi: 0, imponibile: 0, imposta: 0, lordo: 0 }; map.set(k, b); }
      return b;
    };

    for (const r of rows) {
      switch (r.fiscalCategory) {
        case "standard": addTo(ensure(standard, r.aliquota), r); break;
        case "non_standard": addTo(ensure(nonStandard, r.aliquota), r); break;
        case "natura": addTo(ensure(natura, r.naturaCode || "N/D"), r); break;
        case "da_verificare": addTo(daVerificare, r); break;
        case "fuori_scontrino": addTo(fuoriScontrino, r); break;
      }
    }

    return {
      standardArr: Array.from(standard.entries()).map(([aliquota, b]) => ({ aliquota, ...b })).sort((a, b) => a.aliquota - b.aliquota),
      nonStandardArr: Array.from(nonStandard.entries()).map(([aliquota, b]) => ({ aliquota, ...b })).sort((a, b) => a.aliquota - b.aliquota),
      naturaArr: Array.from(natura.entries()).map(([code, b]) => ({ code, ...b })).sort((a, b) => a.code.localeCompare(b.code)),
      daVerificare,
      fuoriScontrino,
    };
  };

  const computeIvaTotals = (r: IvaRiepilogo) => {
    const t = { imponibile: 0, imposta: 0, lordo: 0, pezzi: 0 };
    for (const e of r.standardArr) { t.imponibile += e.imponibile; t.imposta += e.imposta; t.lordo += e.lordo; t.pezzi += e.pezzi; }
    for (const e of r.nonStandardArr) { t.imponibile += e.imponibile; t.imposta += e.imposta; t.lordo += e.lordo; t.pezzi += e.pezzi; }
    for (const e of r.naturaArr) { t.imponibile += e.imponibile; t.lordo += e.lordo; t.pezzi += e.pezzi; }
    return t;
  };

  const contabileTotals = useMemo<{ totale: number; incasso: IncassoTotals }>(() => {
    return {
      totale: contabileRows.reduce((s, r) => s + r.totale, 0),
      incasso: computeIncassoTotals(filteredSales),
    };
  }, [contabileRows, filteredSales]);

  const ivaRiepilogo = useMemo(() => computeIvaRiepilogo(ivaRowsAll), [ivaRowsAll]);
  const ivaTotals = useMemo(() => computeIvaTotals(ivaRiepilogo), [ivaRiepilogo]);

  // Per-Ragione-Sociale grouping for sectioned views
  const rsGroups = useMemo(() => {
    const bySales = new Map<string, BisuiteSale[]>();
    for (const s of filteredSales) {
      const k = s.ragioneSociale || "— Senza Ragione Sociale —";
      const arr = bySales.get(k);
      if (arr) arr.push(s); else bySales.set(k, [s]);
    }
    const groups = Array.from(bySales.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rs, gSales]) => {
        const gContabileRows = buildContabileRows(gSales);
        const gIvaRowsAll = buildIvaRows(gSales);
        let gIvaRows = gIvaRowsAll;
        if (escludiZero) gIvaRows = gIvaRows.filter((r) => r.fiscalCategory !== "fuori_scontrino");
        if (ivaCategoryFilter !== "all") gIvaRows = gIvaRows.filter((r) => r.fiscalCategory === ivaCategoryFilter);
        const gRiepilogo = computeIvaRiepilogo(gIvaRowsAll);
        return {
          rs,
          sales: gSales,
          contabileRows: gContabileRows,
          contabileTotals: {
            totale: gContabileRows.reduce((s, r) => s + r.totale, 0),
            incasso: computeIncassoTotals(gSales),
          },
          ivaRowsAll: gIvaRowsAll,
          ivaRows: gIvaRows,
          ivaRiepilogo: gRiepilogo,
          ivaTotals: computeIvaTotals(gRiepilogo),
        };
      });
    return groups;
  }, [filteredSales, escludiZero, ivaCategoryFilter]);

  const displayedRsGroups = useMemo(
    () => (selectedRs === "all" ? rsGroups : rsGroups.filter((g) => g.rs === selectedRs)),
    [rsGroups, selectedRs],
  );

  useEffect(() => {
    if (selectedRs !== "all" && !rsGroups.some((g) => g.rs === selectedRs)) {
      setSelectedRs("all");
    }
  }, [rsGroups, selectedRs]);

  const periodSuffix = `${year}_${String(month).padStart(2, "0")}`;

  const exportContabile = () => {
    const wb = XLSX.utils.book_new();
    const dettaglio: ContabileExportRow[] = contabileRows.map((r) => ({
      "Data": fmtDate(r.data),
      "ID Scontrino": r.bisuiteId,
      "Codice POS": r.codicePos,
      "Punto Vendita": r.nomeNegozio,
      "Ragione Sociale": r.ragioneSociale,
      "Matricola Fiscale": r.matricolaFiscale,
      "Addetto": r.nomeAddetto,
      "Cliente": r.nomeCliente,
      "Totale": r.totale,
      "Contanti": r.incasso.contanti,
      "POS": r.incasso.pos,
      "Finanziato": r.incasso.finanziato,
      "VAR/Credito": r.incasso.var,
      "Non Scontr. Cont.": r.incasso.nonScontrinato,
      "Non Scontr. POS": r.incasso.nonScontrinatoPos,
      "Bonifici": r.incasso.bonifici,
      "Assegni": r.incasso.assegni,
      "Buoni": r.incasso.buoni,
      "Coupon": r.incasso.coupon,
      "Altri Pagamenti": r.incasso.altriPagamenti,
    }));
    const totalsRow: ContabileExportRow = {
      "Data": "TOTALE",
      "ID Scontrino": "",
      "Codice POS": "",
      "Punto Vendita": "",
      "Ragione Sociale": "",
      "Matricola Fiscale": "",
      "Addetto": "",
      "Cliente": "",
      "Totale": contabileTotals.totale,
      "Contanti": contabileTotals.incasso.contanti,
      "POS": contabileTotals.incasso.pos,
      "Finanziato": contabileTotals.incasso.finanziato,
      "VAR/Credito": contabileTotals.incasso.var,
      "Non Scontr. Cont.": contabileTotals.incasso.nonScontrinato,
      "Non Scontr. POS": contabileTotals.incasso.nonScontrinatoPos,
      "Bonifici": contabileTotals.incasso.bonifici,
      "Assegni": contabileTotals.incasso.assegni,
      "Buoni": contabileTotals.incasso.buoni,
      "Coupon": contabileTotals.incasso.coupon,
      "Altri Pagamenti": contabileTotals.incasso.altriPagamenti,
    };
    dettaglio.push(totalsRow);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dettaglio), "Prima Nota Contabile");

    const summary: RiepilogoPagamentoRow[] = INCASSO_ITEMS_CONFIG.map((cfg) => ({
      "Metodo Pagamento": cfg.label,
      "Importo": contabileTotals.incasso[cfg.key],
    }));
    summary.push({ "Metodo Pagamento": "TOTALE", "Importo": contabileTotals.totale });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Riepilogo Pagamenti");

    XLSX.writeFile(wb, `prima_nota_contabile_${periodSuffix}.xlsx`);
  };

  const exportIva = () => {
    const wb = XLSX.utils.book_new();
    const isFiscalAmount = (cat: IvaCategoria) =>
      cat === "standard" || cat === "non_standard" || cat === "natura";

    const dettaglio: IvaExportRow[] = ivaRows.map((r) => ({
      "Data": fmtDate(r.data),
      "ID Scontrino": r.bisuiteId,
      "Codice POS": r.codicePos,
      "Punto Vendita": r.nomeNegozio,
      "Ragione Sociale": r.ragioneSociale,
      "Cliente": r.nomeCliente,
      "Codice Articolo": r.codiceArticolo,
      "Categoria": r.categoria,
      "Tipologia": r.tipologia,
      "Descrizione": r.descrizione,
      "Tipo": r.tipo,
      "Categoria Fiscale": FISCAL_CATEGORY_LABELS[r.fiscalCategory],
      "Natura": r.naturaCode || "",
      "Aliquota %":
        r.fiscalCategory === "standard" || r.fiscalCategory === "non_standard"
          ? r.aliquota
          : "",
      "Aliquota Calcolata %":
        r.fiscalCategory === "standard" || r.fiscalCategory === "non_standard"
          ? Math.round(r.aliquotaCalcolata * 100) / 100
          : "",
      "Imponibile": isFiscalAmount(r.fiscalCategory) ? r.imponibile : "",
      "Imposta": r.fiscalCategory === "standard" || r.fiscalCategory === "non_standard" ? r.imposta : "",
      "Lordo": isFiscalAmount(r.fiscalCategory) ? r.lordo : "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dettaglio), "Prima Nota IVA");

    const riepilogo: RiepilogoIvaRow[] = [];
    for (const e of ivaRiepilogo.standardArr) {
      riepilogo.push({
        "Gruppo": `IVA ${e.aliquota}%`,
        "Pezzi": e.pezzi,
        "Imponibile": e.imponibile,
        "Imposta": e.imposta,
        "Lordo": e.lordo,
      });
    }
    for (const e of ivaRiepilogo.nonStandardArr) {
      riepilogo.push({
        "Gruppo": `Non standard ${e.aliquota}%`,
        "Pezzi": e.pezzi,
        "Imponibile": e.imponibile,
        "Imposta": e.imposta,
        "Lordo": e.lordo,
      });
    }
    for (const e of ivaRiepilogo.naturaArr) {
      riepilogo.push({
        "Gruppo": `Non imponibile ${e.code}`,
        "Pezzi": e.pezzi,
        "Imponibile": e.imponibile,
        "Imposta": 0,
        "Lordo": e.lordo,
      });
    }
    if (ivaRiepilogo.daVerificare.pezzi > 0) {
      riepilogo.push({
        "Gruppo": "Da verificare",
        "Pezzi": ivaRiepilogo.daVerificare.pezzi,
        "Imponibile": "",
        "Imposta": "",
        "Lordo": ivaRiepilogo.daVerificare.lordo,
      });
    }
    if (ivaRiepilogo.fuoriScontrino.pezzi > 0) {
      riepilogo.push({
        "Gruppo": "Fuori scontrino",
        "Pezzi": ivaRiepilogo.fuoriScontrino.pezzi,
        "Imponibile": "",
        "Imposta": "",
        "Lordo": "",
      });
    }
    riepilogo.push({
      "Gruppo": "TOTALE IVA",
      "Pezzi": ivaTotals.pezzi,
      "Imponibile": ivaTotals.imponibile,
      "Imposta": ivaTotals.imposta,
      "Lordo": ivaTotals.lordo,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riepilogo), "Riepilogo IVA");

    XLSX.writeFile(wb, `prima_nota_iva_${periodSuffix}.xlsx`);
  };

  const exportRegistroCorrispettivi = () => {
    const SEP = ";";
    const fmtNum = (v: number) =>
      (Math.round(v * 100) / 100).toLocaleString("it-IT", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: false,
      });
    const csvCell = (v: string | number) => {
      const s = String(v ?? "");
      if (s.includes(SEP) || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const row = (...cells: (string | number)[]) =>
      cells.map(csvCell).join(SEP);

    interface AliquotaBucket {
      pezzi: number;
      imponibile: number;
      imposta: number;
      lordo: number;
    }
    interface NaturaBucket {
      pezzi: number;
      lordo: number;
    }
    interface DayBucket {
      dataMs: number;
      dataLabel: string;
      aliquote: Map<number, AliquotaBucket>;
      natura: Map<string, NaturaBucket>;
    }

    const days = new Map<string, DayBucket>();
    const ensureDay = (r: IvaRow): DayBucket => {
      const key = r.data ? r.data.slice(0, 10) : "N/D";
      let d = days.get(key);
      if (!d) {
        d = {
          dataMs: r.dataMs,
          dataLabel: fmtDate(r.data),
          aliquote: new Map(),
          natura: new Map(),
        };
        days.set(key, d);
      }
      return d;
    };
    const ensureAliquota = (d: DayBucket, a: number): AliquotaBucket => {
      let b = d.aliquote.get(a);
      if (!b) { b = { pezzi: 0, imponibile: 0, imposta: 0, lordo: 0 }; d.aliquote.set(a, b); }
      return b;
    };
    const ensureNatura = (d: DayBucket, code: string): NaturaBucket => {
      let b = d.natura.get(code);
      if (!b) { b = { pezzi: 0, lordo: 0 }; d.natura.set(code, b); }
      return b;
    };

    for (const r of ivaRows) {
      if (r.fiscalCategory === "standard" || r.fiscalCategory === "non_standard") {
        const d = ensureDay(r);
        const b = ensureAliquota(d, r.aliquota);
        b.pezzi++;
        b.imponibile += r.imponibile;
        b.imposta += r.imposta;
        b.lordo += r.lordo;
      } else if (r.fiscalCategory === "natura") {
        const d = ensureDay(r);
        const b = ensureNatura(d, r.naturaCode || "N/D");
        b.pezzi++;
        b.lordo += r.lordo;
      }
    }

    const sortedDays = Array.from(days.values()).sort((a, b) => a.dataMs - b.dataMs);

    const lines: string[] = [];
    lines.push(row("Registro Corrispettivi"));
    lines.push(row(`Periodo: ${MONTH_LABELS[month - 1]} ${year}`));
    if (filterPdv !== "all") {
      const pdv = pdvOptions.find(([code]) => code === filterPdv);
      lines.push(row(`Punto Vendita: ${pdv ? `${pdv[1]} (${pdv[0]})` : filterPdv}`));
    }
    if (filterRs !== "all") {
      lines.push(row(`Ragione Sociale: ${filterRs}`));
    }
    lines.push("");

    lines.push(row(
      "Data", "Aliquota %", "Pezzi", "Imponibile", "Imposta", "Lordo",
    ));

    const totGen: AliquotaBucket = { pezzi: 0, imponibile: 0, imposta: 0, lordo: 0 };
    const totPerAliquota = new Map<number, AliquotaBucket>();

    for (const d of sortedDays) {
      const aliquoteSorted = Array.from(d.aliquote.entries()).sort((a, b) => a[0] - b[0]);
      if (aliquoteSorted.length === 0) continue;
      const dayTot: AliquotaBucket = { pezzi: 0, imponibile: 0, imposta: 0, lordo: 0 };
      for (const [aliquota, b] of aliquoteSorted) {
        lines.push(row(
          d.dataLabel,
          fmtNum(aliquota),
          b.pezzi,
          fmtNum(b.imponibile),
          fmtNum(b.imposta),
          fmtNum(b.lordo),
        ));
        dayTot.pezzi += b.pezzi;
        dayTot.imponibile += b.imponibile;
        dayTot.imposta += b.imposta;
        dayTot.lordo += b.lordo;
        let tot = totPerAliquota.get(aliquota);
        if (!tot) { tot = { pezzi: 0, imponibile: 0, imposta: 0, lordo: 0 }; totPerAliquota.set(aliquota, tot); }
        tot.pezzi += b.pezzi;
        tot.imponibile += b.imponibile;
        tot.imposta += b.imposta;
        tot.lordo += b.lordo;
      }
      lines.push(row(
        `Totale ${d.dataLabel}`,
        "",
        dayTot.pezzi,
        fmtNum(dayTot.imponibile),
        fmtNum(dayTot.imposta),
        fmtNum(dayTot.lordo),
      ));
      totGen.pezzi += dayTot.pezzi;
      totGen.imponibile += dayTot.imponibile;
      totGen.imposta += dayTot.imposta;
      totGen.lordo += dayTot.lordo;
    }

    lines.push("");
    lines.push(row("Riepilogo per Aliquota"));
    lines.push(row("Aliquota %", "Pezzi", "Imponibile", "Imposta", "Lordo"));
    const aliquoteAll = Array.from(totPerAliquota.entries()).sort((a, b) => a[0] - b[0]);
    for (const [aliquota, b] of aliquoteAll) {
      lines.push(row(
        fmtNum(aliquota),
        b.pezzi,
        fmtNum(b.imponibile),
        fmtNum(b.imposta),
        fmtNum(b.lordo),
      ));
    }
    lines.push(row(
      "TOTALE",
      totGen.pezzi,
      fmtNum(totGen.imponibile),
      fmtNum(totGen.imposta),
      fmtNum(totGen.lordo),
    ));

    const naturaPerCode = new Map<string, NaturaBucket>();
    const naturaDailyLines: string[] = [];
    for (const d of sortedDays) {
      const naturaSorted = Array.from(d.natura.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [code, b] of naturaSorted) {
        naturaDailyLines.push(row(
          d.dataLabel,
          code,
          b.pezzi,
          fmtNum(b.lordo),
        ));
        let tot = naturaPerCode.get(code);
        if (!tot) { tot = { pezzi: 0, lordo: 0 }; naturaPerCode.set(code, tot); }
        tot.pezzi += b.pezzi;
        tot.lordo += b.lordo;
      }
    }

    if (naturaDailyLines.length > 0) {
      lines.push("");
      lines.push(row("Operazioni Non Imponibili / Esenti / Fuori Campo (Natura N1-N7)"));
      lines.push(row("Data", "Natura", "Pezzi", "Lordo"));
      for (const l of naturaDailyLines) lines.push(l);
      lines.push("");
      lines.push(row("Riepilogo per Natura"));
      lines.push(row("Natura", "Pezzi", "Lordo"));
      const naturaAll = Array.from(naturaPerCode.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      let totNatura: NaturaBucket = { pezzi: 0, lordo: 0 };
      for (const [code, b] of naturaAll) {
        lines.push(row(code, b.pezzi, fmtNum(b.lordo)));
        totNatura.pezzi += b.pezzi;
        totNatura.lordo += b.lordo;
      }
      lines.push(row("TOTALE", totNatura.pezzi, fmtNum(totNatura.lordo)));
    }

    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `registro_corrispettivi_${periodSuffix}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppNavbar />
      <main className="flex-1 container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 min-w-0 max-w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
              <BookOpen className="h-6 w-6 text-primary" />
              Amministrazione
            </h1>
            <p className="text-sm text-muted-foreground">
              Prima Nota Contabile e Prima Nota IVA dalle vendite BiSuite
            </p>
          </div>
        </div>

        <FilterBar
          activeCount={
            (filterPdv !== "all" ? 1 : 0) +
            (filterRs !== "all" ? 1 : 0) +
            (search.trim() ? 1 : 0)
          }
          onReset={() => { setFilterPdv("all"); setFilterRs("all"); setSearch(""); }}
        >
          <FilterField label="Mese" icon={Calendar}>
            <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
              <SelectTrigger data-testid="select-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((label, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Anno" icon={CalendarDays}>
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
              <SelectTrigger data-testid="select-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Punto Vendita" icon={Store}>
            <Select value={filterPdv} onValueChange={setFilterPdv}>
              <SelectTrigger data-testid="select-pdv"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i PDV</SelectItem>
                {pdvOptions.map(([code, name]) => (
                  <SelectItem key={code} value={code}>{name} ({code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Ragione Sociale" icon={Building2}>
            <Select value={filterRs} onValueChange={setFilterRs}>
              <SelectTrigger data-testid="select-rs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le RS</SelectItem>
                {rsOptions.map((rs) => (
                  <SelectItem key={rs} value={rs}>{rs}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Cerca" icon={Search} htmlFor="search">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="PDV, cliente, addetto..."
                className="pl-8"
                data-testid="input-search"
              />
            </div>
          </FilterField>
        </FilterBar>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
<Tabs
            value={tab}
            onValueChange={(v) => { if (isTabKey(v)) setTab(v); }}
            className="space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <TabsList>
                <TabsTrigger value="contabile" data-testid="tab-contabile">
                  <BookOpen className="h-4 w-4 mr-2" />
                  Prima Nota Contabile
                </TabsTrigger>
                <TabsTrigger value="iva" data-testid="tab-iva">
                  <Receipt className="h-4 w-4 mr-2" />
                  Prima Nota IVA
                </TabsTrigger>
              </TabsList>
              {tab === "contabile" ? (
                <Button onClick={exportContabile} disabled={contabileRows.length === 0} data-testid="button-export-contabile">
                  <Download className="h-4 w-4 mr-2" />
                  Esporta Contabile
                </Button>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button onClick={exportIva} disabled={ivaRows.length === 0} data-testid="button-export-iva">
                    <Download className="h-4 w-4 mr-2" />
                    Esporta IVA
                  </Button>
                  <Button
                    variant="outline"
                    onClick={exportRegistroCorrispettivi}
                    disabled={ivaRows.length === 0}
                    data-testid="button-export-registro-corrispettivi"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Esporta Registro Corrispettivi
                  </Button>
                </div>
              )}
            </div>

            {rsGroups.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 px-1" data-testid="rs-switcher">
                <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Ragione Sociale:</span>
                <button
                  type="button"
                  onClick={() => setSelectedRs("all")}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    selectedRs === "all"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-border hover-elevate active-elevate-2"
                  }`}
                  data-testid="button-rs-all"
                >
                  Tutte <span className="opacity-70">({rsGroups.length})</span>
                </button>
                {rsGroups.map((g) => (
                  <button
                    key={g.rs}
                    type="button"
                    onClick={() => setSelectedRs(g.rs)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                      selectedRs === g.rs
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover-elevate active-elevate-2"
                    }`}
                    data-testid={`button-rs-${g.rs}`}
                  >
                    <Building2 className="h-3 w-3" />
                    {g.rs}
                    <span className="opacity-70">
                      ({tab === "contabile" ? g.contabileRows.length : g.ivaRows.length})
                    </span>
                  </button>
                ))}
              </div>
            )}

            <TabsContent value="contabile" className="space-y-6">
              {displayedRsGroups.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Nessuno scontrino nel periodo selezionato</CardContent></Card>
              ) : displayedRsGroups.map((g) => (
                <div key={`contabile-${g.rs}`} className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <Building2 className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/90" data-testid={`rs-header-${g.rs}`}>{g.rs}</h2>
                    <Badge variant="secondary" className="text-[10px]">{g.contabileRows.length} scontrini</Badge>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <span>Riepilogo per Metodo Pagamento</span>
                        <span className="text-xs font-normal text-muted-foreground">Totale: <span className="font-semibold text-foreground">{fmtCurrency(g.contabileTotals.totale)}</span></span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                        <div><div className="text-xs text-muted-foreground">Totale</div><div className="font-semibold" data-testid={`totals-totale-${g.rs}`}>{fmtCurrency(g.contabileTotals.totale)}</div></div>
                        {INCASSO_ITEMS_CONFIG.map((cfg) => (
                          <div key={cfg.key}>
                            <div className="text-xs text-muted-foreground">{cfg.label}</div>
                            <div className={`font-semibold ${cfg.color}`}>{fmtCurrency(g.contabileTotals.incasso[cfg.key])}</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="overflow-hidden min-w-0 max-w-full">
                    <CardContent className="p-0 min-w-0">
                      <ScrollableTable>
                        <Table className="min-w-[1200px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs whitespace-nowrap min-w-[90px]">Data</TableHead>
                              <TableHead className="text-xs whitespace-nowrap min-w-[70px]">ID</TableHead>
                              <TableHead className="text-xs whitespace-nowrap min-w-[140px]">PDV</TableHead>
                              <TableHead className="text-xs whitespace-nowrap min-w-[120px]">Matricola</TableHead>
                              <TableHead className="text-xs whitespace-nowrap min-w-[120px]">Addetto</TableHead>
                              <TableHead className="text-xs whitespace-nowrap min-w-[140px]">Cliente</TableHead>
                              <TableHead className="text-xs whitespace-nowrap text-right min-w-[100px]">Totale</TableHead>
                              {INCASSO_ITEMS_CONFIG.map((cfg) => (
                                <TableHead key={cfg.key} className="text-xs whitespace-nowrap text-right min-w-[100px]">{cfg.label}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {g.contabileRows.length === 0 ? (
                              <TableRow><TableCell colSpan={7 + INCASSO_ITEMS_CONFIG.length} className="text-center text-muted-foreground py-8">Nessuno scontrino</TableCell></TableRow>
                            ) : (
                              g.contabileRows.map((r) => (
                                <TableRow key={r.saleId} data-testid={`row-contabile-${r.saleId}`}>
                                  <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.data)}</TableCell>
                                  <TableCell className="text-xs font-mono">{r.bisuiteId}</TableCell>
                                  <TableCell className="text-xs">
                                    <div className="font-medium truncate max-w-[180px]" title={r.nomeNegozio}>{r.nomeNegozio}</div>
                                    <div className="text-muted-foreground font-mono text-[10px] truncate max-w-[180px]" title={r.codicePos}>{r.codicePos}</div>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">
                                    <div className="truncate max-w-[140px]" title={r.matricolaFiscale}>{r.matricolaFiscale || "—"}</div>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <div className="truncate max-w-[140px]" title={r.nomeAddetto}>{r.nomeAddetto}</div>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <div className="truncate max-w-[160px]" title={r.nomeCliente}>{r.nomeCliente}</div>
                                  </TableCell>
                                  <TableCell className="text-xs text-right font-semibold whitespace-nowrap">{fmtCurrency(r.totale)}</TableCell>
                                  {INCASSO_ITEMS_CONFIG.map((cfg) => (
                                    <TableCell key={cfg.key} className={`text-xs text-right whitespace-nowrap ${cfg.color}`}>
                                      {r.incasso[cfg.key] > 0 ? fmtCurrency(r.incasso[cfg.key]) : "—"}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                          {g.contabileRows.length > 0 && (
                            <TableFooter>
                              <TableRow data-testid={`row-contabile-totals-${g.rs}`}>
                                <TableCell colSpan={6} className="text-xs font-bold whitespace-nowrap">TOTALE {g.rs}</TableCell>
                                <TableCell className="text-xs text-right font-bold whitespace-nowrap">{fmtCurrency(g.contabileTotals.totale)}</TableCell>
                                {INCASSO_ITEMS_CONFIG.map((cfg) => (
                                  <TableCell key={cfg.key} className={`text-xs text-right font-bold whitespace-nowrap ${cfg.color}`}>
                                    {fmtCurrency(g.contabileTotals.incasso[cfg.key])}
                                  </TableCell>
                                ))}
                              </TableRow>
                            </TableFooter>
                          )}
                        </Table>
                      </ScrollableTable>
                    </CardContent>
                  </Card>
                </div>
              ))}

              {rsGroups.length > 1 && selectedRs === "all" && (
                <Card className="border-primary/40 bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Totale Generale (tutte le RS)</span>
                      <Badge variant="outline" data-testid="badge-contabile-count">{contabileRows.length} scontrini</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                      <div><div className="text-xs text-muted-foreground">Totale</div><div className="font-bold" data-testid="totals-totale">{fmtCurrency(contabileTotals.totale)}</div></div>
                      {INCASSO_ITEMS_CONFIG.map((cfg) => (
                        <div key={cfg.key}>
                          <div className="text-xs text-muted-foreground">{cfg.label}</div>
                          <div className={`font-bold ${cfg.color}`}>{fmtCurrency(contabileTotals.incasso[cfg.key])}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="iva" className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="iva-cat-filter" className="text-xs">Categoria fiscale</Label>
                  <Select
                    value={ivaCategoryFilter}
                    onValueChange={(v) => setIvaCategoryFilter(v as IvaCategoria | "all")}
                  >
                    <SelectTrigger id="iva-cat-filter" className="h-8 w-[200px]" data-testid="select-iva-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tutte le categorie</SelectItem>
                      <SelectItem value="standard">{FISCAL_CATEGORY_LABELS.standard}</SelectItem>
                      <SelectItem value="non_standard">{FISCAL_CATEGORY_LABELS.non_standard}</SelectItem>
                      <SelectItem value="natura">{FISCAL_CATEGORY_LABELS.natura}</SelectItem>
                      <SelectItem value="da_verificare">{FISCAL_CATEGORY_LABELS.da_verificare}</SelectItem>
                      <SelectItem value="fuori_scontrino">{FISCAL_CATEGORY_LABELS.fuori_scontrino}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="escludi-zero" className="text-xs cursor-pointer">
                    Nascondi righe a 0 nel dettaglio (totali sempre completi)
                  </Label>
                  <Switch
                    id="escludi-zero"
                    checked={escludiZero}
                    onCheckedChange={setEscludiZero}
                    data-testid="switch-escludi-zero"
                  />
                </div>
              </div>

              {displayedRsGroups.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Nessun articolo nel periodo selezionato</CardContent></Card>
              ) : displayedRsGroups.map((g) => {
                const isEmptyRiep =
                  g.ivaRiepilogo.standardArr.length === 0 &&
                  g.ivaRiepilogo.nonStandardArr.length === 0 &&
                  g.ivaRiepilogo.naturaArr.length === 0 &&
                  g.ivaRiepilogo.daVerificare.pezzi === 0 &&
                  g.ivaRiepilogo.fuoriScontrino.pezzi === 0;
                return (
                <div key={`iva-${g.rs}`} className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <Building2 className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/90" data-testid={`rs-iva-header-${g.rs}`}>{g.rs}</h2>
                    <Badge variant="secondary" className="text-[10px]">{g.ivaRowsAll.length} articoli</Badge>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Riepilogo IVA per Aliquota</CardTitle>
                    </CardHeader>
                    <CardContent className="min-w-0">
                      <ScrollableTable>
                      <Table className="min-w-[520px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs whitespace-nowrap min-w-[180px]">Gruppo</TableHead>
                            <TableHead className="text-xs text-right whitespace-nowrap min-w-[70px]">Pezzi</TableHead>
                            <TableHead className="text-xs text-right whitespace-nowrap min-w-[100px]">Imponibile</TableHead>
                            <TableHead className="text-xs text-right whitespace-nowrap min-w-[100px]">Imposta</TableHead>
                            <TableHead className="text-xs text-right whitespace-nowrap min-w-[100px]">Lordo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {isEmptyRiep && (
                            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nessun articolo</TableCell></TableRow>
                          )}
                          {g.ivaRiepilogo.standardArr.map((e) => (
                            <TableRow key={`std-${g.rs}-${e.aliquota}`}>
                              <TableCell className="text-xs font-semibold">IVA {e.aliquota}%</TableCell>
                              <TableCell className="text-xs text-right">{e.pezzi}</TableCell>
                              <TableCell className="text-xs text-right">{fmtCurrency(e.imponibile)}</TableCell>
                              <TableCell className="text-xs text-right">{fmtCurrency(e.imposta)}</TableCell>
                              <TableCell className="text-xs text-right font-semibold">{fmtCurrency(e.lordo)}</TableCell>
                            </TableRow>
                          ))}
                          {g.ivaRiepilogo.naturaArr.map((e) => (
                            <TableRow key={`nat-${g.rs}-${e.code}`}>
                              <TableCell className="text-xs"><Badge variant="secondary" className="text-[10px]">Non imponibile {e.code}</Badge></TableCell>
                              <TableCell className="text-xs text-right">{e.pezzi}</TableCell>
                              <TableCell className="text-xs text-right">{fmtCurrency(e.imponibile)}</TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                              <TableCell className="text-xs text-right font-semibold">{fmtCurrency(e.lordo)}</TableCell>
                            </TableRow>
                          ))}
                          {g.ivaRiepilogo.daVerificare.pezzi > 0 && (
                            <TableRow>
                              <TableCell className="text-xs">
                                <Badge variant="destructive" className="text-[10px]">Da verificare</Badge>
                                <span className="ml-2 text-muted-foreground text-[10px]">(scontrino senza imponibile)</span>
                              </TableCell>
                              <TableCell className="text-xs text-right">{g.ivaRiepilogo.daVerificare.pezzi}</TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                              <TableCell className="text-xs text-right">{fmtCurrency(g.ivaRiepilogo.daVerificare.lordo)}</TableCell>
                            </TableRow>
                          )}
                          {g.ivaRiepilogo.fuoriScontrino.pezzi > 0 && (
                            <TableRow>
                              <TableCell className="text-xs text-muted-foreground italic">Fuori scontrino <span className="text-[10px]">(canoni/servizi fatturati a parte)</span></TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">{g.ivaRiepilogo.fuoriScontrino.pezzi}</TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground" colSpan={3}>—</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                        <TableFooter>
                          <TableRow>
                            <TableCell className="text-xs font-bold">TOTALE IVA {g.rs}</TableCell>
                            <TableCell className="text-xs text-right font-bold">{g.ivaTotals.pezzi}</TableCell>
                            <TableCell className="text-xs text-right font-bold">{fmtCurrency(g.ivaTotals.imponibile)}</TableCell>
                            <TableCell className="text-xs text-right font-bold">{fmtCurrency(g.ivaTotals.imposta)}</TableCell>
                            <TableCell className="text-xs text-right font-bold">{fmtCurrency(g.ivaTotals.lordo)}</TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>
                      </ScrollableTable>
                    </CardContent>
                  </Card>

                  <Card className="overflow-hidden min-w-0 max-w-full">
                    <CardContent className="p-0 min-w-0">
                      <ScrollableTable>
                        <Table className="w-full table-fixed [&_th]:px-1.5 [&_td]:px-1.5 [&_th]:py-1.5 [&_td]:py-1 [&_th]:overflow-hidden [&_td]:overflow-hidden">
                          <colgroup>
                            <col className="w-[84px]" />
                            <col className="w-[150px]" />
                            <col className="w-[110px]" />
                            <col />
                            <col className="w-[50px]" />
                            <col className="w-[42px]" />
                            <col className="w-[76px]" />
                            <col className="w-[68px]" />
                            <col className="w-[80px]" />
                          </colgroup>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[11px] whitespace-nowrap">Data</TableHead>
                              <TableHead className="text-[11px] whitespace-nowrap">PDV</TableHead>
                              <TableHead className="text-[11px] whitespace-nowrap">Cliente</TableHead>
                              <TableHead className="text-[11px] whitespace-nowrap">Articolo</TableHead>
                              <TableHead className="text-[11px] whitespace-nowrap">Cat. Fiscale</TableHead>
                              <TableHead className="text-[11px] whitespace-nowrap text-right">Aliq.</TableHead>
                              <TableHead className="text-[11px] whitespace-nowrap text-right">Imponibile</TableHead>
                              <TableHead className="text-[11px] whitespace-nowrap text-right">Imposta</TableHead>
                              <TableHead className="text-[11px] whitespace-nowrap text-right">Lordo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {g.ivaRows.length === 0 ? (
                              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nessun articolo</TableCell></TableRow>
                            ) : (
                              g.ivaRows.slice(0, 500).map((r, idx) => {
                                const isStd = r.fiscalCategory === "standard";
                                const isNonStd = r.fiscalCategory === "non_standard";
                                const isNatura = r.fiscalCategory === "natura";
                                const isFuori = r.fiscalCategory === "fuori_scontrino";
                                const aliquotaCell = isStd
                                  ? `${r.aliquota}%`
                                  : isNonStd
                                    ? `${r.aliquota.toFixed(2)}%`
                                    : isNatura
                                      ? (r.naturaCode || "—")
                                      : "—";
                                const articoloTitle = [r.codiceArticolo, r.categoria, r.descrizione].filter(Boolean).join(" — ");
                                return (
                                  <TableRow
                                    key={`${r.saleId}-${idx}`}
                                    className={isFuori ? "opacity-60" : ""}
                                    data-testid={`row-iva-${r.saleId}-${idx}`}
                                  >
                                    <TableCell className="text-[11px] align-top">
                                      <div className="truncate">{fmtDate(r.data)}</div>
                                      <div className="text-muted-foreground font-mono text-[10px] truncate">#{r.bisuiteId}</div>
                                    </TableCell>
                                    <TableCell className="text-[11px] align-top">
                                      <div className="font-medium truncate" title={r.nomeNegozio}>{r.nomeNegozio}</div>
                                      <div className="text-muted-foreground font-mono text-[10px] truncate" title={r.codicePos}>{r.codicePos}</div>
                                    </TableCell>
                                    <TableCell className="text-[11px] align-top">
                                      <div className="truncate" title={r.nomeCliente}>{r.nomeCliente}</div>
                                    </TableCell>
                                    <TableCell className="text-[11px] align-top" title={articoloTitle}>
                                      <div className="truncate">{r.descrizione || r.categoria || "—"}</div>
                                    </TableCell>
                                    <TableCell className="text-[10px] align-top">
                                      <Badge
                                        variant={FISCAL_CATEGORY_BADGE[r.fiscalCategory]}
                                        className="text-[9px] whitespace-nowrap px-1 py-0 leading-tight"
                                        title={FISCAL_CATEGORY_LABELS[r.fiscalCategory]}
                                      >
                                        {FISCAL_CATEGORY_SHORT[r.fiscalCategory]}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-[11px] text-right whitespace-nowrap align-top">{aliquotaCell}</TableCell>
                                    <TableCell className="text-[11px] text-right whitespace-nowrap align-top">{(isStd || isNonStd || isNatura) ? fmtCurrency(r.imponibile) : "—"}</TableCell>
                                    <TableCell className="text-[11px] text-right whitespace-nowrap align-top">{(isStd || isNonStd) ? fmtCurrency(r.imposta) : "—"}</TableCell>
                                    <TableCell className="text-[11px] text-right font-semibold whitespace-nowrap align-top">{(isStd || isNonStd || isNatura) ? fmtCurrency(r.lordo) : "—"}</TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </ScrollableTable>
                      {g.ivaRows.length > 500 && (
                        <div className="p-3 text-center text-xs text-muted-foreground border-t">
                          Visualizzati i primi 500 articoli su {g.ivaRows.length}. Esporta in Excel per il dettaglio completo.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
                );
              })}

              {rsGroups.length > 1 && selectedRs === "all" && (
                <Card className="border-primary/40 bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" />Totale IVA Generale (tutte le RS)</span>
                      <Badge variant="outline" data-testid="badge-iva-count">{ivaRowsAll.length} articoli</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div><div className="text-xs text-muted-foreground">Pezzi</div><div className="font-bold">{ivaTotals.pezzi}</div></div>
                      <div><div className="text-xs text-muted-foreground">Imponibile</div><div className="font-bold" data-testid="totals-imponibile">{fmtCurrency(ivaTotals.imponibile)}</div></div>
                      <div><div className="text-xs text-muted-foreground">Imposta</div><div className="font-bold" data-testid="totals-imposta">{fmtCurrency(ivaTotals.imposta)}</div></div>
                      <div><div className="text-xs text-muted-foreground">Lordo</div><div className="font-bold" data-testid="totals-lordo">{fmtCurrency(ivaTotals.lordo)}</div></div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
