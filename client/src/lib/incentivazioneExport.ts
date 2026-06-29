import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { fmtV } from "@shared/incentivazione";
import type { Employee, Section, Track, CalendarInfo, Semaforo } from "@shared/incentivazione";
import { incExportFileBase } from "@shared/incentivazioneExport";

const MONTHS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

// Colori semaforo (equivalenti hex degli HSL usati a video).
const SEM_HEX: Record<Semaforo, string> = {
  g: "#22c55e",
  a: "#f59e0b",
  r: "#ef4444",
  u: "#94a3b8",
};

// Pill di stato come nella scheda.
const PILL: Record<Semaforo, { bg: string; fg: string; label: string }> = {
  g: { bg: "#dcfce7", fg: "#166534", label: "✓ Premio" },
  a: { bg: "#fef3c7", fg: "#92400e", label: "⟳ In proiezione" },
  r: { bg: "#fee2e2", fg: "#991b1b", label: "✕ A rischio" },
  u: { bg: "#f1f5f9", fg: "#64748b", label: "—" },
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lockName(name: string): string {
  return name.replace(/ \(S[0-9]+\).*/, "").replace(/ [—–].*/, "");
}

function trackRowHtml(emp: Employee, t: Track): string {
  const td = emp.tds[t.id];
  const live = t.live ? `<span style="margin-left:4px;font-size:8px;color:#f97316;">●live</span>` : "";
  if (!td || td.actual === null) {
    return `
      <div style="margin-top:6px;font-size:10px;color:#334155;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="display:flex;align-items:center;gap:5px;min-width:0;">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${SEM_HEX.u};"></span>
            <span>${esc(t.name)}${live}</span>
          </span>
          <span style="color:#94a3b8;">—</span>
        </div>
      </div>`;
  }
  const sem = td.sem;
  const pct = Math.min(100, Math.round((td.actual / td.target) * 100));
  return `
    <div style="margin-top:6px;font-size:10px;color:#334155;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="display:flex;align-items:center;gap:5px;min-width:0;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${SEM_HEX[sem]};"></span>
          <span>${esc(t.name)}${live}</span>
        </span>
        <span style="white-space:nowrap;font-variant-numeric:tabular-nums;">
          ${esc(fmtV(td.actual, t.unit))} → <span style="color:${SEM_HEX[sem]};font-weight:600;">${esc(fmtV(td.proj, t.unit))}</span> / ${esc(fmtV(td.target, t.unit))}
        </span>
      </div>
      <div style="height:5px;border-radius:999px;background:#e5e7eb;overflow:hidden;margin-top:4px;">
        <div style="height:100%;width:${pct}%;background:${SEM_HEX[sem]};"></div>
      </div>
    </div>`;
}

function locksHtml(emp: Employee): string {
  if (emp.locks.length === 0) return "";
  const badges = emp.locks.map((l) => `
    <span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;padding:2px 6px;border-radius:6px;background:${SEM_HEX[l.sem]}22;color:${SEM_HEX[l.sem]};">
      ${l.sem === "g" ? "🔓" : "🔒"} ${esc(lockName(l.name))}
    </span>`).join("");
  return `
    <div style="margin-top:8px;">
      <div style="font-size:9px;color:#64748b;margin-bottom:4px;">🔒 Lucchetti bloccanti (${emp.locks.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${badges}</div>
    </div>`;
}

function cardHtml(emp: Employee, tracks: Track[]): string {
  const pill = PILL[emp.status];
  const rows = tracks.filter((t) => !t.sub).map((t) => trackRowHtml(emp, t)).join("");
  return `
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff;break-inside:avoid;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="flex:1;min-width:0;font-weight:700;font-size:12px;line-height:1.25;color:#0f172a;word-break:break-word;">${esc(emp.name)}</div>
        <span style="flex-shrink:0;font-size:9px;font-weight:600;padding:3px 8px;border-radius:999px;background:${pill.bg};color:${pill.fg};white-space:nowrap;">${esc(pill.label)}</span>
      </div>
      ${locksHtml(emp)}
      <div style="margin-top:8px;">${rows}</div>
    </div>`;
}

export interface IncExportOpts {
  section: Section;
  emps: Employee[];
  calendar?: CalendarInfo;
  counts: { g: number; a: number; r: number; unlock: number };
  totalEmps: number;
  month: number;
  year: number;
}

// Dimensioni pagina in px (A4 portrait @96dpi) per impaginare card-per-card.
const PAGE_W = 794;
const PAGE_H = 1123;
const PAGE_PAD = 28;
const COLS = 3;

/** Genera e scarica il PDF della sezione gara, fedele alle schede a video.
 *  Impagina riga-per-riga di card così ogni pagina è un canvas piccolo
 *  (niente limiti di dimensione del browser) e nessuna card viene tagliata. */
export async function exportIncentivazionePdf(o: IncExportOpts): Promise<void> {
  const tracks = o.section.tracks;
  const cal = o.calendar;
  const calLine = cal
    ? `Giorni lavorativi: ${cal.el} trascorsi · ${cal.rem} rimanenti · ${cal.tot} totali · proiezione ×${cal.mult ? cal.mult.toFixed(2) : "—"} · avanzamento ${cal.pct}%`
    : "";
  const summaryLine = `Addetti ${o.totalEmps} · 🟢 Premio ${o.counts.g} · 🟡 In proiezione ${o.counts.a} · 🔴 A rischio ${o.counts.r} · 🔓 Sblocco gara ${o.counts.unlock} · Base ${o.section.base ?? "—"}€`;
  const headerHtml = `
    <div style="margin-bottom:4px;font-size:22px;font-weight:700;color:#0f172a;">Incentivazione interna · Gare addetto</div>
    <div style="font-size:13px;color:#475569;margin-bottom:6px;">${esc(o.section.op)} · ${esc(o.section.label)} — ${MONTHS[o.month - 1]} ${o.year}</div>
    ${calLine ? `<div style="font-size:11px;color:#64748b;">${esc(calLine)}</div>` : ""}
    <div style="font-size:11px;color:#64748b;margin-bottom:14px;">${esc(summaryLine)}</div>`;

  const makePage = (withHeader: boolean): { page: HTMLDivElement; grid: HTMLDivElement } => {
    const page = document.createElement("div");
    page.style.cssText = `position:fixed;left:-99999px;top:0;width:${PAGE_W}px;background:#ffffff;color:#0f172a;font-family:Arial,Helvetica,sans-serif;padding:${PAGE_PAD}px;box-sizing:border-box;`;
    if (withHeader) page.innerHTML = headerHtml;
    const grid = document.createElement("div");
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${COLS},1fr);gap:12px;align-items:start;`;
    page.appendChild(grid);
    document.body.appendChild(page);
    return { page, grid };
  };

  // Raggruppa gli addetti per riga (COLS card per riga) e impaginali greedy.
  const rows: Employee[][] = [];
  for (let i = 0; i < o.emps.length; i += COLS) rows.push(o.emps.slice(i, i + COLS));

  const pages: { page: HTMLDivElement; grid: HTMLDivElement }[] = [];
  let cur = makePage(true);
  for (const row of rows) {
    const html = row.map((e) => cardHtml(e, tracks)).join("");
    const before = cur.grid.childElementCount;
    cur.grid.insertAdjacentHTML("beforeend", html);
    if (cur.page.offsetHeight > PAGE_H && before > 0) {
      for (let k = 0; k < row.length; k++) {
        if (cur.grid.lastElementChild) cur.grid.removeChild(cur.grid.lastElementChild);
      }
      pages.push(cur);
      cur = makePage(false);
      cur.grid.insertAdjacentHTML("beforeend", html);
    }
  }
  pages.push(cur);

  try {
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i].page, { scale: 2, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      let imgW = pw;
      let imgH = (canvas.height * imgW) / canvas.width;
      let x = 0;
      if (imgH > ph) {
        // Caso limite (riga più alta di una pagina): adatta all'altezza, centra.
        imgW = (canvas.width * ph) / canvas.height;
        imgH = ph;
        x = (pw - imgW) / 2;
      }
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", x, 0, imgW, imgH);
    }
    pdf.save(`${incExportFileBase(o.section, o.month, o.year)}.pdf`);
  } finally {
    pages.forEach((p) => { if (p.page.parentNode) document.body.removeChild(p.page); });
  }
}

/** Genera e scarica l'Excel della sezione gara. Gli addetti vengono scritti
 *  nell'ordine in cui arrivano in `o.emps` (l'intera lista già ordinata
 *  dalla vista, identica a quella usata dal PDF), così la tabella scaricata
 *  rispetta l'ordinamento selezionato a schermo (Stato o pista, asc/desc). */
export function exportIncentivazioneExcel(o: IncExportOpts): void {
  const tracks = o.section.tracks.filter((t) => !t.sub);
  const cal = o.calendar;
  const calLine = cal
    ? `Giorni lavorativi: ${cal.el} trascorsi · ${cal.rem} rimanenti · ${cal.tot} totali · proiezione ×${cal.mult ? cal.mult.toFixed(2) : "—"} · avanzamento ${cal.pct}%`
    : "";
  const summaryLine = `Addetti ${o.totalEmps} · Premio ${o.counts.g} · In proiezione ${o.counts.a} · A rischio ${o.counts.r} · Sblocco gara ${o.counts.unlock} · Base ${o.section.base ?? "—"}€`;

  const aoa: (string | number)[][] = [];
  aoa.push(["Incentivazione interna · Gare addetto"]);
  aoa.push([`${o.section.op} · ${o.section.label} — ${MONTHS[o.month - 1]} ${o.year}`]);
  if (calLine) aoa.push([calLine]);
  aoa.push([summaryLine]);
  aoa.push([]);

  const head: string[] = ["Addetto", "Stato"];
  for (const t of tracks) {
    head.push(`${t.name} (attuale)`, `${t.name} (proiezione)`, `${t.name} (target)`);
  }
  aoa.push(head);

  for (const emp of o.emps) {
    const row: (string | number)[] = [emp.name, PILL[emp.status].label];
    for (const t of tracks) {
      const td = emp.tds[t.id];
      row.push(
        td && td.actual !== null ? td.actual : "—",
        td && td.proj !== null ? td.proj : "—",
        td ? td.target : t.target,
      );
    }
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = head.map((_, i) => ({ wch: i === 0 ? 28 : i === 1 ? 16 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Addetti");
  XLSX.writeFile(wb, `${incExportFileBase(o.section, o.month, o.year)}.xlsx`);
}

/** Genera e scarica un file HTML autonomo e interattivo della sezione gara.
 *  A differenza del PDF (immagine statica) l'HTML incorpora l'intero organico
 *  come dati + uno script vanilla che replica ricerca, ordinamento (Stato o
 *  pista, asc/desc) e filtro stato della vista a schermo, così il file scaricato
 *  resta consultabile e "editabile" offline con gli stessi controlli. */
export function exportIncentivazioneHtml(o: IncExportOpts): void {
  const tracks = o.section.tracks.filter((t) => !t.sub);
  const cal = o.calendar;
  const calLine = cal
    ? `Giorni lavorativi: ${cal.el} trascorsi · ${cal.rem} rimanenti · ${cal.tot} totali · proiezione ×${cal.mult ? cal.mult.toFixed(2) : "—"} · avanzamento ${cal.pct}%`
    : "";
  const summaryLine = `Addetti ${o.totalEmps} · 🟢 Premio ${o.counts.g} · 🟡 In proiezione ${o.counts.a} · 🔴 A rischio ${o.counts.r} · 🔓 Sblocco gara ${o.counts.unlock} · Base ${o.section.base ?? "—"}€`;

  // Dati minimi per il rendering client-side (intero organico, già ordinato).
  const empData = o.emps.map((e) => ({
    name: e.name,
    status: e.status,
    locks: e.locks.map((l) => ({ name: lockName(l.name), sem: l.sem })),
    tds: tracks.reduce((acc, t) => {
      const td = e.tds[t.id];
      acc[t.id] = td
        ? { actual: td.actual, proj: td.proj, target: td.target, sem: td.sem }
        : null;
      return acc;
    }, {} as Record<string, { actual: number | null; proj: number | null; target: number; sem: Semaforo } | null>),
  }));
  const trackData = tracks.map((t) => ({ id: t.id, name: t.name, unit: t.unit, live: !!t.live }));

  const payload = {
    title: `${o.section.op} · ${o.section.label} — ${MONTHS[o.month - 1]} ${o.year}`,
    calLine,
    summaryLine,
    semHex: SEM_HEX,
    pill: PILL,
    tracks: trackData,
    emps: empData,
  };
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(payload.title)} · Incentivazione interna</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f8fafc; color: #0f172a; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #475569; margin-bottom: 6px; }
  .meta { font-size: 11px; color: #64748b; margin-bottom: 4px; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 16px 0; }
  input, select, button { font: inherit; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #0f172a; }
  button { cursor: pointer; }
  button.active { background: #0f172a; color: #fff; border-color: #0f172a; }
  .count { font-size: 12px; color: #64748b; margin-left: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; background: #fff; }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .name { flex: 1; min-width: 0; font-weight: 700; font-size: 13px; line-height: 1.25; word-break: break-word; }
  .pill { flex-shrink: 0; font-size: 9px; font-weight: 600; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
  .track { margin-top: 6px; font-size: 11px; color: #334155; }
  .track-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
  .track-label { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .live { margin-left: 4px; font-size: 8px; color: #f97316; }
  .vals { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .bar { height: 5px; border-radius: 999px; background: #e5e7eb; overflow: hidden; margin-top: 4px; }
  .bar > div { height: 100%; }
  .locks { margin-top: 8px; }
  .locks-title { font-size: 9px; color: #64748b; margin-bottom: 4px; }
  .lock { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; padding: 2px 6px; border-radius: 6px; margin: 0 4px 4px 0; }
  .empty { padding: 40px; text-align: center; color: #64748b; }
</style>
</head>
<body>
  <h1>Incentivazione interna · Gare addetto</h1>
  <div class="sub">${esc(payload.title)}</div>
  ${calLine ? `<div class="meta">${esc(calLine)}</div>` : ""}
  <div class="meta">${esc(summaryLine)}</div>

  <div class="controls">
    <input id="q" type="search" placeholder="Cerca addetto…" />
    <label>Ordina per
      <select id="sortKey">
        <option value="status">Stato</option>
        ${tracks.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}
      </select>
    </label>
    <button id="dir" data-dir="desc" title="Direzione">↓ Decrescente</button>
    <button class="status-filter active" data-status="all">Tutti</button>
    <button class="status-filter" data-status="g">🟢 Premio</button>
    <button class="status-filter" data-status="a">🟡 In proiezione</button>
    <button class="status-filter" data-status="r">🔴 A rischio</button>
    <span class="count" id="count"></span>
  </div>

  <div id="grid" class="grid"></div>

<script>
const DATA = ${json};
const STATUS_ORDER = { r: 0, a: 1, g: 2, u: 1 };
const state = { q: "", sortKey: "status", dir: "desc", status: "all" };

function fmtV(v, unit) {
  if (v === null || v === undefined) return "—";
  if (unit === "€") return Math.round(v).toLocaleString("it-IT") + "€";
  return Math.round(v * 10) / 10 + " " + unit;
}
function byName(a, b) { return a.name.localeCompare(b.name, "it"); }
function sortEmps(emps, key, dir) {
  const arr = emps.slice();
  if (key === "status") {
    arr.sort((a, b) => {
      const d = (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0);
      return dir === "desc" ? d : -d;
    });
    return arr;
  }
  const factor = dir === "desc" ? -1 : 1;
  arr.sort((a, b) => {
    const at = a.tds[key], bt = b.tds[key];
    const av = at ? at.actual : null, bv = bt ? bt.actual : null;
    if (av === null && bv === null) return byName(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return (av - bv) * factor;
    const ap = at ? at.proj : null, bp = bt ? bt.proj : null;
    if (ap !== null && bp !== null && ap !== bp) return (ap - bp) * factor;
    return byName(a, b);
  });
  return arr;
}
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function trackRow(emp, t) {
  const td = emp.tds[t.id];
  const live = t.live ? '<span class="live">●live</span>' : "";
  if (!td || td.actual === null) {
    return '<div class="track"><div class="track-row"><span class="track-label">'
      + '<span class="dot" style="background:' + DATA.semHex.u + '"></span>'
      + '<span>' + escHtml(t.name) + live + '</span></span><span style="color:#94a3b8">—</span></div></div>';
  }
  const color = DATA.semHex[td.sem];
  const pct = Math.min(100, Math.round((td.actual / td.target) * 100));
  return '<div class="track"><div class="track-row"><span class="track-label">'
    + '<span class="dot" style="background:' + color + '"></span>'
    + '<span>' + escHtml(t.name) + live + '</span></span>'
    + '<span class="vals">' + escHtml(fmtV(td.actual, t.unit)) + ' → <span style="color:' + color + ';font-weight:600">'
    + escHtml(fmtV(td.proj, t.unit)) + '</span> / ' + escHtml(fmtV(td.target, t.unit)) + '</span></div>'
    + '<div class="bar"><div style="width:' + pct + '%;background:' + color + '"></div></div></div>';
}
function locksHtml(emp) {
  if (!emp.locks.length) return "";
  const badges = emp.locks.map(function (l) {
    return '<span class="lock" style="background:' + DATA.semHex[l.sem] + '22;color:' + DATA.semHex[l.sem] + '">'
      + (l.sem === "g" ? "🔓" : "🔒") + " " + escHtml(l.name) + "</span>";
  }).join("");
  return '<div class="locks"><div class="locks-title">🔒 Lucchetti bloccanti (' + emp.locks.length + ')</div><div>' + badges + "</div></div>";
}
function cardHtml(emp) {
  const pill = DATA.pill[emp.status];
  const rows = DATA.tracks.map(function (t) { return trackRow(emp, t); }).join("");
  return '<div class="card"><div class="card-head"><div class="name">' + escHtml(emp.name) + "</div>"
    + '<span class="pill" style="background:' + pill.bg + ";color:" + pill.fg + '">' + escHtml(pill.label) + "</span></div>"
    + locksHtml(emp) + '<div style="margin-top:8px">' + rows + "</div></div>";
}
function render() {
  let list = DATA.emps.filter(function (e) {
    if (state.status !== "all" && e.status !== state.status) return false;
    if (state.q && e.name.toLowerCase().indexOf(state.q.toLowerCase()) === -1) return false;
    return true;
  });
  const key = state.sortKey !== "status" && !DATA.tracks.some(function (t) { return t.id === state.sortKey; }) ? "status" : state.sortKey;
  list = sortEmps(list, key, state.dir);
  const grid = document.getElementById("grid");
  grid.innerHTML = list.length
    ? list.map(cardHtml).join("")
    : '<div class="empty">Nessun addetto corrisponde ai filtri.</div>';
  document.getElementById("count").textContent = list.length + " / " + DATA.emps.length + " addetti";
}
document.getElementById("q").addEventListener("input", function (e) { state.q = e.target.value; render(); });
document.getElementById("sortKey").addEventListener("change", function (e) { state.sortKey = e.target.value; render(); });
document.getElementById("dir").addEventListener("click", function (e) {
  state.dir = state.dir === "desc" ? "asc" : "desc";
  e.target.dataset.dir = state.dir;
  e.target.textContent = state.dir === "desc" ? "↓ Decrescente" : "↑ Crescente";
  render();
});
Array.prototype.forEach.call(document.querySelectorAll(".status-filter"), function (btn) {
  btn.addEventListener("click", function () {
    state.status = btn.dataset.status;
    Array.prototype.forEach.call(document.querySelectorAll(".status-filter"), function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    render();
  });
});
render();
</script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${incExportFileBase(o.section, o.month, o.year)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
