// Report vendite giornaliero in formato HTML (Task #248, redesign "night
// glass" su feedback utente): file standalone allegato al messaggio
// Telegram. Identità propria, NON una copia del riferimento: tema scuro
// con card in stile glassmorphism (come l'app), filo conduttore arancione
// WindTre, hero con delta integrati, riga "highlights" del giorno (top
// PDV/addetto/pista), piste come gara a barre orizzontali con chip per
// categoria, donut chart per il mix tipi, classifiche PDV/addetti.
// Tutti i grafici sono SVG inline: nessuna risorsa esterna, il file si
// apre offline da Telegram. Logica PURA: nessun import React/server, solo
// import relativi — caricabile via loader tsx nei test.
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

// Palette per pista su fondo scuro (varianti luminose dei colori badge app).
const PISTA_THEME: Record<PistaCanvass, string> = {
  mobile: "#60a5fa",
  fisso: "#a78bfa",
  cb: "#fbbf24",
  assicurazioni: "#2dd4bf",
  protecta: "#f87171",
  energia: "#4ade80",
};

const TYPE_THEME: Record<ArticleType, string> = {
  canvass: "#fb923c",
  prodotti: "#94a3b8",
  servizi: "#22d3ee",
};

const ORANGE = "#ff7a1a";

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
   * andamento e confronti oggi/ieri/media 7 gg. Assente o con meno di
   * 2 giorni ⇒ le sezioni di trend non compaiono.
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
 * Area chart SVG (linea + riempimento + punto finale). `values` con meno
 * di 2 punti ⇒ stringa vuota.
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
  const last = opts.showLast === false ? "" : `<circle cx="${lx}" cy="${ly}" r="3.5" fill="${opts.color}"/>`;
  return (
    `<svg viewBox="0 0 ${opts.w} ${opts.h}" width="100%" height="${opts.h}" preserveAspectRatio="none" role="img" aria-hidden="true">` +
    `<path d="${area}" fill="${opts.color}" fill-opacity="${opts.fillOpacity ?? 0.18}"/>` +
    `<path d="${line}" fill="none" stroke="${opts.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    last +
    `</svg>`
  );
}

/**
 * Donut chart SVG a segmenti. Somma dei valori non positiva ⇒ stringa
 * vuota. Al centro mostra `centerLabel` (es. pezzi totali).
 */
export function svgDonut(
  segments: Array<{ value: number; color: string }>,
  centerLabel: string,
  size = 132,
  strokeW = 18,
): string {
  const total = segments.reduce((s, seg) => s + Math.max(seg.value, 0), 0);
  if (total <= 0) return "";
  const r = (size - strokeW) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .filter((seg) => seg.value > 0)
    .map((seg) => {
      const len = (seg.value / total) * circ;
      const dash = `${len.toFixed(2)} ${(circ - len).toFixed(2)}`;
      const el = `<circle cx="${c}" cy="${c}" r="${r.toFixed(1)}" fill="none" stroke="${seg.color}" stroke-width="${strokeW}" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`;
      offset += len;
      return el;
    })
    .join("");
  return (
    `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-hidden="true">` +
    arcs +
    `<text x="${c}" y="${c - 2}" text-anchor="middle" fill="#f8fafc" font-size="26" font-weight="800">${escapeHtml(centerLabel)}</text>` +
    `<text x="${c}" y="${c + 16}" text-anchor="middle" fill="#94a3b8" font-size="11">pezzi</text>` +
    `</svg>`
  );
}

function fmtDayShort(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const wd = d.toLocaleDateString("it-IT", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${m[3]}/${m[2]}`;
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

function heroSection(a: DailyReportAggregates, trend: TrendDay[] | undefined): string {
  let chips = "";
  if (trend && trend.length >= 2) {
    const ieri = trend[trend.length - 2];
    const prev = trend.slice(0, -1).slice(-7);
    const media7 = prev.length > 0 ? prev.reduce((s, d) => s + d.vendite, 0) / prev.length : 0;
    chips = `<div class="hero-chips">${deltaChip(pctDelta(a.vendite, ieri.vendite), "oggi vs ieri")}${deltaChip(pctDelta(a.vendite, media7), "oggi vs media 7 gg")}</div>`;
  }
  return `<div class="hero">
      <div class="hero-glow"></div>
      <div class="hero-label">Vendite di oggi</div>
      <div class="hero-num">${a.vendite}</div>
      <div class="hero-sub">${escapeHtml(fmtEuro(a.importo))} <span class="hero-sub-dim">di importo totale</span></div>
      ${chips}
    </div>`;
}

function highlightsSection(a: DailyReportAggregates): string {
  const items: string[] = [];
  if (a.perPdv.length > 0) {
    const top = a.perPdv[0];
    items.push(`<div class="hl"><div class="hl-icon">🏆</div><div class="hl-k">Top negozio</div><div class="hl-v">${escapeHtml(top.nomeNegozio || top.codicePos)}</div><div class="hl-s">${escapeHtml(fmtEuro(top.importo))}</div></div>`);
  }
  if (a.perAddetto.length > 0) {
    const top = a.perAddetto[0];
    items.push(`<div class="hl"><div class="hl-icon">⭐</div><div class="hl-k">Top addetto</div><div class="hl-v">${escapeHtml(top.nomeAddetto)}</div><div class="hl-s">${top.vendite} vendite</div></div>`);
  }
  const topPista = REPORT_PISTA_ORDER
    .map((p) => ({ p, n: a.countByPista[p] ?? 0 }))
    .sort((x, y) => y.n - x.n)[0];
  if (topPista && topPista.n > 0) {
    items.push(`<div class="hl"><div class="hl-icon">🚀</div><div class="hl-k">Pista del giorno</div><div class="hl-v" style="color:${PISTA_THEME[topPista.p]}">${escapeHtml(PISTA_CANVASS_LABELS[topPista.p])}</div><div class="hl-s">${topPista.n} pz</div></div>`);
  }
  if (items.length === 0) return "";
  return `<div class="hls">${items.join("")}</div>`;
}

function trendSection(trend: TrendDay[] | undefined): string {
  if (!trend || trend.length < 2) return "";
  const values = trend.map((d) => d.vendite);
  const max = Math.max(...values);
  const chart = svgAreaChart(values, { w: 320, h: 92, color: ORANGE, fillOpacity: 0.22 });
  return `<div class="card">
      <h2>Andamento · ultimi ${trend.length} giorni</h2>
      ${chart}
      <div class="axis"><span>${escapeHtml(fmtDayShort(trend[0].ymd))}</span><span>picco ${max}</span><span>${escapeHtml(fmtDayShort(trend[trend.length - 1].ymd))}</span></div>
    </div>`;
}

function pisteSection(a: DailyReportAggregates, trend: TrendDay[] | undefined): string {
  const active = REPORT_PISTA_ORDER.filter((p) => (a.countByPista[p] ?? 0) > 0);
  if (active.length === 0) return "";
  const maxCount = Math.max(...active.map((p) => a.countByPista[p] ?? 0), 1);
  const rows = active
    .map((pista) => {
      const color = PISTA_THEME[pista];
      const label = PISTA_CANVASS_LABELS[pista];
      const count = a.countByPista[pista] ?? 0;
      const amount = a.amountByPista[pista] ?? 0;
      const width = Math.max(6, Math.round((count / maxCount) * 100));

      let delta = "";
      if (trend && trend.length >= 2) {
        const series = trend.map((d) => d.countByPista[pista] ?? 0);
        const prev = series.slice(0, -1).slice(-7);
        const media7 = prev.length > 0 ? prev.reduce((s, v) => s + v, 0) / prev.length : 0;
        delta = deltaChip(pctDelta(count, media7), "vs media 7 gg");
      }

      const chips = (a.categorieByPista[pista] ?? [])
        .slice(0, 4)
        .map((c) => `<span class="chip">${escapeHtml(c.categoria)} ×${c.pezzi}</span>`)
        .join("");

      return `<div class="prow">
        <div class="prow-head"><span class="pname" style="color:${color}">${escapeHtml(label)}</span><span class="pval">${count} pz · ${escapeHtml(fmtEuro(amount))}</span></div>
        <div class="pbar"><i style="width:${width}%;background:linear-gradient(90deg,${color},${color}66)"></i></div>
        <div class="pmeta">${chips}${delta}</div>
      </div>`;
    })
    .join("\n        ");
  return `<div class="card"><h2>La gara delle piste</h2>
        ${rows}
    </div>`;
}

function tipiSection(a: DailyReportAggregates): string {
  const active = REPORT_TYPE_ORDER.filter((t) => a.countByType[t] > 0);
  if (active.length === 0) return "";
  const totalPz = active.reduce((s, t) => s + a.countByType[t], 0);
  const donut = svgDonut(
    active.map((t) => ({ value: a.countByType[t], color: TYPE_THEME[t] })),
    String(totalPz),
  );
  const legend = active
    .map(
      (t) =>
        `<div class="lrow"><span class="ldot" style="background:${TYPE_THEME[t]}"></span><span class="lname">${escapeHtml(TYPE_LABELS[t])}</span><span class="lval">${a.countByType[t]} pz · ${escapeHtml(fmtEuro(a.amountByType[t]))}</span></div>`,
    )
    .join("");
  return `<div class="card"><h2>Mix del giorno</h2>
      <div class="mix"><div class="mix-donut">${donut}</div><div class="mix-legend">${legend}</div></div>
    </div>`;
}

function rankBar(pct: number, color: string): string {
  const width = Math.max(3, Math.min(100, Math.round(pct)));
  return `<div class="bar"><i style="width:${width}%;background:linear-gradient(90deg,${color},${color}66)"></i></div>`;
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
        ${rankBar((pdv.importo / maxImporto) * 100, ORANGE)}
      </div>`;
    })
    .join("\n        ");
  return `<div class="card"><h2>Per punto vendita</h2>
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
        ${rankBar((add.importo / maxImporto) * 100, "#60a5fa")}
      </div>`;
    })
    .join("\n        ");
  return `<div class="card"><h2>Per addetto</h2>
        ${rows}
    </div>`;
}

/**
 * Costruisce il documento HTML standalone del report giornaliero: tema
 * scuro glass, accento arancione WindTre, grafici SVG inline. Tutti i
 * valori dinamici sono escapati; nessuna risorsa esterna.
 */
export function buildVenditeReportHtml(p: VenditeReportHtmlParams): string {
  const a = p.aggregates;
  const dateLabel = fmtReportDate(p.dateYMD);
  const title = `Report vendite ${dateLabel}`;
  const trend = p.trend && p.trend.length >= 2 ? p.trend : undefined;
  const when = p.timeLabel ? `${escapeHtml(dateLabel)} · ore ${escapeHtml(p.timeLabel)}` : escapeHtml(dateLabel);

  const sections: string[] = [];
  sections.push(heroSection(a, trend));
  if (a.vendite === 0) {
    sections.push(`<div class="card empty">Nessuna vendita registrata oggi.</div>`);
    sections.push(trendSection(trend));
  } else {
    sections.push(highlightsSection(a));
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
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14px; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background: radial-gradient(1000px 500px at 50% -100px, #1e2a45 0%, #0b1220 55%) #0b1220;
         color: #e2e8f0; }
  .wrap { max-width: 640px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
           margin: 4px 2px 14px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 15px; color: #f8fafc; }
  .brand-dot { width: 10px; height: 10px; border-radius: 999px;
               background: linear-gradient(135deg, #ffb347, ${ORANGE}); box-shadow: 0 0 12px ${ORANGE}aa; }
  .when { color: #94a3b8; font-size: 13px; }
  .hero { position: relative; overflow: hidden; text-align: center; padding: 30px 18px 24px;
          border-radius: 22px; margin-bottom: 12px;
          background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); }
  .hero-glow { position: absolute; inset: -40% -20% auto; height: 150%; pointer-events: none;
               background: radial-gradient(closest-side, ${ORANGE}55, transparent 70%); }
  .hero-label { position: relative; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: #fdba74; }
  .hero-num { position: relative; font-size: 64px; font-weight: 800; line-height: 1.02; margin: 2px 0;
              background: linear-gradient(180deg, #fff, #fdba74); -webkit-background-clip: text;
              background-clip: text; color: transparent; }
  .hero-sub { position: relative; font-size: 16px; font-weight: 700; color: #f8fafc; }
  .hero-sub-dim { font-weight: 400; color: #94a3b8; font-size: 13px; }
  .hero-chips { position: relative; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 12px; }
  .delta { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
  .delta.up { color: #4ade80; background: rgba(74,222,128,.12); border: 1px solid rgba(74,222,128,.3); }
  .delta.down { color: #f87171; background: rgba(248,113,113,.12); border: 1px solid rgba(248,113,113,.3); }
  .delta.flat { color: #94a3b8; background: rgba(148,163,184,.1); border: 1px solid rgba(148,163,184,.25); }
  .hls { display: flex; gap: 10px; margin-bottom: 12px; }
  .hl { flex: 1 1 0; min-width: 0; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
        border-radius: 16px; padding: 12px 10px; text-align: center; }
  .hl-icon { font-size: 18px; }
  .hl-k { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; margin-top: 2px; }
  .hl-v { font-size: 13px; font-weight: 700; color: #f8fafc; margin-top: 2px; overflow-wrap: anywhere; }
  .hl-s { font-size: 11px; color: #94a3b8; margin-top: 1px; }
  .card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
          border-radius: 18px; padding: 16px; margin-bottom: 12px; }
  .card.empty { text-align: center; color: #94a3b8; padding: 32px 16px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; color: #fdba74; margin: 0 0 12px; }
  .axis { display: flex; justify-content: space-between; color: #64748b; font-size: 11px; margin-top: 4px; }
  .prow { padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
  .prow:last-child { border-bottom: none; padding-bottom: 2px; }
  .prow-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .pname { font-weight: 800; font-size: 15px; letter-spacing: .02em; }
  .pval { font-size: 13px; font-weight: 600; color: #cbd5e1; white-space: nowrap; }
  .pbar { height: 10px; border-radius: 999px; background: rgba(255,255,255,.06); overflow: hidden; margin: 7px 0 6px; }
  .pbar i { display: block; height: 100%; border-radius: 999px; }
  .pmeta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .chip { font-size: 11px; color: #cbd5e1; background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.1); border-radius: 999px; padding: 2px 8px; }
  .mix { display: flex; gap: 16px; align-items: center; }
  .mix-donut { flex: 0 0 auto; }
  .mix-legend { flex: 1 1 auto; min-width: 0; }
  .lrow { display: flex; align-items: center; gap: 8px; padding: 6px 0;
          border-bottom: 1px solid rgba(255,255,255,.06); font-size: 13px; }
  .lrow:last-child { border-bottom: none; }
  .ldot { width: 10px; height: 10px; border-radius: 999px; flex: 0 0 auto; }
  .lname { font-weight: 700; color: #f8fafc; }
  .lval { margin-left: auto; color: #94a3b8; white-space: nowrap; }
  .rank { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
  .rank:last-child { border-bottom: none; }
  .rank-top { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; }
  .rank-name { font-weight: 600; color: #f8fafc; min-width: 0; overflow-wrap: anywhere; }
  .rank-val { font-weight: 700; color: #f8fafc; white-space: nowrap; }
  .rank-sub { color: #94a3b8; font-size: 12px; margin: 1px 0 5px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
  .bar { height: 6px; background: rgba(255,255,255,.06); border-radius: 999px; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 999px; }
  footer { color: #64748b; font-size: 12px; text-align: center; margin: 18px 0 8px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand"><span class="brand-dot"></span>${escapeHtml(p.orgName)}</div>
      <div class="when">${when}</div>
    </header>
    ${sections.filter(Boolean).join("\n    ")}
    <footer>Report vendite generato automaticamente · vendite ANNULLATA escluse</footer>
  </div>
</body>
</html>
`;
}
