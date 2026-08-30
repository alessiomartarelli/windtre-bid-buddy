import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { PistaCanvass, TrendExtraKey } from "@/lib/bisuiteClassification";

// Grafico a linee dell'andamento giornaliero dei KPI della Tabella PDV × Pista
// (Pezzi) nella pagina Vendite BiSuite: stessi conteggi classificati (stesse
// esclusioni annullate e filtri data/PDV/pista attivi), bucketizzati per data
// vendita. I colori delle piste sono i colori semantici di categoria della
// tabella/dashboard (NON brand); il "Totale pezzi" usa il token --primary.
//
// Task #534 — le serie pista NON sono più un elenco fisso WindTre: arrivano
// via props dalla tassonomia condivisa (trendPisteForModel/trendExtraForModel
// in shared/bisuiteClassification.ts), così il grafico mostra le piste giuste
// per il modello brand attivo (VF: Mobile/Fisso/CB/Luce/Gas/IVA Mobile/
// IVA Wireline/VAS; WindTre: comportamento storico).
//
// Stile Vision UI (Task #418): area sfumata sotto ogni linea attiva (gradiente
// dal colore della serie a trasparente), griglia più tenue, tooltip glass.
export interface PezziTrendPoint {
  /** Giorno in formato yyyy-MM-dd (già ordinato, senza buchi nel periodo). */
  day: string;
  /** Pezzi per pista del modello attivo. */
  perPista: Partial<Record<PistaCanvass, number>>;
  iva: number;
  cb: number;
  telefoni: number;
}

type SeriesKey = string;

// Colori semantici per pista (stessi hue delle icone della tabella/dashboard).
const PISTA_TREND_COLORS: Record<PistaCanvass, string> = {
  mobile: "#3b82f6",
  fisso: "#22c55e",
  energia: "#f59e0b",
  assicurazioni: "#a855f7",
  protecta: "#f43f5e",
  cb: "#06b6d4",
  iva: "#64748b",
  luce: "#eab308",
  gas: "#fb923c",
  iva_mobile: "#38bdf8",
  iva_wireline: "#a78bfa",
  vas: "#2dd4bf",
};

const EXTRA_COLORS: Record<TrendExtraKey, string> = {
  iva: "#64748b",
  cb: "#f43f5e",
  telefoni: "#06b6d4",
};

const EXTRA_LABELS: Record<TrendExtraKey | "totale", string> = {
  iva: "IVA",
  cb: "CB",
  telefoni: "Telefoni",
  totale: "Totale pezzi",
};

const fmtDay = (day: string) => {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
};

// Gradient stop opacities: top (5%) e bottom (95%).
// Leggermente più intensi si leggono bene sia in light che in dark.
const GRAD_TOP = 0.22;
const GRAD_BOT = 0;

type SeriesDef = { key: SeriesKey; color: string; pista?: PistaCanvass; extra?: boolean };

interface Props {
  data: PezziTrendPoint[];
  pistaLabels: Record<PistaCanvass, string>;
  /** Piste (in ordine) del modello brand attivo — tassonomia condivisa. */
  piste: readonly PistaCanvass[];
  /** KPI extra selezionabili per il modello attivo (vuoto = nessuno). */
  extras: readonly TrendExtraKey[];
  /** Mostra anche i KPI extra tra le serie selezionabili. */
  hasExtra: boolean;
}

