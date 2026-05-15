// Sezione Proiezioni (Task #145).
// Slider growth (-50%..+100%) → 12 mesi proiettati con `computeProiezioni`.
// Sorgente storica: tool standalone HTML (rimosso in Task #148, vedi git) righe ~3148-3163.

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer, ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { FinplanCompanySnapshot, FinplanSnapshot } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { MO } from "@/lib/finplanImport";
import { computeProiezioni } from "@/lib/finplan/proiezioni";

interface Props {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

export function Proiezioni({ snapshot, companyIndex, scheduleSave }: Props) {
  const co = snapshot?.data?.[companyIndex];
  const growth = typeof co?.growth === "number" ? co.growth : 0;
  const result = useMemo(() => computeProiezioni(co, growth), [co, growth]);

  const setGrowth = (val: number) => {
    scheduleSave(prev => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = (base.data ?? []).slice();
      const cur = (data[companyIndex] ?? {}) as FinplanCompanySnapshot;
      data[companyIndex] = { ...cur, growth: val };
      return { ...base, data };
    });
  };

  const chartData = result.proj.map(p => ({
    mese: MO[p.i],
    Entrate: p.e,
    Uscite: p.u,
    Cashflow: p.cf,
  }));

  return (
    <div className="space-y-4" data-testid="finplan-proiezioni">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Tasso di crescita atteso</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <Label className="text-xs">Growth annuo applicato a Entrate (Uscite con elasticità 0.4)</Label>
            <Badge variant="outline" className="font-mono" data-testid="badge-proj-growth">
              {growth >= 0 ? "+" : ""}{growth.toFixed(1)}%
            </Badge>
          </div>
          <Slider
            value={[growth]}
            min={-50}
            max={100}
            step={0.5}
            onValueChange={(v) => setGrowth(v[0] ?? 0)}
            data-testid="slider-proj-growth"
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
            <Stat label="Media E mensile" value={formatCurrency(result.avgE)} testId="stat-proj-avge" />
            <Stat label="Media U mensile" value={formatCurrency(result.avgU)} testId="stat-proj-avgu" />
            <Stat label="Tot E proiettate (12m)" value={formatCurrency(result.totals.e)} testId="stat-proj-tote" highlight="emerald" />
            <Stat label="CF cumulato" value={formatCurrency(result.totals.cf)} testId="stat-proj-cf" highlight={result.totals.cf >= 0 ? "emerald" : "rose"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Andamento previsto 12 mesi</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[320px]" data-testid="chart-proj">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Entrate" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Uscite" fill="#EF4444" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="Cashflow" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Dettaglio mensile</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Mese</TableHead>
                <TableHead className="text-right">Entrate</TableHead>
                <TableHead className="text-right">Uscite</TableHead>
                <TableHead className="text-right">Cashflow</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.proj.map(p => (
                <TableRow key={p.i} data-testid={`row-proj-${p.i}`}>
                  <TableCell className="text-xs font-medium">{MO[p.i]}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatCurrency(p.e)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(p.u)}</TableCell>
                  <TableCell className={`text-right font-mono text-xs font-medium ${p.cf >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {formatCurrency(p.cf)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40">
                <TableCell className="font-bold text-xs">TOT</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold">{formatCurrency(result.totals.e)}</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold">{formatCurrency(result.totals.u)}</TableCell>
                <TableCell className={`text-right font-mono text-xs font-bold ${result.totals.cf >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {formatCurrency(result.totals.cf)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, testId, highlight }: { label: string; value: string; testId: string; highlight?: "rose" | "emerald" }) {
  const color = highlight === "rose" ? "text-rose-600" : highlight === "emerald" ? "text-emerald-600" : "";
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`font-bold text-sm font-mono ${color}`} data-testid={testId}>{value}</div>
    </div>
  );
}
