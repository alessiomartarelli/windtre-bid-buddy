import { useState, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Upload, FileSpreadsheet, Check, ChevronRight, ChevronLeft, SkipForward, AlertTriangle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Mese in lingua italiana, allineato al tool standalone (MO).
const MO = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

// Categorie di default (mirror di DEFAULT_CATS_E/U dentro
// client/public/finplan/index.html). Se vengono cambiate lì, replicare
// qui per mantenere coerenza dopo il primo import.
const DEFAULT_CATS_E = [
  { id: "e1", name: "Vendite Prodotti",   color: "#00D4AA", type: "E" },
  { id: "e2", name: "Servizi/Consulenze", color: "#3B82F6", type: "E" },
  { id: "e3", name: "Abbonamenti",        color: "#8B5CF6", type: "E" },
  { id: "e4", name: "Affitti Attivi",     color: "#F59E0B", type: "E" },
  { id: "e5", name: "Altro Entrate",      color: "#06B6D4", type: "E" },
];
const DEFAULT_CATS_U = [
  { id: "u1", name: "Personale/Stipendi", color: "#F43F5E", type: "U" },
  { id: "u2", name: "Fornitori",          color: "#F97316", type: "U" },
  { id: "u3", name: "Affitti Passivi",    color: "#EAB308", type: "U" },
  { id: "u4", name: "Marketing/Adv",      color: "#EC4899", type: "U" },
  { id: "u5", name: "Utenze/Servizi",     color: "#84CC16", type: "U" },
  { id: "u6", name: "Altro Uscite",       color: "#94A3B8", type: "U" },
];

type StepKey = "intro" | "rs" | "upload" | "mapping" | "save";
const STEPS: StepKey[] = ["intro", "rs", "upload", "mapping", "save"];

type ParsedRow = (string | number)[];
interface ParsedFile {
  headers: string[];
  rows: ParsedRow[];
  fileName: string;
}

type UploadMode = "multi" | "single-rs-col";

// Slot per la modalità multi-file: una RS può avere o no un file caricato.
interface RsSlot {
  rsIndex: number;       // 0..4
  parsed: ParsedFile | null;
}

interface ColumnMapping {
  date: number;        // -1 if not present
  amountIn: number;    // -1 if not present (use signed)
  amountOut: number;   // -1 if not present
  amountSigned: number; // -1 if not present (alternative)
  desc: number;        // -1 if not present
  rs: number;          // -1 if not present (only meaningful in single-rs-col mode)
}

interface BuiltTransaction {
  id: number;
  month: number;       // 0..11
  type: "E" | "U";
  amount: number;      // positive
  catId: string;       // e.g. 'e1' or 'u2'
  ivaRate: number;
  desc: string;
}

// Parse un valore numerico in formato italiano/europeo. Tollera
// "1.234,56", "1234.56", " 1 234,56 ", numeri puri Excel.
function parseAmount(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  s = s.replace(/[€$£\s]/g, "");
  if (!s) return 0;
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Estrae il mese (0..11) da una stringa data IT/EN o da un seriale Excel.
function parseMonth(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number" && v > 10000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.m) return Math.max(0, Math.min(11, d.m - 1));
  }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m1) return Math.max(0, Math.min(11, parseInt(m1[2], 10) - 1));
  const m2 = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m2) return Math.max(0, Math.min(11, parseInt(m2[2], 10) - 1));
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getMonth();
  return 0;
}

function autoDetectColumn(headers: string[], keywords: string[]): number {
  const norm = (h: string) => h.toLowerCase().trim();
  for (let i = 0; i < headers.length; i++) {
    if (keywords.some(k => norm(headers[i]) === k)) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    if (keywords.some(k => norm(headers[i]).includes(k))) return i;
  }
  return -1;
}

