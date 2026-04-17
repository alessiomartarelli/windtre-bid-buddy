import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiUrl } from "@/lib/basePath";
import { AppNavbar } from "@/components/AppNavbar";
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
  BookOpen, Receipt, Loader2, Download, Search,
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
  rawData: any;
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

function num(v: any): number {
  const n = parseFloat(v ?? "0");
  return isNaN(n) ? 0 : n;
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
  contanti: number;
  pos: number;
  finanziato: number;
  varCredito: number;
  nonScontrinato: number;
  nonScontrinatoPos: number;
  bonifici: number;
  assegni: number;
  buoni: number;
  coupon: number;
  altriPagamenti: number;
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
  categoria: string;
  tipologia: string;
  descrizione: string;
  aliquota: number;
  imponibile: number;
  imposta: number;
  lordo: number;
  fuoriScontrino: boolean;
}

function buildContabileRows(sales: BisuiteSale[]): ContabileRow[] {
  return sales.map((s) => {
    const pag = s.rawData?.pagamento || {};
    const articoli: any[] = Array.isArray(s.rawData?.articoli) ? s.rawData.articoli : [];
    let finanziato = 0;
    let varCredito = 0;
    for (const art of articoli) {
      const det = art?.dettaglio;
      if (!det) continue;
      finanziato += num(det.importoFinanziato);
      varCredito += num(det.importoCredito);
    }
    const matricolaFiscale =
      s.rawData?.matricolaFiscale ||
      s.rawData?.matricola_fiscale ||
      s.rawData?.matricola ||
      s.rawData?.negozio?.matricolaFiscale ||
      s.rawData?.negozio?.matricola ||
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
      matricolaFiscale: String(matricolaFiscale || ""),
      totale: num(s.totale),
      contanti: num(pag.contanti),
      pos: num(pag.pagamentiElettronici),
      finanziato,
      varCredito,
      nonScontrinato: num(pag.nonScontrinato),
      nonScontrinatoPos: num(pag.nonScontrinatoPos),
      bonifici: num(pag.bonifici),
      assegni: num(pag.assegni),
      buoni: num(pag.buoni),
      coupon: num(pag.coupon),
      altriPagamenti: num(pag.altriPagamenti),
    };
  }).sort((a, b) => a.dataMs - b.dataMs || a.bisuiteId - b.bisuiteId);
}

function buildIvaRows(sales: BisuiteSale[]): IvaRow[] {
  const rows: IvaRow[] = [];
  for (const s of sales) {
    const articoli: any[] = Array.isArray(s.rawData?.articoli) ? s.rawData.articoli : [];
    const dataMs = s.dataVendita ? new Date(s.dataVendita).getTime() : 0;
    for (const art of articoli) {
      const det = art?.dettaglio || {};
      const importoScontrino = num(det.importoScontrino);
      const importoImponibile = num(det.importoImponibile);
      const aliquota = num(det.aliquotaPrezzo);
      let imponibile = importoImponibile;
      let lordo = importoScontrino;
      let imposta = 0;
      const fuoriScontrino = aliquota === 0 && importoScontrino === 0 && importoImponibile === 0;

      if (fuoriScontrino) {
        imponibile = 0;
        lordo = 0;
        imposta = 0;
      } else if (importoScontrino > 0 && importoImponibile > 0) {
        imposta = importoScontrino - importoImponibile;
      } else if (importoImponibile > 0 && aliquota > 0) {
        imposta = (importoImponibile * aliquota) / 100;
        lordo = importoImponibile + imposta;
      } else if (importoScontrino > 0 && aliquota > 0) {
        imponibile = importoScontrino / (1 + aliquota / 100);
        imposta = importoScontrino - imponibile;
      }

      rows.push({
        saleId: s.id,
        bisuiteId: s.bisuiteId,
        data: s.dataVendita,
        dataMs: isNaN(dataMs) ? 0 : dataMs,
        codicePos: s.codicePos || "",
        nomeNegozio: s.nomeNegozio || "",
        ragioneSociale: s.ragioneSociale || "",
        nomeCliente: s.nomeCliente || "",
        categoria: (art?.categoria?.nome || "").trim(),
        tipologia: (art?.tipologia?.nome || "").trim(),
        descrizione: (art?.descrizione || "").trim(),
        aliquota,
        imponibile,
        imposta,
        lordo,
        fuoriScontrino,
      });
    }
  }
  return rows.sort((a, b) => a.dataMs - b.dataMs || a.bisuiteId - b.bisuiteId);
}

