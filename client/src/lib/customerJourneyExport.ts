import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { CJ_DRIVER_ORDER } from "@shared/customerJourney";
import type { CustomerJourney, CustomerJourneyItem, CjDriver } from "@shared/schema";
import {
  CJ_DRIVER_EMOJI, LIST_FIXED_COLS,
  type CjExportDriverSummary, type CjListJourney,
  journeyTitle, detailMeta, detailFileBase,
  driverTableHead, driverTableBody, contractsHead, contractsBody,
  detailExcelHeaderRows,
  listSubtitle, listPdfHead, listPdfBody,
  listExcelHeaderRows, listExcelHead, listExcelBody,
} from "@shared/customerJourneyExport";
import { CJ_DRIVER_ICONS } from "./customerJourneyIcons";

export type DriverSummary = CjExportDriverSummary;

export interface JourneyExportData {
  journey: CustomerJourney;
  items: CustomerJourneyItem[];
  drivers: DriverSummary[];
}

export interface JourneyListExportData {
  journeys: CjListJourney[];
  filterLabel?: string;
}

// Rasterizza un'icona lucide (la stessa mostrata a schermo) in un PNG dataURL,
// così l'export PDF mostra esattamente l'icona della UI. Async perché passa da
// un <img> con sorgente SVG.
function iconToPngDataUrl(driver: CjDriver, px = 64): Promise<string | null> {
  const Icon = CJ_DRIVER_ICONS[driver];
  if (!Icon) return Promise.resolve(null);
  const svg = renderToStaticMarkup(
    createElement(Icon, {
      color: "#1f2937",
      width: px,
      height: px,
      strokeWidth: 2,
      xmlns: "http://www.w3.org/2000/svg",
    } as any),
  );
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, px, px);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function buildIconMap(): Promise<Record<string, string>> {
  const entries = await Promise.all(
    CJ_DRIVER_ORDER.map(async (d) => [d, await iconToPngDataUrl(d)] as const),
  );
  const map: Record<string, string> = {};
  for (const [d, png] of entries) {
    if (png) map[d] = png;
  }
  return map;
}

export async function exportJourneyPdf(data: JourneyExportData): Promise<void> {
  const { journey, items, drivers } = data;
  const iconMap = await buildIconMap();
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text("Customer Journey", 14, 20);

  doc.setFontSize(13);
  doc.text(journeyTitle(journey), 14, 28);

  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(detailMeta(journey), 14, 34);

  // Sezione Driver: icona + nome + stato.
  doc.setFontSize(13);
  doc.setTextColor(40, 40, 40);
  doc.text("Driver", 14, 44);

  autoTable(doc, {
    startY: 48,
    head: [driverTableHead()],
    body: driverTableBody(drivers, false),
    styles: { fontSize: 9, cellPadding: 2, valign: "middle" },
    headStyles: { fillColor: [99, 102, 241] },
    columnStyles: { 0: { cellWidth: 10 } },
    didDrawCell: (hook) => {
      if (hook.section !== "body" || hook.column.index !== 0) return;
      const driver = CJ_DRIVER_ORDER[hook.row.index];
      const png = iconMap[driver];
      if (!png) return;
      const size = 5;
      const x = hook.cell.x + (hook.cell.width - size) / 2;
      const y = hook.cell.y + (hook.cell.height - size) / 2;
      doc.addImage(png, "PNG", x, y, size, size);
    },
  });

  // Sezione Contratti.
  const afterDrivers = (doc as any).lastAutoTable?.finalY ?? 60;
  doc.setFontSize(13);
  doc.text(`Contratti (${items.length})`, 14, afterDrivers + 10);

  if (items.length > 0) {
    autoTable(doc, {
      startY: afterDrivers + 14,
      head: [contractsHead()],
      body: contractsBody(items, false),
      styles: { fontSize: 7.5, cellPadding: 1.5, valign: "middle", overflow: "linebreak" },
      headStyles: { fillColor: [99, 102, 241], fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 32 } },
      didDrawCell: (hook) => {
        if (hook.section !== "body" || hook.column.index !== 0) return;
        const it = items[hook.row.index];
        const png = it ? iconMap[it.driver] : undefined;
        if (!png) return;
        const size = 4;
        const x = hook.cell.x + (hook.cell.width - size) / 2;
        const y = hook.cell.y + (hook.cell.height - size) / 2;
        doc.addImage(png, "PNG", x, y, size, size);
      },
    });
  }

  void pageW;
  doc.save(`${detailFileBase(journey)}.pdf`);
}

