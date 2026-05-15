import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, FileSpreadsheet, Check, ChevronRight, ChevronLeft, SkipForward } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BASE_PATH } from "@/lib/basePath";
// Helper di import puri estratti in `client/src/lib/finplanImport.ts`
// durante Task #144 per essere condivisi con la sezione Transazioni
// della shell React (BankImportFlow).
import {
  MO,
  DEFAULT_CATS_E, DEFAULT_CATS_U,
  type BuiltTransaction,
} from "@/lib/finplanImport";
// Componente shared di import (Task #144 review): il wizard ne è ora
// SOLO un wrapper — niente più upload/mapping/preview duplicato qui.
// Tutto il flusso di parsing/mapping/conferma è dentro BankImportFlow,
// renderizzato in modalità `inline` (senza Dialog wrapper) all'interno
// dello step "import" del wizard.
import { BankImportFlow } from "@/components/finplan/import/BankImportFlow";

type StepKey = "intro" | "rs" | "import" | "save";
const STEPS: StepKey[] = ["intro", "rs", "import", "save"];

type ImportMode = "multi-files" | "single-rs-col";

// Costruisce lo snapshot finale popolando le RS con le rispettive transazioni.
function buildSnapshot(
  rsNames: string[],
  txByRs: BuiltTransaction[][],
  sourceFileNames: (string | null)[],
): unknown {
  const data = rsNames.map((name, i) => {
    const rawTxs = txByRs[i] ?? [];
    const txs = rawTxs.map(({ autoTag: _t, _rowIdx: _r, _rsIdx: _s, ...rest }) => rest);
    const m = MO.map(mo => ({ month: mo, e: 0, u: 0 }));
    let txIdSeq = 1;
    for (const tx of txs) {
      if (tx.type === "E") m[tx.month].e += tx.amount;
      else m[tx.month].u += tx.amount;
      if (tx.id >= txIdSeq) txIdSeq = tx.id + 1;
    }
    const srcName = sourceFileNames[i];
    const hasData = txs.length > 0;
    return {
      m,
      transactions: txs,
      cats: [...DEFAULT_CATS_E, ...DEFAULT_CATS_U],
      obj: [
        { id: 1, name: name || `Società ${i+1}`, tipo: "custom", target: 0, current: 0, color: "#00D4AA" },
      ],
      perdite: { attivo:false, importo:0, recuperato:0, costiFissi:0, mesePart:0, usaCashFlow:true, manuale: Array(12).fill(0) },
      debts: [],
      debtScadenze: [],
      ade: [],
      inv: [
        { id:1, name:"Liquidità",    amount:0, alloc:40 },
        { id:2, name:"Obbligazioni", amount:0, alloc:30 },
        { id:3, name:"Azionario",    amount:0, alloc:20 },
        { id:4, name:"Altro",        amount:0, alloc:10 },
      ],
      growth: 5,
      importedFile: hasData ? { name: srcName ?? "wizard-import", date: new Date().toISOString() } : null,
      importedFiles: hasData ? [{ name: srcName ?? "wizard-import", type: "finance", date: new Date().toISOString() }] : [],
      importedFileHR: null,
      ivaPeriod: "trimestrale",
      txIdSeq,
      budget: { e:0, u:0, catBudget:[], ripartizione:"uniforme" },
      personale: [],
      excludeInfragruppo: false,
      excludeGiroconto: false,
      excludeEstero: false,
      excludeFinanziamenti: false,
      excludeRateazioni: false,
      showLordo: false,
      partitari: { C:[], F:[] },
      partitariPdf: { corrente:null, precedente:null },
      cfExclude: { E:[], U:[], ctpVar:{} },
      storicoMesi: [],
      archivio: { files:[], snapshots:[] },
    };
  });
  return {
    version: 3,
    savedAt: new Date().toISOString(),
    data,
    consGrowth: 5,
    consIvaPeriod: "trimestrale",
    _setupWizard: { createdAt: new Date().toISOString(), populated: txByRs.map(t => t.length > 0) },
  };
}

