// Vista Consolidato di gruppo (Task #147 — 6/7 della migrazione FinPlan).
// Aggrega le 5 RS in una vista unica con 4 sotto-aree:
//   - Dashboard di gruppo (KPI + bar chart RS + donut composizione).
//   - Tabelle comparative RS×mese (ricavi, costi, margine, cashflow) + xlsx.
//   - IVA di gruppo (somma dei buckets per società).
//   - Piano Finanziario: Analisi trasversale, Piano per società,
//     Obiettivi PDV, Scenari (what-if % fatturato / % costi).
//
// Vincolo architetturale: nessun nuovo endpoint backend, tutto è
// calcolato client-side dal payload `useFinplanData`. I grafici hanno
// altezza ≤ ~260px (max 1/3 schermo).

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { ArrowUpDown, Download, TrendingUp, TrendingDown, Wallet, BarChart3, Star } from "lucide-react";
import type { FinplanCompanySnapshot, FinplanSnapshot, IvaPeriod } from "@shared/finplanSchema";
import { formatCurrency } from "@/utils/format";
import { calcIvaPeriods, totalsIvaPeriods, type IvaPeriodRow } from "@/lib/finplanIva";
import {
  aggregateGroupData, applyScenario, flattenPdvObiettivi,
  MO_LABELS, type GroupAggregate, type PdvObiettivoFlat,
} from "@/lib/finplan/groupAggregate";

interface Props {
  snapshot: FinplanSnapshot | null;
  defaultNames: string[];
  companyColors: string[];
  consolidatoColor: string;
}

type SubTab = "dashboard" | "tabelle" | "iva" | "piano";

