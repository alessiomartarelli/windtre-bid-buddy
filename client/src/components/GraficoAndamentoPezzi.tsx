import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PistaCanvass } from "@/lib/bisuiteClassification";

// Grafico a linee dell'andamento giornaliero dei KPI della Tabella PDV × Pista
// (Pezzi) nella pagina Vendite BiSuite: stessi conteggi classificati (stesse
// esclusioni annullate e filtri data/PDV/pista attivi), bucketizzati per data
// vendita. I colori delle 4 piste sono i colori semantici di categoria della
// tabella/dashboard (NON brand); il "Totale pezzi" usa il token --primary.
export interface PezziTrendPoint {
  /** Giorno in formato yyyy-MM-dd (già ordinato, senza buchi nel periodo). */
  day: string;
  mobile: number;
  fisso: number;
  energia: number;
  assicurazioni: number;
  iva: number;
  cb: number;
  telefoni: number;
}

type SeriesKey = keyof Omit<PezziTrendPoint, "day"> | "totale";

const SERIES: { key: SeriesKey; color: string; pista?: PistaCanvass; extra?: boolean }[] = [
  { key: "mobile", color: "#3b82f6", pista: "mobile" },
  { key: "fisso", color: "#22c55e", pista: "fisso" },
  { key: "energia", color: "#f59e0b", pista: "energia" },
  { key: "assicurazioni", color: "#a855f7", pista: "assicurazioni" },
  { key: "totale", color: "hsl(var(--primary))" },
  { key: "iva", color: "#64748b", extra: true },
  { key: "cb", color: "#f43f5e", extra: true },
  { key: "telefoni", color: "#06b6d4", extra: true },
];

const EXTRA_LABELS: Record<string, string> = { iva: "IVA", cb: "CB", telefoni: "Telefoni", totale: "Totale pezzi" };

const DEFAULT_ACTIVE: SeriesKey[] = ["mobile", "fisso", "energia", "assicurazioni"];

const fmtDay = (day: string) => {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
};

interface Props {
  data: PezziTrendPoint[];
  pistaLabels: Record<PistaCanvass, string>;
  /** Mostra anche i KPI extra (IVA/CB/Telefoni) tra le serie selezionabili. */
  hasExtra: boolean;
}

export function GraficoAndamentoPezzi({ data, pistaLabels, hasExtra }: Props) {
  const [active, setActive] = useState<Set<SeriesKey>>(new Set(DEFAULT_ACTIVE));

  const labelOf = (s: (typeof SERIES)[number]) =>
    s.pista ? pistaLabels[s.pista] : EXTRA_LABELS[s.key];

  const series = useMemo(
    () => SERIES.filter(s => hasExtra || !s.extra),
    [hasExtra],
  );

  const chartData = useMemo(
    () =>
      data.map(p => ({
        ...p,
        totale: p.mobile + p.fisso + p.energia + p.assicurazioni,
        label: fmtDay(p.day),
      })),
    [data],
  );

  const toggle = (key: SeriesKey) =>
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev; // almeno una serie sempre visibile
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  if (data.length === 0) return null;

  return (
    <Card data-testid="card-andamento-pezzi">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-5 w-5 text-primary" />
          Andamento KPI nel periodo
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {series.map(s => {
            const on = active.has(s.key);
            return (
              <Button
                key={s.key}
                type="button"
                variant="outline"
                size="sm"
                className={`h-7 px-2.5 text-xs gap-1.5 ${on ? "" : "opacity-45"}`}
                onClick={() => toggle(s.key)}
                data-testid={`btn-trend-${s.key}`}
                aria-pressed={on}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {labelOf(s)}
              </Button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]" data-testid="chart-andamento-pezzi">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={18} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "hsl(var(--popover-foreground))",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series
                .filter(s => active.has(s.key))
                .map(s => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={labelOf(s)}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    activeDot={{ r: 4.5 }}
                    isAnimationActive={false}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
