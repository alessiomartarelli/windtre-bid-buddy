import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiUrl } from "@/lib/basePath";
import { useLocation } from "wouter";
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
  ArrowLeft,
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
} from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { AppNavbar } from "@/components/AppNavbar";

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
  categorie: Record<string, number>;
  vendite: BisuiteSale[];
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
  const [filterCategoria, setFilterCategoria] = useState<string>("all");

  const orgId = profile?.organizationId || "";

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

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    sales.forEach((s) => {
      if (s.categorieArticoli) {
        s.categorieArticoli.split(", ").forEach((c) => cats.add(c));
      }
    });
    return Array.from(cats).sort();
  }, [sales]);

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
          categorie: {},
          vendite: [],
        };
      }
      map[code].totaleVendite++;
      map[code].totaleImporto += parseFloat(sale.totale || "0") || 0;
      map[code].vendite.push(sale);

      if (sale.categorieArticoli) {
        sale.categorieArticoli.split(", ").forEach((cat) => {
          map[code].categorie[cat] = (map[code].categorie[cat] || 0) + 1;
        });
      }
    });
    return Object.values(map).sort((a, b) => b.totaleVendite - a.totaleVendite);
  }, [sales]);

  const filteredSales = useMemo(() => {
    let filtered = selectedPdv
      ? sales.filter((s) => (s.codicePos || "N/D") === selectedPdv)
      : sales;

    if (filterCategoria !== "all") {
      filtered = filtered.filter(
        (s) => s.categorieArticoli?.includes(filterCategoria)
      );
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
  }, [sales, selectedPdv, filterCategoria, searchTerm]);

  const totaleImporto = sales.reduce(
    (sum, s) => sum + (parseFloat(s.totale || "0") || 0),
    0
  );

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

      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Da</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
              data-testid="input-from-date"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">A</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40"
              data-testid="input-to-date"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
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
          <div className="space-y-1 min-w-[180px]">
            <Label className="text-xs">Categoria</Label>
            <Select value={filterCategoria} onValueChange={setFilterCategoria}>
              <SelectTrigger data-testid="select-categoria">
                <SelectValue placeholder="Tutte" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="all">Tutte le categorie</SelectItem>
                {allCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <ShoppingCart className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-2xl font-bold" data-testid="text-total-sales">
                    {sales.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Vendite Totali</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Euro className="h-5 w-5 mx-auto mb-1 text-green-500" />
                  <p
                    className="text-2xl font-bold text-green-600"
                    data-testid="text-total-amount"
                  >
                    {formatCurrency(totaleImporto)}
                  </p>
                  <p className="text-xs text-muted-foreground">Importo Totale</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Store className="h-5 w-5 mx-auto mb-1 text-blue-500" />
                  <p className="text-2xl font-bold" data-testid="text-total-pdv">
                    {pdvSummaries.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Punti Vendita</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <TrendingUp className="h-5 w-5 mx-auto mb-1 text-orange-500" />
                  <p className="text-2xl font-bold" data-testid="text-avg-sale">
                    {sales.length > 0
                      ? formatCurrency(totaleImporto / sales.length)
                      : "€ 0"}
                  </p>
                  <p className="text-xs text-muted-foreground">Media per Vendita</p>
                </CardContent>
              </Card>
            </div>

            {!selectedPdv && (
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
                          className="border rounded-lg px-4"
                        >
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center justify-between w-full pr-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                  <Store className="h-4 w-4 text-primary" />
                                </div>
                                <div className="text-left">
                                  <div className="font-semibold text-sm">
                                    {pdv.nomeNegozio}
                                  </div>
                                  <div className="text-xs text-muted-foreground font-mono">
                                    {pdv.codicePos}
                                    {pdv.ragioneSociale && (
                                      <span className="ml-2 font-sans">
                                        · {pdv.ragioneSociale}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <Badge variant="outline" className="text-xs">
                                  {pdv.totaleVendite} vendite
                                </Badge>
                                <Badge className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                                  {formatCurrency(pdv.totaleImporto)}
                                </Badge>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pb-2">
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(pdv.categorie)
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([cat, count]) => (
                                    <Badge
                                      key={cat}
                                      variant="secondary"
                                      className="text-xs"
                                    >
                                      {cat}: {count}
                                    </Badge>
                                  ))}
                              </div>
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
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredSales.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Nessuna vendita trovata per i filtri selezionati
                  </p>
                ) : (
                  <ScrollArea className="h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">Data</TableHead>
                          <TableHead>Negozio</TableHead>
                          <TableHead>Addetto</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Categorie</TableHead>
                          <TableHead>Stato</TableHead>
                          <TableHead className="text-right">Importo</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSales.map((sale) => (
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
                            <TableCell className="text-sm">
                              {sale.nomeAddetto || "-"}
                            </TableCell>
                            <TableCell className="text-sm">
                              {sale.nomeCliente || "-"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {(sale.categorieArticoli || "")
                                  .split(", ")
                                  .filter(Boolean)
                                  .map((cat) => (
                                    <Badge
                                      key={cat}
                                      variant="secondary"
                                      className="text-[10px] px-1.5 py-0"
                                    >
                                      {cat}
                                    </Badge>
                                  ))}
                              </div>
                            </TableCell>
                            <TableCell>
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
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <SaleDetailDialog
        sale={selectedSale}
        onClose={() => setSelectedSale(null)}
      />
    </div>
  );
}

function SaleDetailDialog({
  sale,
  onClose,
}: {
  sale: BisuiteSale | null;
  onClose: () => void;
}) {
  if (!sale) return null;

  const raw = sale.rawData || {};
  const articoli = raw.articoli || [];
  const pagamento = raw.pagamento || {};
  const cliente = raw.cliente || {};
  const addetto = raw.addetto || {};

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
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
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
              <CardContent className="px-4 pb-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrizione</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Tipologia</TableHead>
                      <TableHead className="text-right">Canone</TableHead>
                      <TableHead className="text-right">Prezzo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {articoli.map((art: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="text-sm font-medium">
                          {art.descrizione || art.codice || "-"}
                          {art.marca && (
                            <span className="text-xs text-muted-foreground ml-1">
                              ({art.marca})
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {art.categoria?.nome || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {art.tipologia?.nome || "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
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
                    ))}
                  </TableBody>
                </Table>

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

          {pagamento && (
            <details>
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Dettaglio Pagamento
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
