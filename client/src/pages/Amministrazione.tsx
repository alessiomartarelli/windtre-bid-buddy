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
import {
  BookOpen, Receipt, Loader2, Download, Search, AlertTriangle, HelpCircle, FileText,
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
  const first = `${year}-${pad(month)}-01`;
  const last = new Date(year, month, 0);
  const lastStr = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
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

  const contabileTotals = useMemo<{ totale: number; incasso: IncassoTotals }>(() => {
    return {
      totale: contabileRows.reduce((s, r) => s + r.totale, 0),
      incasso: computeIncassoTotals(filteredSales),
    };
  }, [contabileRows, filteredSales]);

  interface RiepilogoBucket {
    pezzi: number;
    imponibile: number;
    imposta: number;
    lordo: number;
  }

  const ivaRiepilogo = useMemo(() => {
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

    for (const r of ivaRowsAll) {
      switch (r.fiscalCategory) {
        case "standard":
          addTo(ensure(standard, r.aliquota), r);
          break;
        case "non_standard":
          addTo(ensure(nonStandard, r.aliquota), r);
          break;
        case "natura":
          addTo(ensure(natura, r.naturaCode || "N/D"), r);
          break;
        case "da_verificare":
          addTo(daVerificare, r);
          break;
        case "fuori_scontrino":
          addTo(fuoriScontrino, r);
          break;
      }
    }

    const standardArr = Array.from(standard.entries())
      .map(([aliquota, b]) => ({ aliquota, ...b }))
      .sort((a, b) => a.aliquota - b.aliquota);
    const nonStandardArr = Array.from(nonStandard.entries())
      .map(([aliquota, b]) => ({ aliquota, ...b }))
      .sort((a, b) => a.aliquota - b.aliquota);
    const naturaArr = Array.from(natura.entries())
      .map(([code, b]) => ({ code, ...b }))
      .sort((a, b) => a.code.localeCompare(b.code));

    return { standardArr, nonStandardArr, naturaArr, daVerificare, fuoriScontrino };
  }, [ivaRowsAll]);

  const ivaTotals = useMemo(() => {
    const t = { imponibile: 0, imposta: 0, lordo: 0, pezzi: 0 };
    for (const e of ivaRiepilogo.standardArr) {
      t.imponibile += e.imponibile; t.imposta += e.imposta; t.lordo += e.lordo; t.pezzi += e.pezzi;
    }
    for (const e of ivaRiepilogo.nonStandardArr) {
      t.imponibile += e.imponibile; t.imposta += e.imposta; t.lordo += e.lordo; t.pezzi += e.pezzi;
    }
    for (const e of ivaRiepilogo.naturaArr) {
      t.imponibile += e.imponibile; t.lordo += e.lordo; t.pezzi += e.pezzi;
    }
    return t;
  }, [ivaRiepilogo]);

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

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">Mese</Label>
                <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
                  <SelectTrigger data-testid="select-month"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTH_LABELS.map((label, idx) => (
                      <SelectItem key={idx + 1} value={String(idx + 1)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Anno</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
                  <SelectTrigger data-testid="select-year"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Punto Vendita</Label>
                <Select value={filterPdv} onValueChange={setFilterPdv}>
                  <SelectTrigger data-testid="select-pdv"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutti i PDV</SelectItem>
                    {pdvOptions.map(([code, name]) => (
                      <SelectItem key={code} value={code}>{name} ({code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Ragione Sociale</Label>
                <Select value={filterRs} onValueChange={setFilterRs}>
                  <SelectTrigger data-testid="select-rs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutte le RS</SelectItem>
                    {rsOptions.map((rs) => (
                      <SelectItem key={rs} value={rs}>{rs}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="search" className="text-xs">Cerca</Label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="PDV, cliente, addetto..."
                    className="pl-8"
                    data-testid="input-search"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
          {(ivaAlerts.nonStandard.scontrini > 0 || ivaAlerts.daVerificare.scontrini > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card
                className={`cursor-pointer transition-colors hover-elevate active-elevate-2 ${
                  ivaAlerts.nonStandard.scontrini > 0 ? "border-destructive/50" : "opacity-60"
                }`}
                onClick={() => ivaAlerts.nonStandard.scontrini > 0 && goToIvaCategory("non_standard")}
                data-testid="card-alert-non-standard"
              >
                <CardContent className="pt-6 flex items-center gap-3">
                  <div className="p-2 rounded-md bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground">Aliquote non standard</div>
                    <div className="text-lg font-semibold" data-testid="text-alert-non-standard-count">
                      {ivaAlerts.nonStandard.scontrini} scontrini
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid="text-alert-non-standard-lordo">
                      Lordo: {fmtCurrency(ivaAlerts.nonStandard.lordo)}
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card
                className={`cursor-pointer transition-colors hover-elevate active-elevate-2 ${
                  ivaAlerts.daVerificare.scontrini > 0 ? "border-destructive/50" : "opacity-60"
                }`}
                onClick={() => ivaAlerts.daVerificare.scontrini > 0 && goToIvaCategory("da_verificare")}
                data-testid="card-alert-da-verificare"
              >
                <CardContent className="pt-6 flex items-center gap-3">
                  <div className="p-2 rounded-md bg-destructive/10 text-destructive">
                    <HelpCircle className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground">Da verificare</div>
                    <div className="text-lg font-semibold" data-testid="text-alert-da-verificare-count">
                      {ivaAlerts.daVerificare.scontrini} scontrini
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid="text-alert-da-verificare-lordo">
                      Lordo: {fmtCurrency(ivaAlerts.daVerificare.lordo)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
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

            <TabsContent value="contabile" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Riepilogo per Metodo Pagamento</span>
                    <Badge variant="outline" data-testid="badge-contabile-count">
                      {contabileRows.length} scontrini
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                    <div><div className="text-xs text-muted-foreground">Totale</div><div className="font-semibold" data-testid="totals-totale">{fmtCurrency(contabileTotals.totale)}</div></div>
                    {INCASSO_ITEMS_CONFIG.map((cfg) => (
                      <div key={cfg.key}>
                        <div className="text-xs text-muted-foreground">{cfg.label}</div>
                        <div className={`font-semibold ${cfg.color}`}>{fmtCurrency(contabileTotals.incasso[cfg.key])}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden min-w-0 max-w-full">
                <CardContent className="p-0 min-w-0">
                  <div className="w-full max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
                  <Table className="min-w-[1200px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs whitespace-nowrap min-w-[90px]">Data</TableHead>
                        <TableHead className="text-xs whitespace-nowrap min-w-[70px]">ID</TableHead>
                        <TableHead className="text-xs whitespace-nowrap min-w-[140px]">PDV</TableHead>
                        <TableHead className="text-xs whitespace-nowrap min-w-[140px]">Ragione Sociale</TableHead>
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
                      {contabileRows.length === 0 ? (
                        <TableRow><TableCell colSpan={8 + INCASSO_ITEMS_CONFIG.length} className="text-center text-muted-foreground py-8">Nessuno scontrino nel periodo selezionato</TableCell></TableRow>
                      ) : (
                        contabileRows.map((r) => (
                          <TableRow key={r.saleId} data-testid={`row-contabile-${r.saleId}`}>
                            <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.data)}</TableCell>
                            <TableCell className="text-xs font-mono">{r.bisuiteId}</TableCell>
                            <TableCell className="text-xs">
                              <div className="font-medium truncate max-w-[180px]" title={r.nomeNegozio}>{r.nomeNegozio}</div>
                              <div className="text-muted-foreground font-mono text-[10px] truncate max-w-[180px]" title={r.codicePos}>{r.codicePos}</div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="truncate max-w-[160px]" title={r.ragioneSociale}>{r.ragioneSociale}</div>
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
                    {contabileRows.length > 0 && (
                      <TableFooter>
                        <TableRow data-testid="row-contabile-totals">
                          <TableCell colSpan={7} className="text-xs font-bold whitespace-nowrap">TOTALE</TableCell>
                          <TableCell className="text-xs text-right font-bold whitespace-nowrap">{fmtCurrency(contabileTotals.totale)}</TableCell>
                          {INCASSO_ITEMS_CONFIG.map((cfg) => (
                            <TableCell key={cfg.key} className={`text-xs text-right font-bold whitespace-nowrap ${cfg.color}`}>
                              {fmtCurrency(contabileTotals.incasso[cfg.key])}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                  </div>
                </CardContent>
              </Card>
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

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Riepilogo IVA per Aliquota</span>
                    <Badge variant="outline" data-testid="badge-iva-count">
                      {ivaRowsAll.length} articoli (solo Prodotti e Servizi)
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Aliquote calcolate dagli importi (scontrino − imponibile) e snappate alle 4 aliquote IVA italiane standard.
                    Esclude automaticamente gli articoli Canvass / Contratti.
                  </p>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div className="w-full max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
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
                      {ivaRiepilogo.standardArr.length === 0 &&
                        ivaRiepilogo.nonStandardArr.length === 0 &&
                        ivaRiepilogo.naturaArr.length === 0 &&
                        ivaRiepilogo.daVerificare.pezzi === 0 &&
                        ivaRiepilogo.fuoriScontrino.pezzi === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                              Nessun articolo nel periodo selezionato
                            </TableCell>
                          </TableRow>
                        )}
                      {ivaRiepilogo.standardArr.map((e) => (
                        <TableRow key={`std-${e.aliquota}`} data-testid={`row-aliquota-${e.aliquota}`}>
                          <TableCell className="text-xs font-semibold">IVA {e.aliquota}%</TableCell>
                          <TableCell className="text-xs text-right">{e.pezzi}</TableCell>
                          <TableCell className="text-xs text-right">{fmtCurrency(e.imponibile)}</TableCell>
                          <TableCell className="text-xs text-right">{fmtCurrency(e.imposta)}</TableCell>
                          <TableCell className="text-xs text-right font-semibold">{fmtCurrency(e.lordo)}</TableCell>
                        </TableRow>
                      ))}
                      {ivaRiepilogo.naturaArr.map((e) => (
                        <TableRow key={`nat-${e.code}`} data-testid={`row-natura-${e.code}`}>
                          <TableCell className="text-xs">
                            <Badge variant="secondary" className="text-[10px]">Non imponibile {e.code}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right">{e.pezzi}</TableCell>
                          <TableCell className="text-xs text-right">{fmtCurrency(e.imponibile)}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                          <TableCell className="text-xs text-right font-semibold">{fmtCurrency(e.lordo)}</TableCell>
                        </TableRow>
                      ))}
                      {ivaRiepilogo.nonStandardArr.map((e) => (
                        <TableRow key={`nstd-${e.aliquota}`} data-testid={`row-non-standard-${e.aliquota}`}>
                          <TableCell className="text-xs">
                            <Badge variant="destructive" className="text-[10px]">
                              Non standard {e.aliquota.toFixed(2)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right">{e.pezzi}</TableCell>
                          <TableCell className="text-xs text-right">{fmtCurrency(e.imponibile)}</TableCell>
                          <TableCell className="text-xs text-right">{fmtCurrency(e.imposta)}</TableCell>
                          <TableCell className="text-xs text-right font-semibold">{fmtCurrency(e.lordo)}</TableCell>
                        </TableRow>
                      ))}
                      {ivaRiepilogo.daVerificare.pezzi > 0 && (
                        <TableRow data-testid="row-da-verificare">
                          <TableCell className="text-xs">
                            <Badge variant="destructive" className="text-[10px]">Da verificare</Badge>
                            <span className="ml-2 text-muted-foreground text-[10px]">(scontrino senza imponibile)</span>
                          </TableCell>
                          <TableCell className="text-xs text-right">{ivaRiepilogo.daVerificare.pezzi}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                          <TableCell className="text-xs text-right">{fmtCurrency(ivaRiepilogo.daVerificare.lordo)}</TableCell>
                        </TableRow>
                      )}
                      {ivaRiepilogo.fuoriScontrino.pezzi > 0 && (
                        <TableRow data-testid="row-fuori-scontrino">
                          <TableCell className="text-xs text-muted-foreground italic">
                            Fuori scontrino <span className="text-[10px]">(canoni/servizi fatturati a parte)</span>
                          </TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{ivaRiepilogo.fuoriScontrino.pezzi}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground" colSpan={3}>—</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="text-xs font-bold">TOTALE IVA</TableCell>
                        <TableCell className="text-xs text-right font-bold">{ivaTotals.pezzi}</TableCell>
                        <TableCell className="text-xs text-right font-bold" data-testid="totals-imponibile">{fmtCurrency(ivaTotals.imponibile)}</TableCell>
                        <TableCell className="text-xs text-right font-bold" data-testid="totals-imposta">{fmtCurrency(ivaTotals.imposta)}</TableCell>
                        <TableCell className="text-xs text-right font-bold" data-testid="totals-lordo">{fmtCurrency(ivaTotals.lordo)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden min-w-0 max-w-full">
                <CardContent className="p-0 min-w-0">
                  <div className="w-full max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
                    <Table className="min-w-[960px] [&_th]:px-2 [&_td]:px-2">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap min-w-[80px]">Data</TableHead>
                          <TableHead className="text-xs whitespace-nowrap min-w-[60px]">ID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap min-w-[100px]">PDV</TableHead>
                          <TableHead className="text-xs whitespace-nowrap min-w-[100px]">Ragione Sociale</TableHead>
                          <TableHead className="text-xs whitespace-nowrap min-w-[100px]">Cliente</TableHead>
                          <TableHead className="text-xs whitespace-nowrap min-w-[80px]">Cod. Art.</TableHead>
                          <TableHead className="text-xs whitespace-nowrap min-w-[100px]">Categoria</TableHead>
                          <TableHead className="text-xs whitespace-nowrap min-w-[140px]">Descrizione</TableHead>
                          <TableHead className="text-xs whitespace-nowrap min-w-[100px]">Cat. Fiscale</TableHead>
                          <TableHead className="text-xs whitespace-nowrap text-right min-w-[70px]">Aliquota</TableHead>
                          <TableHead className="text-xs whitespace-nowrap text-right min-w-[90px]">Imponibile</TableHead>
                          <TableHead className="text-xs whitespace-nowrap text-right min-w-[90px]">Imposta</TableHead>
                          <TableHead className="text-xs whitespace-nowrap text-right min-w-[90px]">Lordo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ivaRows.length === 0 ? (
                          <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">Nessun articolo nel periodo selezionato</TableCell></TableRow>
                        ) : (
                          ivaRows.slice(0, 500).map((r, idx) => {
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
                            return (
                              <TableRow
                                key={`${r.saleId}-${idx}`}
                                className={isFuori ? "opacity-60" : ""}
                                data-testid={`row-iva-${r.saleId}-${idx}`}
                              >
                                <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.data)}</TableCell>
                                <TableCell className="text-xs font-mono">{r.bisuiteId}</TableCell>
                                <TableCell className="text-xs">
                                  <div className="font-medium truncate max-w-[160px]" title={r.nomeNegozio}>{r.nomeNegozio}</div>
                                  <div className="text-muted-foreground font-mono text-[10px] truncate max-w-[160px]" title={r.codicePos}>{r.codicePos}</div>
                                </TableCell>
                                <TableCell className="text-xs">
                                  <div className="truncate max-w-[160px]" title={r.ragioneSociale}>{r.ragioneSociale}</div>
                                </TableCell>
                                <TableCell className="text-xs">
                                  <div className="truncate max-w-[160px]" title={r.nomeCliente}>{r.nomeCliente}</div>
                                </TableCell>
                                <TableCell className="text-xs font-mono">
                                  <div className="truncate max-w-[120px]" title={r.codiceArticolo || ""}>{r.codiceArticolo || "—"}</div>
                                </TableCell>
                                <TableCell className="text-xs">
                                  <div className="truncate max-w-[160px]" title={r.categoria}>{r.categoria}</div>
                                </TableCell>
                                <TableCell className="text-xs">
                                  <div className="truncate max-w-[260px]" title={r.descrizione}>{r.descrizione}</div>
                                </TableCell>
                                <TableCell className="text-xs">
                                  <Badge variant={FISCAL_CATEGORY_BADGE[r.fiscalCategory]} className="text-[10px] whitespace-nowrap">
                                    {FISCAL_CATEGORY_LABELS[r.fiscalCategory]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-right whitespace-nowrap">{aliquotaCell}</TableCell>
                                <TableCell className="text-xs text-right whitespace-nowrap">{(isStd || isNonStd || isNatura) ? fmtCurrency(r.imponibile) : "—"}</TableCell>
                                <TableCell className="text-xs text-right whitespace-nowrap">{(isStd || isNonStd) ? fmtCurrency(r.imposta) : "—"}</TableCell>
                                <TableCell className="text-xs text-right font-semibold whitespace-nowrap">{(isStd || isNonStd || isNatura) ? fmtCurrency(r.lordo) : "—"}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {ivaRows.length > 500 && (
                    <div className="p-3 text-center text-xs text-muted-foreground border-t">
                      Visualizzati i primi 500 articoli su {ivaRows.length}. Esporta in Excel per il dettaglio completo.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
