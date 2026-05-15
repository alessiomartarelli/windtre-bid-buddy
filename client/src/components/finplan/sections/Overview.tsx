import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  LineChart as RLineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Wallet, BarChart3, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { FinplanCompanySnapshot } from "@shared/finplanSchema";
import { formatCurrency } from "@/utils/format";

const MO = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

const fmtPct = (n: number) =>
  `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

interface OverviewProps {
  company: FinplanCompanySnapshot | undefined;
  companyColor: string;
}

interface MonthAgg { e: number; u: number; cf: number }

function computeMonthly(co: FinplanCompanySnapshot | undefined): MonthAgg[] {
  const out: MonthAgg[] = MO.map(() => ({ e: 0, u: 0, cf: 0 }));
  if (!co) return out;
  const txs = co.transactions ?? [];
  const cfExcludeE = new Set(co.cfExclude?.E ?? []);
  const cfExcludeU = new Set(co.cfExclude?.U ?? []);
  if (txs.length > 0) {
    for (const t of txs) {
      const m = typeof t.month === "number" ? t.month : -1;
      if (m < 0 || m > 11) continue;
      const amt = typeof t.amount === "number" ? t.amount : 0;
      if (t.type === "E") {
        out[m].e += amt;
        if (!cfExcludeE.has(String(t.catId ?? ""))) out[m].cf += amt;
      } else if (t.type === "U") {
        out[m].u += amt;
        if (!cfExcludeU.has(String(t.catId ?? ""))) out[m].cf -= amt;
      }
    }
    return out;
  }
  // Fallback su co.m[] aggregati
  const m = co.m ?? [];
  for (let i = 0; i < 12; i++) {
    const e = typeof m[i]?.e === "number" ? (m[i]!.e as number) : 0;
    const u = typeof m[i]?.u === "number" ? (m[i]!.u as number) : 0;
    out[i] = { e, u, cf: e - u };
  }
  return out;
}

function categoryComposition(co: FinplanCompanySnapshot | undefined, type: "E" | "U") {
  if (!co) return [] as { name: string; value: number; color: string }[];
  const cats = (co.cats ?? []).filter(c => c.type === type);
  const totals = new Map<string, number>();
  for (const t of co.transactions ?? []) {
    if (t.type !== type) continue;
    const id = String(t.catId ?? "");
    totals.set(id, (totals.get(id) ?? 0) + (typeof t.amount === "number" ? t.amount : 0));
  }
  return cats
    .map(c => ({
      name: c.name ?? c.id,
      value: totals.get(c.id) ?? 0,
      color: c.color ?? "#64748B",
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);
}

function KpiCard({
  label, value, deltaPct, icon: Icon, accent,
}: {
  label: string; value: number; deltaPct: number | null;
  icon: typeof TrendingUp; accent: string;
}) {
  const positive = (deltaPct ?? 0) >= 0;
  return (
    <Card className="overflow-hidden" data-testid={`kpi-${label.toLowerCase()}`}>
      <div className="h-1" style={{ background: accent }} />
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
        <div className="text-xl font-mono font-semibold" data-testid={`kpi-${label.toLowerCase()}-value`}>
          {formatCurrency(value)}
        </div>
        {deltaPct !== null && Number.isFinite(deltaPct) && (
          <div className="flex items-center gap-1 mt-1 text-xs">
            {positive ? (
              <ArrowUpRight className="h-3 w-3 text-emerald-500" />
            ) : (
              <ArrowDownRight className="h-3 w-3 text-rose-500" />
            )}
            <span className={positive ? "text-emerald-500" : "text-rose-500"}>
              {fmtPct(deltaPct)}
            </span>
            <span className="text-muted-foreground">vs mese prec.</span>
          </div>
        )}
        {deltaPct === null && (
          <div className="text-xs text-muted-foreground mt-1">anno corrente</div>
        )}
      </CardContent>
    </Card>
  );
}

function CompactPie({ data, title, testId }: {
  data: { name: string; value: number; color: string }[];
  title: string;
  testId: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            Nessun dato
          </div>
        ) : (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="38%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={130}
                  paddingAngle={2}
                >
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  formatter={(v: number) => formatCurrency(v)}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  wrapperStyle={{ fontSize: 11, paddingLeft: 8 }}
                  formatter={(value, _entry, idx) => {
                    const item = data[idx as number];
                    if (!item) return value;
                    const pct = total > 0 ? (item.value / total) * 100 : 0;
                    return (
                      <span className="text-foreground">
                        {value} <span className="text-muted-foreground">({pct.toFixed(0)}%)</span>
                      </span>
                    );
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

export function Overview({ company, companyColor }: OverviewProps) {
  const monthly = useMemo(() => computeMonthly(company), [company]);
  const compE = useMemo(() => categoryComposition(company, "E"), [company]);
  const compU = useMemo(() => categoryComposition(company, "U"), [company]);

  const totE = monthly.reduce((s, m) => s + m.e, 0);
  const totU = monthly.reduce((s, m) => s + m.u, 0);
  const totCf = monthly.reduce((s, m) => s + m.cf, 0);
  const margine = totE - totU;

  const now = new Date();
  const curM = now.getMonth();
  const prevM = curM - 1;
  const delta = (cur: number, prev: number) =>
    prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;

  const dRic = prevM >= 0 ? delta(monthly[curM].e, monthly[prevM].e) : null;
  const dCos = prevM >= 0 ? delta(monthly[curM].u, monthly[prevM].u) : null;
  const dMar = prevM >= 0 ? delta(monthly[curM].e - monthly[curM].u, monthly[prevM].e - monthly[prevM].u) : null;
  const dCf  = prevM >= 0 ? delta(monthly[curM].cf, monthly[prevM].cf) : null;

  const lineData = monthly.map((m, i) => ({
    month: MO[i],
    Ricavi: Math.round(m.e),
    Costi: Math.round(m.u),
    Cashflow: Math.round(m.cf),
  }));

  return (
    <div className="space-y-4" data-testid="finplan-overview">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Ricavi"   value={totE} deltaPct={dRic} icon={TrendingUp}   accent={companyColor} />
        <KpiCard label="Costi"    value={totU} deltaPct={dCos} icon={TrendingDown} accent="#F43F5E" />
        <KpiCard label="Margine"  value={margine} deltaPct={dMar} icon={BarChart3} accent={margine >= 0 ? "#10B981" : "#F43F5E"} />
        <KpiCard label="Cashflow" value={totCf} deltaPct={dCf}  icon={Wallet}      accent={totCf >= 0 ? "#8B5CF6" : "#F59E0B"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CompactPie data={compE} title="Composizione Entrate"        testId="finplan-pie-entrate" />
        <CompactPie data={compU} title="Composizione Uscite / Costi" testId="finplan-pie-uscite" />
      </div>

      <Card data-testid="finplan-line-monthly">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Andamento mensile (12 mesi)</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RLineChart data={lineData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v as number)} width={70} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Ricavi"   stroke={companyColor} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Costi"    stroke="#F43F5E"      strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Cashflow" stroke="#8B5CF6"      strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
              </RLineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
