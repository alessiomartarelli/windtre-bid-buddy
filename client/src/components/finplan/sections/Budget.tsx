// Sezione Budget annuale (Task #145).
// Sorgente: index.html righe 4670-4805.
// - bgt={e,u,catBudget:[{catId,annual}],ripartizione:'uniforme'|'ponderata'}
// - RAG semaforico per categoria; ripartizione mensile per riga.

import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import type { FinplanBudget, FinplanCategory, FinplanCompanySnapshot, FinplanSnapshot, TxType } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { MO } from "@/lib/finplanImport";
import { computeBudgetVariance, getBudgetMonthly, getCatActualMonthly, ragBgClass, varianceSign } from "@/lib/finplan/budget";

interface Props {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

export function Budget({ snapshot, companyIndex, scheduleSave }: Props) {
  const co = snapshot?.data?.[companyIndex];
  const cats = (co?.cats ?? []) as FinplanCategory[];
  const bgt: FinplanBudget = (co?.budget as FinplanBudget | undefined) ?? {};
  const ripartizione = (bgt.ripartizione ?? "uniforme") as "uniforme" | "ponderata";

  const updateBudget = (patch: Partial<FinplanBudget>) => {
    scheduleSave(prev => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = (base.data ?? []).slice();
      const cur = (data[companyIndex] ?? {}) as FinplanCompanySnapshot;
      const curBgt = (cur.budget as FinplanBudget | undefined) ?? {};
      data[companyIndex] = { ...cur, budget: { ...curBgt, ...patch } };
      return { ...base, data };
    });
  };

