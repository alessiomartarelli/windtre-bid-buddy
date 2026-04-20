import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/basePath";
import { AppNavbar } from "@/components/AppNavbar";
import * as XLSX from "xlsx";
import {
  Upload, Download, AlertCircle, CheckCircle2, TrendingUp, TrendingDown,
  Store, FileSpreadsheet, Filter, BarChart3, Search, X, ChevronRight,
  Target, Activity, Loader2, Trash2, Save,
} from "lucide-react";
import {
  CAPITOLI_CONFIG, classifyAndNormalize, detectPeriod, parsePeriodToMonthYear,
  type CapitoloKey, type DrmsRow,
} from "@/lib/drmsClassifier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type RawXlsxRow = Record<string, unknown>;

const fmtEur = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency", currency: "EUR", maximumFractionDigits: 2,
  }).format(v);
};
const fmtInt = (v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT").format(Math.round(v));
};
const fmtPct = (v: number, tot: number) => (tot > 0 ? `${((v / tot) * 100).toFixed(1)}%` : "—");

function downloadCSV(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows || rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(";"),
    ...rows.map(r => keys.map(k => {
      const v = r[k];
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return /[";\n]/.test(s) ? `"${s}"` : s;
    }).join(";")),
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function parseExcelFile(file: File): Promise<RawXlsxRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames.includes("Estratto conto") ? "Estratto conto" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<RawXlsxRow>(ws, { defval: null, raw: false });
}

interface DrmsListItem {
  id: string;
  month: number;
  year: number;
  period: string;
  fileName: string;
  totaleImporto: string | null;
  righeCount: number;
  uploadedAt: string | null;
}

interface DrmsUploadFull {
  id: string;
  month: number;
  year: number;
  period: string;
  fileName: string;
  totaleImporto: string | null;
  righeCount: number;
  rows: DrmsRow[];
  uploadedAt: string | null;
}

const MONTH_LABELS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

// =============================================================================
// COMPONENTI UI (preservano lo stile del mockup)
// =============================================================================
const KpiCard = ({ label, value, subvalue, accent, icon: Icon }: {
  label: string; value: React.ReactNode; subvalue?: React.ReactNode; accent?: string;
  icon?: React.ComponentType<any>;
}) => (
  <div className="relative overflow-hidden border border-neutral-200 bg-white">
    <div className="absolute top-0 left-0 w-1 h-full" style={{ background: accent || "#9ca3af" }} />
    <div className="px-5 py-4">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 font-medium">{label}</div>
        {Icon && <Icon size={14} strokeWidth={1.5} className="text-neutral-400" />}
      </div>
      <div className="font-serif text-2xl text-neutral-900 leading-tight">{value}</div>
      {subvalue && <div className="text-xs text-neutral-600 mt-1.5 font-mono">{subvalue}</div>}
    </div>
  </div>
);

const SectionHead = ({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) => (
  <div className="flex items-end justify-between mb-5 pb-3 border-b-2 border-neutral-900 gap-3 flex-wrap">
    <div>
      {eyebrow && <div className="text-[10px] uppercase tracking-[0.22em] text-neutral-500 mb-1">{eyebrow}</div>}
      <h2 className="font-serif text-2xl text-neutral-900">{title}</h2>
    </div>
    {right}
  </div>
);

const FilterChip = ({ active, onClick, children, dot, testId }: {
  active: boolean; onClick: () => void; children: React.ReactNode; dot?: string; testId?: string;
}) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={`px-3 py-1.5 text-xs font-mono tracking-wide uppercase border transition-all flex items-center gap-2 ${
      active
        ? 'bg-neutral-900 text-white border-neutral-900'
        : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-900 hover:text-neutral-900'
    }`}
  >
    {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
    {children}
  </button>
);

const MetricBox = ({ label, value, tone, highlight }: {
  label: string; value: React.ReactNode; tone?: 'ok' | 'ko' | 'warn'; highlight?: boolean;
}) => {
  const toneCls = tone === 'ok' ? 'text-emerald-700' : tone === 'ko' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-neutral-900';
  return (
    <div className={`border border-neutral-200 bg-white px-3 py-2 ${highlight ? 'ring-1 ring-orange-200 bg-orange-50/40' : ''}`}>
      <div className="text-[9px] uppercase tracking-[0.15em] text-neutral-500 mb-0.5">{label}</div>
      <div className={`font-mono text-sm font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
};

// =============================================================================
// LANDING / UPLOAD CARD
// =============================================================================
function UploadCard({
  loading, error, onFileChosen, savedList, onLoadSaved, onDeleteSaved,
}: {
  loading: boolean; error: string | null; onFileChosen: (f: File) => void;
  savedList: DrmsListItem[]; onLoadSaved: (id: string) => void; onDeleteSaved: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="space-y-6">
      <div className="relative group">
        <label
          htmlFor="drms-file-input"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files[0]; if (f) onFileChosen(f);
          }}
          className={`relative block bg-white border-2 rounded-2xl transition-all duration-300 cursor-pointer overflow-hidden ${
            dragOver ? 'border-orange-600 bg-orange-50/80 scale-[1.005]' : 'border-neutral-300/60 hover:border-orange-500/60'
          }`}
        >
          <input
            type="file"
            id="drms-file-input"
            data-testid="input-drms-file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChosen(f); }}
            disabled={loading}
            className="absolute opacity-0 -z-10"
          />
          <div className="relative p-8 sm:p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5"
              style={{ background: loading ? 'linear-gradient(135deg, #fed7aa, #fdba74)' : 'linear-gradient(135deg, #fff7ed, #ffedd5)', border: '1px solid #fed7aa' }}>
              {loading ? <Loader2 size={28} className="animate-spin text-orange-700" /> : <Upload size={28} strokeWidth={1.5} className="text-orange-700" />}
            </div>
            <div className="font-serif text-2xl text-neutral-900 mb-2 tracking-tight">
              {loading ? "Elaborazione del DRMS…" : "Carica il file DRMS"}
            </div>
            <div className="text-sm text-neutral-600 mb-4">
              {loading ? "Classificazione e salvataggio in corso" : (
                <>Trascina <span className="font-mono px-1.5 py-0.5 bg-neutral-100 rounded text-xs">.xlsx</span> oppure <span className="text-orange-700 font-semibold underline decoration-dotted underline-offset-4">clicca qui</span></>
              )}
            </div>
            {!loading && (
              <div className="flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.15em] text-neutral-500 flex-wrap">
                <span className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-600" /> Parsing locale</span>
                <span className="w-1 h-1 bg-neutral-300 rounded-full" />
                <span className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-600" /> 13 capitoli</span>
                <span className="w-1 h-1 bg-neutral-300 rounded-full" />
                <span className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-600" /> Persistenza per org+mese</span>
              </div>
            )}
            {error && (
              <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={14} /> {error}
              </div>
            )}
          </div>
        </label>
      </div>

      {savedList.length > 0 && (
        <div className="bg-white border border-neutral-200">
          <div className="px-5 py-3 border-b border-neutral-200">
            <div className="text-[11px] uppercase tracking-[0.15em] text-neutral-600 font-semibold">DRMS salvati</div>
          </div>
          <div className="divide-y divide-neutral-100">
            {savedList.map((s) => (
              <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3" data-testid={`row-drms-saved-${s.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                    <FileSpreadsheet size={14} className="text-emerald-600 shrink-0" />
                    <span className="truncate">{s.fileName}</span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 font-mono">
                    {s.period} · {MONTH_LABELS[s.month - 1]} {s.year} · {fmtInt(s.righeCount)} righe · {fmtEur(parseFloat(s.totaleImporto || '0'))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => onLoadSaved(s.id)} data-testid={`button-load-drms-${s.id}`}>
                    Apri
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDeleteSaved(s.id)} className="text-red-600 hover:text-red-700" data-testid={`button-delete-drms-${s.id}`}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PREVIEW CARD (review-and-confirm)
// =============================================================================
function PreviewCard({
  preview, saving, onConfirm, onCancel,
}: {
  preview: {
    fileName: string; month: number; year: number; period: string;
    totale: number; righeCount: number;
    capitoliCount: Array<{ key: string; label: string; color: string; count: number; importo: number }>;
    altroCount: number; hasConflict: boolean;
  };
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const totalCapitoli = preview.capitoliCount.reduce((s, c) => s + c.count, 0);
  return (
    <div className="bg-white border border-neutral-200">
      <div className="px-5 py-4 border-b-2 border-neutral-900 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-neutral-500 mb-1">Anteprima</div>
          <div className="font-serif text-2xl text-neutral-900">Verifica i dati prima del salvataggio</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-600 font-mono">
          <FileSpreadsheet size={14} className="text-emerald-600" />
          <span className="truncate max-w-[260px]" title={preview.fileName}>{preview.fileName}</span>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Periodo" value={preview.period} subvalue={`${MONTH_LABELS[preview.month - 1]} ${preview.year}`} accent="#f97316" icon={Activity} />
          <KpiCard label="Righe totali" value={fmtInt(preview.righeCount)} subvalue={`${fmtInt(totalCapitoli)} classificate`} accent="#3b82f6" />
          <KpiCard label="Totale importi" value={fmtEur(preview.totale)} accent="#10b981" icon={Target} />
          <KpiCard label="Non classificate" value={fmtInt(preview.altroCount)}
            subvalue={preview.altroCount > 0 ? "Verifica regole" : "OK"}
            accent={preview.altroCount > 0 ? "#eab308" : "#10b981"}
            icon={preview.altroCount > 0 ? AlertCircle : CheckCircle2} />
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 font-medium mb-2">Conteggio per capitolo</div>
          <div className="border border-neutral-200">
            {preview.capitoliCount.map(c => (
              <div key={c.key} className={`px-4 py-2 flex items-center justify-between border-b border-neutral-100 last:border-b-0 ${c.key === 'ALTRO' ? 'bg-amber-50/50' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 shrink-0" style={{ background: c.color }} />
                  <span className="text-sm text-neutral-900 truncate">{c.label}</span>
                  {c.key === 'ALTRO' && (
                    <span className="text-[10px] uppercase tracking-wider text-amber-700 font-mono">non classificato</span>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xs text-neutral-500 font-mono tabular-nums">{fmtInt(c.count)} righe</span>
                  <span className={`font-mono text-sm font-semibold tabular-nums ${c.importo < 0 ? 'text-red-700' : 'text-neutral-900'}`}>{fmtEur(c.importo)}</span>
                </div>
              </div>
            ))}
            {preview.capitoliCount.length === 0 && (
              <div className="px-4 py-6 text-sm text-neutral-500 text-center">Nessuna riga classificata</div>
            )}
          </div>
        </div>

        {preview.hasConflict && (
          <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Esiste già un DRMS per questo periodo</div>
              <div className="text-xs mt-0.5">Salvando, il precedente upload per {MONTH_LABELS[preview.month - 1]} {preview.year} verrà sovrascritto.</div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-200">
          <Button variant="outline" onClick={onCancel} disabled={saving} data-testid="button-preview-cancel">
            <X size={14} className="mr-2" /> Annulla
          </Button>
          <Button onClick={onConfirm} disabled={saving} data-testid="button-preview-confirm" className="bg-orange-600 hover:bg-orange-700 text-white">
            {saving ? <><Loader2 size={14} className="mr-2 animate-spin" /> Salvataggio…</> : <><Save size={14} className="mr-2" /> {preview.hasConflict ? 'Sovrascrivi e apri' : 'Salva e apri'}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// DASHBOARD
// =============================================================================
type TabKey = "overview" | "matrix" | "driver" | "pv";

function Dashboard({
  data, period, fileName, onReset,
}: {
  data: DrmsRow[]; period: string; fileName: string; onReset: () => void;
}) {
  const [selectedCapitoli, setSelectedCapitoli] = useState<Set<CapitoloKey>>(
    () => new Set(Object.keys(CAPITOLI_CONFIG) as CapitoloKey[])
  );
  const [selectedPV, setSelectedPV] = useState<string | null>(null);
  const [searchPV, setSearchPV] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const listaPV = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data) {
      if (!r.CODICE_NEGOZIO_COSY) continue;
      map.set(r.CODICE_NEGOZIO_COSY, (map.get(r.CODICE_NEGOZIO_COSY) || 0) + (r.IMPORTO_NUM || 0));
    }
    return Array.from(map.entries()).map(([neg, tot]) => ({ neg, tot })).sort((a, b) => b.tot - a.tot);
  }, [data]);

  const filteredPVList = useMemo(() => {
    if (!searchPV) return listaPV;
    const q = searchPV.toLowerCase();
    return listaPV.filter(p => p.neg.toLowerCase().includes(q));
  }, [listaPV, searchPV]);

  const filteredData = useMemo(() => {
    return data.filter(r =>
      selectedCapitoli.has(r.CAPITOLO) &&
      (selectedPV === null || r.CODICE_NEGOZIO_COSY === selectedPV)
    );
  }, [data, selectedCapitoli, selectedPV]);

  const perCapitolo = useMemo(() => {
    const map: Record<string, { importo: number; righe: number; contratti: Set<string> }> = {};
    for (const r of filteredData) {
      const c = r.CAPITOLO;
      if (!map[c]) map[c] = { importo: 0, righe: 0, contratti: new Set() };
      map[c].importo += r.IMPORTO_NUM || 0;
      map[c].righe += 1;
      if (r.CODICE_CONTRATTO) map[c].contratti.add(r.CODICE_CONTRATTO);
    }
    return Object.entries(map)
      .map(([c, v]) => ({
        capitolo: c as CapitoloKey,
        importo: v.importo, righe: v.righe, contratti: v.contratti.size,
        config: CAPITOLI_CONFIG[c as CapitoloKey] || { label: c, color: "#888", order: 99 },
      }))
      .sort((a, b) => (a.config.order || 99) - (b.config.order || 99));
  }, [filteredData]);

  const totali = useMemo(() => {
    let imp = 0, righe = 0, pagati = 0, stornati = 0, nonAtt = 0;
    const contrSet = new Set<string>(), pvSet = new Set<string>();
    for (const r of filteredData) {
      const v = r.IMPORTO_NUM || 0;
      imp += v; righe += 1;
      if (r.CODICE_CONTRATTO) contrSet.add(r.CODICE_CONTRATTO);
      if (r.CODICE_NEGOZIO_COSY) pvSet.add(r.CODICE_NEGOZIO_COSY);
      if (v > 0) pagati++; else if (v < 0) stornati++; else nonAtt++;
    }
    return { imp, righe, pagati, stornati, nonAtt, contratti: contrSet.size, pv: pvSet.size };
  }, [filteredData]);

  const matrix = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const r of filteredData) {
      const neg = r.CODICE_NEGOZIO_COSY, c = r.CAPITOLO;
      if (!neg || !c) continue;
      if (!map[neg]) map[neg] = {};
      map[neg][c] = (map[neg][c] || 0) + (r.IMPORTO_NUM || 0);
    }
    return Object.entries(map)
      .map(([neg, byCap]) => ({ neg, byCap, tot: Object.values(byCap).reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.tot - a.tot);
  }, [filteredData]);

  const capitoliOrdinati = useMemo(() => {
    return (Object.entries(CAPITOLI_CONFIG) as [CapitoloKey, typeof CAPITOLI_CONFIG[CapitoloKey]][])
      .sort((a, b) => a[1].order - b[1].order)
      .map(([k]) => k);
  }, []);

  const toggleCapitolo = (c: CapitoloKey) => {
    const s = new Set(selectedCapitoli);
    if (s.has(c)) s.delete(c); else s.add(c);
    setSelectedCapitoli(s);
  };

  return (
    <div className="bg-[#faf8f4] min-h-[calc(100vh-60px)]">
      {/* Sub-header DRMS */}
      <div className="bg-white border-b-2 border-neutral-900">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.3em] text-neutral-500">DRMS · Commissioning</div>
            <div className="font-serif text-lg text-neutral-900 leading-tight">
              Franchising <span className="italic text-orange-700">W3</span>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="text-right">
              <div className="text-[9px] uppercase tracking-wider text-neutral-500">Period</div>
              <div className="font-mono text-xs text-neutral-900 font-semibold" data-testid="text-drms-period">{period}</div>
            </div>
            <div className="h-8 w-px bg-neutral-300 hidden sm:block" />
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Totale pagato</div>
              <div className="font-mono text-sm text-neutral-900 font-semibold" data-testid="text-drms-totale">{fmtEur(totali.imp)}</div>
            </div>
          </div>
        </div>
        {fileName && (
          <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-2 border-t border-neutral-200 bg-neutral-50/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FileSpreadsheet size={14} className="text-emerald-600 shrink-0" />
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 hidden sm:inline">File:</span>
              <span className="text-xs font-mono text-neutral-900 truncate" data-testid="text-drms-filename">{fileName}</span>
            </div>
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-wider font-medium text-red-700 hover:bg-red-50 border border-red-200 hover:border-red-400 rounded transition-colors whitespace-nowrap"
              data-testid="button-drms-reset"
            >
              <X size={12} strokeWidth={2.5} /> <span>Cambia DRMS</span>
            </button>
          </div>
        )}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 flex gap-0 border-t border-neutral-200 overflow-x-auto">
          {([
            { k: "overview" as TabKey, l: "Panoramica" },
            { k: "matrix" as TabKey, l: "Matrice" },
            { k: "driver" as TabKey, l: "Driver" },
            { k: "pv" as TabKey, l: "Punti Vendita" },
          ]).map(t => (
            <button
              key={t.k}
              onClick={() => setActiveTab(t.k)}
              data-testid={`tab-drms-${t.k}`}
              className={`px-4 sm:px-5 py-3 text-[11px] sm:text-xs uppercase tracking-[0.12em] border-b-2 transition-colors whitespace-nowrap ${
                activeTab === t.k ? 'border-orange-700 text-neutral-900 font-semibold' : 'border-transparent text-neutral-500 hover:text-neutral-900'
              }`}
            >{t.l}</button>
          ))}
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-5 sm:py-8">
        {/* Filtri capitoli */}
        <div className="mb-8 bg-white border border-neutral-200">
          <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-neutral-500" />
              <span className="text-[11px] uppercase tracking-[0.15em] text-neutral-600 font-semibold">Capitoli attivi</span>
              <span className="text-[11px] text-neutral-500 font-mono">({selectedCapitoli.size}/{capitoliOrdinati.length})</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelectedCapitoli(new Set(capitoliOrdinati))} className="text-[10px] uppercase tracking-wider text-neutral-600 hover:text-neutral-900 underline">Tutti</button>
              <span className="text-neutral-300">·</span>
              <button onClick={() => setSelectedCapitoli(new Set())} className="text-[10px] uppercase tracking-wider text-neutral-600 hover:text-neutral-900 underline">Nessuno</button>
            </div>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {capitoliOrdinati.map(c => (
              <FilterChip key={c} active={selectedCapitoli.has(c)} onClick={() => toggleCapitolo(c)} dot={CAPITOLI_CONFIG[c].color} testId={`filter-capitolo-${c}`}>
                {CAPITOLI_CONFIG[c].label}
              </FilterChip>
            ))}
          </div>
        </div>

        {activeTab === "overview" && (
          <OverviewTab totali={totali} perCapitolo={perCapitolo} matrix={matrix} period={period} />
        )}
        {activeTab === "matrix" && (
          <MatrixTab matrix={matrix} capitoliOrdinati={capitoliOrdinati.filter(c => selectedCapitoli.has(c))}
            onSelectPV={(pv) => { setSelectedPV(pv); setActiveTab("pv"); }} />
        )}
        {activeTab === "driver" && (
          <DriverTab filteredData={filteredData} perCapitolo={perCapitolo} selectedCapitoli={selectedCapitoli} />
        )}
        {activeTab === "pv" && (
          <PvTab listaPV={filteredPVList} searchPV={searchPV} setSearchPV={setSearchPV}
            selectedPV={selectedPV} setSelectedPV={setSelectedPV} data={data} period={period} selectedCapitoli={selectedCapitoli} />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// OVERVIEW
// =============================================================================
function OverviewTab({ totali, perCapitolo, matrix, period }: {
  totali: { imp: number; righe: number; pagati: number; stornati: number; nonAtt: number; contratti: number; pv: number };
  perCapitolo: Array<{ capitolo: CapitoloKey; importo: number; righe: number; contratti: number; config: { label: string; color: string; order: number } }>;
  matrix: Array<{ neg: string; byCap: Record<string, number>; tot: number }>;
  period: string;
}) {
  const TOP_N = Math.min(10, matrix.filter(r => r.tot > 0).length);
  const topPV = matrix.filter(r => r.tot > 0).slice(0, TOP_N);
  const bottomPV = matrix.filter(r => r.tot < 0);

  const positiveTotImp = perCapitolo.filter(c => c.importo > 0).reduce((s, c) => s + c.importo, 0);

  return (
    <div className="space-y-10">
      <div>
        <SectionHead eyebrow={`Period ${period}`} title="Sintesi esecutiva" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Totale maturato" value={fmtEur(totali.imp)} subvalue={`${fmtInt(totali.righe)} righe`} accent="#f97316" icon={TrendingUp} />
          <KpiCard label="Contratti distinti" value={fmtInt(totali.contratti)} subvalue={`${totali.pv} PV attivi`} accent="#8b5cf6" icon={Store} />
          <KpiCard label="Eventi pagati" value={fmtInt(totali.pagati)} subvalue={`${fmtInt(totali.nonAtt)} non attivati`} accent="#10b981" icon={CheckCircle2} />
          <KpiCard label="Eventi stornati" value={fmtInt(totali.stornati)} subvalue={`${fmtPct(totali.stornati, totali.righe)} righe`} accent="#ef4444" icon={TrendingDown} />
        </div>
      </div>

      <div>
        <SectionHead eyebrow="Ripartizione" title="Distribuzione per capitolo" />
        <div className="bg-white border border-neutral-200">
          <div className="p-5">
            <div className="flex h-10 mb-4 overflow-hidden">
              {perCapitolo.filter(c => c.importo > 0).map(c => (
                <div key={c.capitolo}
                  style={{ width: `${(c.importo / Math.max(positiveTotImp, 1)) * 100}%`, background: c.config.color }}
                  className="relative group" title={`${c.config.label}: ${fmtEur(c.importo)}`}>
                  <div className="absolute inset-0 group-hover:bg-white group-hover:bg-opacity-20" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-2 mt-6">
              {perCapitolo.map(c => (
                <div key={c.capitolo} className="flex items-center justify-between py-2 border-b border-neutral-100 gap-2">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <span className="w-2.5 h-2.5 shrink-0" style={{ background: c.config.color }} />
                    <span className="text-sm text-neutral-900 truncate">{c.config.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-mono whitespace-nowrap">{fmtInt(c.righe)} righe</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-mono text-sm font-semibold ${c.importo < 0 ? 'text-red-700' : 'text-neutral-900'}`}>{fmtEur(c.importo)}</div>
                    <div className="text-[10px] text-neutral-500 font-mono">{fmtPct(c.importo, totali.imp)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionHead eyebrow={`Top ${TOP_N}`} title="Migliori PV" />
          <div className="bg-white border border-neutral-200">
            {topPV.map((p, i) => (
              <div key={p.neg} className="px-4 py-2.5 border-b border-neutral-100 last:border-b-0 flex items-center gap-3">
                <span className="text-[10px] font-mono text-neutral-400 w-6">#{i + 1}</span>
                <span className="font-mono text-sm text-neutral-900 flex-1 truncate">{p.neg}</span>
                <span className="font-mono text-sm font-semibold text-neutral-900">{fmtEur(p.tot)}</span>
              </div>
            ))}
            {topPV.length === 0 && <div className="px-4 py-6 text-sm text-neutral-500 text-center">Nessun PV positivo</div>}
          </div>
        </div>

        <div>
          <SectionHead eyebrow="Storni netti" title="PV in negativo" />
          <div className="bg-white border border-neutral-200">
            {bottomPV.map((p) => (
              <div key={p.neg} className="px-4 py-2.5 border-b border-neutral-100 last:border-b-0 flex items-center gap-3 bg-red-50/30">
                <span className="font-mono text-sm text-neutral-900 flex-1 truncate">{p.neg}</span>
                <span className="font-mono text-sm font-semibold text-red-700">{fmtEur(p.tot)}</span>
              </div>
            ))}
            {bottomPV.length === 0 && <div className="px-4 py-6 text-sm text-neutral-500 text-center">Nessun PV in negativo</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MATRIX
// =============================================================================
function MatrixTab({ matrix, capitoliOrdinati, onSelectPV }: {
  matrix: Array<{ neg: string; byCap: Record<string, number>; tot: number }>;
  capitoliOrdinati: CapitoloKey[];
  onSelectPV: (pv: string) => void;
}) {
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const r of matrix) for (const v of Object.values(r.byCap)) if (Math.abs(v) > m) m = Math.abs(v);
    return m;
  }, [matrix]);

  const capitoliTot: Record<string, number> = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of matrix) for (const [c, v] of Object.entries(r.byCap)) t[c] = (t[c] || 0) + v;
    return t;
  }, [matrix]);

  const handleDownload = () => {
    const rows = matrix.map(r => {
      const o: Record<string, unknown> = { Negozio: r.neg };
      for (const c of capitoliOrdinati) o[CAPITOLI_CONFIG[c].label] = r.byCap[c] || 0;
      o.Totale = r.tot;
      return o;
    });
    downloadCSV(`matrice_pv_capitolo_${Date.now()}.csv`, rows);
  };

  return (
    <div>
      <SectionHead eyebrow="Heatmap" title="Matrice Punti Vendita × Capitoli" right={
        <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-export-matrix" className="font-mono uppercase tracking-wider text-xs">
          <Download size={12} className="mr-2" /> Esporta CSV
        </Button>
      } />

      <div className="bg-white border border-neutral-200 overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-neutral-900">
              <th className="text-left px-3 py-2 sticky left-0 bg-white z-10 font-mono text-[10px] uppercase tracking-wider text-neutral-600 w-[140px]">Negozio</th>
              {capitoliOrdinati.map(c => (
                <th key={c} className="px-2 py-2 text-right font-mono text-[9px] uppercase tracking-wider text-neutral-600 whitespace-nowrap">
                  <div className="flex flex-col items-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: CAPITOLI_CONFIG[c].color }} />
                    <span>{CAPITOLI_CONFIG[c].label}</span>
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-neutral-900 bg-neutral-100 whitespace-nowrap border-l-2 border-neutral-900">Totale</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map(r => (
              <tr key={r.neg} className="border-b border-neutral-100 hover:bg-orange-50 cursor-pointer group" onClick={() => onSelectPV(r.neg)} data-testid={`row-matrix-${r.neg}`}>
                <td className="px-3 py-2 sticky left-0 bg-white group-hover:bg-orange-50 font-mono text-neutral-900">
                  <div className="flex items-center justify-between">
                    <span>{r.neg}</span>
                    <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 text-orange-700" />
                  </div>
                </td>
                {capitoliOrdinati.map(c => {
                  const v = r.byCap[c] || 0;
                  const intensity = maxAbs > 0 ? Math.abs(v) / maxAbs : 0;
                  const bg = v > 0
                    ? `rgba(249,115,22,${0.05 + intensity * 0.4})`
                    : v < 0 ? `rgba(239,68,68,${0.1 + intensity * 0.5})` : 'transparent';
                  return (
                    <td key={c} className="px-2 py-2 text-right tabular-nums" style={{ background: bg }}>
                      {v !== 0 ? <span className={v < 0 ? 'text-red-700' : 'text-neutral-900'}>{v.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</span> : <span className="text-neutral-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono font-semibold text-neutral-900 bg-neutral-50 border-l-2 border-neutral-900 tabular-nums">{fmtEur(r.tot)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-neutral-900 bg-neutral-100 font-semibold">
              <td className="px-3 py-2 sticky left-0 bg-neutral-100 font-mono text-[10px] uppercase tracking-wider text-neutral-900">Totale</td>
              {capitoliOrdinati.map(c => (
                <td key={c} className="px-2 py-2 text-right font-mono tabular-nums text-[11px] text-neutral-900">{fmtInt(capitoliTot[c] || 0)}</td>
              ))}
              <td className="px-3 py-2 text-right font-mono font-bold text-neutral-900 border-l-2 border-neutral-900 tabular-nums">
                {fmtEur(Object.values(capitoliTot).reduce((s, v) => s + v, 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-[10px] uppercase tracking-wider text-neutral-500">Clicca su una riga per il dettaglio PV. Intensità colore = importo/max. Rosso = storni.</div>
    </div>
  );
}

// =============================================================================
// DRIVER
// =============================================================================
function DriverTab({ filteredData, perCapitolo, selectedCapitoli }: {
  filteredData: DrmsRow[];
  perCapitolo: Array<{ capitolo: CapitoloKey; importo: number; righe: number; contratti: number; config: { label: string; color: string; order: number } }>;
  selectedCapitoli: Set<CapitoloKey>;
}) {
  const [selectedCap, setSelectedCap] = useState<CapitoloKey | null>(null);

  const capitoloData = useMemo(() => {
    if (!selectedCap) return null;
    const rows = filteredData.filter(r => r.CAPITOLO === selectedCap);
    const perRegola: Record<string, { imp: number; n: number; contr: Set<string> }> = {};
    const perDesc: Record<string, { imp: number; n: number }> = {};
    const perNegozio: Record<string, { imp: number; n: number }> = {};
    const perCompetenza: Record<string, { imp: number; n: number }> = {};
    const perPiano: Record<string, { imp: number; n: number }> = {};
    const perTipoAtt: Record<string, { imp: number; n: number }> = {};
    const contratti = new Set<string>();
    let nonAttivati = 0, stornati = 0, pagati = 0, impPagati = 0, impStornati = 0;

    for (const r of rows) {
      const v = r.IMPORTO_NUM || 0;
      if (r.CODICE_CONTRATTO) contratti.add(r.CODICE_CONTRATTO);

      const k1 = r.REGOLA_DI_CALCOLO || "(n/d)";
      if (!perRegola[k1]) perRegola[k1] = { imp: 0, n: 0, contr: new Set() };
      perRegola[k1].imp += v; perRegola[k1].n += 1;
      if (r.CODICE_CONTRATTO) perRegola[k1].contr.add(r.CODICE_CONTRATTO);

      const k2 = r.DESCRIZIONE_ITEM || "(n/d)";
      if (!perDesc[k2]) perDesc[k2] = { imp: 0, n: 0 };
      perDesc[k2].imp += v; perDesc[k2].n += 1;

      const k3 = r.CODICE_NEGOZIO_COSY || "(n/d)";
      if (!perNegozio[k3]) perNegozio[k3] = { imp: 0, n: 0 };
      perNegozio[k3].imp += v; perNegozio[k3].n += 1;

      const k4 = r.COMPETENZA || "(n/d)";
      if (!perCompetenza[k4]) perCompetenza[k4] = { imp: 0, n: 0 };
      perCompetenza[k4].imp += v; perCompetenza[k4].n += 1;

      if (r.DESCRIZIONE_PIANO_TARIFFARIO) {
        const k5 = r.DESCRIZIONE_PIANO_TARIFFARIO;
        if (!perPiano[k5]) perPiano[k5] = { imp: 0, n: 0 };
        perPiano[k5].imp += v; perPiano[k5].n += 1;
      }

      const k6 = r.TIPO_ATTIVAZIONE || "(n/d)";
      if (!perTipoAtt[k6]) perTipoAtt[k6] = { imp: 0, n: 0 };
      perTipoAtt[k6].imp += v; perTipoAtt[k6].n += 1;

      if (v > 0) { pagati++; impPagati += v; }
      else if (v < 0) { stornati++; impStornati += v; }
      else nonAttivati++;
    }

    const toArrayWithContr = (obj: Record<string, { imp: number; n: number; contr: Set<string> }>) =>
      Object.entries(obj).map(([k, v]) => ({ key: k, imp: v.imp, n: v.n, contratti: v.contr.size })).sort((a, b) => b.imp - a.imp);
    const toArray = (obj: Record<string, { imp: number; n: number }>) =>
      Object.entries(obj).map(([k, v]) => ({ key: k, imp: v.imp, n: v.n })).sort((a, b) => b.imp - a.imp);

    return {
      rows, contratti: contratti.size, pagati, stornati, nonAttivati, impPagati, impStornati,
      perRegola: toArrayWithContr(perRegola), perDesc: toArray(perDesc),
      perNegozio: toArray(perNegozio), perCompetenza: toArray(perCompetenza),
      perPiano: toArray(perPiano).slice(0, 15), perTipoAtt: toArray(perTipoAtt),
    };
  }, [filteredData, selectedCap]);

  const capitoliDisponibili = perCapitolo.filter(c => selectedCapitoli.has(c.capitolo));

  return (
    <div>
      <SectionHead eyebrow="Dettaglio" title="Driver e Capitoli" />
      {!selectedCap ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {capitoliDisponibili.map(c => (
            <button key={c.capitolo} onClick={() => setSelectedCap(c.capitolo)}
              className="bg-white border border-neutral-200 hover:border-neutral-900 p-4 sm:p-5 text-left transition-all group"
              data-testid={`button-driver-capitolo-${c.capitolo}`}>
              <div className="w-1 h-6 mb-3" style={{ background: c.config.color }} />
              <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1">{c.config.label}</div>
              <div className="font-serif text-lg sm:text-2xl text-neutral-900 mb-2 break-words">{fmtEur(c.importo)}</div>
              <div className="text-xs text-neutral-600 flex items-center justify-between">
                <span>{fmtInt(c.contratti)} contr.</span>
                <ChevronRight size={12} className="opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedCap(null)} className="text-xs uppercase tracking-wider text-neutral-500 hover:text-neutral-900 underline" data-testid="button-driver-back">← Tutti i capitoli</button>
              <span className="text-neutral-400">/</span>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2" style={{ background: CAPITOLI_CONFIG[selectedCap].color }} />
                <span className="font-serif text-xl text-neutral-900">{CAPITOLI_CONFIG[selectedCap].label}</span>
              </div>
            </div>
            {capitoloData && (
              <Button variant="outline" size="sm" data-testid="button-driver-export"
                onClick={() => downloadCSV(`${selectedCap}_${Date.now()}.csv`, capitoloData.rows.map(r => ({
                  CODICE_NEGOZIO_COSY: r.CODICE_NEGOZIO_COSY, CODICE_CONTRATTO: r.CODICE_CONTRATTO,
                  COMPETENZA: r.COMPETENZA, TIPO_FONIA: r.TIPO_FONIA, TIPO_ATTIVAZIONE: r.TIPO_ATTIVAZIONE,
                  REGOLA_DI_CALCOLO: r.REGOLA_DI_CALCOLO, DESCRIZIONE_ITEM: r.DESCRIZIONE_ITEM,
                  DESCRIZIONE_PIANO_TARIFFARIO: r.DESCRIZIONE_PIANO_TARIFFARIO, IMPORTO: r.IMPORTO_NUM,
                })))} className="font-mono uppercase tracking-wider text-xs">
                <Download size={12} className="mr-2" /> Esporta righe
              </Button>
            )}
          </div>

          {capitoloData && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
                <KpiCard label="Importo totale" value={fmtEur(capitoloData.rows.reduce((s, r) => s + (r.IMPORTO_NUM || 0), 0))} accent={CAPITOLI_CONFIG[selectedCap].color} />
                <KpiCard label="Contratti" value={fmtInt(capitoloData.contratti)} />
                <KpiCard label="Pagati" value={fmtInt(capitoloData.pagati)} subvalue={fmtEur(capitoloData.impPagati)} accent="#10b981" />
                <KpiCard label="Stornati" value={fmtInt(capitoloData.stornati)} subvalue={fmtEur(capitoloData.impStornati)} accent="#ef4444" />
                <KpiCard label="Non attivati" value={fmtInt(capitoloData.nonAttivati)} accent="#64748b" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <DetailTable title="Regole di calcolo" data={capitoloData.perRegola} showContratti />
                <DetailTable title="Descrizione Item" data={capitoloData.perDesc} />
                <DetailTable title="Per Punto Vendita" data={capitoloData.perNegozio} />
                <DetailTable title="Per Competenza" data={capitoloData.perCompetenza} />
                <DetailTable title="Tipo Attivazione" data={capitoloData.perTipoAtt} />
                {capitoloData.perPiano.length > 0 && <DetailTable title="Top Piani Tariffari" data={capitoloData.perPiano} />}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DetailTable({ title, data, showContratti }: {
  title: string;
  data: Array<{ key: string; imp: number; n: number; contratti?: number }>;
  showContratti?: boolean;
}) {
  const tot = data.reduce((s, r) => s + r.imp, 0);
  return (
    <div className="bg-white border border-neutral-200">
      <div className="px-4 py-3 border-b border-neutral-200">
        <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-600 font-semibold">{title}</div>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <tbody>
            {data.map((r, i) => (
              <tr key={i} className={`border-b border-neutral-100 ${r.imp < 0 ? 'bg-red-50/30' : ''}`}>
                <td className="px-4 py-2 text-neutral-900">
                  <div className="flex items-center gap-2">
                    <span className="truncate max-w-[250px]" title={r.key}>{r.key}</span>
                  </div>
                  {showContratti && r.contratti !== undefined && (
                    <div className="text-[10px] text-neutral-400 font-mono">{r.contratti} contr.</div>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-neutral-500 font-mono text-[10px] whitespace-nowrap">{fmtInt(r.n)}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                  <span className={r.imp < 0 ? 'text-red-700' : 'text-neutral-900'}>{fmtEur(r.imp)}</span>
                  <div className="text-[10px] text-neutral-400">{fmtPct(r.imp, tot)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =============================================================================
// PV TAB
// =============================================================================
function PvTab({ listaPV, searchPV, setSearchPV, selectedPV, setSelectedPV, data, period, selectedCapitoli }: {
  listaPV: Array<{ neg: string; tot: number }>;
  searchPV: string; setSearchPV: (s: string) => void;
  selectedPV: string | null; setSelectedPV: (s: string | null) => void;
  data: DrmsRow[]; period: string; selectedCapitoli: Set<CapitoloKey>;
}) {
  const pvData = useMemo(() => {
    if (!selectedPV) return null;
    const rows = data.filter(r => r.CODICE_NEGOZIO_COSY === selectedPV && selectedCapitoli.has(r.CAPITOLO));
    const byCap: Record<string, { righe: DrmsRow[]; importo: number; contratti: Set<string> }> = {};
    for (const r of rows) {
      const c = r.CAPITOLO;
      if (!byCap[c]) byCap[c] = { righe: [], importo: 0, contratti: new Set() };
      byCap[c].righe.push(r);
      byCap[c].importo += r.IMPORTO_NUM || 0;
      if (r.CODICE_CONTRATTO) byCap[c].contratti.add(r.CODICE_CONTRATTO);
    }
    const tot = rows.reduce((s, r) => s + (r.IMPORTO_NUM || 0), 0);

    let metricheMobile: { nTot: number; nTied: number; nUntied: number; nMnp: number; nMib: number; nPagati: number; nStornati: number; nNonAtt: number; soglia: number } | null = null;
    const mobile = byCap.MOBILE;
    if (mobile) {
      const contrattuali = mobile.righe.filter(r => r.NATURA === 'CONTRATTUALE' && r.DESCRIZIONE_EVENTO === 'Contrattuale Attivazioni Mobile' && r.COMPETENZA === period);
      const seen = new Set<string>(); const dedup: DrmsRow[] = [];
      for (const r of contrattuali) if (r.CODICE_CONTRATTO && !seen.has(r.CODICE_CONTRATTO)) { seen.add(r.CODICE_CONTRATTO); dedup.push(r); }
      const nTied = dedup.filter(r => r.TIPO_ATTIVAZIONE === 'TIED').length;
      const nUntied = dedup.filter(r => r.TIPO_ATTIVAZIONE === 'UNTIED').length;
      const nMnp = dedup.filter(r => r.MNP === 'Y').length;
      const nMib = dedup.filter(r => r.SEGMENTO_CLIENT === 'MIB').length;
      const nPagati = dedup.filter(r => (r.IMPORTO_NUM || 0) > 0).length;
      const nStornati = dedup.filter(r => (r.IMPORTO_NUM || 0) < 0).length;
      const nNonAtt = dedup.filter(r => (r.IMPORTO_NUM || 0) === 0).length;
      const sogliaRighe = data.filter(r => r.CODICE_NEGOZIO_COSY === selectedPV && r.TIPO_FONIA === 'MOBILE' && r.DESCRIZIONE_EVENTO === 'Gara Attivazioni Mobile');
      let maxSoglia = 0;
      for (const r of sogliaRighe) { const s = parseFloat(r.FLAG_SOGLIA_MOBILE); if (!Number.isNaN(s) && s > maxSoglia) maxSoglia = s; }
      metricheMobile = { nTot: dedup.length, nTied, nUntied, nMnp, nMib, nPagati, nStornati, nNonAtt, soglia: maxSoglia };
    }

    let metricheFisso: { nTot: number; nFtth: number; nFwa: number; nLna: number; nLa: number; nMib: number; nConv: number; soglia: number } | null = null;
    const fisso = byCap.FISSO;
    if (fisso) {
      const contrattuali = fisso.righe.filter(r => r.NATURA === 'CONTRATTUALE' && r.DESCRIZIONE_EVENTO === 'Attivazione Fonia Fissa GA' && r.COMPETENZA === period);
      const seen = new Set<string>(); const dedup: DrmsRow[] = [];
      for (const r of contrattuali) if (r.CODICE_CONTRATTO && !seen.has(r.CODICE_CONTRATTO)) { seen.add(r.CODICE_CONTRATTO); dedup.push(r); }
      const nFtth = dedup.filter(r => r.TIPO_ACCESSO && /FTTH/i.test(r.TIPO_ACCESSO)).length;
      const nFwa = dedup.filter(r => r.TIPO_ACCESSO && /FWA/i.test(r.TIPO_ACCESSO)).length;
      const nLna = dedup.filter(r => r.TIPO_LINEA === 'LNA').length;
      const nLa = dedup.filter(r => r.TIPO_LINEA === 'LA').length;
      const nMib = dedup.filter(r => r.SEGMENTO_CLIENT === 'MIB').length;
      const nConv = dedup.filter(r => r.FLAG_CONVERGENZA === 'Y').length;
      const sogliaRighe = data.filter(r => r.CODICE_NEGOZIO_COSY === selectedPV && r.TIPO_FONIA === 'FISSO' && r.DESCRIZIONE_EVENTO === 'Gara Attivazioni Fisso');
      let maxSoglia = 0;
      for (const r of sogliaRighe) { const s = parseFloat(r.FLAG_SOGLIA_FISSA); if (!Number.isNaN(s) && s > maxSoglia) maxSoglia = s; }
      metricheFisso = { nTot: dedup.length, nFtth, nFwa, nLna, nLa, nMib, nConv, soglia: maxSoglia };
    }

    return { rows, byCap, tot, metricheMobile, metricheFisso };
  }, [selectedPV, data, period, selectedCapitoli]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <div>
        <SectionHead eyebrow="Elenco" title="Negozi" />
        <div className="bg-white border border-neutral-200">
          <div className="p-3 border-b border-neutral-200">
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input type="text" value={searchPV} onChange={(e) => setSearchPV(e.target.value)} placeholder="Cerca codice PV…"
                data-testid="input-pv-search"
                className="w-full pl-8 pr-8 py-2 text-xs border border-neutral-200 focus:outline-none focus:border-neutral-900 font-mono" />
              {searchPV && (
                <button onClick={() => setSearchPV("")} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={12} className="text-neutral-400" /></button>
              )}
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {listaPV.map(pv => (
              <button key={pv.neg} onClick={() => setSelectedPV(pv.neg)} data-testid={`button-pv-${pv.neg}`}
                className={`w-full text-left px-3 py-2.5 border-b border-neutral-100 transition-colors ${
                  selectedPV === pv.neg ? 'bg-orange-50 border-l-2 border-l-orange-700' : 'hover:bg-neutral-50'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-neutral-900">{pv.neg}</span>
                  <span className={`text-xs font-mono tabular-nums ${pv.tot < 0 ? 'text-red-700' : 'text-neutral-600'}`}>
                    {Math.abs(pv.tot) >= 1000 ? `${(pv.tot/1000).toFixed(1)}k` : Math.round(pv.tot)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        {!selectedPV ? (
          <div className="bg-white border border-neutral-200 p-16 text-center">
            <Store size={48} strokeWidth={1} className="mx-auto mb-4 text-neutral-300" />
            <div className="font-serif text-2xl text-neutral-400">Seleziona un punto vendita</div>
            <div className="text-sm text-neutral-500 mt-2">Scegli dall'elenco per vedere il prospetto dettagliato</div>
          </div>
        ) : pvData && (
          <div className="space-y-6">
            <div className="bg-white border border-neutral-200 p-6">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 mb-1">Punto Vendita</div>
                  <div className="font-mono text-2xl text-neutral-900 font-semibold">{selectedPV}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 mb-1">Totale maturato</div>
                  <div className={`font-serif text-3xl ${pvData.tot < 0 ? 'text-red-700' : 'text-neutral-900'}`}>{fmtEur(pvData.tot)}</div>
                </div>
              </div>
            </div>

            {pvData.metricheMobile && (
              <div>
                <SectionHead eyebrow="Driver" title="Mobile" />
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  <MetricBox label="Importo" value={fmtEur(pvData.byCap.MOBILE?.importo || 0)} highlight />
                  <MetricBox label="Tot contratti" value={pvData.metricheMobile.nTot} />
                  <MetricBox label="Pagati" value={pvData.metricheMobile.nPagati} tone="ok" />
                  <MetricBox label="Stornati" value={pvData.metricheMobile.nStornati} tone="ko" />
                  <MetricBox label="Non att." value={pvData.metricheMobile.nNonAtt} tone="warn" />
                  <MetricBox label="Tied / Untied" value={`${pvData.metricheMobile.nTied} / ${pvData.metricheMobile.nUntied}`} />
                  <MetricBox label="MNP" value={pvData.metricheMobile.nMnp} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  <MetricBox label="P.Iva (MIB)" value={pvData.metricheMobile.nMib} />
                  <MetricBox label="Soglia" value={pvData.metricheMobile.soglia > 0 ? `S${pvData.metricheMobile.soglia}` : 'nessuna'}
                    highlight={pvData.metricheMobile.soglia >= 2} tone={pvData.metricheMobile.soglia >= 2 ? 'ok' : 'warn'} />
                </div>
              </div>
            )}

            {pvData.metricheFisso && (
              <div>
                <SectionHead eyebrow="Driver" title="Fisso" />
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  <MetricBox label="Importo" value={fmtEur(pvData.byCap.FISSO?.importo || 0)} highlight />
                  <MetricBox label="Tot contratti" value={pvData.metricheFisso.nTot} />
                  <MetricBox label="FTTH" value={pvData.metricheFisso.nFtth} />
                  <MetricBox label="FWA" value={pvData.metricheFisso.nFwa} />
                  <MetricBox label="LNA / LA" value={`${pvData.metricheFisso.nLna} / ${pvData.metricheFisso.nLa}`} />
                  <MetricBox label="Convergenti" value={pvData.metricheFisso.nConv} />
                  <MetricBox label="Soglia" value={pvData.metricheFisso.soglia > 0 ? `S${pvData.metricheFisso.soglia}` : 'nessuna'}
                    highlight={pvData.metricheFisso.soglia >= 2} tone={pvData.metricheFisso.soglia >= 2 ? 'ok' : 'warn'} />
                </div>
              </div>
            )}

            <div>
              <SectionHead eyebrow="Ripartizione" title="Importo per Capitolo" />
              <div className="bg-white border border-neutral-200">
                {Object.entries(pvData.byCap)
                  .sort((a, b) => b[1].importo - a[1].importo)
                  .map(([cap, d]) => (
                    <div key={cap} className="px-5 py-3 border-b border-neutral-100 last:border-b-0 flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-2 h-2 shrink-0" style={{ background: CAPITOLI_CONFIG[cap as CapitoloKey]?.color || '#888' }} />
                        <span className="text-sm text-neutral-900">{CAPITOLI_CONFIG[cap as CapitoloKey]?.label || cap}</span>
                        <span className="text-[10px] uppercase text-neutral-400 font-mono">{d.contratti.size} contr.</span>
                      </div>
                      <span className={`font-mono text-sm font-semibold ${d.importo < 0 ? 'text-red-700' : 'text-neutral-900'}`}>{fmtEur(d.importo)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// PAGINA PRINCIPALE
// =============================================================================
interface PendingPreview {
  fileName: string;
  month: number;
  year: number;
  period: string;
  totale: number;
  righeCount: number;
  rows: DrmsRow[];
  capitoliCount: Array<{ key: CapitoloKey; label: string; color: string; count: number; importo: number }>;
  altroCount: number;
  hasConflict: boolean;
}

export default function DrmsCommissioning() {
  const { profile, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isAuthorized = !!profile && ["admin", "super_admin"].includes(profile.role);

  const [parsedData, setParsedData] = useState<DrmsRow[] | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);

  useEffect(() => {
    if (!authLoading && profile && !isAuthorized) {
      toast({ title: "Accesso non autorizzato", description: "Solo amministratori possono accedere a questa pagina.", variant: "destructive" });
      setLocation("/");
    }
  }, [authLoading, profile, isAuthorized, toast, setLocation]);

  const { data: savedList = [] } = useQuery<DrmsListItem[]>({
    queryKey: ["/api/drms"],
    enabled: isAuthorized,
  });

  const uploadMutation = useMutation({
    mutationFn: async (payload: {
      fileName: string; month: number; year: number; period: string;
      totaleImporto: number; righeCount: number; rows: DrmsRow[]; overwrite?: boolean;
    }) => {
      const res = await fetch(apiUrl("/api/drms"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const body = await res.json();
        throw new Error(`__CONFLICT__:${body.message || 'conflict'}`);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Errore salvataggio DRMS");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drms"] });
      toast({ title: "DRMS salvato", description: "L'upload è stato salvato con successo." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(apiUrl(`/api/drms/${id}`), { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Errore eliminazione");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drms"] });
      toast({ title: "DRMS eliminato" });
    },
  });

  const handleFileChosen = useCallback(async (file: File) => {
    setParseLoading(true); setParseError(null); setPendingPreview(null);
    try {
      const rawRows = await parseExcelFile(file);
      if (rawRows.length === 0) throw new Error("Il file non contiene righe leggibili");
      const detectedPeriod = detectPeriod(rawRows);
      if (!detectedPeriod) throw new Error("Impossibile determinare il periodo (campo COMPETENZA mancante)");
      const my = parsePeriodToMonthYear(detectedPeriod);
      if (!my) throw new Error(`Formato periodo non riconosciuto: "${detectedPeriod}". Atteso es. "MAR-26".`);
      const normalized = classifyAndNormalize(rawRows, detectedPeriod);
      const totale = normalized.reduce((s, r) => s + (r.IMPORTO_NUM || 0), 0);

      const counts = new Map<CapitoloKey, { count: number; importo: number }>();
      for (const r of normalized) {
        const c = counts.get(r.CAPITOLO) || { count: 0, importo: 0 };
        c.count += 1; c.importo += r.IMPORTO_NUM || 0;
        counts.set(r.CAPITOLO, c);
      }
      const capitoliCount = (Object.entries(CAPITOLI_CONFIG) as [CapitoloKey, typeof CAPITOLI_CONFIG[CapitoloKey]][])
        .map(([key, cfg]) => {
          const v = counts.get(key) || { count: 0, importo: 0 };
          return { key, label: cfg.label, color: cfg.color, count: v.count, importo: v.importo };
        })
        .filter(c => c.count > 0)
        .sort((a, b) => Math.abs(b.importo) - Math.abs(a.importo));
      const altroCount = counts.get("ALTRO")?.count || 0;

      const existingRes = await fetch(apiUrl(`/api/drms/by-period?month=${my.month}&year=${my.year}`), { credentials: "include" });
      const existing = existingRes.ok ? await existingRes.json() : null;

      setPendingPreview({
        fileName: file.name, month: my.month, year: my.year, period: detectedPeriod,
        totale, righeCount: normalized.length, rows: normalized,
        capitoliCount, altroCount, hasConflict: !!existing,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setParseError(msg);
      toast({ title: "Errore caricamento", description: msg, variant: "destructive" });
    } finally {
      setParseLoading(false);
    }
  }, [toast]);

  const handleConfirmSave = useCallback(async (overwrite: boolean) => {
    if (!pendingPreview) return;
    const p = pendingPreview;
    try {
      await uploadMutation.mutateAsync({
        fileName: p.fileName, month: p.month, year: p.year, period: p.period,
        totaleImporto: p.totale, righeCount: p.righeCount, rows: p.rows, overwrite,
      });
      setParsedData(p.rows);
      setPeriod(p.period);
      setFileName(p.fileName);
      setPendingPreview(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("__CONFLICT__:")) {
        const ok = window.confirm(`Esiste già un DRMS per ${MONTH_LABELS[p.month - 1]} ${p.year}. Sovrascriverlo con il nuovo file?`);
        if (ok) return handleConfirmSave(true);
        return;
      }
      toast({ title: "Errore salvataggio", description: msg, variant: "destructive" });
    }
  }, [pendingPreview, uploadMutation, toast]);

  const handleCancelPreview = useCallback(() => {
    setPendingPreview(null);
    setParseError(null);
  }, []);

  const handleLoadSaved = useCallback(async (id: string) => {
    setParseLoading(true); setParseError(null);
    try {
      const res = await fetch(apiUrl(`/api/drms/${id}`), { credentials: "include" });
      if (!res.ok) throw new Error("Errore caricamento DRMS salvato");
      const upload: DrmsUploadFull = await res.json();
      setParsedData(upload.rows);
      setPeriod(upload.period);
      setFileName(upload.fileName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setParseError(msg);
      toast({ title: "Errore", description: msg, variant: "destructive" });
    } finally {
      setParseLoading(false);
    }
  }, [toast]);

  const handleDeleteSaved = useCallback(async (id: string) => {
    if (!window.confirm("Eliminare definitivamente questo DRMS?")) return;
    try { await deleteMutation.mutateAsync(id); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Errore", description: msg, variant: "destructive" });
    }
  }, [deleteMutation, toast]);

  const handleReset = () => { setParsedData(null); setPeriod(""); setFileName(""); };

  if (authLoading || !profile) {
    return (
      <>
        <AppNavbar title="DRMS Commissioning" />
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </>
    );
  }

  if (!isAuthorized) return null;

  return (
    <>
      <AppNavbar title="DRMS Commissioning" />
      {parsedData ? (
        <Dashboard data={parsedData} period={period} fileName={fileName} onReset={handleReset} />
      ) : (
        <div className="bg-[#faf8f4] min-h-[calc(100vh-60px)]">
          <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-neutral-200 rounded-full text-[10px] uppercase tracking-[0.2em] text-neutral-700 font-medium mb-4">
                <span className="w-1 h-1 bg-orange-600 rounded-full" /> Analisi DRMS · W3 Incentivazione
              </div>
              <h1 className="font-serif text-4xl sm:text-5xl text-neutral-900 leading-tight tracking-tight">
                Dashboard <span className="italic" style={{ background: "linear-gradient(135deg, #ea580c 0%, #f97316 50%, #fb923c 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Commissioning</span>
              </h1>
              <p className="mt-4 text-neutral-700 max-w-2xl leading-relaxed">
                Carica un file DRMS Excel per generare il prospetto dettagliato per capitolo, PV, soglie e driver.
                Verifica i dati nell'anteprima prima di salvarli sul database (per organizzazione e mese).
              </p>
            </div>
            {pendingPreview ? (
              <PreviewCard
                preview={pendingPreview}
                saving={uploadMutation.isPending}
                onConfirm={() => handleConfirmSave(pendingPreview.hasConflict)}
                onCancel={handleCancelPreview}
              />
            ) : (
              <UploadCard
                loading={parseLoading || uploadMutation.isPending}
                error={parseError}
                onFileChosen={handleFileChosen}
                savedList={savedList}
                onLoadSaved={handleLoadSaved}
                onDeleteSaved={handleDeleteSaved}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