async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "csv") {
    const text = await file.text();
    const firstLine = text.split("\n")[0] || "";
    const delim = firstLine.includes("\t") ? "\t"
      : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
    const lines = text.trim().split("\n").map(l =>
      l.split(delim).map(c => c.trim().replace(/^"|"$/g, ""))
    );
    if (lines.length < 2) throw new Error("CSV con dati insufficienti");
    return {
      headers: lines[0].map(h => h || ""),
      rows: lines.slice(1).filter(r => r.some(c => c !== "")),
      fileName: file.name,
    };
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  let chosenRaw: ParsedRow[] | null = null;
  for (const sn of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json<ParsedRow>(wb.Sheets[sn], { header: 1, defval: "" });
    const dr = r.filter(row => row.some(c => c !== ""));
    if (dr.length >= 2) { chosenRaw = dr; break; }
  }
  if (!chosenRaw) throw new Error("Nessun foglio con dati sufficienti");
  let hi = 0;
  for (let i = 0; i < Math.min(10, chosenRaw.length); i++) {
    const nonNum = chosenRaw[i].filter(c =>
      c !== "" && isNaN(parseFloat(String(c).replace(",", ".")))
    ).length;
    if (nonNum >= 1) { hi = i; break; }
  }
  const headers = chosenRaw[hi].map((h, i) => String(h ?? "").trim() || `Col${i+1}`);
  const rows = chosenRaw.slice(hi + 1).filter(r => r.some(c => c !== ""));
  return { headers, rows, fileName: file.name };
}

// Converte una lista di righe parsed + mapping in transazioni FinPlan.
function rowsToTransactions(
  rows: ParsedRow[],
  mapping: ColumnMapping,
  defaultCatE: string,
  defaultCatU: string,
  ivaMode: "netti" | "lordi",
  startId: number,
): BuiltTransaction[] {
  const out: BuiltTransaction[] = [];
  let nextId = startId;
  const usesSigned = mapping.amountIn < 0 && mapping.amountOut < 0 && mapping.amountSigned >= 0;
  const factor = ivaMode === "lordi" ? 1 / 1.22 : 1;
  const ivaRate = ivaMode === "lordi" ? 22 : 0;
  for (const row of rows) {
    const month = mapping.date >= 0 ? parseMonth(row[mapping.date]) : 0;
    const desc = mapping.desc >= 0 ? String(row[mapping.desc] ?? "").trim() : "";
    let amountE = 0, amountU = 0;
    if (usesSigned) {
      const a = parseAmount(row[mapping.amountSigned]);
      if (a >= 0) amountE = a; else amountU = -a;
    } else {
      if (mapping.amountIn >= 0) amountE = parseAmount(row[mapping.amountIn]);
      if (mapping.amountOut >= 0) amountU = parseAmount(row[mapping.amountOut]);
    }
    if (amountE > 0) {
      out.push({ id: nextId++, month, type: "E", amount: +(amountE * factor).toFixed(2), catId: defaultCatE, ivaRate, desc });
    }
    if (amountU > 0) {
      out.push({ id: nextId++, month, type: "U", amount: +(amountU * factor).toFixed(2), catId: defaultCatU, ivaRate, desc });
    }
  }
  return out;
}

