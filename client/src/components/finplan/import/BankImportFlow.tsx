// Flusso di import estratto CC riusabile (Task #144).
//
// Tre modalità UX, allineate a quelle del setup wizard:
//   - "append"          : una RS, un singolo file → APPEND alle tx esistenti.
//                         (usato dalla sezione Transazioni.)
//   - "multi-files"     : N RS, N file (uno per RS), stessa mappatura
//                         applicata a tutti. (parità wizard upload "multi".)
//   - "single-rs-col"   : N RS, un singolo file con colonna RS che identifica
//                         la società per riga. (parità wizard upload
//                         "single-rs-col".)
//
// Le ultime due modalità invocano `onConfirmMulti(byRs, files)` con un array
// per ciascuna RS. La modalità "append" mantiene la signature originale
// (`onConfirm(txs, file)`) per non rompere i caller esistenti.
//
// Tutta la logica di parsing/mapping/build è importata da
// `client/src/lib/finplanImport.ts` (funzioni pure testabili).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Upload, Check, ChevronRight, ChevronLeft, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/utils/format";
import {
  EMPTY_MAPPING, autoDetectMapping, isMappingValid,
  parseFile, rowsToTransactions,
  type ParsedFile, type ParsedRow, type BuiltTransaction, type ColumnMapping,
} from "@/lib/finplanImport";
import { MappingFields } from "./MappingFields";

export type BankImportMode = "append" | "multi-files" | "single-rs-col";

interface BankImportFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: BankImportMode;
  /**
   * Se true, NON renderizza il <Dialog> wrapper: il contenuto (steps,
   * upload/mapping/preview, footer) viene reso inline e il chiamante è
   * responsabile della cornice. Usato dal `FinPlanSetupWizard` per
   * embeddare il flusso senza dialog. In modalità inline `open` viene
   * trattato come sempre vero e `onOpenChange(false)` viene invocato
   * dopo la conferma per segnalare al parent che lo step è completato.
   */
  inline?: boolean;

  // ----- append mode -----
  rsName?: string;
  rsIndex?: number;
  /** Prossimo id di transazione disponibile per la RS (txIdSeq della company). */
  nextTxId?: number;
  /** Append singolo: callback con le tx costruite per la RS attiva. */
  onConfirm?: (transactions: BuiltTransaction[], sourceFileName: string) => void;

  // ----- multi-files / single-rs-col modes -----
  /** Nomi delle RS (uno per slot). Richiesto in modalità multi-*. */
  rsNames?: string[];
  /** Alias di riconoscimento RS (per single-rs-col); fallback al nome RS. */
  rsAliases?: string[][];
  /** Prossimo id globale per il batch multi (di solito max(txIdSeq) + 1). */
  nextTxIdSeq?: number;
  /** Multi-RS: callback con array per RS + nomi dei file di origine. */
  onConfirmMulti?: (
    byRs: BuiltTransaction[][],
    sourceFileNames: string[],
  ) => void;
}

type StepKey = "upload" | "mapping" | "preview";
const STEPS: StepKey[] = ["upload", "mapping", "preview"];