interface FinPlanSetupWizardProps {
  orgId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function FinPlanSetupWizard({ orgId, onComplete, onSkip }: FinPlanSetupWizardProps) {
  const { toast } = useToast();
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  // Step "rs": nomi delle 5 ragioni sociali + scelta modalità import.
  const [rsNames, setRsNames] = useState<string[]>([
    "Società 1", "Società 2", "Società 3", "Società 4", "Società 5",
  ]);
  const [importMode, setImportMode] = useState<ImportMode>("multi-files");

  // Step "import": risultato di BankImportFlow (popolato su confirm).
  const [byRs, setByRs] = useState<BuiltTransaction[][]>(() => Array.from({ length: 5 }, () => []));
  const [sourceFileNames, setSourceFileNames] = useState<(string | null)[]>(() => Array(5).fill(null));
  const [importDone, setImportDone] = useState(false);

  // Step "save": stato submit.
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    let e = 0, u = 0, count = 0;
    const perRs = byRs.map(txs => {
      let pe = 0, pu = 0;
      for (const t of txs) {
        if (t.type === "E") { e += t.amount; pe += t.amount; }
        else { u += t.amount; pu += t.amount; }
        count++;
      }
      return { count: txs.length, e: pe, u: pu };
    });
    return { e, u, count, perRs };
  }, [byRs]);

  const populatedCount = useMemo(() => byRs.filter(t => t.length > 0).length, [byRs]);

  const onImportConfirmed = useCallback((built: BuiltTransaction[][], files: string[]) => {
    setByRs(built);
    // Allinea sourceFileNames: in multi-files ogni slot ha il suo nome,
    // in single-rs-col tutte le RS popolate condividono lo stesso file.
    setSourceFileNames(prev => {
      const next = prev.slice();
      if (importMode === "multi-files") {
        for (let i = 0; i < built.length; i++) {
          next[i] = built[i] && built[i].length > 0 ? (files[i] ?? null) : null;
        }
      } else {
        const f = files[0] ?? null;
        for (let i = 0; i < built.length; i++) {
          next[i] = built[i] && built[i].length > 0 ? f : null;
        }
      }
      return next;
    });
    setImportDone(true);
    toast({
      title: "Import completato",
      description: `${built.flat().length} transazioni distribuite su ${built.filter(a => a.length > 0).length} RS`,
    });
  }, [importMode, toast]);

  const onSave = useCallback(async () => {
    if (totals.count === 0) return;
    setSaving(true);
    try {
      const snapshot = buildSnapshot(rsNames, byRs, sourceFileNames);
      // Usiamo fetch diretto invece di `apiRequest` perché quest'ultimo
      // throwa su qualsiasi non-2xx, perdendo il body. Qui dobbiamo
      // distinguere la 409 di Task #152 (`FINPLAN_EMPTY_OVERWRITE_BLOCKED`)
      // dalle altre per mostrare un toast esplicito.
      const res = await fetch(`${BASE_PATH}/api/finplan`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: snapshot }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.code === "FINPLAN_EMPTY_OVERWRITE_BLOCKED") {
        toast({
          title: "Salvataggio rifiutato",
          description:
            "Esistono già dati FinPlan per questa organizzazione. Apri il workspace per vederli o forza un reset manuale prima di rifare il setup.",
          variant: "destructive",
        });
        return;
      }
      if (!res.ok) {
        throw new Error(`${res.status}: ${body?.message ?? res.statusText}`);
      }
      try { localStorage.setItem(`finplan_setup_done__org_${orgId}`, "1"); } catch { /* ignore */ }
      toast({
        title: "Setup completato",
        description: `Importate ${totals.count} righe su ${populatedCount} ragion${populatedCount === 1 ? "e" : "i"} social${populatedCount === 1 ? "e" : "i"}`,
      });
      onComplete();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore di rete";
      toast({ title: "Errore salvataggio", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [rsNames, byRs, sourceFileNames, orgId, totals.count, populatedCount, onComplete, toast]);

  const skipNow = useCallback(() => {
    try { localStorage.setItem(`finplan_setup_skipped__org_${orgId}`, "1"); } catch { /* ignore */ }
    onSkip();
  }, [orgId, onSkip]);

  const fmtEur = (n: number) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  const goNext = () => setStepIdx(i => Math.min(STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx(i => Math.max(0, i - 1));

  const canNext = (() => {
    if (step === "intro") return true;
    if (step === "rs") return rsNames.every(n => n.trim().length > 0);
    if (step === "import") return importDone && totals.count > 0;
    return false;
  })();

  return (
    <Card data-testid="finplan-setup-wizard">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Setup iniziale FinPlan
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={skipNow}
            data-testid="button-finplan-setup-skip"
          >
            <SkipForward className="h-4 w-4 mr-2" />
            Salta e apri il workspace vuoto
          </Button>
        </div>
        <div className="space-y-1 pt-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span data-testid="text-finplan-setup-step">Passo {stepIdx + 1} di {STEPS.length}</span>
            <span>{step === "intro" ? "Introduzione" : step === "rs" ? "Ragioni Sociali" : step === "import" ? "Importa estratti" : "Conferma"}</span>
          </div>
          <Progress value={(stepIdx + 1) / STEPS.length * 100} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "intro" && (
          <div className="space-y-3 text-sm" data-testid="finplan-step-intro">
            <p>
              Questa procedura guidata ti aiuta a popolare il workspace FinPlan
              per la tua organizzazione importando uno o più estratti conto in
              formato Excel o CSV. Niente è obbligatorio: in qualunque momento
              puoi saltare e usare i pulsanti di import dentro la sezione
              Transazioni del workspace.
            </p>
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <div className="font-medium">Cosa farai:</div>
              <ol className="list-decimal pl-5 space-y-0.5 text-muted-foreground">
                <li>Definisci i nomi delle 5 ragioni sociali e scegli la modalità di import</li>
                <li>Carica gli estratti CC e mappa le colonne (un unico flusso condiviso con la sezione Transazioni)</li>
                <li>Salva: il tool sarà popolato con tutte le transazioni importate</li>
              </ol>
            </div>
          </div>
        )}

        {step === "rs" && (
          <div className="space-y-3" data-testid="finplan-step-rs">
            <p className="text-sm text-muted-foreground">
              Inserisci i nomi delle 5 ragioni sociali del gruppo. Potrai
              modificarli in seguito direttamente dal tool.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {rsNames.map((n, i) => (
                <div key={i} className="space-y-1">
                  <Label htmlFor={`finplan-rs-${i}`}>Ragione Sociale {i + 1}</Label>
                  <Input
                    id={`finplan-rs-${i}`}
                    value={n}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRsNames(prev => prev.map((x, j) => j === i ? v : x));
                    }}
                    data-testid={`input-finplan-rs-${i}`}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2 pt-2" data-testid="finplan-upload-mode-toggle">
              <Label className="text-sm">Modalità di import</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={importMode === "multi-files" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setImportMode("multi-files"); setImportDone(false); setByRs(Array.from({length:5},()=>[])); }}
                  data-testid="button-mode-multi"
                >
                  Un file per RS (fino a 5)
                </Button>
                <Button
                  type="button"
                  variant={importMode === "single-rs-col" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setImportMode("single-rs-col"); setImportDone(false); setByRs(Array.from({length:5},()=>[])); }}
                  data-testid="button-mode-single"
                >
                  Un unico file con colonna RS
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {importMode === "multi-files"
                  ? "Carica un estratto CC per ciascuna RS. Tutti i file devono avere lo stesso formato di colonne."
                  : "Carica un singolo file che contenga tutte le RS. Dovrai indicare la colonna 'Ragione Sociale'; i valori verranno confrontati con i nomi inseriti sopra."}
              </p>
            </div>
          </div>
        )}

        {step === "import" && (
          <div className="space-y-3" data-testid="finplan-step-import">
            {/* Wizard come WRAPPER del componente shared BankImportFlow.
                In modalità inline non c'è Dialog: il flusso (upload →
                mapping → preview → conferma) è renderizzato dentro la
                Card del wizard. La conferma popola `byRs` + `sourceFileNames`,
                abilitando il pulsante "Avanti" verso lo step di salvataggio. */}
            <BankImportFlow
              open
              inline
              mode={importMode}
              rsNames={rsNames}
              nextTxIdSeq={1}
              onOpenChange={() => { /* no-op in inline */ }}
              onConfirmMulti={onImportConfirmed}
            />
            {importDone && (
              <div className="rounded-md border bg-emerald-500/10 p-3 text-sm" data-testid="finplan-import-summary">
                <div className="font-medium">Import pronto</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {totals.count} transazioni distribuite su {populatedCount} RS · totale Entrate {fmtEur(totals.e)} · totale Uscite {fmtEur(totals.u)}
                </div>
              </div>
            )}
          </div>
        )}

        {step === "save" && (
          <div className="space-y-3" data-testid="finplan-step-save">
            <p className="text-sm text-muted-foreground">
              Verifica il riepilogo e conferma per salvare il setup iniziale.
              Il workspace FinPlan verrà popolato con le transazioni
              importate; potrai modificare tutto dal tool.
            </p>
            <div className="rounded-md border p-3 space-y-2 text-sm">
              <Row k="Modalità" v={importMode === "multi-files" ? "Un file per RS" : "Unico file con colonna RS"} />
              <Row k="RS popolate" v={`${populatedCount} di 5`} />
              <Row k="Transazioni totali" v={String(totals.count)} />
              <Row k="Totale Entrate" v={fmtEur(totals.e)} />
              <Row k="Totale Uscite" v={fmtEur(totals.u)} />
              <Row k="Cashflow netto" v={fmtEur(totals.e - totals.u)} />
            </div>
            <div className="rounded-md border p-3 space-y-1 text-xs">
              <div className="font-medium mb-1">Dettaglio per RS:</div>
              {totals.perRs.map((r, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span className="truncate">{rsNames[i] || `Società ${i+1}`}</span>
                  <span className="text-muted-foreground shrink-0">
                    {r.count > 0 ? `${r.count} righe · E ${fmtEur(r.e)} · U ${fmtEur(r.u)}` : "vuota"}
                  </span>
                </div>
              ))}
            </div>
            <Button
              onClick={onSave}
              disabled={saving || totals.count === 0}
              className="w-full"
              data-testid="button-finplan-setup-confirm"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvataggio…</>
              ) : (
                <><Check className="h-4 w-4 mr-2" />Conferma e popola FinPlan</>
              )}
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t">
          <Button
            variant="ghost"
            onClick={goBack}
            disabled={stepIdx === 0}
            data-testid="button-finplan-setup-back"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Indietro
          </Button>
          {step !== "save" ? (
            <Button
              onClick={goNext}
              disabled={!canNext}
              data-testid="button-finplan-setup-next"
            >
              Avanti
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
