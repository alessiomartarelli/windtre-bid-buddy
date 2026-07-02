// Report vendite giornaliero in formato HTML (Task #248, redesign Task #250):
// file standalone allegato al messaggio Telegram in stile dashboard mobile:
// hero con gradiente, KPI di confronto (oggi/ieri/media 7 gg), grafico di
// andamento, card per pista con bordo colorato + breakdown categorie +
// sparkline, classifiche PDV/addetti con barre. Tutti i grafici sono SVG
// inline: nessuna risorsa esterna, il file si apre offline da Telegram.
// Logica PURA: nessun import React/server, solo import relativi —
// caricabile via loader tsx nei test.
import {
  type DailyReportAggregates,
  type TrendDay,
  REPORT_PISTA_ORDER,
  REPORT_TYPE_ORDER,
  fmtEuro,
  fmtReportDate,
  pctDelta,
} from "./venditeReport";
import {
  type ArticleType,
  type PistaCanvass,
  PISTA_CANVASS_LABELS,
  TYPE_LABELS,
} from "./bisuiteClassification";

// Palette per pista: colore pieno (bordi/titoli/grafici), tinta di sfondo
// card e colore testo. Coerente coi badge della pagina Vendite BiSuite.
const PISTA_THEME: Record<PistaCanvass, { solid: string; tint: string; text: string }> = {
  mobile: { solid: "#2563eb", tint: "#eff6ff", text: "#1d4ed8" },
  fisso: { solid: "#7c3aed", tint: "#f5f3ff", text: "#6d28d9" },
  cb: { solid: "#d97706", tint: "#fffbeb", text: "#b45309" },
  assicurazioni: { solid: "#0d9488", tint: "#f0fdfa", text: "#0f766e" },
  protecta: { solid: "#dc2626", tint: "#fef2f2", text: "#b91c1c" },
  energia: { solid: "#16a34a", tint: "#f0fdf4", text: "#15803d" },
};

