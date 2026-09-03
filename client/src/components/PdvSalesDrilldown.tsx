import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";

export interface PdvSaleDetail {
  id: string;
  bisuiteId?: number | null;
  dataVendita?: string | null;
  codicePos?: string | null;
  nomeNegozio?: string | null;
  nomeAddetto?: string | null;
  nomeCliente?: string | null;
  totale?: string | number | null;
  stato?: string | null;
  categorieArticoli?: string | null;
  contributions?: PdvSaleContribution[];
}

export interface PdvSaleContribution {
  key: string;
  label: string;
  value: number;
  unit?: "pezzi" | "euro";
}

const formatMoney = (value: number) =>
  value.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

const METRIC_ORDER = [
  "mobile", "fisso", "energia", "luce", "gas", "assicurazioni", "protecta",
  "iva_mobile", "iva_wireline", "vas", "iva", "cb", "telefoni", "accessori",
  "accEuro", "servizi", "srvEuro",
] as const;

const metricRank = (key: string) => {
  const normalized = key.split(":").pop() || key;
  const index = METRIC_ORDER.indexOf(normalized as typeof METRIC_ORDER[number]);
  return index === -1 ? METRIC_ORDER.length : index;
};

export function PdvSalesDrilldown({ sales, emptyMessage = "Nessuna vendita disponibile per questo PDV." }: {
  sales: PdvSaleDetail[];
  emptyMessage?: string;
}) {
  const metrics = Array.from(
    sales.reduce((totals, sale) => {
      for (const contribution of sale.contributions || []) {
        const current = totals.get(contribution.key);
        if (current) current.value += contribution.value;
        else totals.set(contribution.key, { ...contribution });
      }
      return totals;
    }, new Map<string, PdvSaleContribution>()).values(),
  ).sort((a, b) => metricRank(a.key) - metricRank(b.key) || a.label.localeCompare(b.label, "it"));

  return (
    <div className="px-3 py-3 bg-muted/20" data-testid="pdv-sales-drilldown">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <BarChart3 className="h-4 w-4 text-primary" />
          Dettaglio volumi del PDV
        </div>
      </div>
      {metrics.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">{emptyMessage}</p>
      ) : (
        <div className="rounded-md border bg-card px-3">
          {metrics.map((metric) => (
            <div
              key={metric.key}
              className="flex min-h-10 items-center justify-between gap-4 border-b py-2 last:border-0"
              data-testid={`pdv-metric-${metric.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
            >
              <span className="min-w-0 truncate text-sm text-muted-foreground">{metric.label}</span>
              <Badge
                variant="outline"
                className="shrink-0 px-2.5 py-1 text-sm font-bold tabular-nums"
              >
                {metric.unit === "euro" ? formatMoney(metric.value) : metric.value}
              </Badge>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Le proiezioni sono calcolate sui giorni lavorativi e non corrispondono a vendite future già registrate.
      </p>
    </div>
  );
}