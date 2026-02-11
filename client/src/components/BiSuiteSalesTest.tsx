import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, Download, Loader2, ShoppingCart, AlertCircle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, subDays } from "date-fns";
import { it } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Organization {
  id: string;
  name: string;
}

interface SalesData {
  id?: number;
  dataVendita?: string;
  importo?: number;
  cliente?: string;
  prodotto?: string;
  stato?: string;
  [key: string]: unknown;
}

interface BiSuiteSalesTestProps {
  organizations: Organization[];
}

export const BiSuiteSalesTest = ({ organizations }: BiSuiteSalesTestProps) => {
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [startDate, setStartDate] = useState<Date>(subDays(new Date(), 30));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [salesData, setSalesData] = useState<SalesData[] | null>(null);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleFetchSales = async () => {
    if (!selectedOrgId) {
      toast({
        title: "Organizzazione richiesta",
        description: "Seleziona un'organizzazione prima di recuperare le vendite",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setSalesData(null);
    setRawResponse(null);
    setTestResult(null);

    try {
      const res = await fetch('/api/admin/bisuite-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'fetch_sales',
          organization_id: selectedOrgId,
          start_date: format(startDate, 'yyyy-MM-dd'),
          end_date: format(endDate, 'yyyy-MM-dd'),
        }),
      });
      if (!res.ok) throw new Error('Failed to fetch sales');
      const data = await res.json();

      setRawResponse(data);

      // Try to extract sales array from response
      let sales: SalesData[] = [];
      if (Array.isArray(data)) {
        sales = data;
      } else if (data?.data && Array.isArray(data.data)) {
        sales = data.data;
      } else if (data?.vendite && Array.isArray(data.vendite)) {
        sales = data.vendite;
      } else if (data?.sales && Array.isArray(data.sales)) {
        sales = data.sales;
      }

      // Client-side filtering by date (in case API ignores date params)
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');
      
      const filteredSales = sales.filter((sale) => {
        // Try different date field names
        const saleDateStr = sale.dataVendita || sale.data || sale.date || sale.createdAt;
        if (!saleDateStr) return true; // Keep if no date field
        
        // Extract just the date part (YYYY-MM-DD)
        const saleDate = String(saleDateStr).slice(0, 10);
        return saleDate >= startDateStr && saleDate <= endDateStr;
      });

      const totalFromApi = sales.length;
      const filteredCount = filteredSales.length;

      setSalesData(filteredSales);
      setTestResult({
        success: true,
        message: `Recuperate ${filteredCount} vendite (${totalFromApi} totali dall'API, filtrate per date ${startDateStr} - ${endDateStr})`,
      });

      toast({
        title: "Vendite recuperate",
        description: `${filteredCount} nel periodo (API: ${totalFromApi})`,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
      setTestResult({
        success: false,
        message: errorMessage,
      });
      toast({
        title: "Errore",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedOrgId) {
      toast({
        title: "Organizzazione richiesta",
        description: "Seleziona un'organizzazione prima di testare",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/admin/bisuite-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'test',
          organization_id: selectedOrgId,
        }),
      });
      if (!res.ok) throw new Error('Connection test failed');
      const data = await res.json();

      setRawResponse(data);
      
      const success = data?.success === true || data?.tokenObtained === true;
      setTestResult({
        success,
        message: success ? 'Connessione riuscita' : (data?.message || 'Test fallito'),
      });

      toast({
        title: success ? "Test OK" : "Test fallito",
        description: data?.message || (success ? 'Connessione verificata' : 'Errore nella connessione'),
        variant: success ? "default" : "destructive",
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
      setTestResult({
        success: false,
        message: errorMessage,
      });
      toast({
        title: "Errore",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getSalesColumns = (): string[] => {
    if (!salesData || salesData.length === 0) return [];
    const firstItem = salesData[0];
    return Object.keys(firstItem).slice(0, 6); // Show first 6 columns
  };

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') return value.toLocaleString('it-IT', { maximumFractionDigits: 2 });
    if (typeof value === 'boolean') return value ? 'Sì' : 'No';
    if (typeof value === 'object') return JSON.stringify(value).slice(0, 50) + '...';
    return String(value);
  };

  const getTotalAmount = (): number => {
    if (!salesData) return 0;
    return salesData.reduce((sum, sale) => {
      const amount = sale.importo ?? sale.amount ?? sale.totale ?? 0;
      return sum + (typeof amount === 'number' ? amount : 0);
    }, 0);
  };

  return (
    <Card className="border-border shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ShoppingCart className="h-5 w-5 text-primary" />
          Test Fetch Vendite BiSuite
        </CardTitle>
        <CardDescription>
          Recupera le vendite da BiSuite per un intervallo di date
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Organization selector */}
          <div className="space-y-2">
            <Label htmlFor="org-sales">Organizzazione *</Label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona un'organizzazione" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data Inizio</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "PPP", { locale: it }) : "Seleziona data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Data Fine</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "PPP", { locale: it }) : "Seleziona data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setEndDate(date)}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={isLoading || !selectedOrgId}
              className="flex-1"
            >
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Testa Connessione
            </Button>
            <Button
              onClick={handleFetchSales}
              disabled={isLoading || !selectedOrgId}
              className="flex-1"
            >
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Recupera Vendite
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={cn(
              "flex items-center gap-2 p-3 rounded-lg",
              testResult.success ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
            )}>
              {testResult.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">{testResult.message}</span>
            </div>
          )}

          {/* Summary */}
          {salesData && salesData.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{salesData.length}</p>
                <p className="text-xs text-muted-foreground">Vendite Totali</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-primary">
                  €{getTotalAmount().toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-muted-foreground">Importo Totale</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-foreground">
                  {format(startDate, 'dd/MM/yyyy')}
                </p>
                <p className="text-xs text-muted-foreground">Data Inizio</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-foreground">
                  {format(endDate, 'dd/MM/yyyy')}
                </p>
                <p className="text-xs text-muted-foreground">Data Fine</p>
              </div>
            </div>
          )}

          {/* Results table */}
          {salesData && salesData.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Risultati ({salesData.length} record)</Label>
                <Badge variant="outline">
                  Colonne: {getSalesColumns().join(', ')}
                </Badge>
              </div>
              <ScrollArea className="h-[300px] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {getSalesColumns().map((col) => (
                        <TableHead key={col} className="whitespace-nowrap">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesData.slice(0, 50).map((sale, idx) => (
                      <TableRow key={idx}>
                        {getSalesColumns().map((col) => (
                          <TableCell key={col} className="whitespace-nowrap">
                            {formatCellValue(sale[col])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              {salesData.length > 50 && (
                <p className="text-xs text-muted-foreground text-center">
                  Mostrando 50 di {salesData.length} record
                </p>
              )}
            </div>
          )}

          {/* Empty state */}
          {salesData && salesData.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <ShoppingCart className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Nessuna vendita trovata per il periodo selezionato</p>
            </div>
          )}

          {/* Raw response (collapsible for debugging) */}
          {rawResponse && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Mostra risposta raw (debug)
              </summary>
              <pre className="mt-2 p-3 bg-muted rounded-lg overflow-auto max-h-[200px]">
                {JSON.stringify(rawResponse, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
