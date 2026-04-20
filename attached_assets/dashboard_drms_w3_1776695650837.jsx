import React, { useState, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { Upload, Download, AlertCircle, CheckCircle2, TrendingUp, TrendingDown, Store, FileSpreadsheet, Filter, BarChart3, Search, X, ChevronRight, Target, Activity } from "lucide-react";

// =============================================================================
// CONFIGURAZIONE CAPITOLI (tassonomia validata nell'analisi)
// =============================================================================
const CAPITOLI_CONFIG = {
  ENERGIA: { label: "Energia", color: "#10b981", order: 1 },
  MOBILE: { label: "Mobile", color: "#f97316", order: 2 },
  FISSO: { label: "Fisso", color: "#3b82f6", order: 3 },
  PARTNERSHIP_REWARD: { label: "Partnership Reward", color: "#8b5cf6", order: 4 },
  CB: { label: "Customer Base", color: "#ec4899", order: 5 },
  PR_ASSICURAZIONI: { label: "PR Assicurazioni", color: "#a855f7", order: 6 },
  EXTRA_PR_ENERGIA: { label: "Extra PR Energia", color: "#06b6d4", order: 7 },
  ASSICURAZIONI: { label: "Assicurazioni", color: "#eab308", order: 8 },
  RELOAD: { label: "Reload", color: "#ef4444", order: 9 },
  SOS_CARING: { label: "SOS Caring", color: "#f59e0b", order: 10 },
  PR_RELOAD: { label: "PR Reload", color: "#dc2626", order: 11 },
  PINPAD: { label: "Pinpad", color: "#64748b", order: 12 },
  ASSISTENZA_TECNICA: { label: "Ass. Tecnica", color: "#94a3b8", order: 13 },
  ALTRO: { label: "Altro (non classificato)", color: "#fde047", order: 99 },
};

// =============================================================================
// REGOLE DI CLASSIFICAZIONE (replicano la logica Python validata)
// =============================================================================
const REGOLE_RELOAD = [
  "Gara Reload", "Gara Reload Furto", "Gara Reload Forever",
  "Gara Reload Plus", "Gara Reload Plus Furto", "Gara Reload Exchange",
  "Gara Customer Base per Reload Plus",
  "Gara Customer Base per Reload Plus Furto",
  "Gara Customer Base per Reload Exchange",
];
const REGOLE_PR_CB = [
  "Gara Partnership Reward Customer Base Mobile Tied",
  "Gara Partnership Reward Customer Base Mobile Untied",
  "Gara Partnership Reward Customer Base Fisso",
];
const REGOLE_PR_RELOAD = [
  "Gara Partnership Reward Reload Forever",
  "Gara Partnership Reward Reload Furto",
  "Gara Partnership Reward Reload Plus Furto",
];
const REGOLE_SOS = ["Partnership Reward CB SOS Tied", "Partnership Reward CB SOS Unt"];
const REGOLA_PC_ADJ = "PC ADJUSTMENT MANUALI  26";

function classificaRiga(row, PERIOD_COMP) {
  const regola = row.REGOLA_DI_CALCOLO || "";
  const desc = row.DESCRIZIONE_ITEM || "";
  const fonia = row.TIPO_FONIA || "";
  const attivazione = row.TIPO_ATTIVAZIONE || "";
  const comp = row.COMPETENZA || "";
  const isPR = /Partnership Reward/i.test(regola);

  // Assistenza Tecnica
  if (attivazione === "ASSTTCN") return "ASSISTENZA_TECNICA";

  // PR Reload
  if (REGOLE_PR_RELOAD.includes(regola)) return "PR_RELOAD";
  // PR Assicurazioni
  if (regola === "Gara Partnership Reward Insurance") return "PR_ASSICURAZIONI";
  // SOS Caring
  if (REGOLE_SOS.includes(regola)) return "SOS_CARING";

  // PC Adjustment — dispatch per descrizione item
  // IMPORTANT: usiamo pattern regex perché i nomi contengono date/mesi che cambiano ogni DRMS
  if (regola === REGOLA_PC_ADJ) {
    if (/Convergenza Fisso Energy/i.test(desc)) return "ENERGIA";
    // Storni Energia retroattivi: "Contrattuale Attivato Luce/Gas 202XYY" o "Gara Attivato Luce/Gas 202XYY"
    if (/Attivato\s+(Luce|Gas)\s*\d{6}/i.test(desc)) return "ENERGIA";
    // Extra Cluster 3: "Extra Cluster3 Gen26", "Extra Cluster3 Feb26", ecc. → split per TIPO_FONIA
    if (/Extra\s*Cluster\s*3/i.test(desc)) return fonia;
    // Gara CB Per Evento Mobile Tied (stessa stringa, no data)
    if (/Gara\s*CB\s*Per\s*Evento\s*Mobile\s*Tied/i.test(desc)) return "CB";
    // Cliente già contrattualizzato: pattern con qualsiasi data 202XYY
    if (/Cliente\s+gia\s+contrattualizzato\s*\d{6}/i.test(desc)) return "FISSO";
    // Promo Reload: "Reload Extra Promo Gennaio 2026", "RELOAD PLUS Promo Marzo 2026", ecc.
    if (/Reload\s+(Extra|PLUS)\s+Promo/i.test(desc)) return "RELOAD";
    // Pinpad: "Pinpad202602", "Pinpad202603", ecc.
    if (/Pinpad\s*\d{0,6}/i.test(desc)) return "PINPAD";
    return null;
  }

  // Partnership Reward CB Mobile/Fisso
  if (isPR && REGOLE_PR_CB.includes(regola)) {
    return comp === PERIOD_COMP ? "PARTNERSHIP_REWARD" : "EXTRA_PR_ENERGIA";
  }
  // Top Partnership Reward Mobile (tracking 0 €)
  if (regola === "Gara Top Partnership Reward Mobile Tied" ||
      regola === "Gara Top Partnership Reward Mobile Untied") return "PARTNERSHIP_REWARD";

  // Reload (9 regole)
  if (REGOLE_RELOAD.includes(regola)) return "RELOAD";

  // CB puro (TIPO_ATTIVAZIONE=CB, Mobile/Fisso, no Partnership Reward)
  if (attivazione === "CB" && (fonia === "MOBILE" || fonia === "FISSO") && !isPR) return "CB";

  // Energia
  if (fonia === "ENERGIA") return "ENERGIA";
  // Assicurazioni
  if (fonia === "ASSICURAZIONI") return "ASSICURAZIONI";
  // Fisso
  if (fonia === "FISSO" && attivazione === "FISSA") return "FISSO";
  // Mobile
  if (fonia === "MOBILE" && (attivazione === "TIED" || attivazione === "UNTIED")) return "MOBILE";

  return null;
}

// =============================================================================
// PARSING EXCEL
// =============================================================================
async function parseExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames.includes("Estratto conto") ? "Estratto conto" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  return rows;
}

