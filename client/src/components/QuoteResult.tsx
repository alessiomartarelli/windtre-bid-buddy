import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Download, FileText } from "lucide-react";

interface QuoteItem {
  id: string;
  description: string;
  pieces: number;
  points: number;
  currentEconomic: number;
  forecastEconomic: number;
}

interface QuoteResultProps {
  data: QuoteItem[];
}

export const QuoteResult = ({ data }: QuoteResultProps) => {
  const totals = data.reduce(
    (acc, item) => ({
      pieces: acc.pieces + item.pieces,
      points: acc.points + item.points,
      currentEconomic: acc.currentEconomic + item.currentEconomic,
      forecastEconomic: acc.forecastEconomic + item.forecastEconomic,
    }),
    { pieces: 0, points: 0, currentEconomic: 0, forecastEconomic: 0 }
  );

  const economicDiff = totals.forecastEconomic - totals.currentEconomic;
  const economicDiffPercent = ((economicDiff / totals.currentEconomic) * 100).toFixed(1);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR",
    }).format(value);
  };

  return (
    <div className="space-y-6">
      <Card className="border-border shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Preventivo Generato
            </span>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Esporta
            </Button>
          </CardTitle>
          <CardDescription>
            Riepilogo completo della gara con confronto attuale/previsionale
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Descrizione</TableHead>
                  <TableHead className="text-right">Pezzi</TableHead>
                  <TableHead className="text-right">Punti</TableHead>
                  <TableHead className="text-right">Economico Attuale</TableHead>
                  <TableHead className="text-right">Economico Previsionale</TableHead>
                  <TableHead className="text-right">Variazione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => {
                  const diff = item.forecastEconomic - item.currentEconomic;
                  const diffPercent = ((diff / item.currentEconomic) * 100).toFixed(1);
                  
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell className="text-right">{item.pieces}</TableCell>
                      <TableCell className="text-right">{item.points}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.currentEconomic)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(item.forecastEconomic)}</TableCell>
                      <TableCell className="text-right">
                        <Badge 
                          variant={diff >= 0 ? "default" : "destructive"} 
                          className={`gap-1 ${diff >= 0 ? 'bg-accent hover:bg-accent/90' : ''}`}
                        >
                          {diff >= 0 ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          {diffPercent}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-md bg-primary/5">
        <CardHeader>
          <CardTitle>Totali</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Pezzi Totali</p>
              <p className="text-2xl font-bold text-foreground">{totals.pieces}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Punti Totali</p>
              <p className="text-2xl font-bold text-foreground">{totals.points}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Economico Attuale</p>
              <p className="text-2xl font-bold text-foreground">{formatCurrency(totals.currentEconomic)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Economico Previsionale</p>
              <p className="text-2xl font-bold text-primary">{formatCurrency(totals.forecastEconomic)}</p>
              <Badge variant={economicDiff >= 0 ? "default" : "destructive"} className={`gap-1 mt-1 ${economicDiff >= 0 ? 'bg-accent hover:bg-accent/90' : ''}`}>
                {economicDiff >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {economicDiffPercent}%
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