function normalizeRsName(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function matchRsIndex(value: unknown, rsNames: string[], rsAliases?: string[][]): number {
  const v = normalizeRsName(value);
  if (!v) return -1;
  for (let i = 0; i < rsNames.length; i++) {
    const name = normalizeRsName(rsNames[i]);
    if (name && (v === name || v.includes(name) || name.includes(v))) return i;
    const aliases = rsAliases?.[i] ?? [];
    for (const a of aliases) {
      const na = normalizeRsName(a);
      if (na && (v === na || v.includes(na) || na.includes(v))) return i;
    }
  }
  return -1;
}

export function BankImportFlow(props: BankImportFlowProps) {
  const mode: BankImportMode = props.mode ?? "append";
  const isMulti = mode !== "append";
  const rsNames = props.rsNames ?? [];

  const { toast } = useToast();
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  // Stato condiviso ai 3 modi.
  const [parsedSingle, setParsedSingle] = useState<ParsedFile | null>(null);
  const [parsedSlots, setParsedSlots] = useState<(ParsedFile | null)[]>(
    () => rsNames.map(() => null),
  );
  const [parsing, setParsing] = useState<number | "single" | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [defaultCatE, setDefaultCatE] = useState<string>("e1");
  const [defaultCatU, setDefaultCatU] = useState<string>("u2");
  const [ivaMode, setIvaMode] = useState<"netti" | "lordi">("netti");
  const [autoClassifyOn, setAutoClassifyOn] = useState(true);

  // Robustness (review #144 round 3): se `rsNames` cambia di lunghezza
  // mentre il flow è montato (es. il wizard aggiorna i nomi tra render),
  // riallineiamo `parsedSlots` per evitare slot orfani o accessi fuori
  // bounds. Conserviamo i parsed esistenti per le prime N posizioni
  // comuni (no perdita lavoro), troncando o estendendo con `null`.
  useEffect(() => {
    setParsedSlots(prev => {
      if (prev.length === rsNames.length) return prev;
      const next: (ParsedFile | null)[] = rsNames.map((_, i) => prev[i] ?? null);
      return next;
    });
  }, [rsNames.length]);

  // File di riferimento per la mappatura: in "multi-files" prendiamo il
  // primo slot caricato, negli altri due modi è il singolo file caricato.
  const referenceParsed = useMemo<ParsedFile | null>(() => {
    if (mode === "multi-files") return parsedSlots.find(p => p) ?? null;
    return parsedSingle;
  }, [mode, parsedSingle, parsedSlots]);

  const reset = useCallback(() => {
    setStepIdx(0);
    setParsedSingle(null);
    setParsedSlots(rsNames.map(() => null));
    setParsing(null);
    setMapping(EMPTY_MAPPING);
    setDefaultCatE("e1");
    setDefaultCatU("u2");
    setIvaMode("netti");
    setAutoClassifyOn(true);
  }, [rsNames]);

  const handleClose = useCallback((next: boolean) => {
    if (!next) reset();
    props.onOpenChange(next);
  }, [props, reset]);

  const onSingleFile = useCallback(async (file: File) => {
    setParsing("single");
    try {
      const p = await parseFile(file);
      setParsedSingle(p);
      setMapping(autoDetectMapping(p.headers, mode === "single-rs-col"));
      toast({ title: "File caricato", description: `${p.rows.length} righe da "${p.fileName}"` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore nel parsing";
      toast({ title: "Errore lettura file", description: msg, variant: "destructive" });
    } finally {
      setParsing(null);
    }
  }, [toast, mode]);

  const onSlotFile = useCallback(async (slotIdx: number, file: File) => {
    setParsing(slotIdx);
    try {
      const p = await parseFile(file);
      setParsedSlots(prev => {
        const next = prev.slice();
        next[slotIdx] = p;
        return next;
      });
      // Se è il primo file, auto-detecta mappatura sulle sue intestazioni.
      setMapping(prev => {
        const isFirst = parsedSlots.every(s => !s);
        if (isFirst) return autoDetectMapping(p.headers, false);
        return prev;
      });
      toast({ title: "File caricato", description: `${p.rows.length} righe per ${rsNames[slotIdx] ?? `Società ${slotIdx + 1}`}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore nel parsing";
      toast({ title: "Errore lettura file", description: msg, variant: "destructive" });
    } finally {
      setParsing(null);
    }
  }, [toast, parsedSlots, rsNames]);

  const removeSlot = useCallback((slotIdx: number) => {
    setParsedSlots(prev => {
      const next = prev.slice();
      next[slotIdx] = null;
      return next;
    });
  }, []);

  // Costruzione transazioni per modalità.
  const builtAppend = useMemo<BuiltTransaction[]>(() => {
    if (mode !== "append" || !parsedSingle) return [];
    if (!isMappingValid(mapping, false)) return [];
    const indices = parsedSingle.rows.map((_, i) => i);
    return rowsToTransactions(
      parsedSingle.rows, indices, props.rsIndex ?? 0,
      mapping, defaultCatE, defaultCatU, ivaMode, props.nextTxId ?? 1,
      autoClassifyOn, {},
    );
  }, [mode, parsedSingle, mapping, defaultCatE, defaultCatU, ivaMode, autoClassifyOn, props.rsIndex, props.nextTxId]);

  const builtMulti = useMemo<BuiltTransaction[][]>(() => {
    if (mode === "append") return [];
    const requireRs = mode === "single-rs-col";
    if (!isMappingValid(mapping, requireRs)) return [];
    const out: BuiltTransaction[][] = rsNames.map(() => []);
    let nextId = props.nextTxIdSeq ?? 1;

    if (mode === "multi-files") {
      for (let i = 0; i < parsedSlots.length; i++) {
        const slot = parsedSlots[i];
        if (!slot) continue;
        const indices = slot.rows.map((_, ri) => ri);
        const txs = rowsToTransactions(
          slot.rows, indices, i,
          mapping, defaultCatE, defaultCatU, ivaMode, nextId,
          autoClassifyOn, {},
        );
        out[i] = txs;
        if (txs.length > 0) nextId = txs[txs.length - 1].id + 1;
      }
    } else if (mode === "single-rs-col" && parsedSingle && mapping.rs >= 0) {
      const groups: { rows: ParsedRow[]; indices: number[] }[] =
        rsNames.map(() => ({ rows: [], indices: [] }));
      for (let ri = 0; ri < parsedSingle.rows.length; ri++) {
        const row = parsedSingle.rows[ri];
        const idx = matchRsIndex(row[mapping.rs], rsNames, props.rsAliases);
        if (idx >= 0 && idx < rsNames.length) {
          groups[idx].rows.push(row);
          groups[idx].indices.push(ri);
        }
      }
      for (let i = 0; i < rsNames.length; i++) {
        if (groups[i].rows.length === 0) continue;
        const txs = rowsToTransactions(
          groups[i].rows, groups[i].indices, i,
          mapping, defaultCatE, defaultCatU, ivaMode, nextId,
          autoClassifyOn, {},
        );
        out[i] = txs;
        if (txs.length > 0) nextId = txs[txs.length - 1].id + 1;
      }
    }
    return out;
  }, [mode, parsedSingle, parsedSlots, rsNames, mapping, defaultCatE, defaultCatU, ivaMode, autoClassifyOn, props.nextTxIdSeq, props.rsAliases]);

  const totalsAppend = useMemo(() => sumTotals(builtAppend), [builtAppend]);
  const totalsMulti = useMemo(() => {
    let e = 0, u = 0, count = 0;
    const perRs = builtMulti.map(arr => {
      const t = sumTotals(arr);
      e += t.e; u += t.u; count += t.count;
      return t;
    });
    return { e: +e.toFixed(2), u: +u.toFixed(2), count, perRs };
  }, [builtMulti]);

  const totalCount = isMulti ? totalsMulti.count : totalsAppend.count;
  const requireRs = mode === "single-rs-col";
  const mappingOk = isMappingValid(mapping, requireRs);

  const canNext = (() => {
    if (step === "upload") {
      if (mode === "multi-files") return parsedSlots.some(s => !!s);
      return !!parsedSingle;
    }
    if (step === "mapping") return mappingOk && totalCount > 0;
    return false;
  })();

  const onSubmit = useCallback(() => {
    if (totalCount === 0) return;
    if (mode === "append") {
      props.onConfirm?.(builtAppend, parsedSingle?.fileName ?? "");
      toast({
        title: "Import completato",
        description: `${builtAppend.length} transazioni aggiunte a ${props.rsName ?? ""}`,
      });
    } else {
      const fileNames = mode === "multi-files"
        ? parsedSlots.map(s => s?.fileName ?? "")
        : [parsedSingle?.fileName ?? ""];
      props.onConfirmMulti?.(builtMulti, fileNames);
      toast({
        title: "Import completato",
        description: `${totalCount} transazioni aggiunte su ${builtMulti.filter(a => a.length > 0).length} RS`,
      });
    }
    handleClose(false);
  }, [mode, props, builtAppend, builtMulti, totalCount, parsedSingle, parsedSlots, toast, handleClose]);

  const titleLabel = mode === "append"
    ? `Importa estratto CC — ${props.rsName ?? ""}`
    : mode === "multi-files"
      ? "Importa estratti CC (un file per RS)"
      : "Importa estratto CC (singolo file con colonna RS)";

  const body = (
    <>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="bank-import-steps">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`px-2 py-1 rounded ${i === stepIdx ? "bg-primary/10 text-foreground font-medium" : ""}`}
              >
                {i + 1}. {s === "upload" ? "Carica" : s === "mapping" ? "Mappa colonne" : "Anteprima"}
              </div>
            ))}
          </div>

          {step === "upload" && mode !== "multi-files" && (
            <SingleDropzone
              parsing={parsing === "single"}
              parsed={parsedSingle}
              onFile={onSingleFile}
              testIdSuffix="bi"
            />
          )}

          {step === "upload" && mode === "multi-files" && (
            <div className="space-y-2" data-testid="bi-multi-slots">
              {rsNames.map((name, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="text-sm font-medium w-40 truncate">{name || `Società ${i + 1}`}</div>
                  <label
                    htmlFor={`bi-slot-${i}`}
                    className="flex-1 flex items-center justify-center gap-2 rounded border-2 border-dashed border-muted-foreground/30 p-3 cursor-pointer hover-elevate text-xs"
                    data-testid={`bi-slot-${i}`}
                  >
                    {parsing === i ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <Upload className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>
                      {parsing === i ? "Lettura…" :
                        parsedSlots[i] ? `${parsedSlots[i]!.fileName} · ${parsedSlots[i]!.rows.length} righe` :
                        "Scegli file (.xlsx, .xls, .csv)"}
                    </span>
                    <Input
                      id={`bi-slot-${i}`}
                      type="file"
                      accept=".xlsx,.xls,.xlsm,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onSlotFile(i, f);
                        e.target.value = "";
                      }}
                      data-testid={`input-bi-slot-${i}`}
                    />
                  </label>
                  {parsedSlots[i] && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeSlot(i)}
                      data-testid={`button-bi-slot-clear-${i}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {step === "mapping" && referenceParsed && (
            <div className="space-y-3">
              <MappingFields
                headers={referenceParsed.headers}
                mapping={mapping}
                onMappingChange={setMapping}
                defaultCatE={defaultCatE}
                onDefaultCatEChange={setDefaultCatE}
                defaultCatU={defaultCatU}
                onDefaultCatUChange={setDefaultCatU}
                ivaMode={ivaMode}
                onIvaModeChange={setIvaMode}
                autoClassify={{ enabled: autoClassifyOn, onToggle: setAutoClassifyOn }}
                showRsColumn={mode === "single-rs-col"}
                invalid={!mappingOk}
                invalidMessage={
                  mode === "single-rs-col"
                    ? "Mappa Entrate e Uscite (oppure Importo con segno) e indica la colonna Ragione Sociale."
                    : undefined
                }
                testIdPrefix="bi-map"
              />
              {mappingOk && !isMulti && (
                <div className="grid grid-cols-3 gap-2 pt-2 text-sm" data-testid="bi-totals">
                  <Stat label="Righe" value={String(totalsAppend.count)} testId="bi-stat-count" />
                  <Stat label="Entrate" value={formatCurrency(totalsAppend.e)} testId="bi-stat-e" />
                  <Stat label="Uscite" value={formatCurrency(totalsAppend.u)} testId="bi-stat-u" />
                </div>
              )}
              {mappingOk && isMulti && (
                <div className="space-y-2" data-testid="bi-multi-totals">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <Stat label="Righe totali" value={String(totalsMulti.count)} testId="bi-multi-count" />
                    <Stat label="Entrate" value={formatCurrency(totalsMulti.e)} testId="bi-multi-e" />
                    <Stat label="Uscite" value={formatCurrency(totalsMulti.u)} testId="bi-multi-u" />
                  </div>
                  <div className="rounded-md border p-2 text-xs space-y-1" data-testid="bi-per-rs">
                    {rsNames.map((n, i) => {
                      const t = totalsMulti.perRs[i];
                      return (
                        <div key={i} className="flex justify-between gap-3" data-testid={`bi-per-rs-${i}`}>
                          <span className="truncate">{n || `Società ${i + 1}`}</span>
                          <span className="text-muted-foreground shrink-0">
                            {t && t.count > 0 ? `${t.count} righe · E ${formatCurrency(t.e)} · U ${formatCurrency(t.u)}` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3" data-testid="bi-preview">
              <p className="text-sm text-muted-foreground">
                {isMulti
                  ? <>Conferma per aggiungere <b>{totalCount}</b> transazioni distribuite su <b>{builtMulti.filter(a => a.length > 0).length}</b> RS.</>
                  : <>Conferma per aggiungere <b>{totalsAppend.count}</b> transazioni a <b>{props.rsName}</b>.</>}
                {" "}I totali mensili verranno aggiornati automaticamente.
              </p>
              <PreviewTable rows={isMulti ? builtMulti.flat() : builtAppend} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <Button
            variant="ghost"
            onClick={() => setStepIdx(i => Math.max(0, i - 1))}
            disabled={stepIdx === 0}
            data-testid="button-bi-back"
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Indietro
          </Button>
          {step !== "preview" ? (
            <Button
              onClick={() => setStepIdx(i => Math.min(STEPS.length - 1, i + 1))}
              disabled={!canNext}
              data-testid="button-bi-next"
            >
              Avanti <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={onSubmit} disabled={totalCount === 0} data-testid="button-bi-confirm">
              <Check className="h-4 w-4 mr-1" /> Aggiungi {totalCount} transazioni
            </Button>
          )}
        </div>
    </>
  );

  if (props.inline) {
    return (
      <div className="space-y-3" data-testid="bank-import-inline">
        <div>
          <div className="text-sm font-medium">{titleLabel}</div>
          <div className="text-xs text-muted-foreground">
            Carica file Excel/CSV e mappa le colonne. Le righe verranno aggiunte alle transazioni.
          </div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-bank-import">
        <DialogHeader>
          <DialogTitle>{titleLabel}</DialogTitle>
          <DialogDescription>
            Carica un file Excel/CSV e mappa le colonne. Le righe verranno aggiunte
            alle transazioni esistenti.
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function sumTotals(rows: BuiltTransaction[]): { e: number; u: number; count: number } {
  let e = 0, u = 0;
  for (const t of rows) {
    if (t.type === "E") e += t.amount;
    else u += t.amount;
  }
  return { e: +e.toFixed(2), u: +u.toFixed(2), count: rows.length };
}

function SingleDropzone({ parsing, parsed, onFile, testIdSuffix }: {
  parsing: boolean;
  parsed: ParsedFile | null;
  onFile: (f: File) => void;
  testIdSuffix: string;
}) {
  return (
    <label
      htmlFor={`${testIdSuffix}-file`}
      className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 p-8 cursor-pointer hover-elevate"
      data-testid={`dropzone-${testIdSuffix}`}
    >
      {parsing ? (
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      ) : (
        <Upload className="h-8 w-8 text-muted-foreground" />
      )}
      <div className="text-sm font-medium">
        {parsing ? "Lettura in corso…" :
          parsed ? `File caricato: ${parsed.fileName}` :
          "Clicca per scegliere un file (.xlsx, .xls, .csv)"}
      </div>
      {parsed && (
        <div className="text-xs text-muted-foreground">
          {parsed.headers.length} colonne · {parsed.rows.length} righe
        </div>
      )}
      <Input
        id={`${testIdSuffix}-file`}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
        data-testid={`input-${testIdSuffix}-file`}
      />
    </label>
  );
}

function PreviewTable({ rows }: { rows: BuiltTransaction[] }) {
  const totals = sumTotals(rows);
  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat label="Righe" value={String(totals.count)} testId="bi-confirm-count" />
        <Stat label="Entrate" value={formatCurrency(totals.e)} testId="bi-confirm-e" />
        <Stat label="Uscite" value={formatCurrency(totals.u)} testId="bi-confirm-u" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-left">
            <tr>
              <th className="px-2 py-1.5">Tipo</th>
              <th className="px-2 py-1.5">Mese</th>
              <th className="px-2 py-1.5">Importo</th>
              <th className="px-2 py-1.5">Categoria</th>
              <th className="px-2 py-1.5">Descrizione</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((tx) => (
              <tr key={tx.id} className="border-t">
                <td className="px-2 py-1">
                  <Badge variant={tx.type === "E" ? "default" : "secondary"} className="text-[10px]">
                    {tx.type}
                  </Badge>
                </td>
                <td className="px-2 py-1">{tx.month + 1}</td>
                <td className="px-2 py-1 font-mono">{formatCurrency(tx.amount)}</td>
                <td className="px-2 py-1">{tx.catId}</td>
                <td className="px-2 py-1 max-w-[240px] truncate" title={tx.desc}>{tx.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 100 && (
          <div className="text-xs text-muted-foreground px-2 py-1 border-t">
            Anteprima limitata alle prime 100 di {rows.length} righe.
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold text-sm" data-testid={testId}>{value}</div>
    </div>
  );
}
