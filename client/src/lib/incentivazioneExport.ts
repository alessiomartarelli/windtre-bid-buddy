import jsPDF from "jspdf";
import html2canvas from "html2canvas";
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
