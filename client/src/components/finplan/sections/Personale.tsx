// Sezione Personale/HR (Task #146).
// Sorgente: index.html righe 5028-5866.
// CRUD organico + KPI + chart per PDV + import Excel/CSV.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import type {
  FinplanCompanySnapshot,
  FinplanPersonaleRow,
  FinplanSnapshot,
} from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { useToast } from "@/hooks/use-toast";
import {
  HR_COLORS,
  HR_FIELDS,
  aggregateHrPerPdv,
  computeHrTotals,
  hrApplyMapping,
  hrAutoDetect,
  hrCostoMensile,
  syncHRToUscite,
} from "@/lib/finplan/personale";

interface Props {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

const MO = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

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

function nextNumId(arr: { id?: number | string }[]): number {
  return arr.reduce((m, o) => (typeof o.id === "number" && o.id > m ? o.id : m), 0) + 1;
}

function parseEuro(s: string): number {
  return parseFloat(s.replace(",", ".")) || 0;
}

export function Personale({ snapshot, companyIndex, scheduleSave }: Props) {
  const co = snapshot?.data?.[companyIndex];
  const personale = (co?.personale ?? []) as FinplanPersonaleRow[];
  const totals = useMemo(() => computeHrTotals(personale), [personale]);
  const perPdv = useMemo(() => aggregateHrPerPdv(personale), [personale]);

  const [editing, setEditing] = useState<FinplanPersonaleRow | null>(null);
  const [creating, setCreating] = useState(false);

  const updateRow = (id: FinplanPersonaleRow["id"], p: Partial<FinplanPersonaleRow>) =>
    scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
      const list = ((c.personale ?? []) as FinplanPersonaleRow[]).map(r =>
        r.id === id ? { ...r, ...p } : r,
      );
      return syncHRToUscite({ ...c, personale: list });
    }));

  const removeRow = (id: FinplanPersonaleRow["id"]) =>
    scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
      const list = ((c.personale ?? []) as FinplanPersonaleRow[]).filter(r => r.id !== id);
      return syncHRToUscite({ ...c, personale: list });
    }));

  const insertRow = (row: FinplanPersonaleRow) =>
    scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
      const list = ((c.personale ?? []) as FinplanPersonaleRow[]).slice();
      const id = nextNumId(list);
      list.push({ ...row, id });
      return syncHRToUscite({ ...c, personale: list });
    }));

  return (
    <div className="space-y-4" data-testid="finplan-personale">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat label="Dipendenti" value={String(totals.nDip)} testId="stat-hr-dip" />
        <Stat label="RAL Totale" value={formatCurrency(totals.totRAL)} testId="stat-hr-ral" />
        <Stat label="Costo Azienda" value={formatCurrency(totals.totCosto)} testId="stat-hr-costo" highlight="rose" />
        <Stat label="Costo Mensile" value={formatCurrency(totals.costoMese)} testId="stat-hr-mese" highlight="amber" />
        <Stat label="TFR" value={formatCurrency(totals.totTfr)} testId="stat-hr-tfr" />
      </div>

      <Tabs defaultValue="lista">
        <TabsList>
          <TabsTrigger value="lista" data-testid="tab-hr-lista">Organico</TabsTrigger>
          <TabsTrigger value="pdv" data-testid="tab-hr-pdv">Per PDV</TabsTrigger>
          <TabsTrigger value="imp" data-testid="tab-hr-imp">Importa Excel</TabsTrigger>
        </TabsList>

        <TabsContent value="lista" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Organico ({personale.length})</CardTitle>
              <Button onClick={() => setCreating(true)} size="sm" data-testid="button-hr-add">
                <Plus className="h-3.5 w-3.5 mr-1" /> Nuovo dipendente
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Ruolo</TableHead>
                    <TableHead>PDV</TableHead>
                    <TableHead className="text-right w-[110px]">RAL</TableHead>
                    <TableHead className="text-right w-[120px]">Costo Azienda</TableHead>
                    <TableHead className="text-right w-[100px]">TFR</TableHead>
                    <TableHead className="text-right w-[100px]">Benefit</TableHead>
                    <TableHead className="text-right w-[110px]">Costo/mese</TableHead>
                    <TableHead className="w-[60px]">Attivo</TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {personale.length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-6" data-testid="text-no-hr">
                      Nessun dipendente. Aggiungine uno o importa da Excel.
                    </TableCell></TableRow>
                  ) : personale.map(p => {
                    const rec = p as Record<string, unknown>;
                    return (
                      <TableRow key={String(p.id)} data-testid={`row-hr-${p.id}`}>
                        <TableCell><span className="inline-block w-2.5 h-2.5 rounded" style={{ background: HR_COLORS[(Number(p.id) || 0) % HR_COLORS.length] }} /></TableCell>
                        <TableCell className="text-xs font-medium" data-testid={`text-hr-nome-${p.id}`}>{p.nome || "—"}</TableCell>
                        <TableCell className="text-xs" data-testid={`text-hr-ruolo-${p.id}`}>{p.ruolo || "—"}</TableCell>
                        <TableCell className="text-xs" data-testid={`text-hr-pdv-${p.id}`}>{(rec.pdv as string) || "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs" data-testid={`text-hr-ral-${p.id}`}>{formatCurrency(Number(rec.ral) || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs" data-testid={`text-hr-costo-${p.id}`}>{formatCurrency(Number(rec.costoAzienda) || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs" data-testid={`text-hr-tfr-${p.id}`}>{formatCurrency(Number(rec.tfr) || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs" data-testid={`text-hr-benefit-${p.id}`}>{formatCurrency(Number(rec.benefit) || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold" data-testid={`text-hr-costomese-${p.id}`}>{formatCurrency(hrCostoMensile(p))}</TableCell>
                        <TableCell>
                          <Checkbox checked={rec.attivo !== false} onCheckedChange={v => updateRow(p.id, { attivo: !!v } as Partial<FinplanPersonaleRow>)} data-testid={`check-hr-attivo-${p.id}`} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(p)} data-testid={`button-hr-edit-${p.id}`}>
                              <Pencil className="h-3.5 w-3.5 text-sky-600" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(p.id)} data-testid={`button-hr-del-${p.id}`}>
                              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pdv" className="mt-4">
          <PerPdvView rows={perPdv} />
        </TabsContent>

        <TabsContent value="imp" className="mt-4">
          <ImportPanel
            onApply={(rows, mapping, fname) => scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
              const cur = ((c.personale ?? []) as FinplanPersonaleRow[]).slice();
              const startId = nextNumId(cur);
              const imported = hrApplyMapping(rows.headers, rows.rows, mapping, startId);
              const next = cur.concat(imported);
              const filesPrev = (c.importedFiles ?? []).slice();
              if (!filesPrev.find(f => f.name === fname && f.type === "hr")) {
                filesPrev.push({ name: fname, type: "hr", date: new Date().toLocaleDateString("it-IT") });
              }
              return syncHRToUscite({
                ...c,
                personale: next,
                importedFileHR: { name: fname, type: "hr", date: new Date().toLocaleDateString("it-IT") },
                importedFiles: filesPrev,
              });
            }))}
          />
        </TabsContent>
      </Tabs>

      <HrModal
        open={creating}
        onOpenChange={setCreating}
        title="Nuovo dipendente"
        initial={null}
        onSubmit={(row) => { insertRow(row); setCreating(false); }}
      />
      <HrModal
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        title="Modifica dipendente"
        initial={editing}
        onSubmit={(row) => { if (editing) updateRow(editing.id, row); setEditing(null); }}
      />
    </div>
  );
}

function HrModal({ open, onOpenChange, title, initial, onSubmit }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial: FinplanPersonaleRow | null;
  onSubmit: (row: FinplanPersonaleRow) => void;
}) {
  const { toast } = useToast();
  const r = (initial ?? {}) as Record<string, unknown>;
  const [nome, setNome] = useState(String(r.nome ?? ""));
  const [ruolo, setRuolo] = useState(String(r.ruolo ?? ""));
  const [pdv, setPdv] = useState(String(r.pdv ?? ""));
  const [ral, setRal] = useState(String(r.ral ?? ""));
  const [costoAzienda, setCostoAzienda] = useState(String(r.costoAzienda ?? ""));
  const [tfr, setTfr] = useState(String(r.tfr ?? ""));
  const [benefit, setBenefit] = useState(String(r.benefit ?? ""));
  const [attivo, setAttivo] = useState<boolean>(r.attivo !== false);

  // Resetta i campi quando cambia la riga in editing
  useEffect(() => {
    const rr = (initial ?? {}) as Record<string, unknown>;
    setNome(String(rr.nome ?? ""));
    setRuolo(String(rr.ruolo ?? ""));
    setPdv(String(rr.pdv ?? ""));
    setRal(String(rr.ral ?? ""));
    setCostoAzienda(String(rr.costoAzienda ?? ""));
    setTfr(String(rr.tfr ?? ""));
    setBenefit(String(rr.benefit ?? ""));
    setAttivo(rr.attivo !== false);
  }, [initial]);

  const submit = () => {
    if (!nome.trim()) { toast({ title: "Inserisci il nome", variant: "destructive" }); return; }
    const row: FinplanPersonaleRow = {
      id: (initial?.id ?? 0),
      nome: nome.trim(),
      ruolo: ruolo.trim(),
      ral: parseEuro(ral),
      costoAzienda: parseEuro(costoAzienda),
      tfr: parseEuro(tfr),
      benefit: parseEuro(benefit),
      costoMensile: 0,
      meseInizio: (initial as Record<string, unknown>)?.meseInizio as number ?? 0,
      meseUscita: (initial as Record<string, unknown>)?.meseUscita as number ?? -1,
      attivo,
    };
    (row as Record<string, unknown>).pdv = pdv.trim();
    onSubmit(row);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-hr-form">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome"><Input value={nome} onChange={e => setNome(e.target.value)} className="h-9" data-testid="input-hr-form-nome" /></Field>
          <Field label="Ruolo"><Input value={ruolo} onChange={e => setRuolo(e.target.value)} className="h-9" data-testid="input-hr-form-ruolo" /></Field>
          <Field label="PDV (sigla SS/SM/AM/BO/TASK/SPECIALIST)"><Input value={pdv} onChange={e => setPdv(e.target.value)} className="h-9" data-testid="input-hr-form-pdv" /></Field>
          <Field label="RAL"><Input value={ral} onChange={e => setRal(e.target.value)} inputMode="decimal" className="h-9 font-mono" data-testid="input-hr-form-ral" /></Field>
          <Field label="Costo azienda annuo"><Input value={costoAzienda} onChange={e => setCostoAzienda(e.target.value)} inputMode="decimal" className="h-9 font-mono" data-testid="input-hr-form-costo" /></Field>
          <Field label="TFR"><Input value={tfr} onChange={e => setTfr(e.target.value)} inputMode="decimal" className="h-9 font-mono" data-testid="input-hr-form-tfr" /></Field>
          <Field label="Benefit"><Input value={benefit} onChange={e => setBenefit(e.target.value)} inputMode="decimal" className="h-9 font-mono" data-testid="input-hr-form-benefit" /></Field>
          <div className="flex items-end gap-2">
            <Checkbox checked={attivo} onCheckedChange={v => setAttivo(!!v)} data-testid="check-hr-form-attivo" />
            <Label className="text-xs">Attivo</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-hr-form-cancel">Annulla</Button>
          <Button onClick={submit} data-testid="button-hr-form-save">Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function PerPdvView({ rows }: { rows: ReturnType<typeof aggregateHrPerPdv> }) {
  const chartData = rows.map((r, i) => ({
    name: r.pdv,
    costo: +(r.costo + r.tfr + r.benefit).toFixed(2),
    color: HR_COLORS[i % HR_COLORS.length],
  }));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Costo annuo per PDV</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-hr-pdv">Nessun dato per PDV.</p>
        ) : (
          <>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v as number)} />
                  <Bar dataKey="costo" radius={[4, 4, 0, 0]}>
                    {chartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PDV</TableHead>
                  <TableHead className="text-right">Dip</TableHead>
                  <TableHead className="text-right">RAL</TableHead>
                  <TableHead className="text-right">Costo Az.</TableHead>
                  <TableHead className="text-right">TFR</TableHead>
                  <TableHead className="text-right">Benefit</TableHead>
                  <TableHead className="text-right">Costo/mese</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.pdv} data-testid={`row-hr-pdv-${i}`}>
                    <TableCell className="text-xs">
                      <span className="inline-block w-2 h-2 rounded mr-2 align-middle" style={{ background: HR_COLORS[i % HR_COLORS.length] }} />
                      {r.pdv}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.dip}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCurrency(r.ral)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCurrency(r.costo)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCurrency(r.tfr)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCurrency(r.benefit)}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold">{formatCurrency(r.costoMese)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ImportState {
  headers: string[];
  rows: unknown[][];
  fname: string;
  mapping: Record<string, number>;
}

