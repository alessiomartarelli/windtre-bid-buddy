import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Employee, Section, CalendarInfo } from "@shared/incentivazione";
import { incExportHead, incExportBody, incExportFileBase } from "@shared/incentivazioneExport";

const MONTHS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

export interface IncExportOpts {
  section: Section;
  emps: Employee[];
  calendar?: CalendarInfo;
  counts: { g: number; a: number; r: number; unlock: number };
  totalEmps: number;
  month: number;
  year: number;
}

/** Genera e scarica il PDF della sezione gara attiva (addetti × piste). */
export function exportIncentivazionePdf(o: IncExportOpts): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const marginX = 32;
  let y = 40;

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("Incentivazione interna · Gare addetto", marginX, y);

  y += 18;
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(`${o.section.op} · ${o.section.label} — ${MONTHS[o.month - 1]} ${o.year}`, marginX, y);

  if (o.calendar) {
    const c = o.calendar;
    y += 15;
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      `Giorni lavorativi: ${c.el} trascorsi · ${c.rem} rimanenti · ${c.tot} totali · proiezione ×${c.mult ? c.mult.toFixed(2) : "—"} · avanzamento ${c.pct}%`,
      marginX, y,
    );
  }

  y += 13;
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `Addetti ${o.totalEmps} · Premio ${o.counts.g} · In proiezione ${o.counts.a} · A rischio ${o.counts.r} · Sblocco gara ${o.counts.unlock} · Base ${o.section.base ?? "—"}€`,
    marginX, y,
  );

  autoTable(doc, {
    startY: y + 10,
    head: [incExportHead(o.section)],
    body: incExportBody(o.section, o.emps),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [234, 88, 12], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    columnStyles: {
      0: { cellWidth: 92, fontStyle: "bold" },
      1: { cellWidth: 64 },
      2: { cellWidth: 44, halign: "center" },
    },
    margin: { left: marginX, right: marginX },
  });

  doc.save(`${incExportFileBase(o.section, o.month, o.year)}.pdf`);
}