export function GraficoAndamentoPezzi({ data, pistaLabels, piste, extras, hasExtra }: Props) {
  const series = useMemo((): SeriesDef[] => [
    ...piste.map((p): SeriesDef => ({ key: p, color: PISTA_TREND_COLORS[p], pista: p })),
    { key: "totale", color: "hsl(var(--primary))" },
    ...(hasExtra ? extras.map((k): SeriesDef => ({ key: k, color: EXTRA_COLORS[k], extra: true })) : []),
  ], [piste, extras, hasExtra]);

  const [active, setActive] = useState<Set<SeriesKey>>(() => new Set(piste));

  // Task #534 — se il set di piste cambia (es. transizione asincrona da
  // WindTre a VF quando arriva il riferimento canvass), riallinea lo stato
  // delle serie attive: senza reset resterebbero attive solo le chiavi in
  // comune (e chiavi stantie del vecchio modello). Adjust-state-in-render.
  const [pisteSig, setPisteSig] = useState(() => piste.join("|"));
  const currentSig = piste.join("|");
  if (currentSig !== pisteSig) {
    setPisteSig(currentSig);
    setActive(new Set(piste));
  }

  const labelOf = (s: SeriesDef) =>
    s.pista ? pistaLabels[s.pista] : EXTRA_LABELS[s.key as TrendExtraKey | "totale"];

  const chartData = useMemo(
    () =>
      data.map(p => {
        const flat: Record<string, number | string> = {
          label: fmtDay(p.day),
          iva: p.iva,
          cb: p.cb,
          telefoni: p.telefoni,
        };
        let totale = 0;
        for (const pista of piste) {
          const n = p.perPista[pista] || 0;
          flat[pista] = n;
          totale += n;
        }
        flat.totale = totale;
        return flat;
      }),
    [data, piste],
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

  const renderChip = (s: SeriesDef) => {
    const on = active.has(s.key);
    return (
      <Button
        key={s.key}
        type="button"
        variant="outline"
        size="sm"
        className={`h-7 px-3 text-xs gap-1.5 ${on ? "" : "opacity-40"}`}
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
  };

  const activeSeries = series.filter(s => active.has(s.key));

  return (
    <Card data-testid="card-andamento-pezzi">
      <CardHeader className="pb-4 space-y-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-primary" />
            Andamento KPI nel periodo
          </CardTitle>
          <p className="text-xs text-muted-foreground pl-7">
            Pezzi per giorno, con gli stessi filtri della tabella
          </p>
        </div>
        {/* I chip fanno da legenda interattiva: piste principali prima, KPI
            extra separati da un divisore verticale per gerarchia visiva. */}
        <div className="flex flex-wrap items-center gap-2">
          {series.filter(s => !s.extra).map(s => renderChip(s))}
          {series.some(s => s.extra) && (
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          )}
          {series.filter(s => s.extra).map(s => renderChip(s))}
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        <div className="h-[320px]" data-testid="chart-andamento-pezzi">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: -14 }}>
              {/* Gradienti Vision UI: dall'accent della serie a trasparente verso il basso */}
              <defs>
                {series.map(s => (
                  <linearGradient key={s.key} id={`grad-ap-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" style={{ stopColor: s.color, stopOpacity: GRAD_TOP }} />
                    <stop offset="95%" style={{ stopColor: s.color, stopOpacity: GRAD_BOT }} />
                  </linearGradient>
                ))}
              </defs>

              {/* Griglia tenue: strokeOpacity abbassa l'intensità in dark/light */}
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                strokeOpacity={0.5}
                vertical={false}
              />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickMargin={8}
                axisLine={{ stroke: "hsl(var(--border))", strokeOpacity: 0.5 }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickMargin={6}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />

              {/* Tooltip glass: sfondo traslucido + backdrop blur per look Vision UI.
                  La proprietà backdropFilter funziona sul div HTML del tooltip
                  (recharts lo monta come overlay fuori dall'SVG). */}
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover) / 0.85)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: "1px solid hsl(var(--border) / 0.6)",
                  borderRadius: 10,
                  fontSize: 12,
                  padding: "8px 12px",
                  color: "hsl(var(--popover-foreground))",
                  boxShadow: "0 8px 24px hsl(233 60% 3% / 0.25)",
                }}
                itemStyle={{ padding: "1px 0" }}
                labelStyle={{ marginBottom: 6, fontWeight: 600 }}
              />

              {/* Area sfumata: linea + riempimento gradiente sotto */}
              {activeSeries.map(s => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={labelOf(s)}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#grad-ap-${s.key})`}
                  fillOpacity={1}
                  dot={{ r: 2.5, fill: s.color }}
                  activeDot={{ r: 4.5, fill: s.color }}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
