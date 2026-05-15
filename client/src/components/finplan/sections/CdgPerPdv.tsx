// Sezione CdG per-PDV (Task #146).
// Sorgente: index.html righe 8861+. Mini Controllo di Gestione interno
// allo snapshot FinPlan (separato dal modulo CDG dell'app).
//
// Modello: cdg.pdv[]={id,nome,entrate:{mi:val}}; cdg.voci[]={id,pdvId,nome,
//          mensili:{mi:val}}. Tutto opzionale (passthrough). Mostriamo
// ricavi (entrate), costi (sum voci) e margine per PDV per il mese
// selezionato + comparativa anno intero.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend } from "recharts";
import type {
  FinplanCdg,
  FinplanCompanySnapshot,
  FinplanSnapshot,
} from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";

interface Props {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

const MO = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const PDV_COLORS = ["#00D4AA","#3B82F6","#8B5CF6","#F59E0B","#F43F5E","#06B6D4","#84CC16","#EC4899","#F97316","#A855F7"];
const ANNO = 99;

interface CdgPdv {
  id: string;
  nome: string;
  entrate?: Record<string, number>;
  [k: string]: unknown;
}
interface CdgVoce {
  id: string;
  pdvId: string;
  nome: string;
  mensili?: Record<string, number>;
  [k: string]: unknown;
}

function patch(
  prev: FinplanSnapshot | null,
  snap: FinplanSnapshot | null,
  ci: number,
  fn: (co: FinplanCompanySnapshot) => FinplanCompanySnapshot,
): FinplanSnapshot {
  const base: FinplanSnapshot = prev && prev.data ? prev : (snap ?? { data: [] });
  const data = (base.data ?? []).slice();
  data[ci] = fn(data[ci] ?? {});
  return { ...base, data };
}

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseEuro(s: string): number {
  return parseFloat(s.replace(",", ".")) || 0;
}

function getMese(map: Record<string, number> | undefined, mi: number): number {
  if (!map) return 0;
  if (mi === ANNO) return Object.values(map).reduce((s, v) => s + (Number(v) || 0), 0);
  return Number(map[String(mi)]) || 0;
}

export function CdgPerPdv({ snapshot, companyIndex, scheduleSave }: Props) {
  const co = snapshot?.data?.[companyIndex];
  const cdg = (co?.cdg ?? {}) as FinplanCdg;
  const pdv = (cdg.pdv ?? []) as CdgPdv[];
  const voci = (cdg.voci ?? []) as CdgVoce[];

  const [mese, setMese] = useState<number>(ANNO);

  const meseLabel = mese === ANNO ? "Anno intero" : MO[mese];

  const summary = useMemo(() => {
    return pdv.map((p, i) => {
      const ricavi = getMese(p.entrate, mese);
      const vp = voci.filter(v => v.pdvId === p.id);
      const costi = vp.reduce((s, v) => s + getMese(v.mensili, mese), 0);
      const margine = ricavi - costi;
      const marginePct = ricavi > 0 ? (margine / ricavi) * 100 : 0;
      return { id: p.id, nome: p.nome, ricavi, costi, margine, marginePct, color: PDV_COLORS[i % PDV_COLORS.length] };
    });
  }, [pdv, voci, mese]);

  const totals = useMemo(() => {
    const ric = summary.reduce((s, r) => s + r.ricavi, 0);
    const cos = summary.reduce((s, r) => s + r.costi, 0);
    return { ricavi: ric, costi: cos, margine: ric - cos };
  }, [summary]);

  const updateCdg = (fn: (cur: FinplanCdg) => FinplanCdg) =>
    scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
      const cur = (c.cdg ?? {}) as FinplanCdg;
      return { ...c, cdg: fn(cur) };
    }));

  const addPdv = () => updateCdg(cur => ({
    ...cur,
    pdv: [...((cur.pdv ?? []) as CdgPdv[]), { id: uid(), nome: "Nuovo PDV", entrate: {} }],
  }));
  const removePdv = (id: string) => updateCdg(cur => ({
    ...cur,
    pdv: ((cur.pdv ?? []) as CdgPdv[]).filter(p => p.id !== id),
    voci: ((cur.voci ?? []) as CdgVoce[]).filter(v => v.pdvId !== id),
  }));
  const updatePdv = (id: string, p: Partial<CdgPdv>) => updateCdg(cur => ({
    ...cur,
    pdv: ((cur.pdv ?? []) as CdgPdv[]).map(x => x.id === id ? { ...x, ...p } : x),
  }));
  const setEntrata = (pdvId: string, mi: number, v: number) => updateCdg(cur => ({
    ...cur,
    pdv: ((cur.pdv ?? []) as CdgPdv[]).map(x => {
      if (x.id !== pdvId) return x;
      const ent = { ...(x.entrate ?? {}) };
      ent[String(mi)] = v;
      return { ...x, entrate: ent };
    }),
  }));

  const addVoce = (pdvId: string) => updateCdg(cur => ({
    ...cur,
    voci: [...((cur.voci ?? []) as CdgVoce[]), { id: uid(), pdvId, nome: "Nuova voce", mensili: {} }],
  }));
  const updateVoce = (id: string, p: Partial<CdgVoce>) => updateCdg(cur => ({
    ...cur,
    voci: ((cur.voci ?? []) as CdgVoce[]).map(x => x.id === id ? { ...x, ...p } : x),
  }));
  const removeVoce = (id: string) => updateCdg(cur => ({
    ...cur,
    voci: ((cur.voci ?? []) as CdgVoce[]).filter(x => x.id !== id),
  }));
  const setVoceMese = (id: string, mi: number, v: number) => updateCdg(cur => ({
    ...cur,
    voci: ((cur.voci ?? []) as CdgVoce[]).map(x => {
      if (x.id !== id) return x;
      const me = { ...(x.mensili ?? {}) };
      me[String(mi)] = v;
      return { ...x, mensili: me };
    }),
  }));

  const chartData = summary.map(s => ({ name: s.nome, ricavi: s.ricavi, costi: s.costi, margine: s.margine, color: s.color }));

  return (
    <div className="space-y-4" data-testid="finplan-cdg-pdv">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm">Performance per PDV — {meseLabel}</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={String(mese)} onValueChange={v => setMese(parseInt(v, 10))}>
                <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-cdg-mese"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MO.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
                  <SelectItem value={String(ANNO)}>Anno intero</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={addPdv} data-testid="button-cdg-add-pdv">
                <Plus className="h-3.5 w-3.5 mr-1" /> Nuovo PDV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <Stat label="Ricavi totali" value={formatCurrency(totals.ricavi)} testId="stat-cdg-ricavi" highlight="emerald" />
            <Stat label="Costi totali" value={formatCurrency(totals.costi)} testId="stat-cdg-costi" highlight="rose" />
            <Stat label="Margine" value={formatCurrency(totals.margine)} testId="stat-cdg-margine" highlight={totals.margine >= 0 ? "emerald" : "rose"} />
          </div>

          {summary.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-cdg">
              Nessun PDV configurato. Aggiungine uno per tracciare ricavi, costi e margine.
            </p>
          ) : (
            <>
              <div className="h-[280px]" data-testid="chart-cdg-comparativa">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => formatCurrency(v as number)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ricavi" fill="#10B981" radius={[4, 4, 0, 0]} name="Ricavi" />
                    <Bar dataKey="costi" fill="#F43F5E" radius={[4, 4, 0, 0]} name="Costi" />
                    <Bar dataKey="margine" radius={[4, 4, 0, 0]} name="Margine">
                      {chartData.map((e, i) => <Cell key={i} fill={e.margine >= 0 ? "#3B82F6" : "#94A3B8"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PDV</TableHead>
                    <TableHead className="text-right">Ricavi</TableHead>
                    <TableHead className="text-right">Costi</TableHead>
                    <TableHead className="text-right">Margine</TableHead>
                    <TableHead className="text-right w-[80px]">% Marg.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map(s => (
                    <TableRow key={s.id} data-testid={`row-cdg-summary-${s.id}`}>
                      <TableCell className="text-xs">
                        <span className="inline-block w-2 h-2 rounded mr-2 align-middle" style={{ background: s.color }} />
                        {s.nome}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-600">{formatCurrency(s.ricavi)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-rose-600">{formatCurrency(s.costi)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs font-bold ${s.margine >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatCurrency(s.margine)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{s.ricavi > 0 ? `${s.marginePct.toFixed(0)}%` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="ricavi">
        <TabsList>
          <TabsTrigger value="ricavi" data-testid="tab-cdg-ricavi">Ricavi mensili</TabsTrigger>
          <TabsTrigger value="costi" data-testid="tab-cdg-costi">Costi (voci)</TabsTrigger>
        </TabsList>

        <TabsContent value="ricavi" className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Ricavi mensili per PDV</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {pdv.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nessun PDV.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px] sticky left-0 bg-background">PDV</TableHead>
                      {MO.map(m => <TableHead key={m} className="text-right w-[80px]">{m}</TableHead>)}
                      <TableHead className="text-right w-[110px]">Anno</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pdv.map(p => {
                      const tot = getMese(p.entrate, ANNO);
                      return (
                        <TableRow key={p.id} data-testid={`row-cdg-pdv-${p.id}`}>
                          <TableCell className="sticky left-0 bg-background">
                            <Input defaultValue={p.nome} onBlur={e => updatePdv(p.id, { nome: e.target.value })} className="h-7 text-xs" data-testid={`input-cdg-pdv-nome-${p.id}`} />
                          </TableCell>
                          {MO.map((_, mi) => (
                            <TableCell key={mi}>
                              <Input
                                defaultValue={getMese(p.entrate, mi) || ""}
                                onBlur={e => setEntrata(p.id, mi, parseEuro(e.target.value))}
                                placeholder="—"
                                className="h-7 font-mono text-xs text-right"
                                inputMode="decimal"
                                data-testid={`input-cdg-ent-${p.id}-${mi}`}
                              />
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-mono text-xs font-bold text-emerald-600">{formatCurrency(tot)}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removePdv(p.id)} data-testid={`button-cdg-pdv-del-${p.id}`}>
                              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costi" className="mt-4">
          <div className="space-y-3">
            {pdv.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Aggiungi un PDV per tracciare le voci di costo.</p>
            ) : pdv.map(p => {
              const vp = voci.filter(v => v.pdvId === p.id);
              return (
                <Card key={p.id}>
                  <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm">{p.nome}</CardTitle>
                    <Button size="sm" variant="outline" onClick={() => addVoce(p.id)} data-testid={`button-cdg-voce-add-${p.id}`}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Voce
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    {vp.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">Nessuna voce di costo.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[180px] sticky left-0 bg-background">Voce</TableHead>
                            {MO.map(m => <TableHead key={m} className="text-right w-[80px]">{m}</TableHead>)}
                            <TableHead className="text-right w-[110px]">Anno</TableHead>
                            <TableHead className="w-[40px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vp.map(v => {
                            const tot = getMese(v.mensili, ANNO);
                            return (
                              <TableRow key={v.id} data-testid={`row-cdg-voce-${v.id}`}>
                                <TableCell className="sticky left-0 bg-background">
                                  <Input defaultValue={v.nome} onBlur={e => updateVoce(v.id, { nome: e.target.value })} className="h-7 text-xs" data-testid={`input-cdg-voce-nome-${v.id}`} />
                                </TableCell>
                                {MO.map((_, mi) => (
                                  <TableCell key={mi}>
                                    <Input
                                      defaultValue={getMese(v.mensili, mi) || ""}
                                      onBlur={e => setVoceMese(v.id, mi, parseEuro(e.target.value))}
                                      placeholder="—"
                                      className="h-7 font-mono text-xs text-right"
                                      inputMode="decimal"
                                      data-testid={`input-cdg-voce-${v.id}-${mi}`}
                                    />
                                  </TableCell>
                                ))}
                                <TableCell className="text-right font-mono text-xs font-bold text-rose-600">{formatCurrency(tot)}</TableCell>
                                <TableCell>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeVoce(v.id)} data-testid={`button-cdg-voce-del-${v.id}`}>
                                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
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