export function exportJourneyExcel(data: JourneyExportData): void {
  const { journey, items, drivers } = data;
  const workbook = XLSX.utils.book_new();

  const driverRows: (string | number)[][] = [
    ...detailExcelHeaderRows(journey),
    driverTableHead(),
    ...driverTableBody(drivers, true),
  ];
  const wsDriver = XLSX.utils.aoa_to_sheet(driverRows);
  wsDriver["!cols"] = [{ wch: 4 }, { wch: 18 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, wsDriver, "Driver");

  const contractRows: (string | number)[][] = [
    contractsHead(),
    ...contractsBody(items, true),
  ];
  const wsContracts = XLSX.utils.aoa_to_sheet(contractRows);
  wsContracts["!cols"] = [
    { wch: 4 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 18 },
    { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 9 },
  ];
  XLSX.utils.book_append_sheet(workbook, wsContracts, "Contratti");

  XLSX.writeFile(workbook, `${detailFileBase(journey)}.xlsx`);
}

export async function exportJourneyListPdf(data: JourneyListExportData): Promise<void> {
  const { journeys, filterLabel } = data;
  const iconMap = await buildIconMap();
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text("Customer Journey — Elenco", 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(listSubtitle(journeys, filterLabel, new Date()), 14, 25);

  const totalDrivers = CJ_DRIVER_ORDER.length;
  autoTable(doc, {
    startY: 30,
    head: [listPdfHead()],
    body: listPdfBody(journeys),
    styles: { fontSize: 8, cellPadding: 1.8, valign: "middle", overflow: "linebreak" },
    headStyles: { fillColor: [99, 102, 241], fontSize: 8, halign: "center", minCellHeight: 9 },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 20 },
      3: { cellWidth: 18 },
      4: { cellWidth: 16, halign: "center" },
      ...Object.fromEntries(
        CJ_DRIVER_ORDER.map((_, i) => [LIST_FIXED_COLS + i, { cellWidth: 16, halign: "center" }]),
      ),
    },
    didDrawCell: (hook) => {
      const driverIdx = hook.column.index - LIST_FIXED_COLS;
      if (driverIdx < 0 || driverIdx >= totalDrivers) return;
      if (hook.section === "head") {
        const png = iconMap[CJ_DRIVER_ORDER[driverIdx]];
        if (!png) return;
        const size = 5;
        const x = hook.cell.x + (hook.cell.width - size) / 2;
        const y = hook.cell.y + (hook.cell.height - size) / 2;
        doc.addImage(png, "PNG", x, y, size, size);
      }
    },
  });

  doc.save("customer_journey_elenco.pdf");
}

export function exportJourneyListExcel(data: JourneyListExportData): void {
  const { journeys, filterLabel } = data;
  const workbook = XLSX.utils.book_new();

  const rows: (string | number)[][] = [
    ...listExcelHeaderRows(journeys, filterLabel, new Date()),
    listExcelHead(),
    ...listExcelBody(journeys),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 32 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 14 },
    ...CJ_DRIVER_ORDER.map(() => ({ wch: 6 })),
  ];
  XLSX.utils.book_append_sheet(workbook, ws, "Elenco");

  XLSX.writeFile(workbook, "customer_journey_elenco.xlsx");
}
