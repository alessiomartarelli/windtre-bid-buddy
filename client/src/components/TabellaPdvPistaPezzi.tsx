import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ChevronDown, ChevronRight, Download, Table as TableIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { normalizeRsName } from "@shared/ragioneSociale";
import type { PistaCanvass } from "@/lib/bisuiteClassification";

// Tabella PDV × Pista (solo Pezzi) per la pagina Vendite BiSuite.
// Stessa struttura della tabella della Dashboard Gara Reale (RS espandibili
// nei loro PDV, colonne per pista, totali di riga e colonna) ma alimentata
// dai conteggi pezzi già classificati nella pagina Vendite: quindi stesse
// esclusioni annullate e stessi filtri data/PDV/pista attivi.
// Energia: countByPista.energia include già i pezzi CF (consumer) e P.IVA
// (business), quindi la colonna Energia è già la somma delle due categorie.
const PEZZI_PISTE: PistaCanvass[] = ["mobile", "fisso", "energia", "assicurazioni"];

export interface PdvPezziRow {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  countByPista: Partial<Record<PistaCanvass, number>>;
}

interface Props {
  rows: PdvPezziRow[];
  pistaLabels: Record<PistaCanvass, string>;
}

type Cell = number;

export function TabellaPdvPistaPezzi({ rows, pistaLabels }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { rsRows, totals, grandTotal } = useMemo(() => {
    type PdvEntry = { codicePos: string; nomeNegozio: string; perPista: Map<PistaCanvass, Cell> };
    type RsEntry = { displayName: string; perPista: Map<PistaCanvass, Cell>; pdvs: Map<string, PdvEntry> };
    const rsMap = new Map<string, RsEntry>();

    for (const pdv of rows) {
      const rsName = pdv.ragioneSociale || "Senza RS";
      const rsKey = normalizeRsName(rsName);
      if (!rsMap.has(rsKey)) {
        rsMap.set(rsKey, { displayName: rsName, perPista: new Map(), pdvs: new Map() });
      }
      const entry = rsMap.get(rsKey)!;
      if (!entry.pdvs.has(pdv.codicePos)) {
        entry.pdvs.set(pdv.codicePos, { codicePos: pdv.codicePos, nomeNegozio: pdv.nomeNegozio, perPista: new Map() });
      }
      const pdvEntry = entry.pdvs.get(pdv.codicePos)!;
      for (const pista of PEZZI_PISTE) {
        const n = pdv.countByPista[pista] || 0;
        if (n === 0) continue;
        pdvEntry.perPista.set(pista, (pdvEntry.perPista.get(pista) || 0) + n);
        entry.perPista.set(pista, (entry.perPista.get(pista) || 0) + n);
      }
    }

    const rsRows = Array.from(rsMap.entries())
      .map(([rsKey, data]) => ({
        rsKey,
        displayName: data.displayName,
        perPista: data.perPista,
        pdvList: Array.from(data.pdvs.values()).sort((a, b) => a.nomeNegozio.localeCompare(b.nomeNegozio)),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const totals = new Map<PistaCanvass, number>();
    let grandTotal = 0;
    for (const rs of rsRows) {
      for (const pista of PEZZI_PISTE) {
        const n = rs.perPista.get(pista) || 0;
        totals.set(pista, (totals.get(pista) || 0) + n);
        grandTotal += n;
      }
    }
    return { rsRows, totals, grandTotal };
  }, [rows]);

  const sumRow = (perPista: Map<PistaCanvass, Cell>) =>
    PEZZI_PISTE.reduce((acc, p) => acc + (perPista.get(p) || 0), 0);

  const toggleRs = (rsKey: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(rsKey)) next.delete(rsKey); else next.add(rsKey);
      return next;
    });
  };
  const allKeys = rsRows.map(r => r.rsKey);
  const allExpanded = allKeys.length > 0 && allKeys.every(k => expanded.has(k));
  const noneExpanded = expanded.size === 0;

  const buildExportRows = () => {
    const header: (string | number)[] = ["Tipo", "Ragione Sociale", "Codice PDV", "Nome PDV"];
    for (const p of PEZZI_PISTE) header.push(`${pistaLabels[p]} - Pezzi`);
    header.push("Totale Pezzi");
    const out: (string | number)[][] = [header];
    for (const rs of rsRows) {
      const rsRow: (string | number)[] = ["RS", rs.displayName, "", ""];
      for (const p of PEZZI_PISTE) rsRow.push(rs.perPista.get(p) || 0);
      rsRow.push(sumRow(rs.perPista));
      out.push(rsRow);
      for (const pdv of rs.pdvList) {
        const pdvRow: (string | number)[] = ["PDV", rs.displayName, pdv.codicePos, pdv.nomeNegozio];
        for (const p of PEZZI_PISTE) pdvRow.push(pdv.perPista.get(p) || 0);
        pdvRow.push(sumRow(pdv.perPista));
        out.push(pdvRow);
      }
    }
    const totRow: (string | number)[] = ["TOTALE", "Totale complessivo", "", ""];
    for (const p of PEZZI_PISTE) totRow.push(totals.get(p) || 0);
    totRow.push(grandTotal);
    out.push(totRow);
    return out;
  };

  const baseFilename = () => `tabella-pdv-pista-pezzi_vendite_${new Date().toISOString().slice(0, 10)}`;

  const exportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet(buildExportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PDV x Pista (Pezzi)");
    XLSX.writeFile(wb, `${baseFilename()}.xlsx`);
  };

  const exportCsv = () => {
    const ws = XLSX.utils.aoa_to_sheet(buildExportRows());
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseFilename()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const allRows = buildExportRows();
    if (allRows.length <= 1) return;
    const header = allRows[0] as string[];
    const body = allRows.slice(1).map(r => r.map(v => String(v)));
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(13);
    doc.text("Tabella PDV × Pista (Pezzi) — Vendite", 8, 12);
    autoTable(doc, {
      startY: 18,
      head: [header],
      body,
      theme: "striped",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, halign: "center" },
      bodyStyles: { fontSize: 8 },
      styles: { cellPadding: 1.2, overflow: "linebreak" },
      columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 45 }, 2: { cellWidth: 22 }, 3: { cellWidth: 40 } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index >= 4) data.cell.styles.halign = "right";
        if (data.section === "body" && body[data.row.index]?.[0] === "RS") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [240, 244, 250];
        }
        if (data.section === "body" && body[data.row.index]?.[0] === "TOTALE") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [219, 234, 254];
        }
      },
      margin: { left: 8, right: 8 },
    });
    doc.save(`${baseFilename()}.pdf`);
  };

  if (rsRows.length === 0) return null;

  return (
    <Card data-testid="card-tabella-pdv-pista-pezzi">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TableIcon className="h-5 w-5 text-primary" />
            Tabella PDV × Pista (Pezzi)
          </CardTitle>
          <div className="flex gap-2 flex-wrap items-center">
            <Button size="sm" variant="outline" className="h-8" onClick={() => setExpanded(new Set(allKeys))} disabled={allExpanded} data-testid="btn-pezzi-expand-all">Espandi tutto</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setExpanded(new Set())} disabled={noneExpanded} data-testid="btn-pezzi-collapse-all">Collassa tutto</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={exportExcel} data-testid="btn-pezzi-export-excel">
              <Download className="h-3.5 w-3.5 mr-1" />Excel
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={exportCsv} data-testid="btn-pezzi-export-csv">
              <Download className="h-3.5 w-3.5 mr-1" />CSV
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={exportPdf} data-testid="btn-pezzi-export-pdf">
              <Download className="h-3.5 w-3.5 mr-1" />PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollableTable>
          <div className="max-h-[500px] overflow-y-auto min-w-max">
          <table className="w-full text-sm min-w-max" data-testid="table-pdv-pista-pezzi">
            <thead>
              <tr className="border-b">
                <th className="text-left px-3 py-2 font-medium sticky left-0 top-0 bg-muted z-20 min-w-[180px]">RS / PDV</th>
                {PEZZI_PISTE.map(p => (
                  <th key={p} className="text-right px-3 py-2 font-medium whitespace-nowrap sticky top-0 bg-muted z-10">{pistaLabels[p]}</th>
                ))}
                <th className="text-right px-3 py-2 font-semibold whitespace-nowrap sticky top-0 bg-muted z-10">Totale</th>
              </tr>
            </thead>
            <tbody>
              {rsRows.map(rs => (
                <RsGroup
                  key={rs.rsKey}
                  rs={rs}
                  expanded={expanded.has(rs.rsKey)}
                  onToggle={() => toggleRs(rs.rsKey)}
                  sumRow={sumRow}
                />
              ))}
              <tr className="border-t-2 font-bold bg-primary/5" data-testid="row-pezzi-totale">
                <td className="px-3 py-2 sticky left-0 bg-card z-10">Totale complessivo</td>
                {PEZZI_PISTE.map(p => (
                  <td key={p} className="text-right px-3 py-2 tabular-nums" data-testid={`cell-pezzi-tot-${p}`}>{totals.get(p) || 0}</td>
                ))}
                <td className="text-right px-3 py-2 tabular-nums" data-testid="cell-pezzi-tot-generale">{grandTotal}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </ScrollableTable>
      </CardContent>
    </Card>
  );
}