export default function Amministrazione() {
  const { profile, loading } = useAuth();
  const [, setLocation] = useLocation();
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [filterPdv, setFilterPdv] = useState<string>("all");
  const [filterRs, setFilterRs] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabKey>("contabile");
  const [escludiZero, setEscludiZero] = useState<boolean>(false);

  const orgId = profile?.organizationId || "";
  const isAuthorized = !!profile && ["admin", "super_admin"].includes(profile.role);

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
    const cur = now.getFullYear();
    return [cur - 2, cur - 1, cur, cur + 1];
  }, [now]);

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
    if (!escludiZero) return ivaRowsAll;
    return ivaRowsAll.filter((r) => !r.fuoriScontrino && (r.imponibile !== 0 || r.imposta !== 0 || r.lordo !== 0));
  }, [ivaRowsAll, escludiZero]);

  const contabileTotals = useMemo(() => {
    const t = {
      totale: 0, contanti: 0, pos: 0, finanziato: 0, varCredito: 0,
      nonScontrinato: 0, nonScontrinatoPos: 0, bonifici: 0, assegni: 0,
      buoni: 0, coupon: 0, altriPagamenti: 0,
    };
    for (const r of contabileRows) {
      t.totale += r.totale; t.contanti += r.contanti; t.pos += r.pos;
      t.finanziato += r.finanziato; t.varCredito += r.varCredito;
      t.nonScontrinato += r.nonScontrinato; t.nonScontrinatoPos += r.nonScontrinatoPos;
      t.bonifici += r.bonifici; t.assegni += r.assegni;
      t.buoni += r.buoni; t.coupon += r.coupon; t.altriPagamenti += r.altriPagamenti;
    }
    return t;
  }, [contabileRows]);

  const ivaPerAliquota = useMemo(() => {
    const map = new Map<number, { imponibile: number; imposta: number; lordo: number; pezzi: number }>();
    let fuori = { pezzi: 0 };
    for (const r of ivaRows) {
      if (r.fuoriScontrino) { fuori.pezzi++; continue; }
      const k = r.aliquota;
      if (!map.has(k)) map.set(k, { imponibile: 0, imposta: 0, lordo: 0, pezzi: 0 });
      const e = map.get(k)!;
      e.imponibile += r.imponibile;
      e.imposta += r.imposta;
      e.lordo += r.lordo;
      e.pezzi++;
    }
    const arr = Array.from(map.entries())
      .map(([aliquota, v]) => ({ aliquota, ...v }))
      .sort((a, b) => a.aliquota - b.aliquota);
    return { perAliquota: arr, fuori };
  }, [ivaRows]);

  const ivaTotals = useMemo(() => {
    const t = { imponibile: 0, imposta: 0, lordo: 0 };
    for (const e of ivaPerAliquota.perAliquota) {
      t.imponibile += e.imponibile; t.imposta += e.imposta; t.lordo += e.lordo;
    }
    return t;
  }, [ivaPerAliquota]);

  const periodSuffix = `${year}_${String(month).padStart(2, "0")}`;

  const exportContabile = () => {
    const wb = XLSX.utils.book_new();
    const dettaglio = contabileRows.map((r) => ({
      "Data": fmtDate(r.data),
      "ID Scontrino": r.bisuiteId,
      "Codice POS": r.codicePos,
      "Punto Vendita": r.nomeNegozio,
      "Ragione Sociale": r.ragioneSociale,
      "Matricola Fiscale": r.matricolaFiscale,
      "Addetto": r.nomeAddetto,
      "Cliente": r.nomeCliente,
      "Totale": r.totale,
      "Contanti": r.contanti,
      "POS": r.pos,
      "Finanziato": r.finanziato,
      "VAR/Credito": r.varCredito,
      "Non Scontr. Cont.": r.nonScontrinato,
      "Non Scontr. POS": r.nonScontrinatoPos,
      "Bonifici": r.bonifici,
      "Assegni": r.assegni,
      "Buoni": r.buoni,
      "Coupon": r.coupon,
      "Altri Pagamenti": r.altriPagamenti,
    }));
    dettaglio.push({
      "Data": "TOTALE",
      "ID Scontrino": "" as any,
      "Codice POS": "",
      "Punto Vendita": "",
      "Ragione Sociale": "",
      "Matricola Fiscale": "",
      "Addetto": "",
      "Cliente": "",
      "Totale": contabileTotals.totale,
      "Contanti": contabileTotals.contanti,
      "POS": contabileTotals.pos,
      "Finanziato": contabileTotals.finanziato,
      "VAR/Credito": contabileTotals.varCredito,
      "Non Scontr. Cont.": contabileTotals.nonScontrinato,
      "Non Scontr. POS": contabileTotals.nonScontrinatoPos,
      "Bonifici": contabileTotals.bonifici,
      "Assegni": contabileTotals.assegni,
      "Buoni": contabileTotals.buoni,
      "Coupon": contabileTotals.coupon,
      "Altri Pagamenti": contabileTotals.altriPagamenti,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dettaglio), "Prima Nota Contabile");

    const summary = [
      { "Metodo Pagamento": "Contanti", "Importo": contabileTotals.contanti },
      { "Metodo Pagamento": "POS", "Importo": contabileTotals.pos },
      { "Metodo Pagamento": "Finanziato", "Importo": contabileTotals.finanziato },
      { "Metodo Pagamento": "VAR/Credito", "Importo": contabileTotals.varCredito },
      { "Metodo Pagamento": "Non Scontrinato Contanti", "Importo": contabileTotals.nonScontrinato },
      { "Metodo Pagamento": "Non Scontrinato POS", "Importo": contabileTotals.nonScontrinatoPos },
      { "Metodo Pagamento": "Bonifici", "Importo": contabileTotals.bonifici },
      { "Metodo Pagamento": "Assegni", "Importo": contabileTotals.assegni },
      { "Metodo Pagamento": "Buoni", "Importo": contabileTotals.buoni },
      { "Metodo Pagamento": "Coupon", "Importo": contabileTotals.coupon },
      { "Metodo Pagamento": "Altri Pagamenti", "Importo": contabileTotals.altriPagamenti },
      { "Metodo Pagamento": "TOTALE", "Importo": contabileTotals.totale },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Riepilogo Pagamenti");

    XLSX.writeFile(wb, `prima_nota_contabile_${periodSuffix}.xlsx`);
  };

  const exportIva = () => {
    const wb = XLSX.utils.book_new();
    const dettaglio = ivaRows.map((r) => ({
      "Data": fmtDate(r.data),
      "ID Scontrino": r.bisuiteId,
      "Codice POS": r.codicePos,
      "Punto Vendita": r.nomeNegozio,
      "Ragione Sociale": r.ragioneSociale,
      "Cliente": r.nomeCliente,
      "Categoria": r.categoria,
      "Tipologia": r.tipologia,
      "Descrizione": r.descrizione,
      "Aliquota %": r.fuoriScontrino ? "" : r.aliquota,
      "Imponibile": r.fuoriScontrino ? "" : r.imponibile,
      "Imposta": r.fuoriScontrino ? "" : r.imposta,
      "Lordo": r.fuoriScontrino ? "" : r.lordo,
      "Fuori Scontrino": r.fuoriScontrino ? "SI" : "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dettaglio), "Prima Nota IVA");

    const riepilogo: any[] = ivaPerAliquota.perAliquota.map((e) => ({
      "Aliquota %": e.aliquota,
      "Pezzi": e.pezzi,
      "Imponibile": e.imponibile,
      "Imposta": e.imposta,
      "Lordo": e.lordo,
    }));
    if (ivaPerAliquota.fuori.pezzi > 0) {
      riepilogo.push({
        "Aliquota %": "Fuori scontrino",
        "Pezzi": ivaPerAliquota.fuori.pezzi,
        "Imponibile": "",
        "Imposta": "",
        "Lordo": "",
      });
    }
    riepilogo.push({
      "Aliquota %": "TOTALE",
      "Pezzi": ivaPerAliquota.perAliquota.reduce((s, e) => s + e.pezzi, 0),
      "Imponibile": ivaTotals.imponibile,
      "Imposta": ivaTotals.imposta,
      "Lordo": ivaTotals.lordo,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riepilogo), "Riepilogo IVA");

    XLSX.writeFile(wb, `prima_nota_iva_${periodSuffix}.xlsx`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex flex-col">
        <AppNavbar />
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>Accesso non autorizzato</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Solo amministratori e super admin possono accedere a questa pagina.
              </p>
              <Button onClick={() => setLocation("/")} data-testid="button-go-home">Torna alla Home</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppNavbar />
      <main className="flex-1 container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
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
                <Button onClick={exportIva} disabled={ivaRows.length === 0} data-testid="button-export-iva">
                  <Download className="h-4 w-4 mr-2" />
                  Esporta IVA
                </Button>
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
                    <div><div className="text-xs text-muted-foreground">Contanti</div><div className="font-semibold text-green-600">{fmtCurrency(contabileTotals.contanti)}</div></div>
                    <div><div className="text-xs text-muted-foreground">POS</div><div className="font-semibold text-blue-600">{fmtCurrency(contabileTotals.pos)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Finanziato</div><div className="font-semibold text-purple-600">{fmtCurrency(contabileTotals.finanziato)}</div></div>
                    <div><div className="text-xs text-muted-foreground">VAR/Credito</div><div className="font-semibold text-amber-600">{fmtCurrency(contabileTotals.varCredito)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Non Scontr. Cont.</div><div className="font-semibold text-red-600">{fmtCurrency(contabileTotals.nonScontrinato)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Non Scontr. POS</div><div className="font-semibold text-rose-600">{fmtCurrency(contabileTotals.nonScontrinatoPos)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Bonifici</div><div className="font-semibold">{fmtCurrency(contabileTotals.bonifici)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Assegni</div><div className="font-semibold">{fmtCurrency(contabileTotals.assegni)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Buoni</div><div className="font-semibold">{fmtCurrency(contabileTotals.buoni)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Coupon</div><div className="font-semibold">{fmtCurrency(contabileTotals.coupon)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Altri</div><div className="font-semibold">{fmtCurrency(contabileTotals.altriPagamenti)}</div></div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">ID</TableHead>
                        <TableHead className="text-xs">PDV</TableHead>
                        <TableHead className="text-xs">Ragione Sociale</TableHead>
                        <TableHead className="text-xs">Matricola</TableHead>
                        <TableHead className="text-xs">Addetto</TableHead>
                        <TableHead className="text-xs">Cliente</TableHead>
                        <TableHead className="text-xs text-right">Totale</TableHead>
                        <TableHead className="text-xs text-right">Contanti</TableHead>
                        <TableHead className="text-xs text-right">POS</TableHead>
                        <TableHead className="text-xs text-right">Finanz.</TableHead>
                        <TableHead className="text-xs text-right">VAR</TableHead>
                        <TableHead className="text-xs text-right">N.Sc. Cont.</TableHead>
                        <TableHead className="text-xs text-right">N.Sc. POS</TableHead>
                        <TableHead className="text-xs text-right">Bonifici</TableHead>
                        <TableHead className="text-xs text-right">Assegni</TableHead>
                        <TableHead className="text-xs text-right">Buoni</TableHead>
                        <TableHead className="text-xs text-right">Coupon</TableHead>
                        <TableHead className="text-xs text-right">Altri</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contabileRows.length === 0 ? (
                        <TableRow><TableCell colSpan={19} className="text-center text-muted-foreground py-8">Nessuno scontrino nel periodo selezionato</TableCell></TableRow>
                      ) : (
                        contabileRows.map((r) => (
                          <TableRow key={r.saleId} data-testid={`row-contabile-${r.saleId}`}>
                            <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.data)}</TableCell>
                            <TableCell className="text-xs font-mono">{r.bisuiteId}</TableCell>
                            <TableCell className="text-xs">
                              <div className="font-medium truncate max-w-[160px]">{r.nomeNegozio}</div>
                              <div className="text-muted-foreground font-mono text-[10px]">{r.codicePos}</div>
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[140px]">{r.ragioneSociale}</TableCell>
                            <TableCell className="text-xs font-mono truncate max-w-[120px]">{r.matricolaFiscale || "—"}</TableCell>
                            <TableCell className="text-xs truncate max-w-[120px]">{r.nomeAddetto}</TableCell>
                            <TableCell className="text-xs truncate max-w-[140px]">{r.nomeCliente}</TableCell>
                            <TableCell className="text-xs text-right font-semibold">{fmtCurrency(r.totale)}</TableCell>
                            <TableCell className="text-xs text-right text-green-600">{r.contanti > 0 ? fmtCurrency(r.contanti) : "—"}</TableCell>
                            <TableCell className="text-xs text-right text-blue-600">{r.pos > 0 ? fmtCurrency(r.pos) : "—"}</TableCell>
                            <TableCell className="text-xs text-right text-purple-600">{r.finanziato > 0 ? fmtCurrency(r.finanziato) : "—"}</TableCell>
                            <TableCell className="text-xs text-right text-amber-600">{r.varCredito > 0 ? fmtCurrency(r.varCredito) : "—"}</TableCell>
                            <TableCell className="text-xs text-right text-red-600">{r.nonScontrinato > 0 ? fmtCurrency(r.nonScontrinato) : "—"}</TableCell>
                            <TableCell className="text-xs text-right text-rose-600">{r.nonScontrinatoPos > 0 ? fmtCurrency(r.nonScontrinatoPos) : "—"}</TableCell>
                            <TableCell className="text-xs text-right">{r.bonifici > 0 ? fmtCurrency(r.bonifici) : "—"}</TableCell>
                            <TableCell className="text-xs text-right">{r.assegni > 0 ? fmtCurrency(r.assegni) : "—"}</TableCell>
                            <TableCell className="text-xs text-right">{r.buoni > 0 ? fmtCurrency(r.buoni) : "—"}</TableCell>
                            <TableCell className="text-xs text-right">{r.coupon > 0 ? fmtCurrency(r.coupon) : "—"}</TableCell>
                            <TableCell className="text-xs text-right">{r.altriPagamenti > 0 ? fmtCurrency(r.altriPagamenti) : "—"}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    {contabileRows.length > 0 && (
                      <TableFooter>
                        <TableRow data-testid="row-contabile-totals">
                          <TableCell colSpan={7} className="text-xs font-bold">TOTALE</TableCell>
                          <TableCell className="text-xs text-right font-bold">{fmtCurrency(contabileTotals.totale)}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-green-600">{fmtCurrency(contabileTotals.contanti)}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-blue-600">{fmtCurrency(contabileTotals.pos)}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-purple-600">{fmtCurrency(contabileTotals.finanziato)}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-amber-600">{fmtCurrency(contabileTotals.varCredito)}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-red-600">{fmtCurrency(contabileTotals.nonScontrinato)}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-rose-600">{fmtCurrency(contabileTotals.nonScontrinatoPos)}</TableCell>
                          <TableCell className="text-xs text-right font-bold">{fmtCurrency(contabileTotals.bonifici)}</TableCell>
                          <TableCell className="text-xs text-right font-bold">{fmtCurrency(contabileTotals.assegni)}</TableCell>
                          <TableCell className="text-xs text-right font-bold">{fmtCurrency(contabileTotals.buoni)}</TableCell>
                          <TableCell className="text-xs text-right font-bold">{fmtCurrency(contabileTotals.coupon)}</TableCell>
                          <TableCell className="text-xs text-right font-bold">{fmtCurrency(contabileTotals.altriPagamenti)}</TableCell>
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="iva" className="space-y-4">
              <div className="flex items-center justify-end gap-2">
                <Label htmlFor="escludi-zero" className="text-xs cursor-pointer">
                  Escludi righe a 0 (fuori scontrino)
                </Label>
                <Switch
                  id="escludi-zero"
                  checked={escludiZero}
                  onCheckedChange={setEscludiZero}
                  data-testid="switch-escludi-zero"
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Riepilogo IVA per Aliquota</span>
                    <Badge variant="outline" data-testid="badge-iva-count">
                      {ivaRows.length} articoli
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Aliquota</TableHead>
                        <TableHead className="text-xs text-right">Pezzi</TableHead>
                        <TableHead className="text-xs text-right">Imponibile</TableHead>
                        <TableHead className="text-xs text-right">Imposta</TableHead>
                        <TableHead className="text-xs text-right">Lordo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ivaPerAliquota.perAliquota.map((e) => (
                        <TableRow key={e.aliquota} data-testid={`row-aliquota-${e.aliquota}`}>
                          <TableCell className="text-xs font-semibold">{e.aliquota}%</TableCell>
                          <TableCell className="text-xs text-right">{e.pezzi}</TableCell>
                          <TableCell className="text-xs text-right">{fmtCurrency(e.imponibile)}</TableCell>
                          <TableCell className="text-xs text-right">{fmtCurrency(e.imposta)}</TableCell>
                          <TableCell className="text-xs text-right font-semibold">{fmtCurrency(e.lordo)}</TableCell>
                        </TableRow>
                      ))}
                      {ivaPerAliquota.fuori.pezzi > 0 && (
                        <TableRow data-testid="row-fuori-scontrino">
                          <TableCell className="text-xs text-muted-foreground italic">Fuori scontrino</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{ivaPerAliquota.fuori.pezzi}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground" colSpan={3}>(canoni/servizi fatturati a parte)</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="text-xs font-bold">TOTALE</TableCell>
                        <TableCell className="text-xs text-right font-bold">{ivaPerAliquota.perAliquota.reduce((s, e) => s + e.pezzi, 0)}</TableCell>
                        <TableCell className="text-xs text-right font-bold" data-testid="totals-imponibile">{fmtCurrency(ivaTotals.imponibile)}</TableCell>
                        <TableCell className="text-xs text-right font-bold" data-testid="totals-imposta">{fmtCurrency(ivaTotals.imposta)}</TableCell>
                        <TableCell className="text-xs text-right font-bold" data-testid="totals-lordo">{fmtCurrency(ivaTotals.lordo)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">ID</TableHead>
                        <TableHead className="text-xs">PDV</TableHead>
                        <TableHead className="text-xs">Categoria</TableHead>
                        <TableHead className="text-xs">Descrizione</TableHead>
                        <TableHead className="text-xs text-right">Aliquota</TableHead>
                        <TableHead className="text-xs text-right">Imponibile</TableHead>
                        <TableHead className="text-xs text-right">Imposta</TableHead>
                        <TableHead className="text-xs text-right">Lordo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ivaRows.length === 0 ? (
                        <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nessun articolo nel periodo selezionato</TableCell></TableRow>
                      ) : (
                        ivaRows.slice(0, 500).map((r, idx) => (
                          <TableRow key={`${r.saleId}-${idx}`} className={r.fuoriScontrino ? "opacity-60" : ""} data-testid={`row-iva-${r.saleId}-${idx}`}>
                            <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.data)}</TableCell>
                            <TableCell className="text-xs font-mono">{r.bisuiteId}</TableCell>
                            <TableCell className="text-xs">
                              <div className="font-medium truncate max-w-[140px]">{r.nomeNegozio}</div>
                              <div className="text-muted-foreground font-mono text-[10px]">{r.codicePos}</div>
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[140px]">{r.categoria}</TableCell>
                            <TableCell className="text-xs truncate max-w-[200px]">{r.descrizione}</TableCell>
                            <TableCell className="text-xs text-right">{r.fuoriScontrino ? "—" : `${r.aliquota}%`}</TableCell>
                            <TableCell className="text-xs text-right">{r.fuoriScontrino ? "—" : fmtCurrency(r.imponibile)}</TableCell>
                            <TableCell className="text-xs text-right">{r.fuoriScontrino ? "—" : fmtCurrency(r.imposta)}</TableCell>
                            <TableCell className="text-xs text-right font-semibold">{r.fuoriScontrino ? "—" : fmtCurrency(r.lordo)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {ivaRows.length > 500 && (
                    <div className="p-3 text-center text-xs text-muted-foreground border-t">
                      Visualizzati i primi 500 articoli su {ivaRows.length}. Esporta in Excel per il dettaglio completo.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