function ImportPanel({ onApply }: {
  onApply: (data: { headers: string[]; rows: unknown[][] }, mapping: Record<string, number>, fname: string) => void;
}) {
  const { toast } = useToast();
  const inpRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let headers: string[] = [];
      let rows: unknown[][] = [];
      if (ext === "csv") {
        const text = await file.text();
        const fl = text.split("\n")[0] ?? "";
        const delim = fl.includes("\t") ? "\t" : fl.split(";").length > fl.split(",").length ? ";" : ",";
        const lines = text.trim().split("\n").map(l => l.split(delim).map(c => c.trim().replace(/^"|"$/g, "")));
        if (lines.length < 2) { toast({ title: "CSV vuoto", variant: "destructive" }); return; }
        headers = lines[0];
        rows = lines.slice(1).filter(r => r.some(c => c !== ""));
      } else if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        let raw: unknown[][] | null = null;
        for (const sn of wb.SheetNames) {
          const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: "" });
          const dr = r.filter(row => row.some(c => c !== ""));
          if (dr.length >= 2) { raw = dr; break; }
        }
        if (!raw) { toast({ title: "Nessun dato nel file", variant: "destructive" }); return; }
        let hi = 0;
        for (let i = 0; i < Math.min(8, raw.length); i++) {
          if (raw[i].filter(c => c !== "" && isNaN(parseFloat(String(c).replace(",", ".")))).length >= 2) { hi = i; break; }
        }
        headers = raw[hi].map((h, i) => String(h ?? "").trim() || `Col${i + 1}`);
        rows = raw.slice(hi + 1).filter(r => r.some(c => c !== ""));
      } else {
        toast({ title: `Formato .${ext} non supportato`, variant: "destructive" });
        return;
      }
      const mapping: Record<string, number> = {};
      for (const f of HR_FIELDS) mapping[f.k] = hrAutoDetect(headers, f.k);
      setState({ headers, rows, fname: file.name, mapping });
      toast({ title: `${rows.length} righe rilevate da ${file.name}` });
    } catch (e) {
      toast({ title: "Errore parsing", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
      if (inpRef.current) inpRef.current.value = "";
    }
  };

  const apply = () => {
    if (!state) return;
    onApply({ headers: state.headers, rows: state.rows }, state.mapping, state.fname);
    setState(null);
    toast({ title: "Import applicato" });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Importa da Excel/CSV</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            ref={inpRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            disabled={busy}
            className="h-9 text-xs flex-1"
            data-testid="input-hr-file"
          />
          <Upload className="h-4 w-4 text-muted-foreground" />
        </div>
        {state && (
          <div className="rounded-md border p-3 space-y-2" data-testid="hr-import-mapping">
            <div className="text-xs text-muted-foreground">
              File: <span className="font-medium text-foreground">{state.fname}</span> — {state.rows.length} righe
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {HR_FIELDS.map(f => (
                <div key={f.k} className="flex items-center gap-2">
                  <Label className="text-xs w-44">{f.l}</Label>
                  <Select
                    value={String(state.mapping[f.k] ?? -1)}
                    onValueChange={v => setState(s => s ? { ...s, mapping: { ...s.mapping, [f.k]: parseInt(v, 10) } } : s)}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-hr-map-${f.k}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="-1">— non presente —</SelectItem>
                      {state.headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setState(null)} data-testid="button-hr-import-cancel">Annulla</Button>
              <Button size="sm" onClick={apply} data-testid="button-hr-import-apply">Importa</Button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Colonne attese: Nome, Ruolo, PDV, RAL, Costo Azienda, TFR, Benefit, Date assunzione/scadenza.
          La sigla PDV (SS/SM/AM/BO/TASK/SPECIALIST) viene rilevata automaticamente.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, testId, highlight }: { label: string; value: string; testId: string; highlight?: "rose" | "amber" }) {
  const color = highlight === "rose" ? "text-rose-600" : highlight === "amber" ? "text-amber-600" : "";
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`font-bold text-sm font-mono ${color}`} data-testid={testId}>{value}</div>
    </div>
  );
}

// (MO export per coerenza con altri moduli — non usato qui ma utile per
// debug se servisse mostrare il break-down mensile.)
export const __PERSONALE_MO = MO;