function RsGroup({
  rs,
  expanded,
  onToggle,
  sumRow,
}: {
  rs: { rsKey: string; displayName: string; perPista: Map<PistaCanvass, number>; pdvList: { codicePos: string; nomeNegozio: string; perPista: Map<PistaCanvass, number> }[] };
  expanded: boolean;
  onToggle: () => void;
  sumRow: (m: Map<PistaCanvass, number>) => number;
}) {
  return (
    <>
      <tr
        className="border-b bg-muted/30 font-semibold cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
        data-testid={`row-pezzi-rs-${rs.rsKey}`}
      >
        <td className="px-3 py-2 sticky left-0 bg-card z-10">
          <span className="inline-flex items-center gap-1">
            {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            {rs.displayName}
          </span>
        </td>
        {PEZZI_PISTE.map(p => (
          <td key={p} className="text-right px-3 py-2 tabular-nums">{rs.perPista.get(p) || 0}</td>
        ))}
        <td className="text-right px-3 py-2 tabular-nums font-bold">{sumRow(rs.perPista)}</td>
      </tr>
      {expanded && rs.pdvList.map(pdv => (
        <tr key={pdv.codicePos} className="border-b text-muted-foreground" data-testid={`row-pezzi-pdv-${pdv.codicePos}`}>
          <td className="px-3 py-1.5 pl-8 sticky left-0 bg-card z-10">
            <div className="truncate max-w-[220px]">{pdv.nomeNegozio}</div>
            <div className="text-[10px] font-mono">{pdv.codicePos}</div>
          </td>
          {PEZZI_PISTE.map(p => (
            <td key={p} className="text-right px-3 py-1.5 tabular-nums">{pdv.perPista.get(p) || 0}</td>
          ))}
          <td className="text-right px-3 py-1.5 tabular-nums font-medium">{sumRow(pdv.perPista)}</td>
        </tr>
      ))}
    </>
  );
}
