// Sezione Transazioni della shell React (Task #144).
// CRUD su `co.transactions`, filtri (mese/categoria/segno/ricerca),
// scorporo IVA in tabella, dialog di import estratto CC riusabile.
//
// Tutte le mutazioni ricostruiscono `co.m[]` da `transactions` via
// `rebuildMonthly` per mantenere coerenza con le sezioni Mensile/IVA
// (single source of truth: le transazioni). `txIdSeq` viene aggiornato
// al massimo + 1 dopo append.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Plus, Upload, Search, ChevronLeft, ChevronRight } from "lucide-react";
import type { FinplanCompanySnapshot, FinplanSnapshot, FinplanTransaction } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { ALL_DEFAULT_CATS, DEFAULT_CATS_E, DEFAULT_CATS_U, MO, classifyDesc } from "@/lib/finplanImport";
import { rebuildMonthly, scorporaIva, isNoIvaCat } from "@/lib/finplanIva";
import { BankImportFlow } from "../import/BankImportFlow";

interface TransazioniProps {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

const PAGE_SIZE = 20;
const IVA_RATES = [0, 4, 5, 10, 22];
// Soglia oltre la quale la tabella passa da paginazione a rendering
// virtualizzato (Task #144 review): evita di montare migliaia di
// TableRow simultaneamente su dataset grossi (import CC pluriennali).
const VIRTUAL_THRESHOLD = 500;
const VIRTUAL_ROW_HEIGHT = 36; // px, allineato a TableRow shadcn compact
const VIRTUAL_VIEWPORT_H = 600; // px, container scrollabile
const VIRTUAL_OVERSCAN = 8;

interface FormState {
  id: number | null;
  month: number;
  type: "E" | "U";
  amount: string;
  catId: string;
  ivaRate: number;
  desc: string;
}

const EMPTY_FORM: FormState = {
  id: null, month: new Date().getMonth(), type: "U", amount: "",
  catId: "u2", ivaRate: 0, desc: "",
};

function getCatName(catId: string | undefined, co: FinplanCompanySnapshot | undefined): string {
  if (!catId) return "—";
  const fromCo = co?.cats?.find(c => c.id === catId);
  if (fromCo?.name) return fromCo.name;
  const fromDefault = ALL_DEFAULT_CATS.find(c => c.id === catId);
  return fromDefault?.name ?? catId;
}

function getCatColor(catId: string | undefined, co: FinplanCompanySnapshot | undefined): string {
  if (!catId) return "#94A3B8";
  const fromCo = co?.cats?.find(c => c.id === catId);
  if (fromCo?.color) return String(fromCo.color);
  const fromDefault = ALL_DEFAULT_CATS.find(c => c.id === catId);
  return fromDefault?.color ?? "#94A3B8";
}

function nextTxIdFromCompany(co: FinplanCompanySnapshot | undefined): number {
  if (!co) return 1;
  const seq = typeof co.txIdSeq === "number" ? co.txIdSeq : 1;
  let maxId = seq - 1;
  for (const tx of co.transactions ?? []) {
    if (typeof tx.id === "number" && tx.id > maxId) maxId = tx.id;
  }
  return maxId + 1;
}

export function Transazioni({ snapshot, companyIndex, scheduleSave }: TransazioniProps) {
  const co = snapshot?.data?.[companyIndex];
  const transactions = useMemo<FinplanTransaction[]>(() => co?.transactions ?? [], [co]);

  // Filtri
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // CRUD modale
  const [editing, setEditing] = useState<FormState | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter(t => {
      if (filterMonth !== "all" && String(t.month) !== filterMonth) return false;
      if (filterType !== "all" && t.type !== filterType) return false;
      if (filterCat !== "all" && t.catId !== filterCat) return false;
      if (q && !((t.desc || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [transactions, filterMonth, filterType, filterCat, search]);

  const virtualized = filtered.length > VIRTUAL_THRESHOLD;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = virtualized
    ? filtered
    : filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Virtualizzazione manuale: scrollTop → finestra di righe visibili.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !virtualized) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [virtualized]);
  const vStart = virtualized
    ? Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN)
    : 0;
  const vEnd = virtualized
    ? Math.min(
        filtered.length,
        Math.ceil((scrollTop + VIRTUAL_VIEWPORT_H) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN,
      )
    : filtered.length;
  const visibleRows = virtualized ? filtered.slice(vStart, vEnd) : pageRows;
  const padTop = virtualized ? vStart * VIRTUAL_ROW_HEIGHT : 0;
  const padBottom = virtualized ? (filtered.length - vEnd) * VIRTUAL_ROW_HEIGHT : 0;

  const totals = useMemo(() => {
    let e = 0, u = 0, iva = 0;
    for (const t of filtered) {
      const amt = typeof t.amount === "number" ? t.amount : 0;
      const rate = typeof t.ivaRate === "number" ? t.ivaRate : 0;
      if (t.type === "E") e += amt;
      else if (t.type === "U") u += amt;
      if (rate > 0 && !isNoIvaCat(t.catId)) iva += amt * rate / 100;
    }
    return { e, u, iva, count: filtered.length };
  }, [filtered]);

  // Catalogo categorie disponibili: usa cats della company se valorizzate,
  // altrimenti fallback ai default.
  const cats = co?.cats?.length ? co.cats : ALL_DEFAULT_CATS;
  const catsByType = useMemo(() => ({
    E: cats.filter(c => c.type === "E"),
    U: cats.filter(c => c.type === "U"),
  }), [cats]);

  const persistMutation = (mutate: (co: FinplanCompanySnapshot) => FinplanCompanySnapshot) => {
    scheduleSave(prev => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = base.data ?? [];
      return {
        ...base,
        data: data.map((c, i) => i === companyIndex ? mutate(c) : c),
      };
    });
  };

  const handleSave = (form: FormState) => {
    const amount = parseFloat(form.amount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return;
    persistMutation(c => {
      const txs = (c.transactions ?? []).slice();
      // Riclassificazione automatica categoria (Task #144 review).
      // Riusa la stessa logica di mapping del flusso di import: se la
      // descrizione contiene keyword di giroconto/infragruppo/estero/
      // personale/fornitori, sovrascrive il catId di default. Se l'utente
      // ha già selezionato manualmente una categoria diversa dal default
      // del tipo (catId !== "e1"/"u2"), rispetta la scelta dell'utente.
      const isDefaultCat = (form.type === "E" && form.catId === "e1")
        || (form.type === "U" && form.catId === "u2");
      const finalCatId = isDefaultCat
        ? classifyDesc(form.desc, form.type, "e1", "u2").catId
        : form.catId;
      const noIva = isNoIvaCat(finalCatId);
      const next: FinplanTransaction = {
        id: form.id ?? 0,
        month: form.month,
        type: form.type,
        amount: +amount.toFixed(2),
        catId: finalCatId,
        ivaRate: noIva ? 0 : form.ivaRate,
        desc: form.desc,
      };
      let updated: FinplanTransaction[];
      let txIdSeq = typeof c.txIdSeq === "number" ? c.txIdSeq : 1;
      if (form.id !== null) {
        updated = txs.map(t => (typeof t.id === "number" && t.id === form.id) ? next : t);
      } else {
        const newId = Math.max(txIdSeq, ...txs.map(t => typeof t.id === "number" ? t.id : 0)) + 1;
        next.id = newId;
        updated = [...txs, next];
        txIdSeq = newId + 1;
      }
      const newCo: FinplanCompanySnapshot = { ...c, transactions: updated, txIdSeq };
      newCo.m = rebuildMonthly(newCo);
      return newCo;
    });
    setEditing(null);
  };

  const handleDelete = (id: number) => {
    persistMutation(c => {
      const updated = (c.transactions ?? []).filter(t => !(typeof t.id === "number" && t.id === id));
      const newCo: FinplanCompanySnapshot = { ...c, transactions: updated };
      newCo.m = rebuildMonthly(newCo);
      return newCo;
    });
    setDeleteId(null);
  };

  const handleImport = (built: { id: number; month: number; type: "E" | "U"; amount: number; catId: string; ivaRate: number; desc: string }[]) => {
    // CRITICO: re-assegniamo gli ID *dentro* l'updater, partendo dallo
    // stato `c` corrente. Gli ID calcolati dal dialog sono basati sullo
    // snapshot UI, che durante un PUT debounced può essere stale: due
    // import ravvicinati prima del flush riprenderebbero dallo stesso
    // `nextTxId` causando collisioni (handleSave/handleDelete usano
    // confronto per id e colpirebbero più righe). Reseeding qui rende
    // l'append idempotente rispetto allo stato realmente persistito.
    persistMutation(c => {
      const txs = (c.transactions ?? []).slice();
      const existingIds = new Set<number>();
      let maxExisting = (typeof c.txIdSeq === "number" ? c.txIdSeq : 1) - 1;
      for (const t of txs) {
        if (typeof t.id === "number") {
          existingIds.add(t.id);
          if (t.id > maxExisting) maxExisting = t.id;
        }
      }
      let nextId = maxExisting + 1;
      const stripped = built.map(b => {
        const id = nextId++;
        return {
          id, month: b.month, type: b.type, amount: b.amount,
          catId: b.catId, ivaRate: b.ivaRate, desc: b.desc,
        };
      });
      // Sanity check: gli id appena assegnati non devono mai entrare in
      // collisione (existingIds = pre-import). Se accadesse sarebbe un
      // bug, fallback: rigenera scorrendo finché libero.
      const finalTxs = stripped.map(s => {
        if (!existingIds.has(s.id)) return s;
        let candidate = nextId++;
        while (existingIds.has(candidate)) candidate = nextId++;
        return { ...s, id: candidate };
      });
      const updated = [...txs, ...finalTxs];
      const newCo: FinplanCompanySnapshot = {
        ...c,
        transactions: updated,
        txIdSeq: nextId,
      };
      newCo.m = rebuildMonthly(newCo);
      return newCo;
    });
  };

  const startNew = () => setEditing({ ...EMPTY_FORM });
  const startEdit = (tx: FinplanTransaction) => {
    if (typeof tx.id !== "number") return;
    setEditing({
      id: tx.id,
      month: typeof tx.month === "number" ? tx.month : 0,
      type: tx.type ?? "U",
      amount: typeof tx.amount === "number" ? tx.amount.toString() : "",
      catId: tx.catId ?? "u2",
      ivaRate: typeof tx.ivaRate === "number" ? tx.ivaRate : 0,
      desc: tx.desc ?? "",
    });
  };

  return (
    <div className="space-y-4" data-testid="finplan-transazioni">
      {/* Filtri */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Mese</Label>
              <Select value={filterMonth} onValueChange={(v) => { setFilterMonth(v); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-month"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  {MO.map((mo, i) => <SelectItem key={i} value={String(i)}>{mo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="E">Entrate</SelectItem>
                  <SelectItem value="U">Uscite</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={filterCat} onValueChange={(v) => { setFilterCat(v); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-cat"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutte</SelectItem>
                  {cats.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Cerca descrizione</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className="pl-8"
                  placeholder="es. fornitore, bonifico…"
                  data-testid="input-search-tx"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar + totali */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2">
          <Button onClick={startNew} size="sm" data-testid="button-add-tx">
            <Plus className="h-4 w-4 mr-1" /> Nuova transazione
          </Button>
          <Button onClick={() => setImportOpen(true)} size="sm" variant="outline" data-testid="button-import-cc">
            <Upload className="h-4 w-4 mr-1" /> Importa estratto CC
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" data-testid="badge-tx-count">{totals.count} righe</Badge>
          <Badge variant="default" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" data-testid="badge-tx-e">
            E {formatCurrency(totals.e)}
          </Badge>
          <Badge variant="default" className="bg-rose-500/15 text-rose-700 dark:text-rose-300" data-testid="badge-tx-u">
            U {formatCurrency(totals.u)}
          </Badge>
          <Badge variant="secondary" data-testid="badge-tx-iva">IVA {formatCurrency(totals.iva)}</Badge>
        </div>
      </div>

      {/* Tabella */}
      <Card>
        <CardContent className="p-0">
          <div
            ref={scrollRef}
            className="overflow-auto"
            style={virtualized ? { maxHeight: VIRTUAL_VIEWPORT_H } : undefined}
            data-testid={virtualized ? "scroll-tx-virtualized" : "scroll-tx-paginated"}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Mese</TableHead>
                  <TableHead className="w-[60px]">Tipo</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead className="text-right">Netto</TableHead>
                  <TableHead className="w-[60px] text-right">IVA%</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Lordo</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      Nessuna transazione corrisponde ai filtri.
                    </TableCell>
                  </TableRow>
                ) : (<>
                  {padTop > 0 && (
                    <TableRow style={{ height: padTop }} aria-hidden>
                      <TableCell colSpan={9} className="p-0 border-0" />
                    </TableRow>
                  )}
                  {visibleRows.map((tx) => {
                  const idNum = typeof tx.id === "number" ? tx.id : -1;
                  const amt = typeof tx.amount === "number" ? tx.amount : 0;
                  const rate = typeof tx.ivaRate === "number" ? tx.ivaRate : 0;
                  const noIva = isNoIvaCat(tx.catId);
                  const eff = noIva ? 0 : rate;
                  const sc = scorporaIva(amt, eff);
                  return (
                    <TableRow key={idNum} style={virtualized ? { height: VIRTUAL_ROW_HEIGHT } : undefined} data-testid={`row-tx-${idNum}`}>
                      <TableCell className="text-xs">{MO[tx.month ?? 0]}</TableCell>
                      <TableCell>
                        <Badge variant={tx.type === "E" ? "default" : "secondary"} className="text-[10px]">
                          {tx.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: getCatColor(tx.catId, co) }} />
                          {getCatName(tx.catId, co)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs" title={tx.desc}>{tx.desc || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatCurrency(sc.netto)}</TableCell>
                      <TableCell className="text-right text-xs">{noIva ? "—" : `${eff}%`}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {noIva ? "—" : formatCurrency(sc.iva)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium">
                        {noIva ? formatCurrency(sc.netto) : formatCurrency(sc.lordo)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(tx)} data-testid={`button-edit-tx-${idNum}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => idNum >= 0 && setDeleteId(idNum)} data-testid={`button-delete-tx-${idNum}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                  {padBottom > 0 && (
                    <TableRow style={{ height: padBottom }} aria-hidden>
                      <TableCell colSpan={9} className="p-0 border-0" />
                    </TableRow>
                  )}
                </>)}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between p-3 border-t text-xs text-muted-foreground">
            <span data-testid="text-tx-pagination">
              {filtered.length === 0 ? "Nessuna riga"
                : virtualized
                  ? `${filtered.length} righe (vista virtualizzata)`
                  : `Righe ${safePage * PAGE_SIZE + 1}–${Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} di ${filtered.length}`}
            </span>
            {!virtualized && (
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={safePage <= 0} onClick={() => setPage(p => Math.max(0, p - 1))} data-testid="button-tx-prev">
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span data-testid="text-tx-page">{safePage + 1} / {totalPages}</span>
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={safePage >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} data-testid="button-tx-next">
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Modal CRUD */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent data-testid="dialog-edit-tx">
          <DialogHeader>
            <DialogTitle>{editing?.id !== null ? "Modifica transazione" : "Nuova transazione"}</DialogTitle>
            <DialogDescription>I totali mensili e l'IVA si aggiornano automaticamente.</DialogDescription>
          </DialogHeader>
          {editing && (
            <TxForm
              form={editing}
              onChange={setEditing}
              catsE={catsByType.E}
              catsU={catsByType.U}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} data-testid="button-cancel-tx">Annulla</Button>
            <Button onClick={() => editing && handleSave(editing)} data-testid="button-save-tx">Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conferma delete */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent data-testid="alert-delete-tx">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare la transazione?</AlertDialogTitle>
            <AlertDialogDescription>L'operazione non può essere annullata. I totali mensili saranno ricalcolati.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId !== null && handleDelete(deleteId)} data-testid="button-confirm-delete-tx">
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import CC dialog */}
      <BankImportFlow
        open={importOpen}
        onOpenChange={setImportOpen}
        rsName={String(co?.name ?? `Società ${companyIndex + 1}`)}
        rsIndex={companyIndex}
        nextTxId={nextTxIdFromCompany(co)}
        onConfirm={(built) => handleImport(built)}
      />
    </div>
  );
}

function TxForm({ form, onChange, catsE, catsU }: {
  form: FormState;
  onChange: (next: FormState) => void;
  catsE: { id: string; name?: string }[];
  catsU: { id: string; name?: string }[];
}) {
  const cats = form.type === "E" ? catsE : catsU;
  const noIva = isNoIvaCat(form.catId);
  const amount = parseFloat(form.amount.replace(",", "."));
  const sc = Number.isFinite(amount) && amount > 0 ? scorporaIva(amount, noIva ? 0 : form.ivaRate) : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Mese</Label>
          <Select value={String(form.month)} onValueChange={(v) => onChange({ ...form, month: parseInt(v, 10) })}>
            <SelectTrigger data-testid="form-tx-month"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MO.map((mo, i) => <SelectItem key={i} value={String(i)}>{mo}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={form.type} onValueChange={(v) => {
            const type = v as "E" | "U";
            onChange({ ...form, type, catId: type === "E" ? (DEFAULT_CATS_E[0].id) : (DEFAULT_CATS_U[1].id) });
          }}>
            <SelectTrigger data-testid="form-tx-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="E">Entrata</SelectItem>
              <SelectItem value="U">Uscita</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Importo (netto)</Label>
          <Input
            value={form.amount}
            onChange={(e) => onChange({ ...form, amount: e.target.value })}
            placeholder="0,00"
            inputMode="decimal"
            data-testid="form-tx-amount"
          />
        </div>
        <div className="space-y-1">
          <Label>Aliquota IVA</Label>
          <Select
            value={String(form.ivaRate)}
            onValueChange={(v) => onChange({ ...form, ivaRate: parseInt(v, 10) })}
            disabled={noIva}
          >
            <SelectTrigger data-testid="form-tx-iva"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IVA_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label>Categoria</Label>
        <Select value={form.catId} onValueChange={(v) => onChange({ ...form, catId: v })}>
          <SelectTrigger data-testid="form-tx-cat"><SelectValue /></SelectTrigger>
          <SelectContent>
            {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Descrizione</Label>
        <Input
          value={form.desc}
          onChange={(e) => onChange({ ...form, desc: e.target.value })}
          placeholder="opzionale"
          data-testid="form-tx-desc"
        />
      </div>
      {sc && (
        <div className="rounded-md border bg-muted/30 p-2 text-xs grid grid-cols-3 gap-2 text-center" data-testid="form-tx-preview">
          <div><div className="text-muted-foreground">Netto</div><div className="font-mono font-medium">{formatCurrency(sc.netto)}</div></div>
          <div><div className="text-muted-foreground">IVA</div><div className="font-mono">{noIva ? "—" : formatCurrency(sc.iva)}</div></div>
          <div><div className="text-muted-foreground">Lordo</div><div className="font-mono font-medium">{noIva ? formatCurrency(sc.netto) : formatCurrency(sc.lordo)}</div></div>
        </div>
      )}
    </div>
  );
}