export function Consolidato({ snapshot, defaultNames, companyColors, consolidatoColor }: Props) {
  const allRs = (snapshot?.data ?? []) as FinplanCompanySnapshot[];
  const agg = useMemo(() => aggregateGroupData(allRs, defaultNames), [allRs, defaultNames]);
  const [tab, setTab] = useState<SubTab>("dashboard");

  return (
    <div className="space-y-4" data-testid="finplan-consolidato">
      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsList className="flex flex-wrap h-auto justify-start gap-1">
          <TabsTrigger value="dashboard"  data-testid="cons-tab-dashboard"  className="text-xs">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Dashboard di gruppo
          </TabsTrigger>
          <TabsTrigger value="tabelle"    data-testid="cons-tab-tabelle"    className="text-xs">
            Tabelle comparative
          </TabsTrigger>
          <TabsTrigger value="iva"        data-testid="cons-tab-iva"        className="text-xs">
            IVA di gruppo
          </TabsTrigger>
          <TabsTrigger value="piano"      data-testid="cons-tab-piano"      className="text-xs">
            <Star className="h-3.5 w-3.5 mr-1.5" /> Piano Finanziario
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <Dashboard agg={agg} companyColors={companyColors} consolidatoColor={consolidatoColor} />
        </TabsContent>
        <TabsContent value="tabelle" className="mt-4">
          <TabelleComparative agg={agg} />
        </TabsContent>
        <TabsContent value="iva" className="mt-4">
          <IvaGruppo allRs={allRs} agg={agg} />
        </TabsContent>
        <TabsContent value="piano" className="mt-4">
          <PianoFinanziario agg={agg} allRs={allRs} defaultNames={defaultNames} companyColors={companyColors} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────── Dashboard ──────────────────────────

function KpiCard({ label, value, icon: Icon, accent, testId }: {
  label: string; value: number; icon: typeof TrendingUp; accent: string; testId: string;
}) {
  return (
    <Card className="overflow-hidden" data-testid={testId}>
      <div className="h-1" style={{ background: accent }} />
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
        <div className="text-xl font-mono font-semibold">{formatCurrency(value)}</div>
        <div className="text-xs text-muted-foreground mt-1">somma 5 ragioni sociali</div>
      </CardContent>
    </Card>
  );
}

function Dashboard({ agg, companyColors, consolidatoColor }: {
  agg: GroupAggregate; companyColors: string[]; consolidatoColor: string;
}) {
  const barData = agg.companies.map((c, i) => ({
    name: c.name,
    Ricavi: Math.round(c.totE),
    Costi: Math.round(c.totU),
    Margine: Math.round(c.margine),
    color: companyColors[i] ?? consolidatoColor,
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Ricavi gruppo"   value={agg.totals.totE}    icon={TrendingUp}   accent={consolidatoColor} testId="cons-kpi-ricavi"   />
        <KpiCard label="Costi gruppo"    value={agg.totals.totU}    icon={TrendingDown} accent="#F43F5E"           testId="cons-kpi-costi"    />
        <KpiCard label="Margine gruppo"  value={agg.totals.margine} icon={BarChart3}    accent={agg.totals.margine >= 0 ? "#10B981" : "#F43F5E"} testId="cons-kpi-margine"  />
        <KpiCard label="Cashflow gruppo" value={agg.totals.cashflow} icon={Wallet}      accent={agg.totals.cashflow >= 0 ? "#8B5CF6" : "#F59E0B"} testId="cons-kpi-cashflow" />
      </div>

      <Card data-testid="cons-bar-rs">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Comparativa per Ragione Sociale</CardTitle></CardHeader>
        <CardContent>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v as number)} width={80} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Ricavi"  fill={consolidatoColor} />
                <Bar dataKey="Costi"   fill="#F43F5E" />
                <Bar dataKey="Margine" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DonutCard data={agg.compE} title="Composizione Entrate (gruppo)" testId="cons-donut-entrate" />
        <DonutCard data={agg.compU} title="Composizione Uscite (gruppo)"  testId="cons-donut-uscite"  />
      </div>
    </div>
  );
}

function DonutCard({ data, title, testId }: {
  data: { name: string; value: number; color: string }[]; title: string; testId: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">Nessun dato</div>
        ) : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="38%" cy="50%" innerRadius={55} outerRadius={100} paddingAngle={2}>
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                <Legend
                  layout="vertical" align="right" verticalAlign="middle"
                  wrapperStyle={{ fontSize: 11, paddingLeft: 8 }}
                  formatter={(value, _e, idx) => {
                    const it = data[idx as number]; if (!it) return value;
                    const pct = total > 0 ? (it.value / total) * 100 : 0;
                    return <span className="text-foreground">{value} <span className="text-muted-foreground">({pct.toFixed(0)}%)</span></span>;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────── Tabelle comparative ───────────────────────

type Metric = "e" | "u" | "margine" | "cf";
const METRIC_LABEL: Record<Metric, string> = {
  e: "Ricavi", u: "Costi", margine: "Margine", cf: "Cashflow",
};

function metricValue(m: { e: number; u: number; cf: number }, k: Metric): number {
  if (k === "e") return m.e;
  if (k === "u") return m.u;
  if (k === "cf") return m.cf;
  return m.e - m.u;
}

function TabelleComparative({ agg }: { agg: GroupAggregate }) {
  const [metric, setMetric] = useState<Metric>("e");

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    (["e", "u", "margine", "cf"] as Metric[]).forEach(k => {
      const header = ["Ragione Sociale", ...MO_LABELS, "Totale"];
      const rows = agg.companies.map(c => {
        const cells = c.monthly.map(m => +metricValue(m, k).toFixed(2));
        const tot = cells.reduce((s, n) => s + n, 0);
        return [c.name, ...cells, +tot.toFixed(2)];
      });
      const totRow = ["Totale gruppo", ...MO_LABELS.map((_, i) =>
        +agg.companies.reduce((s, c) => s + metricValue(c.monthly[i] ?? { e: 0, u: 0, cf: 0 }, k), 0).toFixed(2),
      )];
      const grand = (totRow.slice(1) as number[]).reduce((s, n) => s + (typeof n === "number" ? n : 0), 0);
      totRow.push(+grand.toFixed(2));
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows, totRow]);
      XLSX.utils.book_append_sheet(wb, ws, METRIC_LABEL[k].slice(0, 31));
    });
    XLSX.writeFile(wb, "FinPlan_Consolidato_RSxMese.xlsx");
  };

  const rows = agg.companies.map(c => ({
    name: c.name,
    cells: c.monthly.map(m => metricValue(m, metric)),
  }));
  const colTotals = MO_LABELS.map((_, i) =>
    agg.companies.reduce((s, c) => s + metricValue(c.monthly[i] ?? { e: 0, u: 0, cf: 0 }, metric), 0),
  );
  const grandTotal = colTotals.reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Metrica</Label>
        <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="cons-select-metric"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(METRIC_LABEL) as Metric[]).map(k => (
              <SelectItem key={k} value={k}>{METRIC_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={exportXlsx} data-testid="cons-btn-export-xlsx">
          <Download className="h-3.5 w-3.5 mr-1.5" /> Esporta tutte (Excel)
        </Button>
      </div>

      <Card data-testid="cons-pivot-table">
        <CardHeader className="pb-2"><CardTitle className="text-sm">{METRIC_LABEL[metric]} — RS × mese</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Ragione Sociale</TableHead>
                  {MO_LABELS.map(m => <TableHead key={m} className="text-xs text-right">{m}</TableHead>)}
                  <TableHead className="text-xs text-right">Totale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const tot = r.cells.reduce((s, n) => s + n, 0);
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{r.name}</TableCell>
                      {r.cells.map((v, j) => (
                        <TableCell key={j} className="text-xs text-right font-mono">{formatCurrency(v)}</TableCell>
                      ))}
                      <TableCell className="text-xs text-right font-mono font-semibold">{formatCurrency(tot)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="text-xs">Totale gruppo</TableCell>
                  {colTotals.map((v, j) => (
                    <TableCell key={j} className="text-xs text-right font-mono">{formatCurrency(v)}</TableCell>
                  ))}
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(grandTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── IVA di gruppo ─────────────────────────

function IvaGruppo({ allRs, agg }: { allRs: FinplanCompanySnapshot[]; agg: GroupAggregate }) {
  const [period, setPeriod] = useState<IvaPeriod>("trimestrale");
  const rows = useMemo<IvaPeriodRow[]>(() => {
    // Somma per-bucket dei risultati IVA di ogni RS.
    const perCo = allRs.map(co => calcIvaPeriods(co.transactions, period));
    if (perCo.length === 0) return [];
    const len = perCo[0]?.length ?? 0;
    const out: IvaPeriodRow[] = [];
    for (let i = 0; i < len; i++) {
      const label = perCo[0]?.[i]?.label ?? `Periodo ${i + 1}`;
      let c = 0, d = 0;
      for (const arr of perCo) { c += arr[i]?.ivaCollettata ?? 0; d += arr[i]?.ivaDetraibile ?? 0; }
      out.push({ label, ivaCollettata: +c.toFixed(2), ivaDetraibile: +d.toFixed(2), saldo: +(c - d).toFixed(2) });
    }
    return out;
  }, [allRs, period]);
  const tot = useMemo(() => totalsIvaPeriods(rows), [rows]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Periodicità</Label>
        <Select value={period} onValueChange={(v) => setPeriod(v as IvaPeriod)}>
          <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="cons-iva-period"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="trimestrale">Trimestrale</SelectItem>
            <SelectItem value="mensile">Mensile</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{agg.companies.length} RS aggregate</span>
      </div>
      <Card data-testid="cons-iva-table">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Liquidazione IVA aggregata</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Periodo</TableHead>
                <TableHead className="text-xs text-right">IVA collettata</TableHead>
                <TableHead className="text-xs text-right">IVA detraibile</TableHead>
                <TableHead className="text-xs text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{r.label}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(r.ivaCollettata)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(r.ivaDetraibile)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    <Badge variant={r.saldo >= 0 ? "destructive" : "secondary"}>{formatCurrency(r.saldo)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-semibold">
                <TableCell className="text-xs">{tot.label}</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatCurrency(tot.ivaCollettata)}</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatCurrency(tot.ivaDetraibile)}</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatCurrency(tot.saldo)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── Piano Finanziario ─────────────────────────

type PianoTab = "trasversale" | "societa" | "pdv" | "scenari";

function PianoFinanziario({ agg, allRs, defaultNames, companyColors }: {
  agg: GroupAggregate; allRs: FinplanCompanySnapshot[]; defaultNames: string[]; companyColors: string[];
}) {
  const [tab, setTab] = useState<PianoTab>("trasversale");
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as PianoTab)} className="space-y-3">
      <TabsList className="flex flex-wrap h-auto justify-start gap-1">
        <TabsTrigger value="trasversale" data-testid="cons-piano-tab-trasversale" className="text-xs">Analisi trasversale</TabsTrigger>
        <TabsTrigger value="societa"     data-testid="cons-piano-tab-societa"     className="text-xs">Piano per società</TabsTrigger>
        <TabsTrigger value="pdv"         data-testid="cons-piano-tab-pdv"         className="text-xs">Obiettivi PDV</TabsTrigger>
        <TabsTrigger value="scenari"     data-testid="cons-piano-tab-scenari"     className="text-xs">Scenari</TabsTrigger>
      </TabsList>
      <TabsContent value="trasversale"><AnalisiTrasversale agg={agg} /></TabsContent>
      <TabsContent value="societa"><PianoPerSocieta agg={agg} companyColors={companyColors} /></TabsContent>
      <TabsContent value="pdv"><ObiettiviPdv allRs={allRs} defaultNames={defaultNames} /></TabsContent>
      <TabsContent value="scenari"><Scenari agg={agg} allRs={allRs} defaultNames={defaultNames} /></TabsContent>
    </Tabs>
  );
}

function AnalisiTrasversale({ agg }: { agg: GroupAggregate }) {
  // Economico = ricavi - costi (anche extra-cassa). Finanziario = cashflow.
  const data = agg.monthly.map((m, i) => ({
    month: MO_LABELS[i],
    Economico:  Math.round(m.e - m.u),
    Finanziario: Math.round(m.cf),
  }));
  const totEcon = agg.totals.margine;
  const totFin  = agg.totals.cashflow;
  return (
    <div className="space-y-3">
      <Card data-testid="cons-trasv-chart">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Flussi economici vs finanziari (gruppo)</CardTitle></CardHeader>
        <CardContent>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v as number)} width={80} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Economico"   stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Finanziario" stroke="#8B5CF6" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Mese</TableHead>
                <TableHead className="text-xs text-right">Economico</TableHead>
                <TableHead className="text-xs text-right">Finanziario</TableHead>
                <TableHead className="text-xs text-right">Δ (E−F)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{d.month}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(d.Economico)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(d.Finanziario)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(d.Economico - d.Finanziario)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-semibold">
                <TableCell className="text-xs">Totale</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatCurrency(totEcon)}</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatCurrency(totFin)}</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatCurrency(totEcon - totFin)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PianoPerSocieta({ agg, companyColors }: { agg: GroupAggregate; companyColors: string[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="cons-piano-soc-grid">
      {agg.companies.map((c, i) => {
        const accent = companyColors[i] ?? "#00D4AA";
        return (
          <Card key={c.index} data-testid={`cons-piano-soc-card-${i}`}>
            <div className="h-1" style={{ background: accent }} />
            <CardHeader className="pb-2"><CardTitle className="text-sm">{c.name}</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <Row label="Ricavi"   value={c.totE}     color="#10B981" />
              <Row label="Costi"    value={c.totU}     color="#F43F5E" />
              <Row label="Margine"  value={c.margine}  color={c.margine >= 0 ? "#10B981" : "#F43F5E"} />
              <Row label="Cashflow" value={c.cashflow} color={c.cashflow >= 0 ? "#8B5CF6" : "#F59E0B"} />
              <div className="pt-2 text-[10px] text-muted-foreground uppercase tracking-wider">
                Margine % su ricavi: <span className="font-mono">{c.totE > 0 ? ((c.margine / c.totE) * 100).toFixed(1) : "0.0"}%</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold" style={{ color }}>{formatCurrency(value)}</span>
    </div>
  );
}

function ObiettiviPdv({ allRs, defaultNames }: { allRs: FinplanCompanySnapshot[]; defaultNames: string[] }) {
  type Sk = "rs" | "pdvName" | "targetAnnuo" | "consuntivo" | "delta" | "pct";
  const [sortKey, setSortKey] = useState<Sk>("pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const flat = useMemo(() => flattenPdvObiettivi(allRs, defaultNames), [allRs, defaultNames]);
  const rows = useMemo(() => {
    const arr = flat.slice();
    arr.sort((a, b) => {
      const va = a[sortKey] as number | string;
      const vb = b[sortKey] as number | string;
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [flat, sortKey, sortDir]);

  const toggle = (k: Sk) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const Th = ({ k, children, align = "left" }: { k: Sk; children: React.ReactNode; align?: "left" | "right" }) => (
    <TableHead className="text-xs">
      <button
        type="button"
        onClick={() => toggle(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "w-full justify-end" : ""}`}
        data-testid={`cons-pdv-sort-${k}`}
      >
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-60" />
      </button>
    </TableHead>
  );

  if (flat.length === 0) {
    return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Nessun obiettivo PDV definito nelle Ragioni Sociali.</CardContent></Card>;
  }
  return (
    <Card data-testid="cons-pdv-table">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Obiettivi PDV — gruppo ({flat.length})</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <Th k="rs">Ragione Sociale</Th>
                <Th k="pdvName">PDV</Th>
                <Th k="targetAnnuo" align="right">Target annuo</Th>
                <Th k="consuntivo" align="right">Consuntivo</Th>
                <Th k="delta" align="right">Δ</Th>
                <Th k="pct" align="right">% raggiunto</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: PdvObiettivoFlat, i) => (
                <TableRow key={i} data-testid={`cons-pdv-row-${i}`}>
                  <TableCell className="text-xs">{r.rs}</TableCell>
                  <TableCell className="text-xs">{r.pdvName}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(r.targetAnnuo)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{formatCurrency(r.consuntivo)}</TableCell>
                  <TableCell className="text-xs text-right font-mono" style={{ color: r.delta >= 0 ? "#10B981" : "#F43F5E" }}>
                    {formatCurrency(r.delta)}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    <Badge variant={r.pct >= 100 ? "default" : r.pct >= 75 ? "secondary" : "destructive"}>
                      {r.pct.toFixed(1)}%
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Scenari({ agg, allRs, defaultNames }: {
  agg: GroupAggregate; allRs: FinplanCompanySnapshot[]; defaultNames: string[];
}) {
  const [pctR, setPctR] = useState(0);
  const [pctC, setPctC] = useState(0);
  const sim = useMemo(() => applyScenario(allRs, defaultNames, pctR, pctC), [allRs, defaultNames, pctR, pctC]);
  const dM = sim.totals.margine - agg.totals.margine;
  const dCf = sim.totals.cashflow - agg.totals.cashflow;
  return (
    <div className="space-y-3">
      <Card data-testid="cons-scenari-form">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Scenari what-if</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            Le percentuali riscalano tutte le transazioni (E e U). Il cashflow
            mantiene l'esclusione delle categorie configurate in “Costi & Incassi”.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Variazione % fatturato: <span className="font-mono text-foreground">{pctR >= 0 ? "+" : ""}{pctR}%</span>
              </Label>
              <Slider min={-50} max={100} step={1} value={[pctR]} onValueChange={(v) => setPctR(v[0] ?? 0)} data-testid="cons-scen-slider-r" />
              <Input type="number" value={pctR} onChange={(e) => setPctR(Number(e.target.value) || 0)} className="h-8 text-xs" data-testid="cons-scen-input-r" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Variazione % costi: <span className="font-mono text-foreground">{pctC >= 0 ? "+" : ""}{pctC}%</span>
              </Label>
              <Slider min={-50} max={100} step={1} value={[pctC]} onValueChange={(v) => setPctC(v[0] ?? 0)} data-testid="cons-scen-slider-c" />
              <Input type="number" value={pctC} onChange={(e) => setPctC(Number(e.target.value) || 0)} className="h-8 text-xs" data-testid="cons-scen-input-c" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <ScenKpi label="Ricavi (sim)"   base={agg.totals.totE}    sim={sim.totals.totE}    accent="#10B981" testId="cons-scen-kpi-r" />
        <ScenKpi label="Costi (sim)"    base={agg.totals.totU}    sim={sim.totals.totU}    accent="#F43F5E" testId="cons-scen-kpi-c" />
        <ScenKpi label="Margine (sim)"  base={agg.totals.margine} sim={sim.totals.margine} accent={dM >= 0 ? "#10B981" : "#F43F5E"} testId="cons-scen-kpi-m" />
        <ScenKpi label="Cashflow (sim)" base={agg.totals.cashflow} sim={sim.totals.cashflow} accent={dCf >= 0 ? "#8B5CF6" : "#F59E0B"} testId="cons-scen-kpi-cf" />
      </div>

      <Card data-testid="cons-scen-chart">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Andamento mensile (scenario)</CardTitle></CardHeader>
        <CardContent>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sim.monthly.map((m, i) => ({
                month: MO_LABELS[i],
                Ricavi: Math.round(m.e),
                Costi: Math.round(m.u),
                Cashflow: Math.round(m.cf),
              }))} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v as number)} width={80} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Ricavi"   stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Costi"    stroke="#F43F5E" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Cashflow" stroke="#8B5CF6" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScenKpi({ label, base, sim, accent, testId }: {
  label: string; base: number; sim: number; accent: string; testId: string;
}) {
  const delta = sim - base;
  const pct = base !== 0 ? (delta / Math.abs(base)) * 100 : 0;
  return (
    <Card className="overflow-hidden" data-testid={testId}>
      <div className="h-1" style={{ background: accent }} />
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</div>
        <div className="text-lg font-mono font-semibold">{formatCurrency(sim)}</div>
        <div className="text-xs mt-1" style={{ color: delta >= 0 ? "#10B981" : "#F43F5E" }}>
          {delta >= 0 ? "+" : ""}{formatCurrency(delta)} ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)
        </div>
      </CardContent>
    </Card>
  );
}
