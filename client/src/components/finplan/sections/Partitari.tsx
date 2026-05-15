// Sezione Partitari (Task #146).
// Sorgente: index.html righe 6029-6310. Due tab: Clienti (C) / Fornitori (F).
// CRUD righe + import Excel + import PDF mastrino (lazy pdfjs-dist).

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Upload, Wallet } from "lucide-react";
import type {
  FinplanCompanySnapshot,
  FinplanPartitarioRow,
  FinplanPartitari,
  FinplanSnapshot,
} from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { parseItalianNumber } from "@/utils/parseItalianNumber";
import { useToast } from "@/hooks/use-toast";
import {
  PT_FIELDS,
  ptApplyMapping,
  ptAutoDetect,
  ptComputeTotals,
  ptGiorniScaduto,
  ptParsePdfText,
  ptResiduo,
  ptStato,
  ptTotale,
  type PtStato,
} from "@/lib/finplan/partitari";

interface Props {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

type PtType = "C" | "F";

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
  return parseItalianNumber(s);
}

const STATO_BADGE: Record<PtStato, string> = {
  pagato:   "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  parziale: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  scaduto:  "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  aperto:   "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

export function Partitari({ snapshot, companyIndex, scheduleSave }: Props) {
  const co = snapshot?.data?.[companyIndex];
  const pt = (co?.partitari ?? {}) as FinplanPartitari;

  const updateBucket = (type: PtType, fn: (rows: FinplanPartitarioRow[]) => FinplanPartitarioRow[]) =>
    scheduleSave(prev => patch(prev, snapshot, companyIndex, c => {
      const cur = (c.partitari ?? {}) as FinplanPartitari;
      const rows = (cur[type] ?? []) as FinplanPartitarioRow[];
      return { ...c, partitari: { ...cur, [type]: fn(rows) } };
    }));

  return (
    <div className="space-y-3" data-testid="finplan-partitari">
      <Tabs defaultValue="C">
        <TabsList>
          <TabsTrigger value="C" data-testid="tab-pt-C">
            Clienti ({(pt.C ?? []).length})
          </TabsTrigger>
          <TabsTrigger value="F" data-testid="tab-pt-F">
            Fornitori ({(pt.F ?? []).length})
          </TabsTrigger>
        </TabsList>

        {(["C", "F"] as PtType[]).map(type => (
          <TabsContent key={type} value={type} className="mt-4">
            <PartitarioBucket
              type={type}
              rows={(pt[type] ?? []) as FinplanPartitarioRow[]}
              onAdd={(r) => updateBucket(type, list => list.concat([r]))}
              onUpdate={(id, p) => updateBucket(type, list => list.map(r => r.id === id ? { ...r, ...p, stato: ptStato({ ...r, ...p }) } : r))}
              onRemove={(id) => updateBucket(type, list => list.filter(r => r.id !== id))}
              onAddPayment={(id, amt) => updateBucket(type, list => list.map(r => {
                if (r.id !== id) return r;
                const next = { ...r, pagato: (r.pagato ?? 0) + amt };
                return { ...next, stato: ptStato(next) };
              }))}
              onImport={(imported) => updateBucket(type, list => list.concat(imported))}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function PartitarioBucket({ type, rows, onAdd, onUpdate, onRemove, onAddPayment, onImport }: {
  type: PtType;
  rows: FinplanPartitarioRow[];
  onAdd: (r: FinplanPartitarioRow) => void;
  onUpdate: (id: FinplanPartitarioRow["id"], p: Partial<FinplanPartitarioRow>) => void;
  onRemove: (id: FinplanPartitarioRow["id"]) => void;
  onAddPayment: (id: FinplanPartitarioRow["id"], amt: number) => void;
  onImport: (rows: FinplanPartitarioRow[]) => void;
}) {
  const [filter, setFilter] = useState<"all" | PtStato>("all");
  const [controparte, setControparte] = useState("");
  const [fascia, setFascia] = useState<"all" | "0-30" | "31-60" | "61-90" | "90+">("all");
  const totals = useMemo(() => ptComputeTotals(rows), [rows]);
  const filtered = useMemo(() => {
    const cpQ = controparte.trim().toLowerCase();
    return rows.filter(r => {
      if (filter !== "all" && ptStato(r) !== filter) return false;
      if (cpQ && !(r.ragsoc ?? "").toLowerCase().includes(cpQ)) return false;
      if (fascia !== "all") {
        const dd = ptGiorniScaduto(r) ?? -1;
        if (dd <= 0) return false;
        if (fascia === "0-30"  && !(dd >= 1  && dd <= 30)) return false;
        if (fascia === "31-60" && !(dd >= 31 && dd <= 60)) return false;
        if (fascia === "61-90" && !(dd >= 61 && dd <= 90)) return false;
        if (fascia === "90+"   && !(dd > 90)) return false;
      }
      return true;
    });
  }, [rows, filter, controparte, fascia]);

  const label = type === "C" ? "Clienti" : "Fornitori";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat label="Partite" value={String(totals.count)} testId={`stat-pt-${type}-count`} />
        <Stat label="Totale" value={formatCurrency(totals.totale)} testId={`stat-pt-${type}-tot`} />
        <Stat label="Pagato" value={formatCurrency(totals.pagato)} testId={`stat-pt-${type}-pag`} highlight="emerald" />
        <Stat label="A scadere" value={formatCurrency(totals.aScadere)} testId={`stat-pt-${type}-asc`} highlight="amber" />
        <Stat label="Scaduto" value={formatCurrency(totals.scaduto)} testId={`stat-pt-${type}-sca`} highlight="rose" />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm">{label}</CardTitle>
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              placeholder="Cerca controparte…"
              value={controparte}
              onChange={e => setControparte(e.target.value)}
              className="h-8 w-44 text-xs"
              data-testid={`input-pt-${type}-controparte`}
            />
            <Select value={filter} onValueChange={v => setFilter(v as typeof filter)}>
              <SelectTrigger className="h-8 w-32 text-xs" data-testid={`select-pt-${type}-filter`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="aperto">Aperti</SelectItem>
                <SelectItem value="parziale">Parziali</SelectItem>
                <SelectItem value="scaduto">Scaduti</SelectItem>
                <SelectItem value="pagato">Pagati</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fascia} onValueChange={v => setFascia(v as typeof fascia)}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid={`select-pt-${type}-fascia`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le fasce</SelectItem>
                <SelectItem value="0-30">Scaduto 0–30 gg</SelectItem>
                <SelectItem value="31-60">Scaduto 31–60 gg</SelectItem>
                <SelectItem value="61-90">Scaduto 61–90 gg</SelectItem>
                <SelectItem value="90+">Scaduto &gt; 90 gg</SelectItem>
              </SelectContent>
            </Select>
            <NewRowDialog type={type} onAdd={onAdd} existing={rows} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ragione Sociale</TableHead>
                <TableHead className="w-[110px]">N. Fatt.</TableHead>
                <TableHead className="w-[110px]">Emiss.</TableHead>
                <TableHead className="w-[110px]">Scad.</TableHead>
                <TableHead className="text-right w-[110px]">Imponibile</TableHead>
                <TableHead className="text-right w-[70px]">IVA %</TableHead>
                <TableHead className="text-right w-[110px]">Totale</TableHead>
                <TableHead className="text-right w-[110px]">Pagato</TableHead>
                <TableHead className="text-right w-[110px]">Residuo</TableHead>
                <TableHead className="w-[90px]">Stato</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-6" data-testid={`text-no-pt-${type}`}>
                  Nessuna partita.
                </TableCell></TableRow>
              ) : filtered.map(r => {
                const stato = ptStato(r);
                const dd = ptGiorniScaduto(r);
                return (
                  <TableRow key={String(r.id)} data-testid={`row-pt-${type}-${r.id}`}>
                    <TableCell><Input defaultValue={r.ragsoc ?? ""} onBlur={e => onUpdate(r.id, { ragsoc: e.target.value })} className="h-7 text-xs" data-testid={`input-pt-ragsoc-${r.id}`} /></TableCell>
                    <TableCell><Input defaultValue={r.nfatt ?? ""} onBlur={e => onUpdate(r.id, { nfatt: e.target.value })} className="h-7 text-xs w-24" data-testid={`input-pt-nfatt-${r.id}`} /></TableCell>
                    <TableCell><Input type="date" defaultValue={r.emiss ?? ""} onBlur={e => onUpdate(r.id, { emiss: e.target.value })} className="h-7 text-xs w-32" data-testid={`input-pt-emiss-${r.id}`} /></TableCell>
                    <TableCell><Input type="date" defaultValue={r.scad ?? ""} onBlur={e => onUpdate(r.id, { scad: e.target.value })} className="h-7 text-xs w-32" data-testid={`input-pt-scad-${r.id}`} /></TableCell>
                    <TableCell><Input defaultValue={r.imp ?? 0} onBlur={e => onUpdate(r.id, { imp: parseEuro(e.target.value) })} className="h-7 font-mono text-xs text-right" inputMode="decimal" data-testid={`input-pt-imp-${r.id}`} /></TableCell>
                    <TableCell><Input defaultValue={r.iva ?? 22} onBlur={e => onUpdate(r.id, { iva: parseEuro(e.target.value) })} className="h-7 font-mono text-xs text-right" inputMode="decimal" data-testid={`input-pt-iva-${r.id}`} /></TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatCurrency(ptTotale(r))}</TableCell>
                    <TableCell><Input defaultValue={r.pagato ?? 0} onBlur={e => onUpdate(r.id, { pagato: parseEuro(e.target.value) })} className="h-7 font-mono text-xs text-right" inputMode="decimal" data-testid={`input-pt-pag-${r.id}`} /></TableCell>
                    <TableCell className={`text-right font-mono text-xs font-bold ${ptResiduo(r) > 0 ? "text-rose-600" : "text-emerald-600"}`} data-testid={`text-pt-res-${r.id}`}>{formatCurrency(ptResiduo(r))}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${STATO_BADGE[stato]}`} data-testid={`badge-pt-stato-${r.id}`}>{stato.toUpperCase()}</Badge>
                      {dd != null && stato === "scaduto" && (
                        <div className="text-[9px] text-rose-500 mt-1">{dd}gg</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Aggiungi pagamento" onClick={() => {
                        const v = window.prompt("Importo pagamento parziale (€):");
                        const amt = v ? parseEuro(v) : 0;
                        if (amt > 0) onAddPayment(r.id, amt);
                      }} data-testid={`button-pt-pay-${r.id}`}>
                        <Wallet className="h-3.5 w-3.5 text-emerald-600" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemove(r.id)} data-testid={`button-pt-del-${r.id}`}>
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

      <ImportPanel type={type} existing={rows} onImport={onImport} />
    </div>
  );
}

function NewRowDialog({ type, existing, onAdd }: {
  type: PtType;
  existing: FinplanPartitarioRow[];
  onAdd: (r: FinplanPartitarioRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ragsoc, setRagsoc] = useState("");
  const [nfatt, setNfatt] = useState("");
  const [emiss, setEmiss] = useState("");
  const [scad, setScad] = useState("");
  const [imp, setImp] = useState("");
  const [iva, setIva] = useState("22");
  const [pagato, setPagato] = useState("");
  const { toast } = useToast();

  const submit = () => {
    if (!ragsoc.trim()) { toast({ title: "Inserisci la ragione sociale", variant: "destructive" }); return; }
    const impN = parseEuro(imp);
    if (impN <= 0) { toast({ title: "Inserisci un importo", variant: "destructive" }); return; }
    const row: FinplanPartitarioRow = {
      id: nextNumId(existing),
      ragsoc: ragsoc.trim(),
      nfatt: nfatt.trim() || undefined,
      emiss: emiss || undefined,
      scad: scad || undefined,
      imp: impN,
      iva: parseEuro(iva) || 22,
      pagato: parseEuro(pagato),
    };
    row.stato = ptStato(row);
    onAdd(row);
    setRagsoc(""); setNfatt(""); setEmiss(""); setScad(""); setImp(""); setIva("22"); setPagato("");
    setOpen(false);
    toast({ title: "Partita aggiunta" });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(o => !o)} data-testid={`button-pt-${type}-add`}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Nuova
      </Button>
      {open && (
        <div className="absolute z-10 mt-12 right-4 w-[420px] rounded-md border bg-background p-3 shadow-md space-y-2" data-testid={`pt-${type}-form`}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ragione Sociale"><Input value={ragsoc} onChange={e => setRagsoc(e.target.value)} className="h-8" data-testid={`input-pt-${type}-form-ragsoc`} /></Field>
            <Field label="N. Fattura"><Input value={nfatt} onChange={e => setNfatt(e.target.value)} className="h-8" data-testid={`input-pt-${type}-form-nfatt`} /></Field>
            <Field label="Emissione"><Input type="date" value={emiss} onChange={e => setEmiss(e.target.value)} className="h-8" data-testid={`input-pt-${type}-form-emiss`} /></Field>
            <Field label="Scadenza"><Input type="date" value={scad} onChange={e => setScad(e.target.value)} className="h-8" data-testid={`input-pt-${type}-form-scad`} /></Field>
            <Field label="Imponibile"><Input value={imp} onChange={e => setImp(e.target.value)} inputMode="decimal" className="h-8 font-mono" data-testid={`input-pt-${type}-form-imp`} /></Field>
            <Field label="IVA %"><Input value={iva} onChange={e => setIva(e.target.value)} inputMode="decimal" className="h-8 font-mono" data-testid={`input-pt-${type}-form-iva`} /></Field>
            <Field label="Pagato"><Input value={pagato} onChange={e => setPagato(e.target.value)} inputMode="decimal" className="h-8 font-mono" data-testid={`input-pt-${type}-form-pag`} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} data-testid={`button-pt-${type}-form-cancel`}>Annulla</Button>
            <Button size="sm" onClick={submit} data-testid={`button-pt-${type}-form-save`}>Salva</Button>
          </div>
        </div>
      )}
    </>
  );
}

interface ImportState {
  headers: string[];
  rows: unknown[][];
  fname: string;
  mapping: Record<string, number>;
}

function ImportPanel({ type, existing, onImport }: {
  type: PtType;
  existing: FinplanPartitarioRow[];
  onImport: (rows: FinplanPartitarioRow[]) => void;
}) {
  const { toast } = useToast();
  const inpRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "pdf") {
        // Lazy load pdfjs-dist
        const pdfjs = await import("pdfjs-dist");
        // Disable worker per evitare il setup separato
        // (parsing piccoli PDF mastrino, va bene single-thread).
        type PdfJsLib = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str: string }[] }> }> }> } };
        (pdfjs as unknown as PdfJsLib).GlobalWorkerOptions.workerSrc = "";
        const buf = await file.arrayBuffer();
        const pdf = await (pdfjs as unknown as PdfJsLib).getDocument({ data: buf }).promise;
        let text = "";
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          text += tc.items.map(it => it.str).join("\n") + "\n";
        }
        const parsed = ptParsePdfText(text);
        if (parsed.length === 0) { toast({ title: "Nessuna riga riconosciuta nel PDF", variant: "destructive" }); return; }
        // Renumera ID in modo coerente con esistenti
        const startId = nextNumId(existing);
        const renum = parsed.map((r, i) => ({ ...r, id: startId + i }));
        onImport(renum);
        toast({ title: `${renum.length} righe importate dal PDF mastrino` });
        return;
      }
      let headers: string[] = [];
      let rows: unknown[][] = [];
      if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
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
      for (const f of PT_FIELDS) mapping[f.k] = ptAutoDetect(headers, f.k);
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
    const startId = nextNumId(existing);
    const imported = ptApplyMapping(state.rows, state.mapping, startId);
    if (imported.length === 0) { toast({ title: "Nessuna riga valida da importare", variant: "destructive" }); return; }
    onImport(imported);
    setState(null);
    toast({ title: `${imported.length} righe importate` });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Importa {type === "C" ? "clienti" : "fornitori"} (Excel/PDF mastrino)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            ref={inpRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.pdf"
            onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            disabled={busy}
            className="h-9 text-xs flex-1"
            data-testid={`input-pt-${type}-file`}
          />
          <Upload className="h-4 w-4 text-muted-foreground" />
        </div>
        {state && (
          <div className="rounded-md border p-3 space-y-2" data-testid={`pt-${type}-import-mapping`}>
            <div className="text-xs text-muted-foreground">
              File: <span className="font-medium text-foreground">{state.fname}</span> — {state.rows.length} righe
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PT_FIELDS.map(f => (
                <div key={f.k} className="flex items-center gap-2">
                  <Label className="text-xs w-36">{f.l}</Label>
                  <Select
                    value={String(state.mapping[f.k] ?? -1)}
                    onValueChange={v => setState(s => s ? { ...s, mapping: { ...s.mapping, [f.k]: parseInt(v, 10) } } : s)}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-pt-${type}-map-${f.k}`}>
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
              <Button variant="ghost" size="sm" onClick={() => setState(null)} data-testid={`button-pt-${type}-import-cancel`}>Annulla</Button>
              <Button size="sm" onClick={apply} data-testid={`button-pt-${type}-import-apply`}>Importa</Button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Per i PDF mastrino il parser estrae automaticamente le righe data + numero + causale + importo.
        </p>
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

function Stat({ label, value, testId, highlight }: { label: string; value: string; testId: string; highlight?: "rose" | "amber" | "emerald" }) {
  const color = highlight === "rose" ? "text-rose-600" : highlight === "amber" ? "text-amber-600" : highlight === "emerald" ? "text-emerald-600" : "";
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`font-bold text-sm font-mono ${color}`} data-testid={testId}>{value}</div>
    </div>
  );
}
