// Sezione Debiti (Task #145).
// 3 sotto-tab: Finanziamenti, AdE (Agenzia Entrate), Scadenziario.
// Sorgente: index.html righe 3165-3408 (debt) e 6480-6740 (AdE).
// Le forme oggetto sono mantenute compatibili con l'iframe legacy
// (passthrough nei rispettivi schemi Zod).

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
import type { FinplanAde, FinplanCompanySnapshot, FinplanDebt, FinplanDebtScadenza, FinplanSnapshot } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";

interface Props {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

function patch(prev: FinplanSnapshot | null, snap: FinplanSnapshot | null, ci: number, fn: (co: FinplanCompanySnapshot) => FinplanCompanySnapshot): FinplanSnapshot {
  const base: FinplanSnapshot = prev && prev.data ? prev : (snap ?? { data: [] });
  const data = (base.data ?? []).slice();
  data[ci] = fn(data[ci] ?? {});
  return { ...base, data };
}

function nextNumId(arr: { id?: number | string }[]): number {
  return arr.reduce((m, o) => {
    const n = typeof o.id === "number" ? o.id : 0;
    return n > m ? n : m;
  }, 0) + 1;
}

const DEBT_COLORS = ["#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#10B981", "#EC4899"];

export function Debiti({ snapshot, companyIndex, scheduleSave }: Props) {
  const co = snapshot?.data?.[companyIndex];
  const debts = (co?.debts ?? []) as FinplanDebt[];
  const ade = (co?.ade ?? []) as FinplanAde[];
  const sc = (co?.debtScadenze ?? []) as FinplanDebtScadenza[];

  const totals = useMemo(() => {
    const tDebt = debts.reduce((s, d) => s + (Number((d as any).rem) || Number((d as any).total) || (d.amount ?? 0)), 0);
    const tAde = ade.reduce((s, a) => s + (a.importo ?? 0), 0);
    return { tDebt: +tDebt.toFixed(2), tAde: +tAde.toFixed(2), totale: +(tDebt + tAde).toFixed(2) };
  }, [debts, ade]);

  return (
    <div className="space-y-4" data-testid="finplan-debiti">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Stat label="Debiti finanziari" value={formatCurrency(totals.tDebt)} testId="stat-debiti-fin" />
        <Stat label="Debiti AdE" value={formatCurrency(totals.tAde)} testId="stat-debiti-ade" />
        <Stat label="Totale esposizione" value={formatCurrency(totals.totale)} testId="stat-debiti-tot" highlight="rose" />
      </div>

      <Tabs defaultValue="fin">
        <TabsList>
          <TabsTrigger value="fin" data-testid="tab-debiti-fin">Finanziamenti</TabsTrigger>
          <TabsTrigger value="ade" data-testid="tab-debiti-ade">Agenzia Entrate</TabsTrigger>
          <TabsTrigger value="sc" data-testid="tab-debiti-sc">Scadenziario</TabsTrigger>
        </TabsList>

        <TabsContent value="fin" className="mt-4">
          <DebtList
            debts={debts}
            onAdd={() => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
              const list = ((c.debts ?? []) as FinplanDebt[]).slice();
              const id = nextNumId(list);
              const color = DEBT_COLORS[(list.length) % DEBT_COLORS.length];
              list.push({ id, name: "Nuovo debito", color, total: 0, rem: 0, rate: 0, periodicita: "mensile", giornoPagamento: 1 } as FinplanDebt);
              return { ...c, debts: list };
            }))}
            onUpdate={(id, p) => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => ({
              ...c,
              debts: ((c.debts ?? []) as FinplanDebt[]).map(d => d.id === id ? { ...d, ...p } as FinplanDebt : d),
            })))}
            onRemove={(id) => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => ({
              ...c,
              debts: ((c.debts ?? []) as FinplanDebt[]).filter(d => d.id !== id),
              debtScadenze: ((c.debtScadenze ?? []) as FinplanDebtScadenza[]).filter(s => (s as any).debtId !== id),
            })))}
          />
        </TabsContent>

        <TabsContent value="ade" className="mt-4">
          <AdeList
            list={ade}
            onAdd={() => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
              const list = ((c.ade ?? []) as FinplanAde[]).slice();
              const id = nextNumId(list);
              list.push({
                id, tipo: "bonario", ente: "Agenzia delle Entrate",
                numero: "", anno: new Date().getFullYear(), importo: 0,
                scadenza: "", stato: "aperto", tributo: "", periodo: "", note: "",
                rateazione: false, nRate: 0, importoRata: 0, rateScadenze: [],
              });
              return { ...c, ade: list };
            }))}
            onUpdate={(id, p) => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => ({
              ...c,
              ade: ((c.ade ?? []) as FinplanAde[]).map(a => a.id === id ? { ...a, ...p } as FinplanAde : a),
            })))}
            onRemove={(id) => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => ({
              ...c,
              ade: ((c.ade ?? []) as FinplanAde[]).filter(a => a.id !== id),
            })))}
          />
        </TabsContent>

        <TabsContent value="sc" className="mt-4">
          <Scadenziario
            scadenze={sc}
            debts={debts}
            onAdd={() => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
              const list = ((c.debtScadenze ?? []) as FinplanDebtScadenza[]).slice();
              const id = nextNumId(list);
              list.push({ id, debtId: undefined, debtName: "", data: "", importo: 0, pagata: false, note: "" } as any);
              return { ...c, debtScadenze: list };
            }))}
            onUpdate={(id, p) => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => ({
              ...c,
              debtScadenze: ((c.debtScadenze ?? []) as FinplanDebtScadenza[]).map(s => s.id === id ? { ...s, ...p } as FinplanDebtScadenza : s),
            })))}
            onRemove={(id) => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => ({
              ...c,
              debtScadenze: ((c.debtScadenze ?? []) as FinplanDebtScadenza[]).filter(s => s.id !== id),
            })))}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DebtList({ debts, onAdd, onUpdate, onRemove }: {
  debts: FinplanDebt[];
  onAdd: () => void;
  onUpdate: (id: FinplanDebt["id"], p: Partial<FinplanDebt>) => void;
  onRemove: (id: FinplanDebt["id"]) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Finanziamenti / mutui ({debts.length})</CardTitle>
        <Button onClick={onAdd} size="sm" data-testid="button-debt-add"><Plus className="h-3.5 w-3.5 mr-1" /> Nuovo</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {debts.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-debts">Nessun finanziamento. Aggiungine uno per tracciare residui e rate.</p>
        ) : debts.map(d => {
          const da = d as any;
          return (
            <div key={String(d.id)} className="rounded-md border p-3 space-y-2" data-testid={`row-debt-${d.id}`} style={{ borderLeftColor: da.color ?? "#3B82F6", borderLeftWidth: 4 }}>
              <div className="flex items-center gap-2">
                <Input defaultValue={d.name ?? ""} onBlur={e => onUpdate(d.id, { name: e.target.value })} className="h-8 flex-1" placeholder="Nome finanziamento" data-testid={`input-debt-name-${d.id}`} />
                <Input type="color" defaultValue={da.color ?? "#3B82F6"} onBlur={e => onUpdate(d.id, { color: e.target.value } as any)} className="h-8 w-12 p-1" />
                <Button variant="ghost" size="icon" onClick={() => onRemove(d.id)} className="h-7 w-7" data-testid={`button-debt-del-${d.id}`}>
                  <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <Field label="Importo totale">
                  <Input defaultValue={da.total ?? 0} onBlur={e => onUpdate(d.id, { total: parseFloat(e.target.value.replace(",", ".")) || 0 } as any)} className="h-8 font-mono text-xs" inputMode="decimal" data-testid={`input-debt-total-${d.id}`} />
                </Field>
                <Field label="Residuo">
                  <Input defaultValue={da.rem ?? 0} onBlur={e => onUpdate(d.id, { rem: parseFloat(e.target.value.replace(",", ".")) || 0 } as any)} className="h-8 font-mono text-xs" inputMode="decimal" data-testid={`input-debt-rem-${d.id}`} />
                </Field>
                <Field label="Tasso %">
                  <Input defaultValue={da.rate ?? 0} onBlur={e => onUpdate(d.id, { rate: parseFloat(e.target.value.replace(",", ".")) || 0 } as any)} className="h-8 font-mono text-xs" inputMode="decimal" data-testid={`input-debt-rate-${d.id}`} />
                </Field>
                <Field label="N. rate">
                  <Input defaultValue={da.nRate ?? 0} onBlur={e => onUpdate(d.id, { nRate: parseInt(e.target.value, 10) || 0 } as any)} className="h-8 font-mono text-xs" inputMode="numeric" data-testid={`input-debt-nrate-${d.id}`} />
                </Field>
                <Field label="Rata">
                  <Input defaultValue={da.importoRata ?? 0} onBlur={e => onUpdate(d.id, { importoRata: parseFloat(e.target.value.replace(",", ".")) || 0 } as any)} className="h-8 font-mono text-xs" inputMode="decimal" data-testid={`input-debt-rata-${d.id}`} />
                </Field>
                <Field label="Periodicità">
                  <Select defaultValue={da.periodicita ?? "mensile"} onValueChange={v => onUpdate(d.id, { periodicita: v } as any)}>
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-debt-period-${d.id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mensile">Mensile</SelectItem>
                      <SelectItem value="trimestrale">Trimestrale</SelectItem>
                      <SelectItem value="semestrale">Semestrale</SelectItem>
                      <SelectItem value="annuale">Annuale</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Data inizio">
                  <Input type="date" defaultValue={da.dataInizio ?? ""} onBlur={e => onUpdate(d.id, { dataInizio: e.target.value } as any)} className="h-8 text-xs" data-testid={`input-debt-data-${d.id}`} />
                </Field>
                <Field label="Giorno pag.">
                  <Input defaultValue={da.giornoPagamento ?? 1} onBlur={e => onUpdate(d.id, { giornoPagamento: parseInt(e.target.value, 10) || 1 } as any)} className="h-8 font-mono text-xs" inputMode="numeric" data-testid={`input-debt-day-${d.id}`} />
                </Field>
                <div className="col-span-2 md:col-span-4">
                  <Field label="Note">
                    <Input defaultValue={da.note ?? ""} onBlur={e => onUpdate(d.id, { note: e.target.value } as any)} className="h-8 text-xs" data-testid={`input-debt-note-${d.id}`} />
                  </Field>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AdeList({ list, onAdd, onUpdate, onRemove }: {
  list: FinplanAde[];
  onAdd: () => void;
  onUpdate: (id: FinplanAde["id"], p: Partial<FinplanAde>) => void;
  onRemove: (id: FinplanAde["id"]) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Avvisi bonari / cartelle ({list.length})</CardTitle>
        <Button onClick={onAdd} size="sm" data-testid="button-ade-add"><Plus className="h-3.5 w-3.5 mr-1" /> Nuovo</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-ade">Nessun avviso AdE registrato.</p>
        ) : list.map(a => (
          <div key={String(a.id)} className="rounded-md border p-3 space-y-2" data-testid={`row-ade-${a.id}`}>
            <div className="flex items-center gap-2">
              <Badge variant={a.tipo === "cartella" ? "destructive" : "secondary"}>{a.tipo}</Badge>
              <Badge variant="outline" className="text-[10px] capitalize">{a.stato ?? "aperto"}</Badge>
              <Input defaultValue={a.ente ?? ""} onBlur={e => onUpdate(a.id, { ente: e.target.value })} className="h-8 flex-1" placeholder="Ente" data-testid={`input-ade-ente-${a.id}`} />
              <Button variant="ghost" size="icon" onClick={() => onRemove(a.id)} className="h-7 w-7" data-testid={`button-ade-del-${a.id}`}>
                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <Field label="Tipo">
                <Select defaultValue={a.tipo ?? "bonario"} onValueChange={v => onUpdate(a.id, { tipo: v as "bonario" | "cartella" })}>
                  <SelectTrigger className="h-8 text-xs" data-testid={`select-ade-tipo-${a.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bonario">Avviso bonario</SelectItem>
                    <SelectItem value="cartella">Cartella</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Numero"><Input defaultValue={a.numero ?? ""} onBlur={e => onUpdate(a.id, { numero: e.target.value })} className="h-8 text-xs" data-testid={`input-ade-num-${a.id}`} /></Field>
              <Field label="Anno"><Input defaultValue={a.anno ?? ""} onBlur={e => onUpdate(a.id, { anno: parseInt(e.target.value, 10) || 0 })} className="h-8 font-mono text-xs" inputMode="numeric" data-testid={`input-ade-anno-${a.id}`} /></Field>
              <Field label="Importo"><Input defaultValue={a.importo ?? 0} onBlur={e => onUpdate(a.id, { importo: parseFloat(e.target.value.replace(",", ".")) || 0 })} className="h-8 font-mono text-xs" inputMode="decimal" data-testid={`input-ade-imp-${a.id}`} /></Field>
              <Field label="Scadenza"><Input type="date" defaultValue={a.scadenza ?? ""} onBlur={e => onUpdate(a.id, { scadenza: e.target.value })} className="h-8 text-xs" data-testid={`input-ade-scad-${a.id}`} /></Field>
              <Field label="Stato">
                <Select defaultValue={a.stato ?? "aperto"} onValueChange={v => onUpdate(a.id, { stato: v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid={`select-ade-stato-${a.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* Valori canonici lowercase allineati al tool legacy
                        (index.html ~6708) per byte-compat dei filtri e KPI
                        che fanno match esatto su `a.stato`. */}
                    <SelectItem value="aperto">Aperto</SelectItem>
                    <SelectItem value="pagato">Pagato</SelectItem>
                    <SelectItem value="rateazione">In rateazione</SelectItem>
                    <SelectItem value="scaduto">Scaduto</SelectItem>
                    <SelectItem value="impugnato">Impugnato</SelectItem>
                    <SelectItem value="sospeso">Sospeso</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Tributo"><Input defaultValue={a.tributo ?? ""} onBlur={e => onUpdate(a.id, { tributo: e.target.value })} className="h-8 text-xs" data-testid={`input-ade-trib-${a.id}`} /></Field>
              <Field label="Periodo"><Input defaultValue={a.periodo ?? ""} onBlur={e => onUpdate(a.id, { periodo: e.target.value })} className="h-8 text-xs" data-testid={`input-ade-per-${a.id}`} /></Field>
              <Field label="N. rate"><Input defaultValue={a.nRate ?? 0} onBlur={e => onUpdate(a.id, { nRate: parseInt(e.target.value, 10) || 0, rateazione: (parseInt(e.target.value, 10) || 0) > 0 })} className="h-8 font-mono text-xs" inputMode="numeric" data-testid={`input-ade-nrate-${a.id}`} /></Field>
              <Field label="Rata"><Input defaultValue={a.importoRata ?? 0} onBlur={e => onUpdate(a.id, { importoRata: parseFloat(e.target.value.replace(",", ".")) || 0 })} className="h-8 font-mono text-xs" inputMode="decimal" data-testid={`input-ade-rata-${a.id}`} /></Field>
              <div className="col-span-2 md:col-span-3">
                <Field label="Note"><Input defaultValue={a.note ?? ""} onBlur={e => onUpdate(a.id, { note: e.target.value })} className="h-8 text-xs" data-testid={`input-ade-note-${a.id}`} /></Field>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Scadenziario({ scadenze, debts, onAdd, onUpdate, onRemove }: {
  scadenze: FinplanDebtScadenza[];
  debts: FinplanDebt[];
  onAdd: () => void;
  onUpdate: (id: FinplanDebtScadenza["id"], p: Partial<FinplanDebtScadenza>) => void;
  onRemove: (id: FinplanDebtScadenza["id"]) => void;
}) {
  const sortedSc = useMemo(() => {
    return scadenze.slice().sort((a, b) => {
      const da = String((a as any).data ?? a.date ?? "");
      const db = String((b as any).data ?? b.date ?? "");
      return da.localeCompare(db);
    });
  }, [scadenze]);

  const totaleAperte = useMemo(() => {
    return sortedSc
      .filter(s => !(s as any).pagata)
      .reduce((acc, s) => acc + (Number((s as any).importo) || s.amount || 0), 0);
  }, [sortedSc]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Scadenze ({sortedSc.length}) — aperto: <span className="font-mono">{formatCurrency(totaleAperte)}</span></CardTitle>
        <Button onClick={onAdd} size="sm" data-testid="button-sc-add"><Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi</Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead className="w-[140px]">Data</TableHead>
              <TableHead>Debito</TableHead>
              <TableHead className="text-right">Importo</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedSc.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-4" data-testid="text-no-sc">Nessuna scadenza.</TableCell></TableRow>
            ) : sortedSc.map(s => {
              const sa = s as any;
              return (
                <TableRow key={String(s.id)} data-testid={`row-sc-${s.id}`}>
                  <TableCell>
                    <Checkbox checked={!!sa.pagata} onCheckedChange={v => onUpdate(s.id, { pagata: !!v } as any)} data-testid={`check-sc-pagata-${s.id}`} />
                  </TableCell>
                  <TableCell>
                    <Input type="date" defaultValue={sa.data ?? s.date ?? ""} onBlur={e => onUpdate(s.id, { data: e.target.value } as any)} className="h-8 text-xs" data-testid={`input-sc-data-${s.id}`} />
                  </TableCell>
                  <TableCell>
                    <Select defaultValue={sa.debtId != null ? String(sa.debtId) : "_none"} onValueChange={v => {
                      if (v === "_none") {
                        onUpdate(s.id, { debtId: undefined, debtName: "" } as any);
                      } else {
                        const d = debts.find(x => String(x.id) === v);
                        onUpdate(s.id, { debtId: d?.id, debtName: d?.name ?? "" } as any);
                      }
                    }}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-sc-debt-${s.id}`}><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— libero —</SelectItem>
                        {debts.map(d => <SelectItem key={String(d.id)} value={String(d.id)}>{d.name ?? `Debito ${d.id}`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input defaultValue={sa.importo ?? s.amount ?? 0} onBlur={e => onUpdate(s.id, { importo: parseFloat(e.target.value.replace(",", ".")) || 0 } as any)} className="h-8 font-mono text-xs text-right ml-auto w-32" inputMode="decimal" data-testid={`input-sc-imp-${s.id}`} />
                  </TableCell>
                  <TableCell>
                    <Input defaultValue={sa.note ?? ""} onBlur={e => onUpdate(s.id, { note: e.target.value } as any)} className="h-8 text-xs" data-testid={`input-sc-note-${s.id}`} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => onRemove(s.id)} className="h-7 w-7" data-testid={`button-sc-del-${s.id}`}>
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
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
