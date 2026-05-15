// Flusso di import estratto CC riusabile, usato dalla sezione
// Transazioni della shell React (Task #144). UX semplificata rispetto al
// wizard di setup iniziale (`FinPlanSetupWizard`): qui c'è UNA sola RS
// di destinazione (quella attiva), nessuno step "rs", nessun multi-file
// — un singolo file estratto CC viene parsato, mappato e APPESO alle
// transazioni esistenti della RS. I totali mensili `m[]` vengono poi
// ricostruiti dal chiamante via `rebuildMonthly`.

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Upload, Check, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/utils/format";
import {
  EMPTY_MAPPING, autoDetectMapping, isMappingValid,
  parseFile, rowsToTransactions,
  type ParsedFile, type BuiltTransaction,
} from "@/lib/finplanImport";
import { MappingFields } from "./MappingFields";

interface BankImportFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rsName: string;
  rsIndex: number;
  /** Prossimo id di transazione disponibile per la RS (txIdSeq della company). */
  nextTxId: number;
  /** Callback: riceve le transazioni costruite (id già assegnati) da appendere. */
  onConfirm: (transactions: BuiltTransaction[], sourceFileName: string) => void;
}

type StepKey = "upload" | "mapping" | "preview";
const STEPS: StepKey[] = ["upload", "mapping", "preview"];

export function BankImportFlow({ open, onOpenChange, rsName, rsIndex, nextTxId, onConfirm }: BankImportFlowProps) {
  const { toast } = useToast();
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [parsing, setParsing] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [defaultCatE, setDefaultCatE] = useState<string>("e1");
  const [defaultCatU, setDefaultCatU] = useState<string>("u2");
  const [ivaMode, setIvaMode] = useState<"netti" | "lordi">("netti");
  const [autoClassifyOn, setAutoClassifyOn] = useState(true);

  const reset = useCallback(() => {
    setStepIdx(0);
    setParsed(null);
    setParsing(false);
    setMapping(EMPTY_MAPPING);
    setDefaultCatE("e1");
    setDefaultCatU("u2");
    setIvaMode("netti");
    setAutoClassifyOn(true);
  }, []);

  const handleClose = useCallback((next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  }, [onOpenChange, reset]);

  const onFile = useCallback(async (file: File) => {
    setParsing(true);
    try {
      const p = await parseFile(file);
      setParsed(p);
      setMapping(autoDetectMapping(p.headers, false));
      toast({ title: "File caricato", description: `${p.rows.length} righe da "${p.fileName}"` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore nel parsing";
      toast({ title: "Errore lettura file", description: msg, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }, [toast]);

  const built = useMemo<BuiltTransaction[]>(() => {
    if (!parsed) return [];
    if (!isMappingValid(mapping, false)) return [];
    const indices = parsed.rows.map((_, i) => i);
    return rowsToTransactions(
      parsed.rows, indices, rsIndex,
      mapping, defaultCatE, defaultCatU, ivaMode, nextTxId,
      autoClassifyOn, {},
    );
  }, [parsed, mapping, defaultCatE, defaultCatU, ivaMode, autoClassifyOn, rsIndex, nextTxId]);

  const totals = useMemo(() => {
    let e = 0, u = 0;
    for (const t of built) {
      if (t.type === "E") e += t.amount;
      else u += t.amount;
    }
    return { e: +e.toFixed(2), u: +u.toFixed(2), count: built.length };
  }, [built]);

  const mappingOk = isMappingValid(mapping, false);
  const canNext = (() => {
    if (step === "upload") return !!parsed;
    if (step === "mapping") return mappingOk && totals.count > 0;
    return false;
  })();

  const onSubmit = useCallback(() => {
    if (!parsed || built.length === 0) return;
    onConfirm(built, parsed.fileName);
    toast({
      title: "Import completato",
      description: `${built.length} transazioni aggiunte a ${rsName}`,
    });
    handleClose(false);
  }, [parsed, built, onConfirm, toast, rsName, handleClose]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-bank-import">
        <DialogHeader>
          <DialogTitle>Importa estratto CC — {rsName}</DialogTitle>
          <DialogDescription>
            Carica un file Excel/CSV e mappa le colonne. Le righe verranno aggiunte
            alle transazioni esistenti.
          </DialogDescription>
        </DialogHeader>

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

          {step === "upload" && (
            <label
              htmlFor="bank-import-file"
              className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 p-8 cursor-pointer hover-elevate"
              data-testid="dropzone-bank-import"
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
                id="bank-import-file"
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
                data-testid="input-bank-import-file"
              />
            </label>
          )}

          {step === "mapping" && parsed && (
            <div className="space-y-3">
              <MappingFields
                headers={parsed.headers}
                mapping={mapping}
                onMappingChange={setMapping}
                defaultCatE={defaultCatE}
                onDefaultCatEChange={setDefaultCatE}
                defaultCatU={defaultCatU}
                onDefaultCatUChange={setDefaultCatU}
                ivaMode={ivaMode}
                onIvaModeChange={setIvaMode}
                autoClassify={{ enabled: autoClassifyOn, onToggle: setAutoClassifyOn }}
                invalid={!mappingOk}
                testIdPrefix="bi-map"
              />
              {mappingOk && (
                <div className="grid grid-cols-3 gap-2 pt-2 text-sm" data-testid="bi-totals">
                  <Stat label="Righe" value={String(totals.count)} testId="bi-stat-count" />
                  <Stat label="Entrate" value={formatCurrency(totals.e)} testId="bi-stat-e" />
                  <Stat label="Uscite" value={formatCurrency(totals.u)} testId="bi-stat-u" />
                </div>
              )}
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3" data-testid="bi-preview">
              <p className="text-sm text-muted-foreground">
                Conferma per aggiungere <b>{built.length}</b> transazioni a <b>{rsName}</b>.
                I totali mensili verranno aggiornati automaticamente.
              </p>
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
                    {built.slice(0, 100).map((tx) => (
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
                {built.length > 100 && (
                  <div className="text-xs text-muted-foreground px-2 py-1 border-t">
                    Anteprima limitata alle prime 100 di {built.length} righe.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2">
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
            <Button onClick={onSubmit} disabled={built.length === 0} data-testid="button-bi-confirm">
              <Check className="h-4 w-4 mr-1" /> Aggiungi {built.length} transazioni
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
