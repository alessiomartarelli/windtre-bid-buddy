import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Download,
  Euro,
  Filter,
  Layers,
  Package,
  RefreshCw,
  Route,
  Search,
  ShoppingCart,
  Store,
  Table as TableIcon,
  Tag,
  TrendingUp,
  User,
  UserRound,
  Users,
  Wallet,
  Waves,
  Wrench,
  X,
} from "lucide-react";
import {
  addetti,
  andamento,
  canvassCard,
  euro,
  incasso,
  integer,
  kpi,
  pdvRows,
  PISTA_LABELS,
  prodottiCard,
  ragioniSociali,
  serviziCard,
  vendite,
  type PistaKey,
} from "./venditeDarkData";
import "./vendite-dark.css";

/* ------------------------------------------------------------------ */
/* Grafico "Andamento KPI nel periodo": riproduzione FEDELE della       */
/* versione attuale (GraficoAndamentoPezzi) — stesse serie, colori,     */
/* gradienti, griglia e tooltip. NON adotta la palette dark del resto.  */
/* ------------------------------------------------------------------ */

type SeriesKey = PistaKey | "totale" | "iva" | "cb" | "telefoni";

const SERIES: { key: SeriesKey; color: string; extra?: boolean }[] = [
  { key: "mobile", color: "#3b82f6" },
  { key: "fisso", color: "#22c55e" },
  { key: "energia", color: "#f59e0b" },
  { key: "assicurazioni", color: "#a855f7" },
  { key: "totale", color: "hsl(239 84% 67%)" },
  { key: "iva", color: "#64748b", extra: true },
  { key: "cb", color: "#f43f5e", extra: true },
  { key: "telefoni", color: "#06b6d4", extra: true },
];

const SERIES_LABELS: Record<SeriesKey, string> = {
  ...PISTA_LABELS,
  totale: "Totale pezzi",
  iva: "IVA",
  cb: "CB",
  telefoni: "Telefoni",
};

const GRAD_TOP = 0.22;
const GRAD_BOT = 0;

