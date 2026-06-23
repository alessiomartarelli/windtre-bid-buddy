import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  CJ_DRIVER_LABELS, CJ_DRIVER_ORDER, CJ_ITEM_STATE_LABELS,
} from "@shared/customerJourney";
import type { CustomerJourney, CustomerJourneyItem, CjDriver } from "@shared/schema";
import { CJ_DRIVER_ICONS, CJ_DRIVER_EMOJI } from "./customerJourneyIcons";

interface DriverSummary {
  driver: string;
  activated: boolean;
  count: number;
}

export interface JourneyExportData {
  journey: CustomerJourney;
  items: CustomerJourneyItem[];
  drivers: DriverSummary[];
}

export interface JourneyListExportData {
  journeys: (CustomerJourney & { drivers: DriverSummary[] })[];
  filterLabel?: string;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("it-IT");
}

function journeyTitle(j: CustomerJourney): string {
  if (j.customerType === "azienda") return j.ragioneSociale || j.nominativo || j.customerKey;
  const full = [j.nome, j.cognome].filter(Boolean).join(" ").trim();
  return full || j.nominativo || j.customerKey;
}

function safeFileName(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "journey";
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

function driverLabel(driver: string): string {
  return CJ_DRIVER_LABELS[driver as CjDriver] || driver;
}

function itemDescription(it: CustomerJourneyItem): string {
  return it.descrizione || it.tipologia || it.categoria || "—";
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
  const meta = [
    `${journey.customerType === "azienda" ? "P.IVA" : "CF"}: ${journey.customerKey}`,
    journey.telefono ? `Tel: ${journey.telefono}` : "",
    journey.codiceCliente ? `Cod. cliente: ${journey.codiceCliente}` : "",
    `Aperta il ${fmtDate(journey.openedAt)}`,
  ].filter(Boolean).join("  ·  ");
  doc.text(meta, 14, 34);

  const driverMap = new Map(drivers.map((d) => [d.driver, d]));

  // Sezione Driver: icona + nome + stato.
  doc.setFontSize(13);
  doc.setTextColor(40, 40, 40);
  doc.text("Driver", 14, 44);

  autoTable(doc, {
    startY: 48,
    head: [["", "Driver", "Stato", "Contratti"]],
    body: CJ_DRIVER_ORDER.map((driver) => {
      const s = driverMap.get(driver);
      return [
        "",
        driverLabel(driver),
        s?.activated ? "Attivato" : "Attivabile",
        String(s?.count ?? 0),
      ];
    }),
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
      head: [[
        "", "Driver", "Descrizione", "Contratto", "Addetto", "PDV",
        "IMEI", "RATA/CANONE", "Inserito", "Attivato", "Stato", "Gettone",
      ]],
      body: items.map((it) => [
        "",
        driverLabel(it.driver),
        itemDescription(it),
        it.codiceContratto || "—",
        it.addetto || "—",
        it.pdvDestinazione || it.pdvOrigine || "—",
        it.imei || "—",
        it.rata ? `€ ${it.rata}` : it.canone ? `€ ${it.canone}` : "—",
        fmtDate(it.dataInserimento),
        fmtDate(it.dataAttivazione),
        CJ_ITEM_STATE_LABELS[it.state as keyof typeof CJ_ITEM_STATE_LABELS] || it.state,
        it.gettoneConfirmed ? "Sì" : "No",
      ]),
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
  doc.save(`customer_journey_${safeFileName(journeyTitle(journey))}.pdf`);
}

export function exportJourneyExcel(data: JourneyExportData): void {
  const { journey, items, drivers } = data;
  const driverMap = new Map(drivers.map((d) => [d.driver, d]));
  const workbook = XLSX.utils.book_new();

  const headerRows: (string | number)[][] = [
    ["Customer Journey"],
    [journeyTitle(journey)],
    [`${journey.customerType === "azienda" ? "P.IVA" : "CF"}`, journey.customerKey],
    ["Telefono", journey.telefono || "—"],
    ["Cod. cliente", journey.codiceCliente || "—"],
    ["Aperta il", fmtDate(journey.openedAt)],
    [],
  ];

  const driverRows: (string | number)[][] = [
    ...headerRows,
    ["", "Driver", "Stato", "Contratti"],
    ...CJ_DRIVER_ORDER.map((driver) => {
      const s = driverMap.get(driver);
      return [
        CJ_DRIVER_EMOJI[driver] || "",
        driverLabel(driver),
        s?.activated ? "Attivato" : "Attivabile",
        s?.count ?? 0,
      ];
    }),
  ];
  const wsDriver = XLSX.utils.aoa_to_sheet(driverRows);
  wsDriver["!cols"] = [{ wch: 4 }, { wch: 18 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, wsDriver, "Driver");

  const contractHead = [
    "", "Driver", "Descrizione", "Contratto", "Addetto", "PDV",
    "IMEI", "RATA/CANONE", "Inserito", "Attivato", "Stato", "Gettone",
  ];
  const contractRows: (string | number)[][] = [
    contractHead,
    ...items.map((it) => [
      CJ_DRIVER_EMOJI[it.driver as CjDriver] || "",
      driverLabel(it.driver),
      itemDescription(it),
      it.codiceContratto || "—",
      it.addetto || "—",
      it.pdvDestinazione || it.pdvOrigine || "—",
      it.imei || "—",
      it.rata ? `€ ${it.rata}` : it.canone ? `€ ${it.canone}` : "—",
      fmtDate(it.dataInserimento),
      fmtDate(it.dataAttivazione),
      CJ_ITEM_STATE_LABELS[it.state as keyof typeof CJ_ITEM_STATE_LABELS] || it.state,
      it.gettoneConfirmed ? "Sì" : "No",
    ]),
  ];
  const wsContracts = XLSX.utils.aoa_to_sheet(contractRows);
  wsContracts["!cols"] = [
    { wch: 4 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 18 },
    { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 9 },
  ];
  XLSX.utils.book_append_sheet(workbook, wsContracts, "Contratti");

  XLSX.writeFile(workbook, `customer_journey_${safeFileName(journeyTitle(journey))}.xlsx`);
}

function journeyDriverMap(
  j: CustomerJourney & { drivers: DriverSummary[] },
): Map<string, DriverSummary> {
  return new Map((j.drivers ?? []).map((d) => [d.driver, d]));
}

function activeDriverCount(j: CustomerJourney & { drivers: DriverSummary[] }): number {
  const m = journeyDriverMap(j);
  return CJ_DRIVER_ORDER.filter((d) => m.get(d)?.activated).length;
}

// Numero di colonne fisse (non-driver) prima delle colonne per-driver,
// usato per mappare l'indice colonna ↔ driver nei callback di disegno.
const LIST_FIXED_COLS = 5;

export async function exportJourneyListPdf(data: JourneyListExportData): Promise<void> {
  const { journeys, filterLabel } = data;
  const iconMap = await buildIconMap();
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text("Customer Journey — Elenco", 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  const subtitle = [
    `${journeys.length} journey`,
    filterLabel,
    `Esportato il ${fmtDate(new Date())}`,
  ].filter(Boolean).join("  ·  ");
  doc.text(subtitle, 14, 25);

  const totalDrivers = CJ_DRIVER_ORDER.length;
  autoTable(doc, {
    startY: 30,
    head: [[
      "Cliente", "Tipo", "CF/P.IVA", "Stato", "Driver",
      ...CJ_DRIVER_ORDER.map(() => ""),
    ]],
    body: journeys.map((j) => {
      const m = journeyDriverMap(j);
      return [
        journeyTitle(j),
        j.customerType === "azienda" ? "Business" : "Privato",
        j.customerKey,
        j.status === "aperta" ? "Aperta" : "Chiusa",
        `${activeDriverCount(j)}/${totalDrivers}`,
        ...CJ_DRIVER_ORDER.map((d) => (m.get(d)?.activated ? "Si" : "")),
      ];
    }),
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
  const totalDrivers = CJ_DRIVER_ORDER.length;

  const headerRows: (string | number)[][] = [
    ["Customer Journey — Elenco"],
    [`${journeys.length} journey`],
  ];
  if (filterLabel) headerRows.push([filterLabel]);
  headerRows.push([`Esportato il ${fmtDate(new Date())}`]);
  headerRows.push([]);

  const tableHead = [
    "Cliente", "Tipo", "CF/P.IVA", "Telefono", "Stato", "Driver attivati",
    ...CJ_DRIVER_ORDER.map((d) => CJ_DRIVER_EMOJI[d] || driverLabel(d)),
  ];

  const rows: (string | number)[][] = [
    ...headerRows,
    tableHead,
    ...journeys.map((j) => {
      const m = journeyDriverMap(j);
      return [
        journeyTitle(j),
        j.customerType === "azienda" ? "Business" : "Privato",
        j.customerKey,
        j.telefono || "—",
        j.status === "aperta" ? "Aperta" : "Chiusa",
        `${activeDriverCount(j)}/${totalDrivers}`,
        ...CJ_DRIVER_ORDER.map((d) => (m.get(d)?.activated ? "Sì" : "")),
      ];
    }),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 32 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 14 },
    ...CJ_DRIVER_ORDER.map(() => ({ wch: 6 })),
  ];
  XLSX.utils.book_append_sheet(workbook, ws, "Elenco");

  XLSX.writeFile(workbook, "customer_journey_elenco.xlsx");
}