// =============================================================================
// UTILITÀ FORMATTAZIONE
// =============================================================================
const fmtEur = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency", currency: "EUR", maximumFractionDigits: 2
  }).format(v);
};
const fmtInt = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT").format(Math.round(v));
};
const fmtPct = (v, tot) => (tot > 0 ? `${((v / tot) * 100).toFixed(1)}%` : "—");

function downloadCSV(filename, rows) {
  if (!rows || rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(";"),
    ...rows.map(r => keys.map(k => {
      const v = r[k];
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return /[";\n]/.test(s) ? `"${s}"` : s;
    }).join(";"))
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// =============================================================================
// COMPONENTI UI
// =============================================================================
const KpiCard = ({ label, value, subvalue, accent, icon: Icon, trend }) => (
  <div className="relative overflow-hidden border border-neutral-200 bg-white">
    <div className="absolute top-0 left-0 w-1 h-full" style={{ background: accent }}></div>
    <div className="px-5 py-4">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 font-medium">{label}</div>
        {Icon && <Icon size={14} strokeWidth={1.5} className="text-neutral-400" />}
      </div>
      <div className="font-serif text-2xl text-neutral-900 leading-tight">{value}</div>
      {subvalue && <div className="text-xs text-neutral-600 mt-1.5 font-mono">{subvalue}</div>}
      {trend !== undefined && (
        <div className={`text-xs mt-2 flex items-center gap-1 font-mono ${trend >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {trend >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
          {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
        </div>
      )}
    </div>
  </div>
);

const SectionHead = ({ eyebrow, title, right }) => (
  <div className="flex items-end justify-between mb-5 pb-3 border-b-2 border-neutral-900">
    <div>
      {eyebrow && <div className="text-[10px] uppercase tracking-[0.22em] text-neutral-500 mb-1">{eyebrow}</div>}
      <h2 className="font-serif text-2xl text-neutral-900">{title}</h2>
    </div>
    {right}
  </div>
);

const FilterChip = ({ active, onClick, children, dot }) => (
  <button
    onClick={onClick}
    className={`
      px-3 py-1.5 text-xs font-mono tracking-wide uppercase border transition-all
      flex items-center gap-2
      ${active
        ? 'bg-neutral-900 text-white border-neutral-900'
        : 'bg-white text-neutral-600 border-neutral-300 hover:border-neutral-900 hover:text-neutral-900'}
    `}
  >
    {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }}></span>}
    {children}
  </button>
);

// =============================================================================
// LANDING / UPLOAD SCREEN
// =============================================================================
const LandingScreen = ({ onFileLoaded, loading, error }) => {
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (f) => {
    if (!f) return;
    onFileLoaded(f);
  };

  return (
    <div className="min-h-screen relative overflow-hidden" style={{
      background: "linear-gradient(180deg, #fefbf5 0%, #faf3e8 100%)"
    }}>
      {/* Blob colorati sfumati - decorazione di sfondo */}
      <div className="absolute top-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full pointer-events-none z-0"
        style={{
          background: "radial-gradient(circle at 30% 30%, rgba(249,115,22,0.35), rgba(249,115,22,0) 65%)",
          filter: "blur(40px)"
        }}></div>
      <div className="absolute bottom-[-15%] left-[-10%] w-[60vw] h-[60vw] rounded-full pointer-events-none z-0"
        style={{
          background: "radial-gradient(circle at 70% 70%, rgba(251,146,60,0.22), rgba(251,146,60,0) 65%)",
          filter: "blur(50px)"
        }}></div>
      <div className="absolute top-[40%] left-[30%] w-[30vw] h-[30vw] rounded-full pointer-events-none z-0"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(234,88,12,0.12), rgba(234,88,12,0) 65%)",
          filter: "blur(60px)"
        }}></div>

      {/* Grana sottile per texture - MOLTO leggera */}
      <div className="absolute inset-0 opacity-[0.15] pointer-events-none z-0 mix-blend-multiply hidden sm:block"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.08'/%3E%3C/svg%3E\")"
        }}></div>

      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-14 pb-16">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-12 sm:mb-20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-neutral-900 flex items-center justify-center">
              <span className="font-serif italic text-white text-lg leading-none">w3</span>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-neutral-600 font-medium">B2C Sales</div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-neutral-500">Commissioning</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-neutral-500">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
            <span>Sistema operativo</span>
          </div>
        </div>

        {/* Hero */}
        <div className="mb-10 sm:mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/60 backdrop-blur border border-neutral-200 rounded-full text-[10px] uppercase tracking-[0.2em] text-neutral-700 font-medium mb-6">
            <span className="w-1 h-1 bg-orange-600 rounded-full"></span>
            Analisi DRMS · W3 Incentivazione
          </div>
          <h1 className="font-serif text-5xl sm:text-7xl lg:text-8xl text-neutral-900 leading-[0.9] tracking-tight">
            Dashboard
            <br/>
            <span className="italic" style={{
              background: "linear-gradient(135deg, #ea580c 0%, #f97316 50%, #fb923c 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text"
            }}>Commissioning</span>
          </h1>
          <p className="mt-8 text-neutral-700 max-w-2xl leading-relaxed text-base sm:text-lg">
            Strumento di analisi delle performance di incentivazione del canale Franchising WindTre.
            Carica un file DRMS Excel per generare il prospetto dettagliato di flussi di cassa,
            competenze, raggiungimento soglie e coerenza erogato/previsto.
          </p>
        </div>

        {/* Upload card - glassmorphism */}
        <div className="relative group">
          {/* Glow effect */}
          <div className="absolute -inset-0.5 rounded-2xl opacity-0 group-hover:opacity-40 transition-opacity duration-500 pointer-events-none"
            style={{
              background: "linear-gradient(135deg, #f97316, #fb923c, #ea580c)",
              filter: "blur(12px)"
            }}></div>

          <label
            htmlFor="file-input"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            className={`
              relative block bg-white/70 backdrop-blur-xl border-2 rounded-2xl
              transition-all duration-300 cursor-pointer overflow-hidden
              ${dragOver
                ? 'border-orange-600 bg-orange-50/80 scale-[1.01]'
                : 'border-neutral-300/60 hover:border-orange-500/60 hover:shadow-xl hover:shadow-orange-500/10'}
            `}
          >
            <input
              type="file"
              id="file-input"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => handleFile(e.target.files[0])}
              disabled={loading}
              style={{
                position: 'absolute',
                width: '1px',
                height: '1px',
                padding: 0,
                margin: '-1px',
                overflow: 'hidden',
                clip: 'rect(0,0,0,0)',
                whiteSpace: 'nowrap',
                border: 0
              }}
            />

            <div className="relative p-8 sm:p-14 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl mb-6"
                style={{
                  background: loading
                    ? "linear-gradient(135deg, #fed7aa, #fdba74)"
                    : "linear-gradient(135deg, #fff7ed, #ffedd5)",
                  border: "1px solid #fed7aa"
                }}>
                {loading ? (
                  <div className="w-8 h-8 border-3 border-orange-600 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Upload size={32} strokeWidth={1.5} className="text-orange-700"/>
                )}
              </div>

              <div className="font-serif text-2xl sm:text-3xl text-neutral-900 mb-2 tracking-tight">
                {loading ? "Elaborazione del DRMS…" : "Carica il file DRMS"}
              </div>
              <div className="text-sm text-neutral-600 mb-6">
                {loading ? "Classificazione in corso, attendi qualche secondo" : (
                  <>
                    Trascina il file <span className="font-mono text-neutral-900 px-1.5 py-0.5 bg-neutral-100 rounded text-xs">.xlsx</span> oppure
                    <span className="text-orange-700 font-semibold underline decoration-dotted underline-offset-4 ml-1">clicca qui</span>
                  </>
                )}
              </div>

              {!loading && (
                <div className="flex items-center justify-center gap-6 text-[10px] uppercase tracking-[0.15em] text-neutral-500">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={11} className="text-emerald-600"/>
                    Parsing locale
                  </span>
                  <span className="w-1 h-1 bg-neutral-300 rounded-full"></span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={11} className="text-emerald-600"/>
                    13 capitoli
                  </span>
                  <span className="w-1 h-1 bg-neutral-300 rounded-full hidden sm:block"></span>
                  <span className="hidden sm:flex items-center gap-1.5">
                    <CheckCircle2 size={11} className="text-emerald-600"/>
                    Quadratura al ¢
                  </span>
                </div>
              )}

              {error && (
                <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={14}/> {error}
                </div>
              )}
            </div>
          </label>
        </div>

        {/* Feature cards - nuovo layout */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12 sm:mt-16">
          {[
            {
              icon: BarChart3,
              title: "13 Capitoli",
              desc: "Mobile, Fisso, Energia, Assicurazioni, CB, Partnership Reward, Reload, extra e storni.",
              accent: "#f97316"
            },
            {
              icon: Target,
              title: "Quadratura al ¢",
              desc: "Verifica automatica: somma capitoli = totale DRMS. Tracciamento completo degli storni retroattivi.",
              accent: "#8b5cf6"
            },
            {
              icon: Activity,
              title: "Soglie & Performance",
              desc: "Driver per PV, raggiungimento soglie, dettaglio per regola di calcolo e piano tariffario.",
              accent: "#10b981"
            },
          ].map((it, i) => (
            <div key={i}
              className="group relative bg-white/60 backdrop-blur border border-neutral-200/70 rounded-xl p-5 hover:bg-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-neutral-900/5">
              <div className="absolute top-0 left-5 right-5 h-0.5 rounded-b-full" style={{ background: it.accent }}></div>
              <div className="flex items-start gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${it.accent}15` }}>
                  <it.icon size={16} strokeWidth={1.8} style={{ color: it.accent }}/>
                </div>
                <div className="font-serif text-lg text-neutral-900 leading-tight pt-1">{it.title}</div>
              </div>
              <div className="text-xs text-neutral-600 leading-relaxed">{it.desc}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-16 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-neutral-400">
          <span>© 2026 · Uso interno</span>
          <span>Aprile 2026 · v1.0</span>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// DASHBOARD PRINCIPALE
// =============================================================================
const Dashboard = ({ data, period, fileName, onReset }) => {
  const [selectedCapitoli, setSelectedCapitoli] = useState(new Set(Object.keys(CAPITOLI_CONFIG)));
  const [selectedPV, setSelectedPV] = useState(null);
  const [searchPV, setSearchPV] = useState("");
  const [activeTab, setActiveTab] = useState("overview"); // overview, matrix, driver

  // Lista PV ordinata per totale
  const listaPV = useMemo(() => {
    const map = new Map();
    for (const r of data) {
      const neg = r.CODICE_NEGOZIO_COSY;
      if (!neg) continue;
      map.set(neg, (map.get(neg) || 0) + (r.IMPORTO_NUM || 0));
    }
    return Array.from(map.entries())
      .map(([neg, tot]) => ({ neg, tot }))
      .sort((a, b) => b.tot - a.tot);
  }, [data]);

  const filteredPVList = useMemo(() => {
    if (!searchPV) return listaPV;
    return listaPV.filter(p => p.neg.includes(searchPV));
  }, [listaPV, searchPV]);

  // Dati filtrati (capitoli + PV)
  const filteredData = useMemo(() => {
    return data.filter(r =>
      selectedCapitoli.has(r.CAPITOLO) &&
      (selectedPV === null || r.CODICE_NEGOZIO_COSY === selectedPV)
    );
  }, [data, selectedCapitoli, selectedPV]);

  // Aggregati per capitolo
  const perCapitolo = useMemo(() => {
    const map = {};
    for (const r of filteredData) {
      const c = r.CAPITOLO;
      if (!map[c]) map[c] = { importo: 0, righe: 0, contratti: new Set() };
      map[c].importo += r.IMPORTO_NUM || 0;
      map[c].righe += 1;
      if (r.CODICE_CONTRATTO) map[c].contratti.add(r.CODICE_CONTRATTO);
    }
    return Object.entries(map)
      .map(([c, v]) => ({
        capitolo: c,
        importo: v.importo,
        righe: v.righe,
        contratti: v.contratti.size,
        config: CAPITOLI_CONFIG[c] || { label: c, color: "#888" },
      }))
      .sort((a, b) => (a.config.order || 99) - (b.config.order || 99));
  }, [filteredData]);

  const totali = useMemo(() => {
    let imp = 0, righe = 0, pagati = 0, stornati = 0, nonAtt = 0;
    const contrSet = new Set();
    const pvSet = new Set();
    for (const r of filteredData) {
      const v = r.IMPORTO_NUM || 0;
      imp += v;
      righe += 1;
      if (r.CODICE_CONTRATTO) contrSet.add(r.CODICE_CONTRATTO);
      if (r.CODICE_NEGOZIO_COSY) pvSet.add(r.CODICE_NEGOZIO_COSY);
      if (v > 0) pagati++;
      else if (v < 0) stornati++;
      else nonAtt++;
    }
    return { imp, righe, pagati, stornati, nonAtt, contratti: contrSet.size, pv: pvSet.size };
  }, [filteredData]);

  // Matrice PV × capitolo
  const matrix = useMemo(() => {
    const map = {};
    for (const r of filteredData) {
      const neg = r.CODICE_NEGOZIO_COSY;
      const c = r.CAPITOLO;
      if (!neg || !c) continue;
      if (!map[neg]) map[neg] = {};
      map[neg][c] = (map[neg][c] || 0) + (r.IMPORTO_NUM || 0);
    }
    const rows = Object.entries(map).map(([neg, byCap]) => {
      const tot = Object.values(byCap).reduce((s, v) => s + v, 0);
      return { neg, byCap, tot };
    });
    return rows.sort((a, b) => b.tot - a.tot);
  }, [filteredData]);

  const capitoliOrdinati = useMemo(() => {
    return Object.entries(CAPITOLI_CONFIG)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([k]) => k);
  }, []);

  const toggleCapitolo = (c) => {
    const s = new Set(selectedCapitoli);
    if (s.has(c)) s.delete(c); else s.add(c);
    setSelectedCapitoli(s);
  };
  const selectAllCapitoli = () => setSelectedCapitoli(new Set(Object.keys(CAPITOLI_CONFIG)));
  const clearAllCapitoli = () => setSelectedCapitoli(new Set());

  return (
    <div className="min-h-screen bg-[#faf8f4]">
      {/* Header */}
      <header className="bg-white border-b-2 border-neutral-900 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.3em] text-neutral-500">DRMS · Commissioning</div>
            <div className="font-serif text-lg sm:text-xl text-neutral-900 leading-tight">
              Franchising <span className="italic text-orange-700">W3</span>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="text-right">
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-neutral-500">Period</div>
              <div className="font-mono text-xs sm:text-sm text-neutral-900 font-semibold">{period}</div>
            </div>
            <div className="h-8 w-[1px] bg-neutral-300 hidden sm:block"></div>
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Totale pagato</div>
              <div className="font-mono text-sm text-neutral-900 font-semibold">{fmtEur(totali.imp)}</div>
            </div>
          </div>
        </div>

        {/* Riga file caricato */}
        {fileName && (
          <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-2 border-t border-neutral-200 bg-neutral-50/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FileSpreadsheet size={14} className="text-emerald-600 shrink-0"/>
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 hidden sm:inline">File caricato:</span>
              <span className="text-xs font-mono text-neutral-900 truncate">{fileName}</span>
            </div>
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-wider font-medium text-red-700 hover:bg-red-50 border border-red-200 hover:border-red-400 rounded transition-colors whitespace-nowrap"
              title="Rimuovi il file e carica un altro DRMS"
            >
              <X size={12} strokeWidth={2.5}/>
              <span>Rimuovi</span>
            </button>
          </div>
        )}

        {/* Tabs - scrollabili su mobile */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 flex gap-0 border-t border-neutral-200 overflow-x-auto">
          {[
            { k: "overview", l: "Panoramica" },
            { k: "matrix", l: "Matrice" },
            { k: "driver", l: "Driver" },
            { k: "pv", l: "Punti Vendita" },
          ].map(t => (
            <button
              key={t.k}
              onClick={() => setActiveTab(t.k)}
              className={`
                px-4 sm:px-5 py-3 text-[11px] sm:text-xs uppercase tracking-[0.12em] border-b-2 transition-colors whitespace-nowrap
                ${activeTab === t.k ? 'border-orange-700 text-neutral-900 font-semibold' : 'border-transparent text-neutral-500 hover:text-neutral-900'}
              `}
            >
              {t.l}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-8 py-5 sm:py-8">
        {/* Pannello filtri capitoli */}
        <div className="mb-8 bg-white border border-neutral-200">
          <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-neutral-500"/>
              <span className="text-[11px] uppercase tracking-[0.15em] text-neutral-600 font-semibold">Capitoli attivi</span>
              <span className="text-[11px] text-neutral-500 font-mono">
                ({selectedCapitoli.size}/{Object.keys(CAPITOLI_CONFIG).length})
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={selectAllCapitoli} className="text-[10px] uppercase tracking-wider text-neutral-600 hover:text-neutral-900 underline">Tutti</button>
              <span className="text-neutral-300">·</span>
              <button onClick={clearAllCapitoli} className="text-[10px] uppercase tracking-wider text-neutral-600 hover:text-neutral-900 underline">Nessuno</button>
            </div>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {capitoliOrdinati.map(c => (
              <FilterChip
                key={c}
                active={selectedCapitoli.has(c)}
                onClick={() => toggleCapitolo(c)}
                dot={CAPITOLI_CONFIG[c].color}
              >
                {CAPITOLI_CONFIG[c].label}
              </FilterChip>
            ))}
          </div>
        </div>

        {/* Contenuto tab */}
        {activeTab === "overview" && (
          <OverviewTab totali={totali} perCapitolo={perCapitolo} matrix={matrix} period={period}/>
        )}

        {activeTab === "matrix" && (
          <MatrixTab matrix={matrix} capitoliOrdinati={capitoliOrdinati.filter(c => selectedCapitoli.has(c))}
            onSelectPV={(pv) => { setSelectedPV(pv); setActiveTab("pv"); }}/>
        )}

        {activeTab === "driver" && (
          <DriverTab filteredData={filteredData} perCapitolo={perCapitolo} selectedCapitoli={selectedCapitoli}/>
        )}

        {activeTab === "pv" && (
          <PvTab
            listaPV={filteredPVList}
            searchPV={searchPV}
            setSearchPV={setSearchPV}
            selectedPV={selectedPV}
            setSelectedPV={setSelectedPV}
            data={data}
            period={period}
            selectedCapitoli={selectedCapitoli}
          />
        )}
      </div>

      <footer className="mt-16 border-t border-neutral-300 py-6 bg-white">
        <div className="max-w-[1600px] mx-auto px-8 text-[10px] uppercase tracking-[0.2em] text-neutral-500 flex justify-between">
          <span>Dashboard DRMS · Analisi W3 Incentivazione</span>
          <span>Bozza — Riservato</span>
        </div>
      </footer>
    </div>
  );
};

// =============================================================================
// TAB: OVERVIEW
// =============================================================================
const OverviewTab = ({ totali, perCapitolo, matrix, period }) => {
  // Dinamico: mostra al massimo 10 Top PV, oppure tutti se sono meno
  const TOP_N = Math.min(10, matrix.filter(r => r.tot > 0).length);
  const topPV = matrix.filter(r => r.tot > 0).slice(0, TOP_N);
  const bottomPV = matrix.filter(r => r.tot < 0);
  const totalPVCount = matrix.length;

  return (
    <div className="space-y-10">
      {/* KPI */}
      <div>
        <SectionHead eyebrow={`Period ${period}`} title="Sintesi esecutiva"/>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Totale maturato" value={fmtEur(totali.imp)} subvalue={`${fmtInt(totali.righe)} righe`} accent="#f97316" icon={TrendingUp}/>
          <KpiCard label="Contratti distinti" value={fmtInt(totali.contratti)} subvalue={`${totali.pv} punti vendita attivi`} accent="#8b5cf6" icon={Store}/>
          <KpiCard label="Eventi pagati" value={fmtInt(totali.pagati)} subvalue={`${fmtInt(totali.nonAtt)} non attivati`} accent="#10b981" icon={CheckCircle2}/>
          <KpiCard label="Eventi stornati" value={fmtInt(totali.stornati)} subvalue={`${fmtPct(totali.stornati, totali.righe)} delle righe`} accent="#ef4444" icon={TrendingDown}/>
        </div>
      </div>

      {/* Distribuzione capitoli */}
      <div>
        <SectionHead eyebrow="Ripartizione" title="Distribuzione per capitolo"/>
        <div className="bg-white border border-neutral-200 overflow-hidden">
          <div className="p-5">
            {/* Stacked bar orizzontale */}
            <div className="flex h-10 mb-4 overflow-hidden">
              {perCapitolo.filter(c => c.importo > 0).map(c => (
                <div key={c.capitolo}
                  style={{ width: `${(c.importo / totali.imp) * 100}%`, background: c.config.color }}
                  className="relative group cursor-help"
                  title={`${c.config.label}: ${fmtEur(c.importo)}`}
                >
                  <div className="absolute inset-0 group-hover:bg-white group-hover:bg-opacity-20"></div>
                </div>
              ))}
            </div>
            {/* Legenda / tabella */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-2 mt-6">
              {perCapitolo.map(c => (
                <div key={c.capitolo} className="flex items-center justify-between py-2 border-b border-neutral-100 gap-2">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <span className="w-2.5 h-2.5 shrink-0" style={{ background: c.config.color }}></span>
                    <span className="text-xs sm:text-sm text-neutral-900 truncate">{c.config.label}</span>
                    <span className="text-[10px] font-mono text-neutral-400 hidden sm:inline">{fmtInt(c.contratti)} contr.</span>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                    <span className="text-[10px] sm:text-xs font-mono text-neutral-500">{fmtPct(c.importo, totali.imp)}</span>
                    <span className="text-xs sm:text-sm font-mono text-neutral-900 font-semibold tabular-nums">{fmtEur(c.importo)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Top PV */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <div>
          <SectionHead
            eyebrow="Ranking"
            title={topPV.length === totalPVCount ? `Punti Vendita (${totalPVCount})` : `Top ${topPV.length} su ${totalPVCount} Punti Vendita`}
          />
          <div className="bg-white border border-neutral-200">
            {topPV.length === 0 ? (
              <div className="px-5 py-6 text-sm text-neutral-500 text-center">Nessun PV con importo positivo</div>
            ) : topPV.map((pv, i) => (
              <div key={pv.neg} className={`flex items-center justify-between px-5 py-4 ${i < topPV.length-1 ? 'border-b border-neutral-100' : ''}`}>
                <div className="flex items-center gap-4">
                  <span className="font-serif italic text-2xl text-orange-700 w-7 text-right">{i+1}</span>
                  <div>
                    <div className="font-mono text-sm text-neutral-900 font-semibold">{pv.neg}</div>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-500">Negozio Cosy</div>
                  </div>
                </div>
                <div className="font-mono text-lg text-neutral-900 font-semibold tabular-nums">{fmtEur(pv.tot)}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionHead
            eyebrow="Anomalie"
            title={bottomPV.length > 0 ? `PV in negativo (${bottomPV.length})` : "PV in negativo"}
          />
          <div className="bg-white border border-neutral-200">
            {bottomPV.length === 0 ? (
              <div className="px-5 py-6 text-sm text-neutral-500 text-center">Nessun PV in saldo negativo</div>
            ) : bottomPV.map((pv, i) => (
              <div key={pv.neg} className={`flex items-center justify-between px-5 py-4 ${i < bottomPV.length-1 ? 'border-b border-neutral-100' : ''}`}>
                <div className="flex items-center gap-4">
                  <span className="text-red-700 text-xs">●</span>
                  <div>
                    <div className="font-mono text-sm text-neutral-900 font-semibold">{pv.neg}</div>
                    <div className="text-[10px] uppercase tracking-wider text-red-700">Solo storni retroattivi</div>
                  </div>
                </div>
                <div className="font-mono text-lg text-red-700 font-semibold tabular-nums">{fmtEur(pv.tot)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// TAB: MATRIX
// =============================================================================
const MatrixTab = ({ matrix, capitoliOrdinati, onSelectPV }) => {
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const r of matrix) for (const c of capitoliOrdinati) m = Math.max(m, Math.abs(r.byCap[c] || 0));
    return m;
  }, [matrix, capitoliOrdinati]);

  const capitoliTot = useMemo(() => {
    const tot = {};
    for (const r of matrix) for (const c of capitoliOrdinati) tot[c] = (tot[c] || 0) + (r.byCap[c] || 0);
    return tot;
  }, [matrix, capitoliOrdinati]);

  const handleDownload = () => {
    const rows = matrix.map(r => ({
      NEGOZIO: r.neg,
      ...Object.fromEntries(capitoliOrdinati.map(c => [c, (r.byCap[c] || 0).toFixed(2)])),
      TOTALE: r.tot.toFixed(2)
    }));
    downloadCSV(`matrice_pv_capitolo_${Date.now()}.csv`, rows);
  };

  return (
    <div>
      <SectionHead
        eyebrow="Heatmap"
        title="Matrice Punti Vendita × Capitoli"
        right={
          <button onClick={handleDownload} className="text-xs uppercase tracking-wider text-neutral-600 hover:text-neutral-900 border border-neutral-300 hover:border-neutral-900 px-3 py-1.5 font-mono flex items-center gap-2">
            <Download size={12}/> Esporta CSV
          </button>
        }
      />

      <div className="bg-white border border-neutral-200 overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-neutral-900">
              <th className="text-left px-3 py-2 sticky left-0 bg-white z-10 font-mono text-[10px] uppercase tracking-wider text-neutral-600 w-[140px]">Negozio</th>
              {capitoliOrdinati.map(c => (
                <th key={c} className="px-2 py-2 text-right font-mono text-[9px] uppercase tracking-wider text-neutral-600 whitespace-nowrap">
                  <div className="flex flex-col items-end gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: CAPITOLI_CONFIG[c]?.color }}></span>
                    <span>{CAPITOLI_CONFIG[c]?.label || c}</span>
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-neutral-900 bg-neutral-100 whitespace-nowrap border-l-2 border-neutral-900">Totale</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map(r => (
              <tr key={r.neg} className="border-b border-neutral-100 hover:bg-orange-50 cursor-pointer group" onClick={() => onSelectPV(r.neg)}>
                <td className="px-3 py-2 sticky left-0 bg-white group-hover:bg-orange-50 font-mono text-neutral-900">
                  <div className="flex items-center justify-between">
                    <span>{r.neg}</span>
                    <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 text-orange-700"/>
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
                      {v !== 0 ? <span className={v < 0 ? 'text-red-700' : 'text-neutral-900'}>{v.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span> : <span className="text-neutral-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono font-semibold text-neutral-900 bg-neutral-50 border-l-2 border-neutral-900 tabular-nums">
                  {fmtEur(r.tot)}
                </td>
              </tr>
            ))}
            {/* Totali colonna */}
            <tr className="border-t-2 border-neutral-900 bg-neutral-100 font-semibold">
              <td className="px-3 py-2 sticky left-0 bg-neutral-100 font-mono text-[10px] uppercase tracking-wider text-neutral-900">Totale</td>
              {capitoliOrdinati.map(c => (
                <td key={c} className="px-2 py-2 text-right font-mono tabular-nums text-[11px] text-neutral-900">
                  {fmtInt(capitoliTot[c] || 0)}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono font-bold text-neutral-900 border-l-2 border-neutral-900 tabular-nums">
                {fmtEur(Object.values(capitoliTot).reduce((s, v) => s + v, 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] uppercase tracking-wider text-neutral-500">
        Clicca su una riga per aprire il dettaglio del Punto Vendita.
        Intensità colore = importo/max. Rosso = storni.
      </div>
    </div>
  );
};

// =============================================================================
// TAB: DRIVER / CAPITOLO
// =============================================================================
const DriverTab = ({ filteredData, perCapitolo, selectedCapitoli }) => {
  const [selectedCap, setSelectedCap] = useState(null);

  const capitoloData = useMemo(() => {
    if (!selectedCap) return null;
    const rows = filteredData.filter(r => r.CAPITOLO === selectedCap);

    // Aggregati
    const perRegola = {};
    const perDesc = {};
    const perNegozio = {};
    const perCompetenza = {};
    const perPiano = {};
    const perTipoAtt = {};
    const contratti = new Set();
    let nonAttivati = 0, stornati = 0, pagati = 0;
    let impPagati = 0, impStornati = 0;

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

    const toArray = (obj) => Object.entries(obj)
      .map(([k, v]) => ({ key: k, ...v, contratti: v.contr ? v.contr.size : undefined }))
      .sort((a, b) => b.imp - a.imp);

    return {
      rows,
      contratti: contratti.size,
      pagati, stornati, nonAttivati, impPagati, impStornati,
      perRegola: toArray(perRegola),
      perDesc: toArray(perDesc),
      perNegozio: toArray(perNegozio),
      perCompetenza: toArray(perCompetenza),
      perPiano: toArray(perPiano).slice(0, 15),
      perTipoAtt: toArray(perTipoAtt),
    };
  }, [filteredData, selectedCap]);

  const capitoliDisponibili = perCapitolo.filter(c => selectedCapitoli.has(c.capitolo));

  return (
    <div>
      <SectionHead eyebrow="Dettaglio" title="Driver e Capitoli"/>

      {!selectedCap ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {capitoliDisponibili.map(c => (
            <button
              key={c.capitolo}
              onClick={() => setSelectedCap(c.capitolo)}
              className="bg-white border border-neutral-200 hover:border-neutral-900 p-4 sm:p-5 text-left transition-all group"
            >
              <div className="w-1 h-6 mb-3" style={{ background: c.config.color }}></div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-neutral-500 mb-1">{c.config.label}</div>
              <div className="font-serif text-lg sm:text-2xl text-neutral-900 mb-2 break-words">{fmtEur(c.importo)}</div>
              <div className="text-[10px] sm:text-xs text-neutral-600 flex items-center justify-between">
                <span>{fmtInt(c.contratti)} contr.</span>
                <ChevronRight size={12} className="opacity-30 group-hover:opacity-100 group-hover:translate-x-1 transition-all"/>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedCap(null)} className="text-xs uppercase tracking-wider text-neutral-500 hover:text-neutral-900 underline">← Tutti i capitoli</button>
              <span className="text-neutral-400">/</span>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2" style={{ background: CAPITOLI_CONFIG[selectedCap]?.color }}></span>
                <span className="font-serif text-xl text-neutral-900">{CAPITOLI_CONFIG[selectedCap]?.label}</span>
              </div>
            </div>
            <button
              onClick={() => downloadCSV(`${selectedCap}_${Date.now()}.csv`,
                capitoloData.rows.map(r => ({
                  CODICE_NEGOZIO_COSY: r.CODICE_NEGOZIO_COSY,
                  CODICE_CONTRATTO: r.CODICE_CONTRATTO,
                  COMPETENZA: r.COMPETENZA,
                  TIPO_FONIA: r.TIPO_FONIA,
                  TIPO_ATTIVAZIONE: r.TIPO_ATTIVAZIONE,
                  REGOLA_DI_CALCOLO: r.REGOLA_DI_CALCOLO,
                  DESCRIZIONE_ITEM: r.DESCRIZIONE_ITEM,
                  DESCRIZIONE_PIANO_TARIFFARIO: r.DESCRIZIONE_PIANO_TARIFFARIO,
                  IMPORTO: r.IMPORTO_NUM,
                })))}
              className="text-xs uppercase tracking-wider text-neutral-600 border border-neutral-300 hover:border-neutral-900 px-3 py-1.5 font-mono flex items-center gap-2"
            >
              <Download size={12}/> Esporta righe
            </button>
          </div>

          {/* KPI capitolo */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
            <KpiCard label="Importo totale" value={fmtEur(capitoloData.rows.reduce((s, r) => s + (r.IMPORTO_NUM || 0), 0))} accent={CAPITOLI_CONFIG[selectedCap]?.color}/>
            <KpiCard label="Contratti" value={fmtInt(capitoloData.contratti)}/>
            <KpiCard label="Pagati" value={fmtInt(capitoloData.pagati)} subvalue={fmtEur(capitoloData.impPagati)} accent="#10b981"/>
            <KpiCard label="Stornati" value={fmtInt(capitoloData.stornati)} subvalue={fmtEur(capitoloData.impStornati)} accent="#ef4444"/>
            <KpiCard label="Non attivati" value={fmtInt(capitoloData.nonAttivati)} accent="#64748b"/>
          </div>

          {/* Grid dettagli */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DetailTable title="Regole di calcolo" data={capitoloData.perRegola} showContratti/>
            <DetailTable title="Descrizione Item" data={capitoloData.perDesc}/>
            <DetailTable title="Per Punto Vendita" data={capitoloData.perNegozio}/>
            <DetailTable title="Per Competenza" data={capitoloData.perCompetenza}/>
            <DetailTable title="Tipo Attivazione" data={capitoloData.perTipoAtt}/>
            {capitoloData.perPiano.length > 0 && (
              <DetailTable title="Top Piani Tariffari" data={capitoloData.perPiano}/>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const DetailTable = ({ title, data, showContratti }) => {
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
};

// =============================================================================
// TAB: DETTAGLIO PUNTO VENDITA
// =============================================================================
const PvTab = ({ listaPV, searchPV, setSearchPV, selectedPV, setSelectedPV, data, period, selectedCapitoli }) => {

  const pvData = useMemo(() => {
    if (!selectedPV) return null;
    const rows = data.filter(r => r.CODICE_NEGOZIO_COSY === selectedPV && selectedCapitoli.has(r.CAPITOLO));

    // Breakdown per capitolo con dettagli
    const byCap = {};
    for (const r of rows) {
      const c = r.CAPITOLO;
      if (!byCap[c]) byCap[c] = { righe: [], importo: 0, contratti: new Set() };
      byCap[c].righe.push(r);
      byCap[c].importo += r.IMPORTO_NUM || 0;
      if (r.CODICE_CONTRATTO) byCap[c].contratti.add(r.CODICE_CONTRATTO);
    }

    const tot = rows.reduce((s, r) => s + (r.IMPORTO_NUM || 0), 0);

    // Metriche Mobile (se presente)
    const mobile = byCap.MOBILE;
    let metricheMobile = null;
    if (mobile) {
      // contratti distinti
      const cc = mobile.contratti;
      // Contiamo i contrattuali attivazioni mobile del PERIOD
      const contrattuali = mobile.righe.filter(r =>
        r.NATURA === 'CONTRATTUALE' &&
        r.DESCRIZIONE_EVENTO === 'Contrattuale Attivazioni Mobile' &&
        r.COMPETENZA === period
      );
      // Deduplica per codice contratto
      const seen = new Set();
      const dedup = [];
      for (const r of contrattuali) {
        if (r.CODICE_CONTRATTO && !seen.has(r.CODICE_CONTRATTO)) {
          seen.add(r.CODICE_CONTRATTO);
          dedup.push(r);
        }
      }
      const nTied = dedup.filter(r => r.TIPO_ATTIVAZIONE === 'TIED').length;
      const nUntied = dedup.filter(r => r.TIPO_ATTIVAZIONE === 'UNTIED').length;
      const nMnp = dedup.filter(r => r.MNP === 'Y').length;
      const nMib = dedup.filter(r => r.SEGMENTO_CLIENT === 'MIB').length;
      const nPagati = dedup.filter(r => (r.IMPORTO_NUM || 0) > 0).length;
      const nStornati = dedup.filter(r => (r.IMPORTO_NUM || 0) < 0).length;
      const nNonAtt = dedup.filter(r => (r.IMPORTO_NUM || 0) === 0).length;
      // Soglia: guardo righe Gara Attivazioni Mobile per flag_soglia
      const sogliaRighe = data.filter(r =>
        r.CODICE_NEGOZIO_COSY === selectedPV &&
        r.TIPO_FONIA === 'MOBILE' &&
        r.DESCRIZIONE_EVENTO === 'Gara Attivazioni Mobile'
      );
      let maxSoglia = 0;
      for (const r of sogliaRighe) {
        const s = parseFloat(r.FLAG_SOGLIA_MOBILE);
        if (!Number.isNaN(s) && s > maxSoglia) maxSoglia = s;
      }
      metricheMobile = { nTot: dedup.length, nTied, nUntied, nMnp, nMib, nPagati, nStornati, nNonAtt, soglia: maxSoglia };
    }

    // Metriche Fisso
    const fisso = byCap.FISSO;
    let metricheFisso = null;
    if (fisso) {
      const contrattuali = fisso.righe.filter(r =>
        r.NATURA === 'CONTRATTUALE' &&
        r.DESCRIZIONE_EVENTO === 'Attivazione Fonia Fissa GA' &&
        r.COMPETENZA === period
      );
      const seen = new Set();
      const dedup = [];
      for (const r of contrattuali) {
        if (r.CODICE_CONTRATTO && !seen.has(r.CODICE_CONTRATTO)) {
          seen.add(r.CODICE_CONTRATTO);
          dedup.push(r);
        }
      }
      const nFtth = dedup.filter(r => r.TIPO_ACCESSO && /FTTH/i.test(r.TIPO_ACCESSO)).length;
      const nFwa = dedup.filter(r => r.TIPO_ACCESSO && /FWA/i.test(r.TIPO_ACCESSO)).length;
      const nLna = dedup.filter(r => r.TIPO_LINEA === 'LNA').length;
      const nLa = dedup.filter(r => r.TIPO_LINEA === 'LA').length;
      const nMib = dedup.filter(r => r.SEGMENTO_CLIENT === 'MIB').length;
      const nConv = dedup.filter(r => r.FLAG_CONVERGENZA === 'Y').length;
      const sogliaRighe = data.filter(r =>
        r.CODICE_NEGOZIO_COSY === selectedPV &&
        r.TIPO_FONIA === 'FISSO' &&
        r.DESCRIZIONE_EVENTO === 'Gara Attivazioni Fisso'
      );
      let maxSoglia = 0;
      for (const r of sogliaRighe) {
        const s = parseFloat(r.FLAG_SOGLIA_FISSA);
        if (!Number.isNaN(s) && s > maxSoglia) maxSoglia = s;
      }
      metricheFisso = { nTot: dedup.length, nFtth, nFwa, nLna, nLa, nMib, nConv, soglia: maxSoglia };
    }

    return { rows, byCap, tot, metricheMobile, metricheFisso };
  }, [selectedPV, data, period, selectedCapitoli]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      {/* Lista PV laterale */}
      <div>
        <SectionHead eyebrow="Elenco" title="Negozi"/>
        <div className="bg-white border border-neutral-200">
          <div className="p-3 border-b border-neutral-200">
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"/>
              <input
                type="text"
                value={searchPV}
                onChange={(e) => setSearchPV(e.target.value)}
                placeholder="Cerca codice PV…"
                className="w-full pl-8 pr-8 py-2 text-xs border border-neutral-200 focus:outline-none focus:border-neutral-900 font-mono"
              />
              {searchPV && (
                <button onClick={() => setSearchPV("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X size={12} className="text-neutral-400"/>
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {listaPV.map(pv => (
              <button
                key={pv.neg}
                onClick={() => setSelectedPV(pv.neg)}
                className={`
                  w-full text-left px-3 py-2.5 border-b border-neutral-100 transition-colors
                  ${selectedPV === pv.neg ? 'bg-orange-50 border-l-2 border-l-orange-700' : 'hover:bg-neutral-50'}
                `}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-neutral-900">{pv.neg}</span>
                  <span className={`text-xs font-mono tabular-nums ${pv.tot < 0 ? 'text-red-700' : 'text-neutral-600'}`}>
                    {pv.tot >= 1000 ? `${(pv.tot/1000).toFixed(1)}k` : Math.round(pv.tot)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dettaglio PV */}
      <div>
        {!selectedPV ? (
          <div className="bg-white border border-neutral-200 p-16 text-center">
            <Store size={48} strokeWidth={1} className="mx-auto mb-4 text-neutral-300"/>
            <div className="font-serif text-2xl text-neutral-400">Seleziona un punto vendita</div>
            <div className="text-sm text-neutral-500 mt-2">Scegli dall'elenco per vedere il prospetto dettagliato</div>
          </div>
        ) : pvData && (
          <div className="space-y-6">
            {/* Header PV */}
            <div className="bg-white border border-neutral-200 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 mb-1">Punto Vendita</div>
                  <div className="font-mono text-2xl text-neutral-900 font-semibold">{selectedPV}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 mb-1">Totale maturato</div>
                  <div className={`font-serif text-3xl ${pvData.tot < 0 ? 'text-red-700' : 'text-neutral-900'}`}>
                    {fmtEur(pvData.tot)}
                  </div>
                </div>
              </div>
            </div>

            {/* Metriche Mobile */}
            {pvData.metricheMobile && (
              <div>
                <SectionHead eyebrow="Driver" title="Mobile"/>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  <MetricBox label="Importo" value={fmtEur(pvData.byCap.MOBILE?.importo || 0)} highlight/>
                  <MetricBox label="Tot contratti" value={pvData.metricheMobile.nTot}/>
                  <MetricBox label="Pagati" value={pvData.metricheMobile.nPagati} tone="ok"/>
                  <MetricBox label="Stornati" value={pvData.metricheMobile.nStornati} tone="ko"/>
                  <MetricBox label="Non att." value={pvData.metricheMobile.nNonAtt} tone="warn"/>
                  <MetricBox label="Tied / Untied" value={`${pvData.metricheMobile.nTied} / ${pvData.metricheMobile.nUntied}`}/>
                  <MetricBox label="MNP" value={pvData.metricheMobile.nMnp}/>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  <MetricBox label="P.Iva (MIB)" value={pvData.metricheMobile.nMib}/>
                  <MetricBox label="Soglia" value={pvData.metricheMobile.soglia > 0 ? `S${pvData.metricheMobile.soglia}` : 'nessuna'} highlight={pvData.metricheMobile.soglia >= 2} tone={pvData.metricheMobile.soglia >= 2 ? 'ok' : 'warn'}/>
                </div>
              </div>
            )}

            {/* Metriche Fisso */}
            {pvData.metricheFisso && (
              <div>
                <SectionHead eyebrow="Driver" title="Fisso"/>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  <MetricBox label="Importo" value={fmtEur(pvData.byCap.FISSO?.importo || 0)} highlight/>
                  <MetricBox label="Tot contratti" value={pvData.metricheFisso.nTot}/>
                  <MetricBox label="FTTH" value={pvData.metricheFisso.nFtth}/>
                  <MetricBox label="FWA" value={pvData.metricheFisso.nFwa}/>
                  <MetricBox label="LNA / LA" value={`${pvData.metricheFisso.nLna} / ${pvData.metricheFisso.nLa}`}/>
                  <MetricBox label="Convergenti" value={pvData.metricheFisso.nConv}/>
                  <MetricBox label="Soglia" value={pvData.metricheFisso.soglia > 0 ? `S${pvData.metricheFisso.soglia}` : 'nessuna'} highlight={pvData.metricheFisso.soglia >= 2} tone={pvData.metricheFisso.soglia >= 2 ? 'ok' : 'warn'}/>
                </div>
              </div>
            )}

            {/* Breakdown per capitolo */}
            <div>
              <SectionHead eyebrow="Ripartizione" title="Importo per Capitolo"/>
              <div className="bg-white border border-neutral-200">
                {Object.entries(pvData.byCap)
                  .sort((a, b) => b[1].importo - a[1].importo)
                  .map(([cap, d]) => (
                    <div key={cap} className="px-5 py-3 border-b border-neutral-100 last:border-b-0 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-8" style={{ background: CAPITOLI_CONFIG[cap]?.color || '#888' }}></span>
                        <div>
                          <div className="text-sm text-neutral-900 font-medium">{CAPITOLI_CONFIG[cap]?.label || cap}</div>
                          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono">
                            {d.righe.length} righe · {d.contratti.size} contratti
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-semibold tabular-nums ${d.importo < 0 ? 'text-red-700' : 'text-neutral-900'}`}>
                          {fmtEur(d.importo)}
                        </div>
                        <div className="text-[10px] text-neutral-400 font-mono">
                          {fmtPct(d.importo, pvData.tot)}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const MetricBox = ({ label, value, highlight, tone }) => {
  const toneColor = {
    ok: 'text-emerald-700',
    ko: 'text-red-700',
    warn: 'text-amber-700'
  };
  return (
    <div className={`bg-white border ${highlight ? 'border-neutral-900' : 'border-neutral-200'} px-3 py-2.5`}>
      <div className="text-[9px] uppercase tracking-[0.15em] text-neutral-500 mb-1">{label}</div>
      <div className={`font-mono font-semibold tabular-nums ${toneColor[tone] || 'text-neutral-900'} ${typeof value === 'string' && value.length > 10 ? 'text-xs' : 'text-sm'}`}>
        {value}
      </div>
    </div>
  );
};

// =============================================================================
// ROOT APP
// =============================================================================
export default function App() {
  const [rawData, setRawData] = useState(null);
  const [period, setPeriod] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = useCallback(async (file) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await parseExcel(file);
      if (rows.length === 0) throw new Error("Il file non contiene righe.");

      // Determina il PERIOD: prende il valore più frequente
      const periodCount = {};
      for (const r of rows) {
        const p = r.PERIOD;
        if (p) periodCount[p] = (periodCount[p] || 0) + 1;
      }
      const period = Object.entries(periodCount).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!period) throw new Error("Campo PERIOD non trovato nel file.");

      // PERIOD è del tipo "202602", competenza è "2026-02"
      const periodComp = `${period.substring(0, 4)}-${period.substring(4, 6)}`;

      // Converti IMPORTO in numero e classifica
      const processed = rows.map(r => {
        const imp = parseFloat((r.IMPORTO || "").toString().replace(",", "."));
        const row = { ...r, IMPORTO_NUM: Number.isNaN(imp) ? 0 : imp };
        row.CAPITOLO = classificaRiga(row, periodComp);
        return row;
      });

      // Check quadratura: segnalo righe non classificate come warning (non blocco)
      const nonClassificate = processed.filter(r => !r.CAPITOLO);
      if (nonClassificate.length > 0) {
        console.warn(`Attenzione: ${nonClassificate.length} righe non classificate`, nonClassificate.slice(0, 5));
        // Le etichetto come ALTRO per renderle visibili
        for (const r of nonClassificate) r.CAPITOLO = "ALTRO";
      }

      setRawData(processed);
      setPeriod(periodComp);
      setFileName(file.name);
    } catch (e) {
      console.error(e);
      setError(e.message || "Errore nel parsing del file.");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = () => {
    if (rawData && !window.confirm("Vuoi davvero rimuovere il file caricato? L'analisi attuale andrà persa.")) {
      return;
    }
    setRawData(null);
    setPeriod(null);
    setFileName(null);
    setError(null);
  };

  if (!rawData) {
    return <LandingScreen onFileLoaded={handleFile} loading={loading} error={error}/>;
  }

  return (
    <div style={{ fontFamily: "'Libre Franklin', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&family=Libre+Franklin:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        body { font-family: 'Libre Franklin', system-ui, sans-serif; }
        .font-serif { font-family: 'Libre Caslon Text', Georgia, serif; }
        .font-mono { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; }
      `}</style>
      <Dashboard data={rawData} period={period} fileName={fileName} onReset={reset}/>
    </div>
  );
}