function TrendChart() {
  const [active, setActive] = useState<Set<SeriesKey>>(
    new Set<SeriesKey>(["mobile", "fisso", "energia", "assicurazioni"]),
  );

  const chartData = useMemo(
    () =>
      andamento.map((p) => ({
        ...p,
        totale: p.mobile + p.fisso + p.energia + p.assicurazioni,
        label: `${p.day.slice(8, 10)}/${p.day.slice(5, 7)}`,
      })),
    [],
  );

  const toggle = (key: SeriesKey) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const chip = (s: (typeof SERIES)[number]) => (
    <button
      key={s.key}
      type="button"
      className={`vd-trend-chip ${active.has(s.key) ? "" : "off"}`}
      onClick={() => toggle(s.key)}
      aria-pressed={active.has(s.key)}
    >
      <i style={{ backgroundColor: s.color }} />
      {SERIES_LABELS[s.key]}
    </button>
  );

  const activeSeries = SERIES.filter((s) => active.has(s.key));

  return (
    <section className="vd-panel vd-panel-pad">
      <div className="vd-panel-title">
        <TrendingUp />
        Andamento KPI nel periodo
      </div>
      <p className="vd-subnote" style={{ paddingLeft: 25 }}>
        Pezzi per giorno, con gli stessi filtri della tabella · grafico invariato rispetto alla versione attuale
      </p>
      <div className="vd-trend-chips">
        {SERIES.filter((s) => !s.extra).map(chip)}
        <span className="vd-trend-divider" aria-hidden="true" />
        {SERIES.filter((s) => s.extra).map(chip)}
      </div>
      <div style={{ height: 320, marginTop: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: -14 }}>
            <defs>
              {SERIES.map((s) => (
                <linearGradient key={s.key} id={`vd-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" style={{ stopColor: s.color, stopOpacity: GRAD_TOP }} />
                  <stop offset="95%" style={{ stopColor: s.color, stopOpacity: GRAD_BOT }} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(196,172,255,0.3)" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#9c8dd0" }}
              tickMargin={8}
              axisLine={{ stroke: "rgba(196,172,255,0.3)", strokeOpacity: 0.5 }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis tick={{ fontSize: 11, fill: "#9c8dd0" }} tickMargin={6} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(36, 18, 80, 0.85)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                border: "1px solid rgba(196,172,255,0.25)",
                borderRadius: 10,
                fontSize: 12,
                padding: "8px 12px",
                color: "#f4f0ff",
                boxShadow: "0 8px 24px rgba(8,3,24,0.5)",
              }}
              itemStyle={{ padding: "1px 0" }}
              labelStyle={{ marginBottom: 6, fontWeight: 600 }}
            />
            {activeSeries.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={SERIES_LABELS[s.key]}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#vd-grad-${s.key})`}
                fillOpacity={1}
                dot={{ r: 2.5, fill: s.color }}
                activeDot={{ r: 4.5, fill: s.color }}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Tabella PDV × Pista con gruppi RS espandibili e sort dimostrativo    */
/* ------------------------------------------------------------------ */

const PISTE: PistaKey[] = ["mobile", "fisso", "energia", "assicurazioni"];
const EXTRA_COLS = [
  { key: "iva" as const, label: "IVA" },
  { key: "cb" as const, label: "CB" },
  { key: "telefoni" as const, label: "Telefoni" },
];

function PezziTable() {
  const rsNames = ragioniSociali.map((r) => r.nome);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(rsNames));
  const [sort, setSort] = useState<{ pista: PistaKey; dir: "asc" | "desc" } | null>(null);

  const toggleRs = (rs: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rs)) next.delete(rs);
      else next.add(rs);
      return next;
    });

  const toggleSort = (pista: PistaKey) =>
    setSort((prev) =>
      prev?.pista === pista ? (prev.dir === "desc" ? { pista, dir: "asc" } : null) : { pista, dir: "desc" },
    );

  const sumPiste = (r: Record<PistaKey, number>) => PISTE.reduce((a, p) => a + r[p], 0);

  const groups = rsNames.map((rs) => {
    let list = pdvRows.filter((p) => p.rs === rs);
    if (sort) {
      list = [...list].sort((a, b) =>
        sort.dir === "asc" ? a.perPista[sort.pista] - b.perPista[sort.pista] : b.perPista[sort.pista] - a.perPista[sort.pista],
      );
    }
    const agg = {
      perPista: Object.fromEntries(PISTE.map((p) => [p, list.reduce((a, r) => a + r.perPista[p], 0)])) as Record<PistaKey, number>,
      iva: list.reduce((a, r) => a + r.iva, 0),
      cb: list.reduce((a, r) => a + r.cb, 0),
      telefoni: list.reduce((a, r) => a + r.telefoni, 0),
    };
    return { rs, list, agg };
  });

  const totals = {
    perPista: Object.fromEntries(PISTE.map((p) => [p, pdvRows.reduce((a, r) => a + r.perPista[p], 0)])) as Record<PistaKey, number>,
    iva: pdvRows.reduce((a, r) => a + r.iva, 0),
    cb: pdvRows.reduce((a, r) => a + r.cb, 0),
    telefoni: pdvRows.reduce((a, r) => a + r.telefoni, 0),
  };

  const allExpanded = rsNames.every((r) => expanded.has(r));
  const noneExpanded = expanded.size === 0;

  return (
    <section className="vd-panel">
      <div className="vd-panel-pad" style={{ paddingBottom: 12 }}>
        <div className="vd-filterhead" style={{ marginBottom: 0 }}>
          <div className="vd-panel-title">
            <TableIcon />
            Tabella PDV × Pista (Pezzi)
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="vd-btn" onClick={() => setExpanded(new Set(rsNames))} disabled={allExpanded}>
              Espandi tutto
            </button>
            <button className="vd-btn" onClick={() => setExpanded(new Set())} disabled={noneExpanded}>
              Collassa tutto
            </button>
            <button className="vd-btn"><Download />Excel</button>
            <button className="vd-btn"><Download />CSV</button>
            <button className="vd-btn"><Download />PDF</button>
          </div>
        </div>
      </div>
      <div className="vd-tablewrap">
        <table className="vd-table">
          <thead>
            <tr>
              <th style={{ minWidth: 190 }}>RS / PDV</th>
              {PISTE.map((p) => {
                const isActive = sort?.pista === p;
                const SortIcon = isActive ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th key={p}>
                    <button className="vd-sortbtn" onClick={() => toggleSort(p)} title={`Ordina PDV per ${PISTA_LABELS[p]}`}>
                      {PISTA_LABELS[p]}
                      <SortIcon style={{ opacity: isActive ? 1 : 0.5 }} />
                    </button>
                  </th>
                );
              })}
              {EXTRA_COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Totale</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ rs, list, agg }) => (
              <FragmentRows
                key={rs}
                rs={rs}
                list={list}
                agg={agg}
                expanded={expanded.has(rs)}
                onToggle={() => toggleRs(rs)}
                sumPiste={sumPiste}
              />
            ))}
            <tr className="tot-row">
              <td>Totale complessivo</td>
              {PISTE.map((p) => (
                <td key={p}>{totals.perPista[p]}</td>
              ))}
              <td>{totals.iva}</td>
              <td>{totals.cb}</td>
              <td>{totals.telefoni}</td>
              <td>{sumPiste(totals.perPista)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FragmentRows({
  rs,
  list,
  agg,
  expanded,
  onToggle,
  sumPiste,
}: {
  rs: string;
  list: typeof pdvRows;
  agg: { perPista: Record<PistaKey, number>; iva: number; cb: number; telefoni: number };
  expanded: boolean;
  onToggle: () => void;
  sumPiste: (r: Record<PistaKey, number>) => number;
}) {
  return (
    <>
      <tr className="rs-row" onClick={onToggle}>
        <td>
          <button
            className="vd-expander"
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
            {rs}
          </button>
        </td>
        {PISTE.map((p) => (
          <td key={p}>{agg.perPista[p]}</td>
        ))}
        <td>{agg.iva}</td>
        <td>{agg.cb}</td>
        <td>{agg.telefoni}</td>
        <td>{sumPiste(agg.perPista)}</td>
      </tr>
      {expanded &&
        list.map((pdv) => (
          <tr key={pdv.codicePos}>
            <td style={{ paddingLeft: 32 }}>
              <div className="pdv-name">{pdv.nome}</div>
              <div className="pdv-code">{pdv.codicePos}</div>
            </td>
            {PISTE.map((p) => (
              <td key={p}>{pdv.perPista[p]}</td>
            ))}
            <td>{pdv.iva}</td>
            <td>{pdv.cb}</td>
            <td>{pdv.telefoni}</td>
            <td style={{ fontWeight: 600 }}>{sumPiste(pdv.perPista)}</td>
          </tr>
        ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pagina completa                                                      */
/* ------------------------------------------------------------------ */

export function VenditeBiSuiteDark() {
  const [fromDate, setFromDate] = useState("2026-08-01");
  const [toDate, setToDate] = useState("2026-08-19");
  const [search, setSearch] = useState("");
  const [tipo, setTipo] = useState("all");
  const [stato, setStato] = useState("finalizzate");
  const [pista, setPista] = useState("all");
  const [pagamento, setPagamento] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"vendite" | "addetti">("vendite");
  const [openRs, setOpenRs] = useState<Set<string>>(new Set([ragioniSociali[0].nome]));
  const [openPdv, setOpenPdv] = useState<Set<string>>(new Set());
  const [openAddetti, setOpenAddetti] = useState<Set<string>>(new Set());

  const activeCount =
    (search.trim() ? 1 : 0) +
    (tipo !== "all" ? 1 : 0) +
    (pista !== "all" ? 1 : 0) +
    (stato !== "finalizzate" ? 1 : 0) +
    (pagamento ? 1 : 0);

  const reset = () => {
    setSearch("");
    setTipo("all");
    setStato("finalizzate");
    setPista("all");
    setPagamento(null);
  };

  const toggleIn = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendite.filter((v) => {
      if (stato === "finalizzate" && v.stato !== "FINALIZZATA IN CASSA") return false;
      if (stato === "annullate" && v.stato !== "ANNULLATA") return false;
      if (tipo === "canvass" && (v.pista === "prodotti" || v.pista === "servizi")) return false;
      if (tipo === "prodotti" && v.pista !== "prodotti") return false;
      if (tipo === "servizi" && v.pista !== "servizi") return false;
      if (pista !== "all" && v.pista !== pista) return false;
      if (q && ![v.negozio, v.addetto, v.cliente, v.pistaLabel].some((s) => s.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [search, tipo, stato, pista]);

  return (
    <main className="vd-root">
      <header className="vd-topbar">
        <div className="vd-brand">
          <span className="vd-brand-mark"><Waves /></span>
          MyStoreDesk
        </div>
        <span className="vd-crumb">Vendite BiSuite / Agosto 2026</span>
        <div className="vd-topbar-right">
          <span className="vd-chip-preview">Preview dark</span>
          <a className="vd-backlink" href="/">Dashboard Prisma Light</a>
          <div className="vd-avatar" aria-label="Profilo utente"><UserRound size={15} /></div>
        </div>
      </header>

      <div className="vd-main">
        <p className="vd-subnote">
          Concept "Midnight Violet" — dati aggregati/dimostrativi, nessun dato personale reale. Il grafico
          Andamento KPI resta identico alla versione attuale.
        </p>

        {/* -------- Filtri -------- */}
        <section className="vd-panel vd-panel-pad">
          <div className="vd-filterhead">
            <div className="vd-panel-title">
              <Filter />
              Filtri
              {activeCount > 0 && <span className="vd-filtercount">{activeCount} attivi</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {activeCount > 0 && (
                <button className="vd-btn ghost" onClick={reset}><X />Azzera</button>
              )}
              <button className="vd-btn primary"><RefreshCw />Aggiorna Vendite</button>
              <button className="vd-btn"><Route />Allinea con BiSuite</button>
            </div>
          </div>
          <div className="vd-filters">
            <div className="vd-field">
              <label className="vd-label"><CalendarRange />Da</label>
              <input className="vd-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="vd-field">
              <label className="vd-label"><CalendarRange />A</label>
              <input className="vd-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="vd-field span2">
              <label className="vd-label"><Search />Cerca</label>
              <input
                className="vd-input"
                placeholder="Cliente, addetto, negozio, categoria..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="vd-field">
              <label className="vd-label"><Layers />Tipo</label>
              <select className="vd-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="all">Tutti i tipi</option>
                <option value="canvass">Canvass</option>
                <option value="prodotti">Prodotti</option>
                <option value="servizi">Servizi</option>
              </select>
            </div>
            <div className="vd-field">
              <label className="vd-label"><Filter />Stato</label>
              <select className="vd-select" value={stato} onChange={(e) => setStato(e.target.value)}>
                <option value="finalizzate">Solo finalizzate</option>
                <option value="annullate">Solo annullate</option>
                <option value="all">Tutte (incluse annullate)</option>
              </select>
            </div>
            {(tipo === "canvass" || tipo === "all") && (
              <div className="vd-field">
                <label className="vd-label"><Route />Pista</label>
                <select className="vd-select" value={pista} onChange={(e) => setPista(e.target.value)}>
                  <option value="all">Tutte le piste</option>
                  {PISTE.map((p) => (
                    <option key={p} value={p}>{PISTA_LABELS[p]}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>

        {/* -------- KPI -------- */}
        <div className="vd-kpis">
          <article className="vd-panel vd-kpi">
            <ShoppingCart className="vd-gold-text" />
            <div className="vd-kpi-value">{integer.format(kpi.venditeTotali)}</div>
            <div className="vd-kpi-label">Vendite Totali</div>
          </article>
          <article className="vd-panel vd-kpi">
            <Euro className="vd-green-text" />
            <div className="vd-kpi-value vd-green-text">{euro.format(kpi.importoTotale)}</div>
            <div className="vd-kpi-label">Importo Totale</div>
          </article>
          <article className="vd-panel vd-kpi">
            <Store style={{ color: "#93c5fd" }} />
            <div className="vd-kpi-value">{kpi.puntiVendita}</div>
            <div className="vd-kpi-label">Punti Vendita</div>
          </article>
          <article className="vd-panel vd-kpi">
            <TrendingUp className="vd-gold-text" />
            <div className="vd-kpi-value vd-gold-text">{euro.format(kpi.mediaVendita)}</div>
            <div className="vd-kpi-label">Media per Vendita</div>
          </article>
        </div>

        {/* -------- Modalità di incasso -------- */}
        <section className="vd-panel vd-panel-pad">
          <div className="vd-filterhead">
            <div className="vd-panel-title"><Wallet />Modalità di Incasso</div>
            {pagamento && (
              <button className="vd-btn ghost" onClick={() => setPagamento(null)}>
                <X />Azzera filtro pagamento
              </button>
            )}
          </div>
          <p className="vd-subnote" style={{ marginTop: -6, marginBottom: 10 }}>
            Clicca un metodo per filtrare le vendite con quell'incasso.
          </p>
          <div className="vd-chiprow">
            {incasso.map((i) => (
              <button
                key={i.key}
                className={`vd-chipbtn ${pagamento === i.key ? "active" : ""}`}
                onClick={() => setPagamento(pagamento === i.key ? null : i.key)}
                aria-pressed={pagamento === i.key}
              >
                {i.label}
                <small>{euro.format(i.value)}</small>
              </button>
            ))}
          </div>
        </section>

        {/* -------- Canvass / Prodotti / Servizi -------- */}
        <div className="vd-types">
          <article className="vd-panel vd-panel-pad vd-type-card canvass">
            <div className="vd-type-head">
              <div><Tag />Canvass</div>
              <span className="vd-badge gold">{integer.format(canvassCard.totale)}</span>
            </div>
            <div className="vd-row" style={{ paddingTop: 0 }}>
              <span className="money green">{euro.format(canvassCard.importo)}</span>
            </div>
            {canvassCard.piste.map((p) => (
              <div key={p.key} className="vd-row">
                <div className="name"><span>{PISTA_LABELS[p.key]}</span></div>
                <div className="vals">
                  <span className="money">{euro.format(p.importo)}</span>
                  {p.iva > 0 && <span className="money" style={{ color: "#b4a6e8" }}>di cui {p.iva} IVA</span>}
                  <span className={`vd-badge ${p.key}`}>{p.count}</span>
                </div>
              </div>
            ))}
            {canvassCard.altre.map((p) => (
              <div key={p.label} className="vd-row">
                <div className="name"><span>{p.label}</span></div>
                <div className="vals">
                  <span className="money">{euro.format(p.importo)}</span>
                  <span className="vd-badge">{p.count}</span>
                </div>
              </div>
            ))}
            <div className="vd-divider-dashed" />
            <div className="vd-row">
              <div className="name">
                <Tag style={{ width: 12, height: 12, color: "var(--vd-gold)" }} />
                <span>Coupon Caring <small style={{ color: "var(--vd-lav-dim)" }}>(esclusi da CB)</small></span>
              </div>
              <div className="vals">
                <span className="money">{euro.format(canvassCard.couponCaring.importo)}</span>
                <span className="vd-badge gold">{canvassCard.couponCaring.pezzi}</span>
              </div>
            </div>
          </article>

          <article className="vd-panel vd-panel-pad vd-type-card prodotti">
            <div className="vd-type-head">
              <div><Package />Prodotti <small style={{ color: "var(--vd-lav-dim)", fontWeight: 500 }}>(acc. netto IVA)</small></div>
              <span className="vd-badge">{integer.format(prodottiCard.totale)}</span>
            </div>
            <div className="vd-row" style={{ paddingTop: 0 }}>
              <span className="money green">{euro.format(prodottiCard.importoNetto)}</span>
            </div>
            {prodottiCard.categorie.map((c) => (
              <div key={c.label} className="vd-row">
                <div className="name"><span>{c.label}</span></div>
                <div className="vals">
                  {c.importo > 0 && <span className="money green">{euro.format(c.importo)}{c.label === "ACCESSORI" ? " (n.IVA)" : ""}</span>}
                  {c.iva > 0 && <span className="money">IVA {euro.format(c.iva)}</span>}
                  <span className="vd-badge">{c.pezzi}</span>
                </div>
              </div>
            ))}
          </article>

          <article className="vd-panel vd-panel-pad vd-type-card servizi">
            <div className="vd-type-head">
              <div><Wrench />Servizi <small style={{ color: "var(--vd-lav-dim)", fontWeight: 500 }}>(netto IVA)</small></div>
              <span className="vd-badge">{integer.format(serviziCard.totale)}</span>
            </div>
            <div className="vd-row" style={{ paddingTop: 0 }}>
              <span className="money green">{euro.format(serviziCard.importoNetto)}</span>
              <span className="money">IVA {euro.format(serviziCard.iva)}</span>
            </div>
            {serviziCard.voci.map((v) => (
              <div key={v.label} className="vd-row">
                <div className="name"><span>{v.label}</span></div>
                <div className="vals">
                  <span className="money green">{euro.format(v.importo)}</span>
                  <span className="money">IVA {euro.format(v.iva)}</span>
                  <span className="vd-badge">{v.pezzi}</span>
                </div>
              </div>
            ))}
          </article>
        </div>

        {/* -------- Riepilogo per Ragione Sociale -------- */}
        <section className="vd-panel vd-panel-pad">
          <div className="vd-panel-title" style={{ marginBottom: 12 }}>
            <Users />Riepilogo per Ragione Sociale
          </div>
          {ragioniSociali.map((rs) => {
            const open = openRs.has(rs.nome);
            return (
              <div key={rs.nome} className="vd-acc">
                <button className="vd-acc-head" onClick={() => toggleIn(openRs, rs.nome, setOpenRs)} aria-expanded={open}>
                  <span className="vd-acc-ico"><Users /></span>
                  <span>
                    <span className="vd-acc-title">{rs.nome}</span>
                    <br />
                    <span className="vd-acc-sub">{rs.pdv} PDV</span>
                  </span>
                  <span className="vd-acc-right">
                    <span className="vd-badge">{integer.format(rs.vendite)} vendite</span>
                    <span className="vd-badge green">{euro.format(rs.importo)}</span>
                    <ChevronDown className={`vd-acc-chevron ${open ? "open" : ""}`} size={16} />
                  </span>
                </button>
                {open && (
                  <div className="vd-acc-body">
                    <div className="vd-chiprow">
                      {rs.incasso.map((i) => (
                        <span key={i.label} className="vd-badge">
                          {i.label}: <b style={{ color: "var(--vd-text)" }}>{euro.format(i.value)}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* -------- Toggle vista -------- */}
        <div className="vd-viewtoggle" role="group" aria-label="Modalità vista">
          <button className={`vd-btn ${viewMode === "vendite" ? "on" : ""}`} onClick={() => setViewMode("vendite")}>
            <Store />Per PDV
          </button>
          <button className={`vd-btn ${viewMode === "addetti" ? "on" : ""}`} onClick={() => setViewMode("addetti")}>
            <User />Per Addetto ({addetti.length})
          </button>
        </div>

        {/* -------- Riepilogo per Addetto -------- */}
        {viewMode === "addetti" && (
          <section className="vd-panel vd-panel-pad">
            <div className="vd-filterhead">
              <div className="vd-panel-title"><User />Riepilogo per Addetto</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="vd-btn"><Download />Dettaglio</button>
                <button className="vd-btn"><Download />Per Addetto</button>
              </div>
            </div>
            {addetti.map((a) => {
              const open = openAddetti.has(a.nome);
              return (
                <div key={a.nome} className="vd-acc">
                  <button className="vd-acc-head" onClick={() => toggleIn(openAddetti, a.nome, setOpenAddetti)} aria-expanded={open}>
                    <span className="vd-acc-ico" style={{ background: "rgba(59,130,246,0.15)", color: "#93c5fd" }}><User /></span>
                    <span>
                      <span className="vd-acc-title">{a.nome}</span>
                      <br />
                      <span className="vd-acc-sub">{a.pdv} PDV</span>
                    </span>
                    <span className="vd-acc-right">
                      <span className="vd-badge">{a.vendite} vendite</span>
                      <span className="vd-badge green">{euro.format(a.importo)}</span>
                      <ChevronDown className={`vd-acc-chevron ${open ? "open" : ""}`} size={16} />
                    </span>
                  </button>
                  {open && (
                    <div className="vd-acc-body">
                      <div className="vd-chiprow">
                        {PISTE.map((p) => (
                          <span key={p} className={`vd-badge ${p}`}>
                            {PISTA_LABELS[p]}: {a.perPista[p]}
                          </span>
                        ))}
                      </div>
                      <button className="vd-btn" style={{ width: "fit-content" }}>
                        Vedi tutte le vendite<ChevronRight />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* -------- Grafico (invariato) + Tabella pezzi -------- */}
        <TrendChart />
        <PezziTable />

        {/* -------- Riepilogo per Punto Vendita -------- */}
        {viewMode === "vendite" && (
          <section className="vd-panel vd-panel-pad">
            <div className="vd-panel-title" style={{ marginBottom: 12 }}>
              <BarChart3 />Riepilogo per Punto Vendita
            </div>
            {pdvRows.slice(0, 6).map((pdv) => {
              const open = openPdv.has(pdv.codicePos);
              return (
                <div key={pdv.codicePos} className="vd-acc">
                  <button className="vd-acc-head" onClick={() => toggleIn(openPdv, pdv.codicePos, setOpenPdv)} aria-expanded={open}>
                    <span className="vd-acc-ico"><Store /></span>
                    <span style={{ minWidth: 0 }}>
                      <span className="vd-acc-title">{pdv.nome}</span>
                      <br />
                      <span className="vd-acc-sub vd-mono">{pdv.codicePos} · {pdv.rs}</span>
                    </span>
                    <span className="vd-acc-right">
                      <span className="vd-badge">{pdv.vendite} vendite</span>
                      <span className="vd-badge green">{euro.format(pdv.importo)}</span>
                      <ChevronDown className={`vd-acc-chevron ${open ? "open" : ""}`} size={16} />
                    </span>
                  </button>
                  {open && (
                    <div className="vd-acc-body">
                      <div className="vd-chiprow">
                        {PISTE.map((p) => (
                          <span key={p} className={`vd-badge ${p}`}>
                            {PISTA_LABELS[p]}: {pdv.perPista[p]}
                          </span>
                        ))}
                        <span className="vd-badge">Telefoni: {pdv.telefoni}</span>
                        <span className="vd-badge red">CB: {pdv.cb}</span>
                      </div>
                      <button className="vd-btn" style={{ width: "fit-content" }}>
                        Vedi tutte le vendite<ChevronRight />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="vd-subnote" style={{ marginTop: 10 }}>
              + altri {pdvRows.length - 6} PDV nella pagina reale.
            </p>
          </section>
        )}

        {/* -------- Lista vendite -------- */}
        <section className="vd-panel">
          <div className="vd-panel-pad" style={{ paddingBottom: 12 }}>
            <div className="vd-panel-title">
              <Package />Tutte le Vendite
              <span className="vd-badge">{filteredSales.length} record</span>
            </div>
          </div>
          <div className="vd-tablewrap">
            <table className="vd-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th className="vd-hide-sm">ID BiSuite</th>
                  <th style={{ textAlign: "left" }}>Negozio</th>
                  <th className="vd-hide-sm" style={{ textAlign: "left" }}>Addetto</th>
                  <th className="vd-hide-sm" style={{ textAlign: "left" }}>Cliente</th>
                  <th style={{ textAlign: "left" }}>Pista / Tipo</th>
                  <th>Stato</th>
                  <th>Importo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center", color: "var(--vd-lav-dim)", padding: "28px 0" }}>
                      Nessuna vendita trovata per i filtri selezionati
                    </td>
                  </tr>
                ) : (
                  filteredSales.map((v) => (
                    <tr key={v.id} style={{ cursor: "pointer" }}>
                      <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>{v.data}</td>
                      <td className="vd-mono vd-hide-sm">{v.id}</td>
                      <td style={{ textAlign: "left" }}>
                        <div className="pdv-name">{v.negozio}</div>
                        <div className="pdv-code">{v.codicePos}</div>
                      </td>
                      <td className="vd-hide-sm" style={{ textAlign: "left" }}>{v.addetto}</td>
                      <td className="vd-hide-sm" style={{ textAlign: "left" }}>{v.cliente}</td>
                      <td style={{ textAlign: "left" }}>
                        <span className={`vd-badge ${v.pista === "prodotti" || v.pista === "servizi" ? "" : v.pista}`}>
                          {v.pistaLabel}
                        </span>
                      </td>
                      <td>
                        <span className={`vd-badge ${v.stato === "ANNULLATA" ? "red" : "gold"}`}>{v.stato}</span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{v.importo > 0 ? euro.format(v.importo) : "—"}</td>
                      <td><ChevronRight size={14} style={{ color: "var(--vd-lav-dim)" }} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

export default VenditeBiSuiteDark;
