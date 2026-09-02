import { Badge } from "@/components/ui/badge";
import { ReceiptText } from "lucide-react";

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

const formatSaleDate = (value?: string | null) => {
  if (!value) return "Data non disponibile";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year}${hour && minute ? ` ${hour}:${minute}` : ""}`;
};

const formatMoney = (value?: string | number | null) => {
  const amount = typeof value === "number" ? value : Number.parseFloat(value || "0");
  return Number.isFinite(amount)
    ? amount.toLocaleString("it-IT", { style: "currency", currency: "EUR" })
    : "—";
};

export function PdvSalesDrilldown({ sales, emptyMessage = "Nessuna vendita disponibile per questo PDV." }: {
  sales: PdvSaleDetail[];
  emptyMessage?: string;
}) {
  return (
    <div className="px-3 py-3 bg-muted/20" data-testid="pdv-sales-drilldown">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <ReceiptText className="h-4 w-4 text-primary" />
          Vendite che compongono il totale attuale
        </div>
        <Badge variant="secondary">{sales.length} vendite</Badge>
      </div>
      {sales.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card max-h-72 overflow-y-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="border-b">
                <th className="text-left px-3 py-2 font-medium">Data e ora</th>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-left px-3 py-2 font-medium">Addetto</th>
                <th className="text-left px-3 py-2 font-medium">Contributi al totale</th>
                <th className="text-left px-3 py-2 font-medium">Stato</th>
                <th className="text-right px-3 py-2 font-medium">Totale vendita</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`pdv-sale-${sale.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div>{formatSaleDate(sale.dataVendita)}</div>
                    {sale.bisuiteId != null && <div className="text-[10px] text-muted-foreground">BiSuite #{sale.bisuiteId}</div>}
                  </td>
                  <td className="px-3 py-2">{sale.nomeCliente || "—"}</td>
                  <td className="px-3 py-2">{sale.nomeAddetto || "—"}</td>
                  <td className="px-3 py-2 max-w-[360px]">
                    {sale.contributions?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {sale.contributions.map((contribution) => (
                          <Badge key={contribution.key} variant="secondary" className="font-normal">
                            {contribution.label}: {contribution.unit === "euro"
                              ? formatMoney(contribution.value)
                              : `+${contribution.value}`}
                          </Badge>
                        ))}
                      </div>
                    ) : (sale.categorieArticoli || "—")}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={(sale.stato || "").trim().toUpperCase() === "ANNULLATA" ? "destructive" : "outline"}>
                      {sale.stato || "Registrata"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{formatMoney(sale.totale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Le proiezioni sono calcolate sui giorni lavorativi e non corrispondono a vendite future già registrate.
      </p>
    </div>
  );
}