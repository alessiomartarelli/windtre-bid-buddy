// Report vendite giornaliero in formato HTML (Task #248): file standalone
// allegato al messaggio Telegram, che replica la leggibilità della pagina
// "Vendite BiSuite" (KPI card, badge colorati per tipo/pista, tabella per
// PDV, sezione per addetto). Logica PURA: nessun import React/server, solo
// import relativi — caricabile via loader tsx nei test.
import {
  type DailyReportAggregates,
  REPORT_PISTA_ORDER,
  REPORT_TYPE_ORDER,
  fmtEuro,
  fmtReportDate,
} from "./venditeReport";
import {
  type ArticleType,
  type PistaCanvass,
  PISTA_CANVASS_LABELS,
  TYPE_LABELS,
} from "./bisuiteClassification";

// Palette inline coerente coi badge Tailwind della pagina Vendite BiSuite
// (bg-*-500/10, text-*-700, border-*-500/20) tradotti in colori CSS reali:
// il file HTML deve essere standalone, senza Tailwind.
const TYPE_CSS: Record<ArticleType, { bg: string; border: string; text: string }> = {
  canvass: { bg: "rgba(249,115,22,.10)", border: "rgba(249,115,22,.25)", text: "#c2410c" },
  prodotti: { bg: "rgba(100,116,139,.10)", border: "rgba(100,116,139,.25)", text: "#334155" },
  servizi: { bg: "rgba(6,182,212,.10)", border: "rgba(6,182,212,.25)", text: "#0e7490" },
};

const PISTA_CSS: Record<PistaCanvass, { bg: string; border: string; text: string }> = {
  mobile: { bg: "rgba(59,130,246,.10)", border: "rgba(59,130,246,.25)", text: "#1d4ed8" },
  fisso: { bg: "rgba(168,85,247,.10)", border: "rgba(168,85,247,.25)", text: "#7e22ce" },
  cb: { bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.25)", text: "#b45309" },
  assicurazioni: { bg: "rgba(20,184,166,.10)", border: "rgba(20,184,166,.25)", text: "#0f766e" },
  protecta: { bg: "rgba(239,68,68,.10)", border: "rgba(239,68,68,.25)", text: "#b91c1c" },
  energia: { bg: "rgba(34,197,94,.10)", border: "rgba(34,197,94,.25)", text: "#15803d" },
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
}

function badge(label: string, count: number, amount: number, c: { bg: string; border: string; text: string }): string {
  return (
    `<span class="badge" style="background:${c.bg};border-color:${c.border};color:${c.text}">` +
    `${escapeHtml(label)} <b>${count} pz</b> · ${escapeHtml(fmtEuro(amount))}</span>`
  );
}

/**
 * Costruisce il documento HTML standalone del report giornaliero.
 * Tutti i valori dinamici sono escapati; CSS inline nel <head>, nessuna
 * risorsa esterna (il file deve aprirsi offline da Telegram).
 */
export function buildVenditeReportHtml(p: VenditeReportHtmlParams): string {
  const a = p.aggregates;
  const title = `Report vendite ${fmtReportDate(p.dateYMD)}`;
  const subtitle = [p.orgName, p.timeLabel ? `ore ${p.timeLabel}` : ""].filter(Boolean).join(" — ");

  const typeBadges = REPORT_TYPE_ORDER
    .filter((t) => a.countByType[t] > 0)
    .map((t) => badge(TYPE_LABELS[t], a.countByType[t], a.amountByType[t], TYPE_CSS[t]))
    .join("\n        ");

  const pistaBadges = REPORT_PISTA_ORDER
    .filter((pista) => (a.countByPista[pista] ?? 0) > 0)
    .map((pista) =>
      badge(PISTA_CANVASS_LABELS[pista], a.countByPista[pista] ?? 0, a.amountByPista[pista] ?? 0, PISTA_CSS[pista]),
    )
    .join("\n        ");

  const pdvRows = a.perPdv
    .map(
      (pdv) =>
        `<tr><td>${escapeHtml(pdv.nomeNegozio || "N/D")}</td><td class="mono">${escapeHtml(pdv.codicePos)}</td>` +
        `<td class="num">${pdv.vendite}</td><td class="num strong">${escapeHtml(fmtEuro(pdv.importo))}</td></tr>`,
    )
    .join("\n          ");

  const addettoRows = a.perAddetto
    .map(
      (add) =>
        `<tr><td>${escapeHtml(add.nomeAddetto)}</td>` +
        `<td class="num">${add.vendite}</td><td class="num strong">${escapeHtml(fmtEuro(add.importo))}</td></tr>`,
    )
    .join("\n          ");

  const body =
    a.vendite === 0
      ? `<div class="card empty">Nessuna vendita registrata oggi.</div>`
      : `<div class="kpis">
      <div class="card kpi"><div class="kpi-label">Vendite</div><div class="kpi-value">${a.vendite}</div></div>
      <div class="card kpi"><div class="kpi-label">Importo totale</div><div class="kpi-value">${escapeHtml(fmtEuro(a.importo))}</div></div>
    </div>
    ${typeBadges ? `<div class="card"><h2>Per tipo</h2><div class="badges">
        ${typeBadges}
    </div></div>` : ""}
    ${pistaBadges ? `<div class="card"><h2>Per pista</h2><div class="badges">
        ${pistaBadges}
    </div></div>` : ""}
    ${pdvRows ? `<div class="card"><h2>Per punto vendita</h2>
      <table>
        <thead><tr><th>Negozio</th><th>Codice POS</th><th class="num">Vendite</th><th class="num">Importo</th></tr></thead>
        <tbody>
          ${pdvRows}
        </tbody>
      </table>
    </div>` : ""}
    ${addettoRows ? `<div class="card"><h2>Per addetto</h2>
      <table>
        <thead><tr><th>Addetto</th><th class="num">Vendite</th><th class="num">Importo</th></tr></thead>
        <tbody>
          ${addettoRows}
        </tbody>
      </table>
    </div>` : ""}`;

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(p.orgName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background: #f1f5f9; color: #0f172a; }
  .wrap { max-width: 760px; margin: 0 auto; }
  header { margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #475569; font-size: 14px; margin: 0; }
  .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px;
          margin-bottom: 12px; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
  .card.empty { text-align: center; color: #475569; padding: 32px 16px; }
  .kpis { display: flex; gap: 12px; flex-wrap: wrap; }
  .kpi { flex: 1 1 160px; margin-bottom: 12px; }
  .kpi-label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  .kpi-value { font-size: 26px; font-weight: 700; margin-top: 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin: 0 0 10px; }
  .badges { display: flex; flex-wrap: wrap; gap: 8px; }
  .badge { display: inline-block; border: 1px solid; border-radius: 999px; padding: 4px 12px;
           font-size: 13px; white-space: nowrap; }
  .badge b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b;
       padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  td { padding: 8px; border-bottom: 1px solid #f1f5f9; }
  tbody tr:last-child td { border-bottom: none; }
  .num { text-align: right; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; color: #475569; }
  .strong { font-weight: 600; }
  footer { color: #94a3b8; font-size: 12px; text-align: center; margin-top: 16px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>📊 ${escapeHtml(title)}</h1>
      <p class="sub">${escapeHtml(subtitle)}</p>
    </header>
    ${body}
    <footer>Report generato automaticamente — vendite ANNULLATA escluse.</footer>
  </div>
</body>
</html>
`;
}