const TYPE_THEME: Record<ArticleType, { solid: string; text: string }> = {
  canvass: { solid: "#f97316", text: "#c2410c" },
  prodotti: { solid: "#64748b", text: "#334155" },
  servizi: { solid: "#06b6d4", text: "#0e7490" },
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Nome file sicuro per l'allegato: `report-vendite-<org>-<data>[-<ora>].html`.
 * L'org è slugificata (accenti rimossi, solo [a-z0-9-]).
 */
export function reportHtmlFileName(orgName: string, dateYMD: string, timeLabel?: string): string {
  const slug = orgName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
  const time = (timeLabel ?? "").replace(/[^0-9]/g, "");
  return `report-vendite-${slug}-${dateYMD}${time ? `-${time}` : ""}.html`;
}

export interface VenditeReportHtmlParams {
  orgName: string;
  /** Data italiana del report in formato YYYY-MM-DD. */
  dateYMD: string;
  /** Etichetta oraria (es. "13:30") mostrata nell'intestazione. */
  timeLabel?: string;
  aggregates: DailyReportAggregates;
  /**
   * Serie per-giorno (crescente, ultimo giorno = oggi) per grafico di
   * andamento, sparkline per pista e confronti oggi/ieri/media 7 gg.
   * Assente o con meno di 2 giorni ⇒ le sezioni di trend non compaiono.
   */
  trend?: TrendDay[];
}

// ---------------------------------------------------------------------------
// Grafici SVG inline (puri, nessuna risorsa esterna)
// ---------------------------------------------------------------------------

function chartCoords(values: number[], w: number, h: number, pad: number): Array<[number, number]> {
  const max = Math.max(...values, 1);
  const n = values.length;
  const stepX = n > 1 ? (w - pad * 2) / (n - 1) : 0;
  return values.map((v, i) => [
    +(pad + i * stepX).toFixed(1),
    +(h - pad - (Math.max(v, 0) / max) * (h - pad * 2)).toFixed(1),
  ]);
}

/**
 * Area chart SVG (linea + riempimento sfumato + punto finale). `values`
 * con meno di 2 punti ⇒ stringa vuota. Usato sia per il grafico grande
 * di andamento sia per le sparkline delle card pista.
 */
export function svgAreaChart(
  values: number[],
  opts: { w: number; h: number; color: string; fillOpacity?: number; showLast?: boolean },
): string {
  if (values.length < 2) return "";
  const pad = 4;
  const pts = chartCoords(values, opts.w, opts.h, pad);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const baseline = (opts.h - pad).toFixed(1);
  const area = `${line} L${pts[pts.length - 1][0]},${baseline} L${pts[0][0]},${baseline} Z`;
  const [lx, ly] = pts[pts.length - 1];
  const last = opts.showLast === false ? "" : `<circle cx="${lx}" cy="${ly}" r="3" fill="${opts.color}"/>`;
  return (
    `<svg viewBox="0 0 ${opts.w} ${opts.h}" width="100%" height="${opts.h}" preserveAspectRatio="none" role="img" aria-hidden="true">` +
    `<path d="${area}" fill="${opts.color}" fill-opacity="${opts.fillOpacity ?? 0.12}"/>` +
    `<path d="${line}" fill="none" stroke="${opts.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    last +
    `</svg>`
  );
}

function fmtDayShort(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}` : ymd;
}

function deltaChip(delta: number | null, suffix: string): string {
  if (delta === null) {
    return `<span class="delta flat">— ${escapeHtml(suffix)}</span>`;
  }
  if (delta >= 0) {
    return `<span class="delta up">▲ ${delta}% ${escapeHtml(suffix)}</span>`;
  }
  return `<span class="delta down">▼ ${Math.abs(delta)}% ${escapeHtml(suffix)}</span>`;
}

// ---------------------------------------------------------------------------
// Sezioni
// ---------------------------------------------------------------------------

function heroSection(a: DailyReportAggregates, dateLabel: string, timeLabel?: string): string {
  const when = timeLabel ? `${dateLabel} · ore ${escapeHtml(timeLabel)}` : dateLabel;
  return `<div class="hero">
      <div class="hero-label">Vendite di oggi</div>
      <div class="hero-num">${a.vendite}</div>
      <div class="hero-sub">Importo totale <b>${escapeHtml(fmtEuro(a.importo))}</b></div>
      <div class="hero-when">${when}</div>
    </div>`;
}

function kpiSection(a: DailyReportAggregates, trend: TrendDay[] | undefined): string {
  if (!trend || trend.length < 2) return "";
  const ieri = trend[trend.length - 2];
  const prev = trend.slice(0, -1).slice(-7);
  const media7 = prev.length > 0 ? prev.reduce((s, d) => s + d.vendite, 0) / prev.length : 0;
  const media7Round = Math.round(media7 * 10) / 10;
  const media7Label = Number.isInteger(media7Round) ? String(media7Round) : media7Round.toFixed(1).replace(".", ",");
  return `<div class="kpis">
      <div class="card kpi"><div class="kpi-label">Oggi</div><div class="kpi-value">${a.vendite}</div></div>
      <div class="card kpi"><div class="kpi-label">Ieri</div><div class="kpi-value">${ieri.vendite}</div>${deltaChip(pctDelta(a.vendite, ieri.vendite), "oggi vs ieri")}</div>
      <div class="card kpi"><div class="kpi-label">Media 7 gg</div><div class="kpi-value">${media7Label}</div>${deltaChip(pctDelta(a.vendite, media7), "oggi vs media")}</div>
    </div>`;
}

function trendSection(trend: TrendDay[] | undefined): string {
  if (!trend || trend.length < 2) return "";
  const values = trend.map((d) => d.vendite);
  const max = Math.max(...values);
  const chart = svgAreaChart(values, { w: 320, h: 96, color: "#f97316", fillOpacity: 0.15 });
  return `<div class="card">
      <h2><span class="dot" style="background:#f97316"></span>Andamento — vendite ultimi ${trend.length} giorni</h2>
      ${chart}
      <div class="axis"><span>${escapeHtml(fmtDayShort(trend[0].ymd))}</span><span>max ${max}</span><span>${escapeHtml(fmtDayShort(trend[trend.length - 1].ymd))}</span></div>
    </div>`;
}

function pisteSection(a: DailyReportAggregates, trend: TrendDay[] | undefined): string {
  const cards = REPORT_PISTA_ORDER
    .filter((pista) => (a.countByPista[pista] ?? 0) > 0 || (trend ?? []).some((d) => (d.countByPista[pista] ?? 0) > 0))
    .map((pista) => {
      const theme = PISTA_THEME[pista];
      const label = PISTA_CANVASS_LABELS[pista];
      const count = a.countByPista[pista] ?? 0;
      const amount = a.amountByPista[pista] ?? 0;

      let deltaHtml = "";
      let sparkHtml = "";
      if (trend && trend.length >= 2) {
        const series = trend.map((d) => d.countByPista[pista] ?? 0);
        const prev = series.slice(0, -1).slice(-7);
        const media7 = prev.length > 0 ? prev.reduce((s, v) => s + v, 0) / prev.length : 0;
        deltaHtml = `<div class="pista-delta">${deltaChip(pctDelta(count, media7), "vs media 7 gg")}</div>`;
        const spark = svgAreaChart(series, { w: 280, h: 48, color: theme.solid, fillOpacity: 0.12 });
        if (spark) {
          sparkHtml = `<div class="pista-chart-label">Andamento ${escapeHtml(label)}</div>${spark}`;
        }
      }

      const breakdown = (a.categorieByPista[pista] ?? [])
        .slice(0, 5)
        .map((c) => `<div class="brow"><span>${escapeHtml(c.categoria)}</span><b>${c.pezzi}</b></div>`)
        .join("");

      return `<div class="pista-card" style="border-color:${theme.solid};background:${theme.tint}">
        <div class="pista-name" style="color:${theme.text}">${escapeHtml(label)}</div>
        <div class="pista-num">${count} <span class="pista-pz">pz</span></div>
        ${deltaHtml}
        <div class="pista-amount">${escapeHtml(fmtEuro(amount))}</div>
        ${breakdown ? `<div class="brows">${breakdown}</div>` : ""}
        ${sparkHtml}
      </div>`;
    });
  if (cards.length === 0) return "";
  return `<div class="section-title">📊 Piste</div>\n    ${cards.join("\n    ")}`;
}

function tipiSection(a: DailyReportAggregates): string {
  const cards = REPORT_TYPE_ORDER
    .filter((t) => a.countByType[t] > 0)
    .map((t) => {
      const theme = TYPE_THEME[t];
      return `<div class="card tipo"><div class="tipo-label"><span class="dot" style="background:${theme.solid}"></span>${escapeHtml(TYPE_LABELS[t])}</div>` +
        `<div class="tipo-num" style="color:${theme.text}">${a.countByType[t]} <span class="pista-pz">pz</span></div>` +
        `<div class="tipo-amount">${escapeHtml(fmtEuro(a.amountByType[t]))}</div></div>`;
    });
  if (cards.length === 0) return "";
  return `<div class="section-title">🧾 Per tipo</div>\n    <div class="tipi">${cards.join("")}</div>`;
}

function rankBar(pct: number, color: string): string {
  const width = Math.max(2, Math.min(100, Math.round(pct)));
  return `<div class="bar"><i style="width:${width}%;background:${color}"></i></div>`;
}

function pdvSection(a: DailyReportAggregates): string {
  if (a.perPdv.length === 0) return "";
  const maxImporto = Math.max(...a.perPdv.map((p) => p.importo), 1);
  const rows = a.perPdv
    .map((pdv) => {
      const name = pdv.nomeNegozio || "N/D";
      return `<div class="rank">
        <div class="rank-top"><span class="rank-name">${escapeHtml(name)}</span><span class="rank-val">${escapeHtml(fmtEuro(pdv.importo))}</span></div>
        <div class="rank-sub"><span class="mono">${escapeHtml(pdv.codicePos)}</span> · ${pdv.vendite} vendite</div>
        ${rankBar((pdv.importo / maxImporto) * 100, "#f97316")}
      </div>`;
    })
    .join("\n        ");
  return `<div class="card"><h2>🏬 Per punto vendita</h2>
        ${rows}
    </div>`;
}

function addettiSection(a: DailyReportAggregates): string {
  if (a.perAddetto.length === 0) return "";
  const maxImporto = Math.max(...a.perAddetto.map((p) => p.importo), 1);
  const medals = ["🥇", "🥈", "🥉"];
  const rows = a.perAddetto
    .map((add, i) => {
      const medal = medals[i] ? `${medals[i]} ` : "";
      return `<div class="rank">
        <div class="rank-top"><span class="rank-name">${medal}${escapeHtml(add.nomeAddetto)}</span><span class="rank-val">${escapeHtml(fmtEuro(add.importo))}</span></div>
        <div class="rank-sub">${add.vendite} vendite</div>
        ${rankBar((add.importo / maxImporto) * 100, "#2563eb")}
      </div>`;
    })
    .join("\n        ");
  return `<div class="card"><h2>👤 Per addetto</h2>
        ${rows}
    </div>`;
}

/**
 * Costruisce il documento HTML standalone del report giornaliero in stile
 * dashboard mobile. Tutti i valori dinamici sono escapati; CSS e grafici
 * SVG inline nel documento, nessuna risorsa esterna.
 */
export function buildVenditeReportHtml(p: VenditeReportHtmlParams): string {
  const a = p.aggregates;
  const dateLabel = fmtReportDate(p.dateYMD);
  const title = `Report vendite ${dateLabel}`;
  const trend = p.trend && p.trend.length >= 2 ? p.trend : undefined;

  const sections: string[] = [];
  sections.push(heroSection(a, escapeHtml(dateLabel), p.timeLabel));
  if (a.vendite === 0) {
    sections.push(`<div class="card empty">Nessuna vendita registrata oggi.</div>`);
    sections.push(trendSection(trend));
  } else {
    sections.push(kpiSection(a, trend));
    sections.push(trendSection(trend));
    sections.push(pisteSection(a, trend));
    sections.push(tipiSection(a));
    sections.push(pdvSection(a));
    sections.push(addettiSection(a));
  }

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(p.orgName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14px; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background: #eef1f5; color: #0f172a; }
  .wrap { max-width: 640px; margin: 0 auto; }
  header { margin: 4px 2px 14px; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  .sub { color: #475569; font-size: 13px; margin: 0; }
  .hero { background: linear-gradient(135deg, #ff9a3d 0%, #ff6a00 60%, #f4511e 100%);
          border-radius: 20px; padding: 26px 18px 22px; text-align: center; color: #fff;
          margin-bottom: 14px; box-shadow: 0 8px 24px rgba(244,81,30,.25); }
  .hero-label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; opacity: .9; }
  .hero-num { font-size: 56px; font-weight: 800; line-height: 1.05; margin: 4px 0 2px; }
  .hero-sub { font-size: 15px; opacity: .95; }
  .hero-sub b { font-weight: 700; }
  .hero-when { font-size: 12px; opacity: .8; margin-top: 8px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 14px 16px;
          margin-bottom: 12px; box-shadow: 0 1px 3px rgba(15,23,42,.06); }
  .card.empty { text-align: center; color: #475569; padding: 32px 16px; }
  .kpis { display: flex; gap: 10px; }
  .kpi { flex: 1 1 0; text-align: center; padding: 12px 8px; margin-bottom: 12px; }
  .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }
  .kpi-value { font-size: 26px; font-weight: 800; margin-top: 2px; }
  .delta { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 999px;
           padding: 2px 8px; margin-top: 4px; }
  .delta.up { color: #15803d; background: #dcfce7; }
  .delta.down { color: #b91c1c; background: #fee2e2; }
  .delta.flat { color: #64748b; background: #f1f5f9; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #475569;
       margin: 0 0 10px; display: flex; align-items: center; gap: 6px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; }
  .axis { display: flex; justify-content: space-between; color: #94a3b8; font-size: 11px; margin-top: 4px; }
  .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em;
                   color: #334155; margin: 18px 2px 10px; }
  .pista-card { border: 2px solid; border-radius: 18px; padding: 16px 16px 12px; margin-bottom: 12px;
                text-align: center; box-shadow: 0 2px 8px rgba(15,23,42,.06); }
  .pista-name { font-size: 14px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .pista-num { font-size: 40px; font-weight: 800; line-height: 1.1; margin: 2px 0; }
  .pista-pz { font-size: 14px; font-weight: 600; color: #64748b; }
  .pista-delta { margin: 2px 0 4px; }
  .pista-amount { font-size: 13px; color: #475569; margin-bottom: 8px; }
  .brows { text-align: left; margin: 8px 2px 10px; }
  .brow { display: flex; justify-content: space-between; font-size: 13px; color: #334155;
          padding: 3px 0; border-bottom: 1px dashed rgba(100,116,139,.25); }
  .brow:last-child { border-bottom: none; }
  .brow b { font-weight: 700; }
  .pista-chart-label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
                       color: #94a3b8; margin: 6px 0 2px; }
  .tipi { display: flex; gap: 10px; flex-wrap: wrap; }
  .tipo { flex: 1 1 140px; text-align: center; padding: 12px 8px; }
  .tipo-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #64748b;
                display: flex; align-items: center; justify-content: center; gap: 5px; }
  .tipo-num { font-size: 24px; font-weight: 800; margin-top: 2px; }
  .tipo-amount { font-size: 12px; color: #64748b; }
  .rank { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
  .rank:last-child { border-bottom: none; }
  .rank-top { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; }
  .rank-name { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .rank-val { font-weight: 700; white-space: nowrap; }
  .rank-sub { color: #64748b; font-size: 12px; margin: 1px 0 5px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
  .bar { height: 6px; background: #f1f5f9; border-radius: 999px; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 999px; }
  footer { color: #94a3b8; font-size: 12px; text-align: center; margin: 18px 0 8px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>📊 ${escapeHtml(title)}</h1>
      <p class="sub">${escapeHtml(p.orgName)}</p>
    </header>
    ${sections.filter(Boolean).join("\n    ")}
    <footer>Report generato automaticamente — vendite ANNULLATA escluse.</footer>
  </div>
</body>
</html>
`;
}