// Costruisce lo snapshot finale popolando le RS con le rispettive transazioni.
// `txByRs[i]` contiene le transazioni per la RS i-esima (vuoto se non importata).
function buildSnapshot(
  rsNames: string[],
  txByRs: BuiltTransaction[][],
  sourceFileNames: (string | null)[],
): unknown {
  const data = rsNames.map((name, i) => {
    const txs = txByRs[i] ?? [];
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

  // Step "rs": nomi delle 5 ragioni sociali.
  const [rsNames, setRsNames] = useState<string[]>([
    "Società 1", "Società 2", "Società 3", "Società 4", "Società 5",
  ]);

  // Step "upload": modalità + file caricati.
  const [uploadMode, setUploadMode] = useState<UploadMode>("multi");
  const [slots, setSlots] = useState<RsSlot[]>(() =>
    Array.from({ length: 5 }, (_, i) => ({ rsIndex: i, parsed: null }))
  );
  const [singleParsed, setSingleParsed] = useState<ParsedFile | null>(null);
  const [parsingSlot, setParsingSlot] = useState<number | null>(null); // -1 = single
  const [parsingSingle, setParsingSingle] = useState(false);

  // Step "mapping": una mappatura condivisa fra tutti i file caricati.
  // (La quasi totalità degli operatori usa lo stesso formato di estratto CC
  // per tutte le RS del gruppo, quindi una sola mappatura è sufficiente.)
  const [mapping, setMapping] = useState<ColumnMapping>({
    date: -1, amountIn: -1, amountOut: -1, amountSigned: -1, desc: -1, rs: -1,
  });
  const [defaultCatE, setDefaultCatE] = useState<string>("e1");
  const [defaultCatU, setDefaultCatU] = useState<string>("u2");
  const [ivaMode, setIvaMode] = useState<"netti" | "lordi">("netti");

  // Step "save": stato submit.
  const [saving, setSaving] = useState(false);

  // Headers di riferimento per la mappatura: il primo file caricato detta lo
  // schema (multi-file) oppure il file unico (single-rs-col).
  const referenceHeaders = useMemo<string[] | null>(() => {
    if (uploadMode === "single-rs-col") return singleParsed?.headers ?? null;
    const first = slots.find(s => s.parsed)?.parsed;
    return first?.headers ?? null;
  }, [uploadMode, singleParsed, slots]);

  // Auto-detect mapping quando cambiano gli headers di riferimento.
  const applyAutoDetect = useCallback((headers: string[], wantRs: boolean) => {
    setMapping({
      date: autoDetectColumn(headers, ["data","date","mese","periodo","data contabile","data valuta"]),
      amountIn: autoDetectColumn(headers, ["accredit","entrate","ricavi","incassi","avere","credit","entrata"]),
      amountOut: autoDetectColumn(headers, ["addebit","uscite","spese","dare","debit","uscita"]),
      amountSigned: autoDetectColumn(headers, ["importo","amount","valore"]),
      desc: autoDetectColumn(headers, ["descrizione","description","causale","nota","operazione","dettaglio"]),
      rs: wantRs ? autoDetectColumn(headers, ["ragione sociale","ragionesociale","rs","società","societa","azienda","company"]) : -1,
    });
  }, []);

  const onSlotFile = useCallback(async (slotIdx: number, file: File) => {
    setParsingSlot(slotIdx);
    try {
      const p = await parseFile(file);
      setSlots(prev => prev.map((s, i) => i === slotIdx ? { ...s, parsed: p } : s));
      // Auto-detect alla prima importazione (se mapping ancora vuoto).
      setMapping(curr => {
        const empty = curr.date < 0 && curr.amountIn < 0 && curr.amountOut < 0 && curr.amountSigned < 0 && curr.desc < 0;
        if (empty) {
          return {
            date: autoDetectColumn(p.headers, ["data","date","mese","periodo","data contabile","data valuta"]),
            amountIn: autoDetectColumn(p.headers, ["accredit","entrate","ricavi","incassi","avere","credit","entrata"]),
            amountOut: autoDetectColumn(p.headers, ["addebit","uscite","spese","dare","debit","uscita"]),
            amountSigned: autoDetectColumn(p.headers, ["importo","amount","valore"]),
            desc: autoDetectColumn(p.headers, ["descrizione","description","causale","nota","operazione","dettaglio"]),
            rs: -1,
          };
        }
        return curr;
      });
      toast({ title: "File caricato", description: `${p.rows.length} righe per ${rsNames[slotIdx]}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore nel parsing";
      toast({ title: "Errore lettura file", description: msg, variant: "destructive" });
    } finally {
      setParsingSlot(null);
    }
  }, [toast, rsNames]);

  const onSingleFile = useCallback(async (file: File) => {
    setParsingSingle(true);
    try {
      const p = await parseFile(file);
      setSingleParsed(p);
      applyAutoDetect(p.headers, true);
      toast({ title: "File caricato", description: `${p.rows.length} righe da "${p.fileName}"` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore nel parsing";
      toast({ title: "Errore lettura file", description: msg, variant: "destructive" });
    } finally {
      setParsingSingle(false);
    }
  }, [toast, applyAutoDetect]);

  const clearSlot = useCallback((slotIdx: number) => {
    setSlots(prev => prev.map((s, i) => i === slotIdx ? { ...s, parsed: null } : s));
  }, []);

  // Cambio modalità: ripulisci stato non rilevante e reset mapping.
  const switchMode = useCallback((m: UploadMode) => {
    setUploadMode(m);
    if (m === "multi") setSingleParsed(null);
    else setSlots(prev => prev.map(s => ({ ...s, parsed: null })));
    setMapping({ date: -1, amountIn: -1, amountOut: -1, amountSigned: -1, desc: -1, rs: -1 });
  }, []);

  // Trova l'indice RS dato un valore di cella (match case-insensitive su rsNames).
  const matchRsIndex = useCallback((v: unknown): number => {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s) return -1;
    for (let i = 0; i < rsNames.length; i++) {
      const n = rsNames[i].trim().toLowerCase();
      if (!n) continue;
      if (n === s || s.includes(n) || n.includes(s)) return i;
    }
    return -1;
  }, [rsNames]);

  // Costruisce le transazioni per RS in base a modalità + mapping corrente.
  const txByRs = useMemo<BuiltTransaction[][]>(() => {
    const out: BuiltTransaction[][] = Array.from({ length: 5 }, () => []);
    let nextId = 1;
    if (uploadMode === "multi") {
      for (const s of slots) {
        if (!s.parsed) continue;
        const txs = rowsToTransactions(s.parsed.rows, mapping, defaultCatE, defaultCatU, ivaMode, nextId);
        out[s.rsIndex] = txs;
        if (txs.length > 0) nextId = txs[txs.length - 1].id + 1;
      }
    } else if (uploadMode === "single-rs-col" && singleParsed && mapping.rs >= 0) {
      // Raggruppa righe per RS, poi processa.
      const groups: ParsedRow[][] = Array.from({ length: 5 }, () => []);
      for (const row of singleParsed.rows) {
        const idx = matchRsIndex(row[mapping.rs]);
        if (idx >= 0) groups[idx].push(row);
      }
      for (let i = 0; i < 5; i++) {
        if (groups[i].length === 0) continue;
        const txs = rowsToTransactions(groups[i], mapping, defaultCatE, defaultCatU, ivaMode, nextId);
        out[i] = txs;
        if (txs.length > 0) nextId = txs[txs.length - 1].id + 1;
      }
    }
    return out;
  }, [uploadMode, slots, singleParsed, mapping, defaultCatE, defaultCatU, ivaMode, matchRsIndex]);

  const sourceFileNames = useMemo<(string | null)[]>(() => {
    if (uploadMode === "multi") {
      return slots.map(s => s.parsed?.fileName ?? null);
    }
    // Single mode: stesso file per tutte le RS popolate.
    return Array.from({ length: 5 }, (_, i) =>
      txByRs[i].length > 0 ? (singleParsed?.fileName ?? null) : null
    );
  }, [uploadMode, slots, singleParsed, txByRs]);

  const totals = useMemo(() => {
    let e = 0, u = 0, count = 0;
    const perRs = txByRs.map(txs => {
      let pe = 0, pu = 0;
      for (const t of txs) {
        if (t.type === "E") { e += t.amount; pe += t.amount; }
        else { u += t.amount; pu += t.amount; }
        count++;
      }
      return { count: txs.length, e: pe, u: pu };
    });
    return { e, u, count, perRs };
  }, [txByRs]);

  const populatedCount = useMemo(() => txByRs.filter(t => t.length > 0).length, [txByRs]);

  const uploadHasAny = useMemo(() => {
    if (uploadMode === "multi") return slots.some(s => s.parsed);
    return !!singleParsed;
  }, [uploadMode, slots, singleParsed]);

  const mappingValid = useMemo(() => {
    if (!referenceHeaders) return false;
    const amountsOk = (mapping.amountIn >= 0 && mapping.amountOut >= 0) || mapping.amountSigned >= 0;
    if (!amountsOk) return false;
    if (uploadMode === "single-rs-col" && mapping.rs < 0) return false;
    return true;
  }, [referenceHeaders, mapping, uploadMode]);

  const onSave = useCallback(async () => {
    if (!uploadHasAny) return;
    setSaving(true);
    try {
      const snapshot = buildSnapshot(rsNames, txByRs, sourceFileNames);
      const res = await apiRequest("PUT", "/api/finplan", { data: snapshot });
      await res.json().catch(() => null);
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
  }, [uploadHasAny, rsNames, txByRs, sourceFileNames, orgId, totals.count, populatedCount, onComplete, toast]);

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
    if (step === "upload") return uploadHasAny;
    if (step === "mapping") return mappingValid && totals.count > 0;
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
            Salta e usa il tool standalone
          </Button>
        </div>
        <div className="space-y-1 pt-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span data-testid="text-finplan-setup-step">Passo {stepIdx + 1} di {STEPS.length}</span>
            <span>{step === "intro" ? "Introduzione" : step === "rs" ? "Ragioni Sociali" : step === "upload" ? "Carica estratti" : step === "mapping" ? "Mappatura colonne" : "Conferma"}</span>
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
              puoi saltare e usare i pulsanti di import del tool standalone.
            </p>
            <div className="rounded-md border bg-muted/30 p-3 space-y-1">
              <div className="font-medium">Cosa farai:</div>
              <ol className="list-decimal pl-5 space-y-0.5 text-muted-foreground">
                <li>Definisci i nomi delle 5 ragioni sociali</li>
                <li>Carica fino a 5 estratti CC (uno per RS) o un unico file con la colonna "Ragione Sociale"</li>
                <li>Mappa le colonne (data, importo, descrizione)</li>
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
            <p className="text-xs text-muted-foreground pt-1">
              Nello step successivo potrai caricare un estratto CC per ciascuna RS, oppure un unico file
              con tutti i movimenti se contiene una colonna "Ragione Sociale".
            </p>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-3" data-testid="finplan-step-upload">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Scegli come fornire i movimenti CC: i file vengono processati
                localmente, niente viene inviato finché non confermi l'ultimo passo.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" data-testid="finplan-upload-mode-toggle">
              <Button
                type="button"
                variant={uploadMode === "multi" ? "default" : "outline"}
                size="sm"
                onClick={() => switchMode("multi")}
                data-testid="button-mode-multi"
              >
                Un file per RS (fino a 5)
              </Button>
              <Button
                type="button"
                variant={uploadMode === "single-rs-col" ? "default" : "outline"}
                size="sm"
                onClick={() => switchMode("single-rs-col")}
                data-testid="button-mode-single"
              >
                Un unico file con colonna RS
              </Button>
            </div>

            {uploadMode === "multi" && (
              <div className="space-y-2" data-testid="finplan-multi-uploads">
                <p className="text-xs text-muted-foreground">
                  Carica un file per ciascuna ragione sociale. Puoi caricarne anche solo alcune e completare le altre in seguito dal tool.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {slots.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-md border p-3"
                      data-testid={`finplan-slot-${i}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{rsNames[i] || `Società ${i+1}`}</div>
                        {s.parsed ? (
                          <div className="text-xs text-muted-foreground truncate">
                            {s.parsed.fileName} · {s.parsed.rows.length} righe · {s.parsed.headers.length} colonne
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">Nessun file</div>
                        )}
                      </div>
                      {s.parsed && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => clearSlot(i)}
                          data-testid={`button-slot-clear-${i}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      <label
                        htmlFor={`finplan-slot-input-${i}`}
                        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm cursor-pointer hover-elevate"
                        data-testid={`label-slot-upload-${i}`}
                      >
                        {parsingSlot === i ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        {s.parsed ? "Sostituisci" : "Carica"}
                      </label>
                      <Input
                        id={`finplan-slot-input-${i}`}
                        type="file"
                        accept=".xlsx,.xls,.xlsm,.csv"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onSlotFile(i, f);
                          e.target.value = "";
                        }}
                        data-testid={`input-slot-file-${i}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {uploadMode === "single-rs-col" && (
              <div className="space-y-2" data-testid="finplan-single-upload">
                <p className="text-xs text-muted-foreground">
                  Carica un singolo file che contenga tutte le RS. Nello step successivo dovrai indicare la colonna che identifica la ragione sociale; i valori verranno confrontati con i nomi inseriti nel passo precedente.
                </p>
                <label
                  htmlFor="finplan-single-input"
                  className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 p-8 cursor-pointer hover-elevate"
                  data-testid="dropzone-finplan-single"
                >
                  {parsingSingle ? (
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  ) : (
                    <Upload className="h-8 w-8 text-muted-foreground" />
                  )}
                  <div className="text-sm font-medium">
                    {parsingSingle ? "Lettura in corso…" :
                      singleParsed ? `File caricato: ${singleParsed.fileName}` :
                      "Clicca per scegliere un file (.xlsx, .xls, .csv)"}
                  </div>
                  {singleParsed && (
                    <div className="text-xs text-muted-foreground">
                      {singleParsed.headers.length} colonne · {singleParsed.rows.length} righe
                    </div>
                  )}
                  <Input
                    id="finplan-single-input"
                    type="file"
                    accept=".xlsx,.xls,.xlsm,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onSingleFile(f);
                      e.target.value = "";
                    }}
                    data-testid="input-finplan-single-file"
                  />
                </label>
              </div>
            )}

            {referenceHeaders && (
              <div className="rounded-md border p-3 text-xs">
                <div className="font-medium mb-1">Anteprima intestazioni:</div>
                <div className="flex flex-wrap gap-1">
                  {referenceHeaders.slice(0, 12).map((h, i) => (
                    <Badge key={i} variant="secondary">{h}</Badge>
                  ))}
                  {referenceHeaders.length > 12 && (
                    <Badge variant="outline">+{referenceHeaders.length - 12}</Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {step === "mapping" && referenceHeaders && (
          <div className="space-y-3" data-testid="finplan-step-mapping">
            <p className="text-sm text-muted-foreground">
              {uploadMode === "multi"
                ? "Associa le colonne. La stessa mappatura viene applicata a tutti i file caricati (assumendo lo stesso formato di estratto CC)."
                : "Associa le colonne, inclusa quella che identifica la Ragione Sociale."}
              {" "}Le voci con "(opz.)" sono opzionali. Compila Entrate+Uscite oppure Importo con segno.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ColMap label="Data / Mese (opz.)" value={mapping.date} headers={referenceHeaders}
                onChange={(v) => setMapping(m => ({ ...m, date: v }))} testId="select-map-date" />
              <ColMap label="Descrizione (opz.)" value={mapping.desc} headers={referenceHeaders}
                onChange={(v) => setMapping(m => ({ ...m, desc: v }))} testId="select-map-desc" />
              <ColMap label="Entrate / Accrediti" value={mapping.amountIn} headers={referenceHeaders}
                onChange={(v) => setMapping(m => ({ ...m, amountIn: v }))} testId="select-map-in" />
              <ColMap label="Uscite / Addebiti" value={mapping.amountOut} headers={referenceHeaders}
                onChange={(v) => setMapping(m => ({ ...m, amountOut: v }))} testId="select-map-out" />
              <ColMap label="OPPURE Importo unico con segno" value={mapping.amountSigned} headers={referenceHeaders}
                onChange={(v) => setMapping(m => ({ ...m, amountSigned: v }))} testId="select-map-signed" />
              {uploadMode === "single-rs-col" && (
                <ColMap label="Ragione Sociale" value={mapping.rs} headers={referenceHeaders}
                  onChange={(v) => setMapping(m => ({ ...m, rs: v }))} testId="select-map-rs" />
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className="space-y-1">
                <Label>Categoria default Entrate</Label>
                <Select value={defaultCatE} onValueChange={setDefaultCatE}>
                  <SelectTrigger data-testid="select-default-cat-e"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEFAULT_CATS_E.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Categoria default Uscite</Label>
                <Select value={defaultCatU} onValueChange={setDefaultCatU}>
                  <SelectTrigger data-testid="select-default-cat-u"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEFAULT_CATS_U.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Modalità importi</Label>
                <Select value={ivaMode} onValueChange={(v) => setIvaMode(v as "netti" | "lordi")}>
                  <SelectTrigger data-testid="select-iva-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="netti">Netti (estratto CC)</SelectItem>
                    <SelectItem value="lordi">Lordi IVA 22% (fatture)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!mappingValid && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex items-start gap-2" data-testid="warn-mapping-invalid">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Mappa Entrate <b>e</b> Uscite, oppure Importo con segno
                  {uploadMode === "single-rs-col" ? ", e indica la colonna Ragione Sociale" : ""}
                  , per procedere.
                </span>
              </div>
            )}

            {mappingValid && (
              <>
                <div className="grid grid-cols-3 gap-3 pt-2 text-sm">
                  <Stat label="Righe importate" value={String(totals.count)} testId="stat-count" />
                  <Stat label="Totale Entrate" value={fmtEur(totals.e)} testId="stat-entrate" />
                  <Stat label="Totale Uscite" value={fmtEur(totals.u)} testId="stat-uscite" />
                </div>
                <div className="rounded-md border p-3 space-y-1 text-xs" data-testid="finplan-per-rs-preview">
                  <div className="font-medium mb-1">Anteprima per ragione sociale:</div>
                  {totals.perRs.map((r, i) => (
                    <div key={i} className="flex justify-between gap-3" data-testid={`per-rs-row-${i}`}>
                      <span className="truncate">{rsNames[i] || `Società ${i+1}`}</span>
                      <span className="text-muted-foreground shrink-0">
                        {r.count > 0 ? `${r.count} righe · E ${fmtEur(r.e)} · U ${fmtEur(r.u)}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
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
              <Row k="Modalità" v={uploadMode === "multi" ? "Un file per RS" : "Unico file con colonna RS"} />
              <Row k="RS popolate" v={`${populatedCount} di 5`} />
              <Row k="Transazioni totali" v={String(totals.count)} />
              <Row k="Totale Entrate" v={fmtEur(totals.e)} />
              <Row k="Totale Uscite" v={fmtEur(totals.u)} />
              <Row k="Cashflow netto" v={fmtEur(totals.e - totals.u)} />
              <Row k="Modalità importi" v={ivaMode === "netti" ? "Netti" : "Lordi IVA 22%"} />
            </div>
            <div className="rounded-md border p-3 space-y-1 text-xs">
              <div className="font-medium mb-1">Dettaglio per RS:</div>
              {totals.perRs.map((r, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span className="truncate">{rsNames[i] || `Società ${i+1}`}</span>
                  <span className="text-muted-foreground shrink-0">
                    {r.count > 0 ? `${r.count} righe` : "vuota"}
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
          ) : (
            <span />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ColMap(props: {
  label: string;
  value: number;
  headers: string[];
  onChange: (v: number) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{props.label}</Label>
      <Select value={String(props.value)} onValueChange={(v) => props.onChange(parseInt(v, 10))}>
        <SelectTrigger data-testid={props.testId}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="-1">— non presente —</SelectItem>
          {props.headers.map((h, i) => (
            <SelectItem key={i} value={String(i)}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold text-base" data-testid={testId}>{value}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