  const setCatBudget = (catId: string, annual: number) => {
    scheduleSave(prev => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = (base.data ?? []).slice();
      const cur = (data[companyIndex] ?? {}) as FinplanCompanySnapshot;
      const curBgt = (cur.budget as FinplanBudget | undefined) ?? {};
      const list = (curBgt.catBudget ?? []).slice();
      const idx = list.findIndex(r => r.catId === catId);
      if (idx >= 0) list[idx] = { ...list[idx], annual };
      else list.push({ catId, annual });
      data[companyIndex] = { ...cur, budget: { ...curBgt, catBudget: list } };
      return { ...base, data };
    });
  };

  return (
    <div className="space-y-4" data-testid="finplan-budget">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Impostazioni</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Budget annuo Entrate</Label>
              <Input
                defaultValue={bgt.e ?? 0}
                onBlur={e => updateBudget({ e: parseFloat(e.target.value.replace(",", ".")) || 0 })}
                className="h-8 font-mono"
                inputMode="decimal"
                data-testid="input-budget-e"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Budget annuo Uscite</Label>
              <Input
                defaultValue={bgt.u ?? 0}
                onBlur={e => updateBudget({ u: parseFloat(e.target.value.replace(",", ".")) || 0 })}
                className="h-8 font-mono"
                inputMode="decimal"
                data-testid="input-budget-u"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ripartizione mensile</Label>
              <Select value={ripartizione} onValueChange={v => updateBudget({ ripartizione: v })}>
                <SelectTrigger className="h-8" data-testid="select-budget-ripartizione"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="uniforme">Uniforme (annual / 12)</SelectItem>
                  <SelectItem value="ponderata">Ponderata sugli actuals</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="E">
        <TabsList>
          <TabsTrigger value="E" data-testid="tab-budget-E">Entrate</TabsTrigger>
          <TabsTrigger value="U" data-testid="tab-budget-U">Uscite</TabsTrigger>
        </TabsList>
        {(["E", "U"] as TxType[]).map(type => (
          <TabsContent key={type} value={type} className="mt-4 space-y-4">
            <CategoryVariance
              type={type}
              cats={cats.filter(c => c.type === type)}
              co={co}
              bgt={bgt}
              annualTot={type === "E" ? (bgt.e ?? 0) : (bgt.u ?? 0)}
              setCatBudget={setCatBudget}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function CategoryVariance({ type, cats, co, bgt, annualTot, setCatBudget }: {
  type: TxType;
  cats: FinplanCategory[];
  co: FinplanCompanySnapshot | undefined;
  bgt: FinplanBudget;
  annualTot: number;
  setCatBudget: (catId: string, annual: number) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Variance/scostamento è calcolato in pure-lib `lib/finplan/budget.ts`
  // così è riusabile sia in questa UI che in Consolidato (#147).
  const { rows, totals } = useMemo(
    () => computeBudgetVariance(cats, co, bgt, type),
    [cats, co, bgt, type],
  );

  // Chart variance (verde = favorevole, rosso = sfavorevole). La
  // direzione "favorevole" dipende dal tipo della categoria — vedi
  // `varianceSign`. Bar = `variance` con segno; ReferenceLine y=0.
  const chartData = rows.map(r => ({
    name: r.c.name ?? r.c.id,
    variance: r.variance,
    sign: varianceSign(r.variance, type),
  }));

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Budget annuo (totale)" value={formatCurrency(annualTot)} testId={`stat-budget-annual-${type}`} />
        <Stat label="Budget categorie" value={formatCurrency(totals.tBudget)} testId={`stat-budget-cats-${type}`} />
        <Stat label="Actual YTD" value={formatCurrency(totals.tActual)} testId={`stat-actual-${type}`} />
        <Stat
          label="Variance"
          value={formatCurrency(totals.tVariance)}
          testId={`stat-variance-${type}`}
          highlight={
            type === "E"
              ? (totals.tVariance >= 0 ? "emerald" : "rose")
              : (totals.tVariance <= 0 ? "emerald" : "rose")
          }
        />
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Scostamento vs Budget ({type === "E" ? "Entrate" : "Uscite"})
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Verde = favorevole ({type === "E" ? "actual sopra budget" : "spesa sotto budget"}),
              rosso = sfavorevole. Linea zero = a target.
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]" data-testid={`chart-budget-${type}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v as number)} />
                  <ReferenceLine y={0} stroke="#94A3B8" strokeWidth={1} />
                  <Bar dataKey="variance" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.sign === "good" ? "#10B981" : entry.sign === "bad" ? "#EF4444" : "#94A3B8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]"></TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right w-[140px]">Budget annuo</TableHead>
                <TableHead className="text-right w-[120px]">Actual YTD</TableHead>
                <TableHead className="text-right w-[120px]">Variance</TableHead>
                <TableHead className="text-right w-[80px]">% B</TableHead>
                <TableHead className="w-[80px]">RAG</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-4" data-testid={`text-no-budget-${type}`}>
                  Nessuna categoria di tipo {type}. Crea categorie nella sezione Categorie.
                </TableCell></TableRow>
              ) : rows.map(r => {
                const isOpen = !!expanded[r.c.id];
                const monthlyActuals = getCatActualMonthly(co, r.c.id);
                const monthlyBudget = getBudgetMonthly(r.budget, bgt.ripartizione, monthlyActuals);
                return (
                  <Fragment key={r.c.id}>
                    <TableRow data-testid={`row-budget-${r.c.id}`}>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded(s => ({ ...s, [r.c.id]: !s[r.c.id] }))} data-testid={`button-budget-expand-${r.c.id}`}>
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </Button>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: r.c.color ?? "#64748B" }} />
                        {r.c.name ?? r.c.id}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          defaultValue={r.budget}
                          onBlur={e => setCatBudget(r.c.id, parseFloat(e.target.value.replace(",", ".")) || 0)}
                          className="h-7 font-mono text-xs text-right ml-auto w-32"
                          inputMode="decimal"
                          data-testid={`input-budget-cat-${r.c.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatCurrency(r.actual)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${r.variance === 0 ? "" : (type === "E" ? (r.variance > 0 ? "text-emerald-600" : "text-rose-600") : (r.variance < 0 ? "text-emerald-600" : "text-rose-600"))}`}>
                        {formatCurrency(r.variance)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{r.budget > 0 ? `${r.pct.toFixed(0)}%` : "—"}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${ragBgClass(r.rag)}`}>{r.rag.toUpperCase()}</Badge>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow data-testid={`row-budget-monthly-${r.c.id}`} key={`m-${r.c.id}`}>
                        <TableCell colSpan={7} className="bg-muted/30 p-2">
                          <div className="grid grid-cols-12 gap-1 text-[10px]">
                            {MO.map((m, i) => (
                              <div key={i} className="rounded border bg-background p-1 text-center">
                                <div className="font-medium text-[9px] uppercase text-muted-foreground">{m}</div>
                                <div className="font-mono text-[10px]">B {monthlyBudget[i].toFixed(0)}</div>
                                <div className={`font-mono text-[10px] ${monthlyActuals[i] === 0 ? "text-muted-foreground" : ""}`}>A {monthlyActuals[i].toFixed(0)}</div>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              {rows.length > 0 && (
                <TableRow className="bg-muted/40">
                  <TableCell></TableCell>
                  <TableCell className="font-bold text-xs">TOT</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">{formatCurrency(totals.tBudget)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">{formatCurrency(totals.tActual)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">{formatCurrency(totals.tVariance)}</TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
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
